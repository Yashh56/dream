import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** One stateless JSON MCP request. Authentication belongs to the caller. */
export const createMcpRequestHandler = ({ name, tools }) => {
  const server = new McpServer({ name, version: "1.0.0" });
  for (const [toolName, definition] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        ...(definition.annotations
          ? { annotations: definition.annotations }
          : {}),
        description: definition.description,
        inputSchema: definition.inputSchema.shape,
      },
      (args, extra) => definition.handler(args ?? {}, extra),
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  return async (request) => {
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      void server.close().catch(() => {});
    }
  };
};
