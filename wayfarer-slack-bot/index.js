// index.js (ESM)
import bolt from "@slack/bolt";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const { App } = bolt;

const app = new App({
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN,
  // signingSecret is not required in Socket Mode; keep it only if you also expose HTTP routes
  // signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// ---- Config (unchanged) ----
const AGENT_API_BASE = "http://localhost:8000";
const AGENT_NAME = "TARS";

// ---- Helper: get Slack user identity (email/name) ----
async function getSlackUserIdentity({ client }, userId) {
  // You need 'users:read.email' (for email) and 'users:read' scopes
  const { user } = await client.users.info({ user: userId });
  // Some workspaces restrict email; handle nulls gracefully

  console.log('@@@ user :', JSON.stringify(user));

  return {
    id: user?.id,
    name: user?.profile?.real_name || user?.real_name || user?.name || user?.id,
    email: user?.profile?.email || null,
  };
}

// ---- Agent session creation (unchanged) ----
async function createSession(userId, sessionId) {
  try {
    const response = await fetch(`${AGENT_API_BASE}/apps/${AGENT_NAME}/users/${userId}/sessions/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          platform: "slack",
          timestamp: new Date().toISOString(),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }
    console.log(`Session created for user ${userId}, session ${sessionId}`);
    return true;
  } catch (error) {
    console.error("Error creating session:", error);
    return false;
  }
}

// ---- Agent call (optionally include identity now; JWTs come in Step 2) ----
async function callTarsAgent(userIdentity, sessionId, message) {
  try {
    const payload = {
      app_name: AGENT_NAME,
      user_id: userIdentity.id, // keep your original contract
      session_id: sessionId,
      new_message: {
        role: "user",
        parts: [{ text: message }],
      },
      // Optional: include identity hint for tracing (POC only; safe to remove later)
      // _user_context: { email: userIdentity.email, name: userIdentity.name },
    };

    const response = await fetch(`${AGENT_API_BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to call agent: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log("Agent response:", result);

    // Extract text as you already do
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
  // Guardrails
  if (!message?.text) return;
  if (message.subtype === "bot_message") return;        // ignore bot messages
  if (message.channel_type !== "im") return;            // only DMs for this POC

  const userId = message.user;
  const sessionId = `slack_${userId}_${Date.now()}`;

  try {
    // 1) Resolve Slack identity (email/name)
    const userIdentity = await getSlackUserIdentity({ client }, userId);
    logger.info({ userIdentity }, "Resolved Slack user identity");

    // 2) Create agent session
    const sessionCreated = await createSession(userId, sessionId);
    if (!sessionCreated) {
      await say({ text: "Sorry, I'm having trouble starting a new conversation session." });
      return;
    }

    // 3) Call agent
    const agentResponse = await callTarsAgent(userIdentity, sessionId, message.text);

    // 4) Reply
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
