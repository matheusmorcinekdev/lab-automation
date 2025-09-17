// index.js (ESM)
import bolt from "@slack/bolt";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const { App } = bolt;

const app = new App({
  socketMode: true, // for POC only
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN,
});

// ---- Config ----
const AGENT_API_BASE = process.env.AGENT_API_BASE || "http://localhost:8000";
const AGENT_NAME = process.env.AGENT_NAME || "TARS";

// whether to send X-Actor-* (server will only honor them if the token has can_impersonate) *****
const SEND_ACTOR_HEADERS = process.env.SEND_ACTOR_HEADERS !== "false";

// ---- Keycloak S2S token (client_credentials) with simple in-memory cache ----
let _kc = { token: null, exp: 0 };
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_kc.token && now < _kc.exp - 30) return _kc.token; // reuse until ~30s before expiry

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.KC_CLIENT_ID);       // e.g., "bolt-client"
  params.append("client_secret", process.env.KC_CLIENT_SECRET);

  const url = `${process.env.KC_URL}/realms/${process.env.KC_REALM}/protocol/openid-connect/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak token error: ${res.status} ${res.statusText} - ${text}`);
  }

  const data = await res.json();
  // parse exp for caching
  try {
    const payload = JSON.parse(Buffer.from(data.access_token.split(".")[1], "base64").toString());
    _kc = { token: data.access_token, exp: payload.exp || now + (data.expires_in || 300) };
  } catch {
    _kc = { token: data.access_token, exp: now + (data.expires_in || 300) };
  }
  return _kc.token;
}

// ---- Small wrapper to auto-attach Authorization + identity headers ----
async function fetchWithAuth(url, { userIdentity, ...init } = {}) {
  const token = await getAccessToken();
  const headers = {
    ...(init.headers || {}),
    "Authorization": `Bearer ${token}`,
  };

  console.log('@@@ fetchWithAuth: ', userIdentity);

  if (SEND_ACTOR_HEADERS && userIdentity) {
    if (userIdentity.name) headers["X-Actor-User"] = userIdentity.name;
    if (userIdentity.email) headers["X-Actor-Email"] = userIdentity.email;
  }

  return fetch(url, { ...init, headers });
}

// ---- Helper: get Slack user identity (email/name) ----
async function getSlackUserIdentity({ client }, userId) {
  const { user } = await client.users.info({ user: userId });
  return {
    id: user?.id,
    name: user?.profile?.real_name || user?.real_name || user?.name || user?.id,
    email: user?.profile?.email || null,
  };
}

// ---- Agent session creation (now authenticated) ----
async function createSession(userId, sessionId, userIdentity) {
  const response = await fetchWithAuth(
    `${AGENT_API_BASE}/apps/${AGENT_NAME}/users/${userId}/sessions/${sessionId}`,
    {
      method: "POST",
      userIdentity, // only used to add X-Actor-* (optional)
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          identity: {
            source: "slack",
            user: {
              id: userIdentity.id,
              name: userIdentity.name,
              email: userIdentity.email,
            },
          },
          platform: "slack",
          timestamp: new Date().toISOString(),
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create session: ${response.status} ${response.statusText} - ${text}`);
  }
  return true;
}

// ---- Agent call (now authenticated + optional identity headers) ----
async function callTarsAgent(userIdentity, sessionId, message) {
  try {
    const payload = {
      app_name: AGENT_NAME,
      user_id: userIdentity.id,
      session_id: sessionId,
      new_message: { role: "user", parts: [{ text: message }] },
    };

    const response = await fetchWithAuth(`${AGENT_API_BASE}/run`, {
      method: "POST",
      userIdentity,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      // token might be expired or audience mismatch; try refresh once
      _kc = { token: null, exp: 0 };
      const retry = await fetchWithAuth(`${AGENT_API_BASE}/run`, {
        method: "POST",
        userIdentity,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`Agent call failed (after refresh): ${retry.status} ${retry.statusText} - ${text}`);
      }
      return await retry.json();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent call failed: ${response.status} ${response.statusText} - ${text}`);
    }

    const result = await response.json();
    // your extraction logic stays as-is
    if (Array.isArray(result) && result.length > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        const event = result[i];
        if (event.content?.parts?.length) {
          const part = event.content.parts[0];
          if (part.text && typeof part.text === "string" && part.text.trim() !== "") {
            return part.text;
          }
        }
      }
    } else if (result.content?.parts?.length) {
      return result.content.parts[0].text;
    } else if (result.text) {
      return result.text;
    }
    return "I received your message but couldn't process a response.";
  } catch (error) {
    console.error("Error calling TARS agent:", error);
    return "Sorry, I'm having trouble connecting to my brain right now.";
  }
}

// ---- Listener ----
app.message(async ({ message, say, client, logger }) => {
  if (!message?.text) return;
  if (message.subtype === "bot_message") return;
  if (message.channel_type !== "im") return;

  const userId = message.user;
  const sessionId = `slack_${userId}_${Date.now()}`;

  try {
    const userIdentity = await getSlackUserIdentity({ client }, userId);
    logger.info({ userIdentity }, "Resolved Slack user identity");

    const sessionCreated = await createSession(userId, sessionId, userIdentity);
    if (!sessionCreated) {
      await say({ text: "Sorry, I'm having trouble starting a new conversation session." });
      return;
    }

    const agentResponse = await callTarsAgent(userIdentity, sessionId, message.text);
    await say({ text: agentResponse });
  } catch (error) {
    console.error("Error processing message:", error);
    await say({ text: "Sorry, something went wrong while processing your message." });
  }
});

// ---- Start ----
(async () => {
  await app.start();
  console.log("⚡️ Bot running locally (Socket Mode)");
  console.log(`🤖 TARS Agent integration enabled - API: ${AGENT_API_BASE}`);
})();
