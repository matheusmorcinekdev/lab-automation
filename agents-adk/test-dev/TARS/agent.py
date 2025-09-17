from google.adk.agents import Agent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters, SseConnectionParams, StreamableHTTPConnectionParams
import os

from TARS.prompt import DB_MCP_PROMPT


root_agent = Agent(
    name="TARS",
    model="gemini-2.0-flash",
    description="TARS from Interstellar movie",
    instruction=DB_MCP_PROMPT,
    tools=[
          MCPToolset(
              connection_params=SseConnectionParams(
                    url="https://api.githubcopilot.com/mcp/",
                     headers={"Authorization": f"Bearer {os.environ['GITHUB_MCP_PAT']}"},
                ),
           )
                    
            # get_special_message, 
            # get_special_message, 
            # get_auth_bearer_token,
        #    call_node_script, 
        #    get_bitcoin_price,
        #    MCPToolset(
        #         connection_params=StdioServerParameters(
        #             command="npx",
        #             args=["-y", "@modelcontextprotocol/server-puppeteer"],
        #             env={
        #                 "PUPPETEER_LAUNCH_OPTIONS": '{"headless": true, "timeout": 30000, "defaultViewport": {"width": 375, "height": 812, "deviceScaleFactor": 3, "isMobile": true, "hasTouch": true, "isLandscape": false}, "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"}',
        #                 "ALLOW_DANGEROUS": "true"
        #             }
        #         )
        #    ),
        #    MCPToolset(
        #         connection_params=StdioServerParameters(
        #             command="npx",
        #             args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/matheusmorcinek/Developer/Freestar/my-agents/TARS"],
        #             env={
        #                 "PUPPETEER_LAUNCH_OPTIONS": '{"headless": true, "timeout": 30000, "defaultViewport": {"width": 375, "height": 812, "deviceScaleFactor": 3, "isMobile": true, "hasTouch": true, "isLandscape": false}, "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"}',
        #                 "ALLOW_DANGEROUS": "true"
        #             }
        #         )
        #    ),
        #    MCPToolset(
        #        connection_params=StdioServerParameters(
        #            command="node",
        #            args=[LOCAL_MPC_TEST_PATH]
        #        )
        #    ),
        #    MCPToolset(
        #        connection_params=StdioServerParameters(
        #            command="npx",
        #            args=["-y", "@playwright/mcp@latest"]
        #        )
        #    )]
        #    MCPToolset(
        #        connection_params=StdioServerParameters(
        #            command="uv",
        #            args=["run", "--with", "fastmcp", "fastmcp", "run", "TARS/mcp_auth.py"]
        #        )
        #    )]
        #    MCPToolset(
        #       connection_params=StreamableHTTPConnectionParams(
        #             url="http://127.0.0.1:3000/mcp",
        #         ),
        #    )
        #    MCPToolset(
        #        connection_params=StdioServerParameters(
        #            command="uv",
        #            args=["run", "--with", "fastmcp", "fastmcp", "run", "TARS/accounts-server.py"]
        #         #    args=["run", "--with", "fastmcp", "fastmcp", "run", "TARS/mcp_server_original.py"]
        #        )
        #    )
        #     MCPToolset(
        #         connection_params=StdioServerParameters(
        #             command="npx",
        #             args=["-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"],
        #         )
        #    ),
        #     MCPToolset(
        #     connection_params=SseConnectionParams(
        #         url="https://docs.mcp.cloudflare.com/sse",

        #     )
        # )
           ]
)