from google.adk.agents import Agent

# # Hypothetical callback function
# def validate_tool_params(
#     callback_context: CallbackContext, # Correct context type
#     tool: BaseTool,
#     args: Dict[str, Any],
#     tool_context: ToolContext
#     ) -> Optional[Dict]: # Correct return type for before_tool_callback

#   print(f"Callback triggered for tool: {tool.name}, args: {args}")

#   # Example validation: Check if a required user ID from state matches an arg
#   expected_user_id = callback_context.state.get("session_user_id")
#   actual_user_id_in_args = args.get("user_id_param") # Assuming tool takes 'user_id_param'

#   if actual_user_id_in_args != expected_user_id:
#       print("Validation Failed: User ID mismatch!")
#       # Return a dictionary to prevent tool execution and provide feedback
#       return {"error": f"Tool call blocked: User ID mismatch."}

#   # Return None to allow the tool call to proceed if validation passes
#   print("Callback validation passed.")
#   return None

def get_current_time(city:str) -> dict:
    """Returns the current time in a specified city.

    Args:
        dict: A dictionary containing the current time for a specified city information with a 'status' key ('success' or 'error') and a 'report' key with the current time details in a city if successful, or an 'error_message' if an error occurred.
    """
    import datetime
    from zoneinfo import ZoneInfo

    if city.lower() == "new york":
        tz_identifier = "America/New_York"
    else:
        return {"status": "error",
                "error_message": f"Sorry, I don't have timezone information for {city}."}

    tz = ZoneInfo(tz_identifier)
    now = datetime.datetime.now(tz)
    return {"status": "success",
            "report": f"""The current time in {city} is {now.strftime("%Y-%m-%d %H:%M:%S %Z%z")}"""}

root_agent = Agent(
    name="weather_time_agent",
    model="gemini-2.0-flash",
    description="Agent to answer questions about the time in a city.",
    instruction="I can answer your questions about the time in a city.",
    # before_tool_callback=validate_tool_params,
    tools=[get_current_time]
)