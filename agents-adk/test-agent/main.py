# main.py
# This is the main entry point for our secure agent application
# It sets up authentication using JWT tokens from Keycloak and protects all agent endpoints

import os
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from jose import jwt  # Library for handling JWT (JSON Web Tokens)
from google.adk.cli.fast_api import get_fast_api_app

# Import our custom agent instance
# We need to add the wayfarer-agent directory to Python's path so we can import it
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'wayfarer-agent'))
from agent import root_agent  # This is our actual agent that handles user requests

# ---- Security Configuration ----
# These settings tell our app how to connect to Keycloak (our authentication server)
REALM_URL = os.getenv("KC_REALM_URL", "http://localhost:8080/realms/master")  # Where Keycloak is running
AUDIENCE  = os.getenv("KC_AUDIENCE", "adk-client")   # The client ID that tokens must be issued for

# ---- Fetch Keycloak Security Information on Startup ----
# When the app starts, we need to get Keycloak's public keys to verify JWT tokens
# OIDC = OpenID Connect (a standard for authentication)
# JWKS = JSON Web Key Set (contains the public keys for verifying token signatures)
print("Fetching security configuration from Keycloak...")
with httpx.Client(timeout=5.0) as c:
    # Get Keycloak's configuration (tells us where to find the public keys)
    oidc = c.get(f"{REALM_URL}/.well-known/openid-configuration").json()
    # Get the actual public keys that we'll use to verify JWT signatures
    jwks = c.get(oidc["jwks_uri"]).json()
print("Security configuration loaded successfully")

def _find_key(header):
    """
    Helper function to find the correct public key for verifying a JWT token.
    Each JWT token has a 'kid' (key ID) in its header that tells us which public key to use.
    """
    kid = header.get("kid")  # Get the key ID from the token header
    # Look through all available public keys to find the one with matching ID
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None  # No matching key found

def verify_bearer(token: str):
    """
    This is the core security function that validates JWT tokens.
    It performs several security checks to ensure the token is legitimate.
    """
    # Step 1: Extract the token header (without verifying signature yet)
    header = jwt.get_unverified_header(token)
    
    # Step 2: Find the correct public key to verify this token's signature
    key = _find_key(header)
    if not key:
        raise HTTPException(status_code=401, detail="Unknown key id (kid)")

    # Step 3: Verify the token's signature and validate its claims
    # This is where the magic happens - we verify the token was actually issued by Keycloak
    claims = jwt.decode(
        token,
        key,  # The public key to verify the signature
        algorithms=[key.get("alg", "RS256")],  # The encryption algorithm used
        audience=AUDIENCE,  # Verify the token was issued for our specific client
        options={"verify_at_hash": False},  # Skip some checks that aren't needed for client credentials
    )

    # Step 4: Verify the token was issued by our trusted Keycloak server
    if claims.get("iss") != REALM_URL:
        raise HTTPException(status_code=401, detail="Bad issuer")
    
    # If we get here, the token is valid! Return the user's information
    return claims

# ---- Create the Agent Application ----
# This creates the basic agent app using Google's ADK (Agent Development Kit)
# The agent is defined in wayfarer-agent/agent.py and exports 'root_agent'
adk_app: FastAPI = get_fast_api_app(agents_dir=".", web=True)

# ---- Create Our Secure Application Wrapper ----
# We create our own FastAPI app that will wrap the agent app with security
# This allows us to add authentication before requests reach the agent
app = FastAPI(title="Secure Agent API", description="Agent protected with JWT authentication")

@app.middleware("http")
async def auth_and_headers(request: Request, call_next):
    """
    This middleware runs before every request to our agent.
    It's like a security guard that checks everyone before they can enter.
    """
    
    # Allow public access to health check endpoint (no authentication required)
    if request.url.path.startswith("/healthz"):
        return await call_next(request)

    # For all other endpoints, require a valid JWT token
    # Look for the Authorization header (case-insensitive)
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    
    # Check if the header exists and starts with "Bearer " (the standard format)
    if not auth or not auth.lower().startswith("bearer "):
        return JSONResponse({"detail": "Missing bearer token"}, status_code=401)

    # Extract just the token part (remove "Bearer " prefix)
    token = auth.split(" ", 1)[1].strip()

    # Verify the token is valid and get user information from it
    try:
        claims = verify_bearer(token)
    except HTTPException as e:
        # If token verification fails, return an error
        return JSONResponse({"detail": e.detail}, status_code=e.status_code)

    # ---- Role-Based Impersonation Security ----
    # Check if the authenticated user has permission to impersonate other users
    roles = (claims.get("realm_access", {}) or {}).get("roles", []) or []
    allows_impersonation = "can_impersonate" in roles

    # Get the user identity from the token (the actual authenticated user)
    actor_user_from_token  = claims.get("preferred_username") or claims.get("sub")
    actor_email_from_token = claims.get("email")

    if allows_impersonation:
        # User has impersonation rights - they can set X-Actor-User/X-Actor-Email headers
        # to act on behalf of another user (useful for admin/support scenarios)
        actor_user  = request.headers.get("X-Actor-User")  or actor_user_from_token
        actor_email = request.headers.get("X-Actor-Email") or actor_email_from_token
    else:
        # User cannot impersonate - ignore any custom headers and use only token identity
        # This prevents regular users from spoofing other users' identities
        actor_user  = actor_user_from_token
        actor_email = actor_email_from_token

    # Store the final user information in the request so the agent can access it
    request.state.actor = {
        "user": actor_user,
        "email": actor_email,
        "claims": claims,   # Keep claims if you want to forward token-derived context
    }

    # If we get here, authentication was successful - allow the request to continue
    return await call_next(request)


# ---- Public Health Check Endpoint ----
# This endpoint is accessible without authentication and is used to check if the service is running
@app.get("/healthz")
def healthz():
    """
    Health check endpoint that returns the status of the service.
    This is typically used by load balancers and monitoring systems.
    """
    return {"ok": True}

# ---- Mount the Agent Application ----
# This connects our secure wrapper to the actual agent application
# All requests to the agent will now go through our authentication middleware first
app.mount("/", adk_app)
