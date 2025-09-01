from google.adk.agents import Agent

# # Security Callback Function (Currently Disabled)
# This is an example of how you could add additional security validation
# for tool calls. It would run before each tool is executed to check
# if the user is allowed to use that tool with those specific parameters.
# 
# def validate_tool_params(
#     callback_context: CallbackContext, # Contains user session information
#     tool: BaseTool,                    # The tool being called
#     args: Dict[str, Any],             # The arguments passed to the tool
#     tool_context: ToolContext         # Additional context about the tool call
#     ) -> Optional[Dict]:              # Return None to allow, or dict to block

#   print(f"🔍 Security check for tool: {tool.name}, args: {args}")

#   # Example: Check if the user ID in the tool arguments matches the logged-in user
#   expected_user_id = callback_context.state.get("session_user_id")
#   actual_user_id_in_args = args.get("user_id_param")

#   if actual_user_id_in_args != expected_user_id:
#       print("❌ Security validation failed: User ID mismatch!")
#       # Return an error to prevent the tool from running
#       return {"error": f"Tool call blocked: User ID mismatch."}

#   # Return None to allow the tool call to proceed
#   print("✅ Security validation passed.")
#   return None

def get_current_time(city: str) -> dict:
    """
    Tool function that returns the current time in a specified city.
    This is an example tool that the agent can use to answer time-related questions.
    
    Args:
        city (str): The name of the city to get the time for
        
    Returns:
        dict: A dictionary with either:
            - status: "success" and report: time information, OR
            - status: "error" and error_message: explanation of what went wrong
    """
    import datetime
    from zoneinfo import ZoneInfo  # Python's timezone library

    # For this example, we only support New York timezone
    # In a real application, you might support many more cities
    if city.lower() == "new york":
        tz_identifier = "America/New_York"  # Standard timezone identifier
    else:
        # Return an error if we don't support the requested city
        return {
            "status": "error",
            "error_message": f"Sorry, I don't have timezone information for {city}. Currently only 'New York' is supported."
        }

    # Get the current time in the specified timezone
    tz = ZoneInfo(tz_identifier)
    now = datetime.datetime.now(tz)
    
    # Format the time nicely and return success response
    return {
        "status": "success",
        "report": f"The current time in {city} is {now.strftime('%Y-%m-%d %H:%M:%S %Z%z')}"
    }

def my_session_state_test_tool(tool_context) -> dict:
    """
    Tool function that returns the current session state information.
    This tool demonstrates how to access session state data that was
    populated by the middleware (user, email, etc.).
    
    Args:
        tool_context: The tool context object containing session state
        
    Returns:
        dict: A dictionary with:
            - status: "success"
            - message: A descriptive message about the session state
            - state: The current session state data
    """
    try:
        # Extract session state from tool context
        # Handle different types of tool_context objects
        if hasattr(tool_context, 'state'):
            # Convert ADK State object to a serializable dict
            if hasattr(tool_context.state, 'model_dump'):
                # If it's a Pydantic model, convert to dict
                session_state = tool_context.state.model_dump()
            elif hasattr(tool_context.state, '__dict__'):
                # If it has __dict__, use that
                session_state = tool_context.state.__dict__.copy()
            else:
                # Try to convert to dict directly
                session_state = dict(tool_context.state) if hasattr(tool_context.state, '__iter__') else {}
        else:
            session_state = {}
        
        # Handle nested state structure (state.state)
        if 'state' in session_state and isinstance(session_state['state'], dict):
            # Extract the nested state data
            nested_state = session_state['state']
            if 'identity' in nested_state and 'user' in nested_state['identity']:
                user_info = nested_state['identity']['user']
                user = user_info.get('name', 'Unknown')
                email = user_info.get('email', 'No email')
                user_id = user_info.get('id', 'Unknown ID')
                source = nested_state['identity'].get('source', 'Unknown')
                platform = nested_state.get('platform', 'Unknown')
                timestamp = nested_state.get('timestamp', 'Unknown')
                
                message = f"Current session state retrieved successfully. User: {user} ({user_id}), Email: {email}, Source: {source}, Platform: {platform}, Timestamp: {timestamp}"
            else:
                message = f"Session state found but user identity not available. State keys: {list(nested_state.keys())}"
        else:
            # Fallback to direct state access
            user = session_state.get('user', 'Unknown')
            email = session_state.get('email', 'No email')
            message = f"Current session state retrieved successfully. User: {user}, Email: {email}"
        
        return {
            "status": "success",
            "message": message,
            "state": session_state
        }
    except Exception as e:
        # Fallback in case of any serialization issues
        return {
            "status": "success",
            "message": f"Session state retrieved but encountered serialization issue: {str(e)}",
            "state": {"error": "Serialization issue", "details": str(e)}
        }

# ---- Create the Agent Instance ----
# This is where we define our actual AI agent with its capabilities and behavior
root_agent = Agent(
    name="wayfarer",                    # Internal name for the agent
    model="gemini-2.0-flash",                     # The AI model to use (Google's Gemini)
    description="Agent to answer questions about the time in a city.",  # What the agent does
    instruction="I can answer your questions about the time in a city.",  # How the agent should behave
    # before_tool_callback=validate_tool_params,  # Optional: security validation (currently disabled)
    tools=[my_session_state_test_tool]  # List of tools/functions the agent can use
)