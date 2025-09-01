# main.py
import os
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from jose import jwt
from google.adk.cli.fast_api import get_fast_api_app

# import your agent instance
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'wayfarer-agent'))
from agent import root_agent

# ---- Configure via env (defaults match your screenshots) ----
REALM_URL = os.getenv("KC_REALM_URL", "http://localhost:8080/realms/master")
AUDIENCE  = os.getenv("KC_AUDIENCE", "adk-client")   # your Keycloak Client ID

# ---- Fetch OIDC config + JWKS on startup (simple in-memory cache) ----
with httpx.Client(timeout=5.0) as c:
    oidc = c.get(f"{REALM_URL}/.well-known/openid-configuration").json()
    jwks = c.get(oidc["jwks_uri"]).json()

def _find_key(header):
    kid = header.get("kid")
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None

def verify_bearer(token: str):
    header = jwt.get_unverified_header(token)
    key = _find_key(header)
    if not key:
        raise HTTPException(status_code=401, detail="Unknown key id (kid)")

    # Validate signature, audience, etc.
    claims = jwt.decode(
        token,
        key,
        algorithms=[key.get("alg", "RS256")],
        audience=AUDIENCE,
        options={"verify_at_hash": False},  # fine for client_credentials
    )

    if claims.get("iss") != REALM_URL:
        raise HTTPException(status_code=401, detail="Bad issuer")
    return claims

# ---- Build the vanilla ADK app from your agent object ----
# Your agent file is test-agent/wayfarer-agent/agent.py
# which exports root_agent, so the import path is:
# "wayfarer-agent.agent:root_agent"
adk_app: FastAPI = get_fast_api_app(agents_dir=".", web=True)
# ---- Our outer FastAPI app with auth + header capture ----
app = FastAPI()

@app.middleware("http")
async def auth_and_headers(request: Request, call_next):
    # Skip auth for public endpoints like /healthz
    if request.url.path.startswith("/healthz"):
        return await call_next(request)

    # Require Bearer token for everything else
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return JSONResponse({"detail": "Missing bearer token"}, status_code=401)

    token = auth.split(" ", 1)[1].strip()

    try:
        claims = verify_bearer(token)
    except HTTPException as e:
        return JSONResponse({"detail": e.detail}, status_code=e.status_code)

    # Capture identity from headers or fallback to token claims
    actor_user = request.headers.get("X-Actor-User") or claims.get("preferred_username") or claims.get("sub")
    actor_email = request.headers.get("X-Actor-Email") or claims.get("email")
    request.state.actor = {"user": actor_user, "email": actor_email, "claims": claims}

    return await call_next(request)


# Add health endpoint directly to main app (before mounting ADK)
@app.get("/healthz")
def healthz():
    return {"ok": True}

# Protect all ADK endpoints
app.mount("/", adk_app)
