/**
 * MCP (Model Context Protocol) client.
 * Connects to configured MCP servers and fetches tool schemas dynamically.
 * Routes tool execution requests to the appropriate MCP server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import type { McpServerConfig } from '../config.js';
import { logger } from '../logger.js';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  tools: Tool[];
}

const connectedServers: ConnectedServer[] = [];

/** Connect to all configured MCP servers and fetch their tool schemas. */
export async function initializeMcpServers(serverConfigs: McpServerConfig[]): Promise<void> {
  if (serverConfigs.length === 0) {
    logger.info('No MCP servers configured');
    return;
  }

  for (const serverConfig of serverConfigs) {
    try {
      await connectServer(serverConfig);
    } catch (err) {
      logger.error({ serverName: serverConfig.name, err }, 'Failed to connect to MCP server');
    }
  }

  const totalTools = connectedServers.reduce((sum, s) => sum + s.tools.length, 0);
  logger.info(
    { serverCount: connectedServers.length, totalTools },
    'MCP servers initialized'
  );
}

/** Get all available tools from all connected MCP servers. */
export function getAllMcpTools(): Tool[] {
  return connectedServers.flatMap((s) => s.tools);
}

/** Execute a tool on the appropriate MCP server. */
export async function executeMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<McpToolResult> {
  // Find which server owns this tool
  const server = connectedServers.find((s) =>
    s.tools.some((t) => t.name === toolName)
  );

  if (!server) {
    return {
      content: [{ type: 'text', text: `Error: Tool '${toolName}' not found on any connected MCP server` }],
      isError: true,
    };
  }

  logger.debug({ toolName, serverName: server.config.name }, 'Executing MCP tool');

  try {
    const result = await server.client.callTool({ name: toolName, arguments: toolArgs });

    return {
      content: result.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'image') {
          return { type: 'image' as const, data: block.data, mimeType: block.mimeType };
        }
        return { type: 'text' as const, text: JSON.stringify(block) };
      }),
      isError: result.isError === true,
    };
  } catch (err) {
    logger.error({ toolName, serverName: server.config.name, err }, 'MCP tool execution failed');
    return {
      content: [{ type: 'text', text: `Error executing tool '${toolName}': ${String(err)}` }],
      isError: true,
    };
  }
}

/** Gracefully disconnect all MCP servers. */
export async function disconnectAllServers(): Promise<void> {
  for (const server of connectedServers) {
    try {
      await server.client.close();
      logger.info({ serverName: server.config.name }, 'MCP server disconnected');
    } catch (err) {
      logger.warn({ serverName: server.config.name, err }, 'Error disconnecting MCP server');
    }
  }
  connectedServers.length = 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function connectServer(serverConfig: McpServerConfig): Promise<void> {
  const client = new Client(
    { name: 'openkeemier-agent', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  let transport: StdioClientTransport;

  if (serverConfig.transport === 'stdio') {
    if (!serverConfig.command) {
      throw new Error(`MCP server '${serverConfig.name}' requires 'command' for stdio transport`);
    }
    transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args ?? [],
    });
  } else {
    throw new Error(`Unsupported MCP transport: '${serverConfig.transport}'`);
  }

  await client.connect(transport);

  const toolsResponse = await client.listTools();
  const tools: Tool[] = toolsResponse.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Tool['input_schema'],
  }));

  connectedServers.push({ config: serverConfig, client, tools });

  logger.info(
    { serverName: serverConfig.name, toolCount: tools.length },
    'MCP server connected'
  );
}
