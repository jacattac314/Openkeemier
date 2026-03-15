/**
 * Unified tool registry.
 * Merges tools from MCP servers with any local tool implementations.
 * Provides a single interface for tool lookup and execution.
 */

import type { Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { getAllMcpTools, executeMcpTool } from './mcpClient.js';
import { isHighRisk } from '../tools/highRiskTools.js';
import { logger } from '../logger.js';

export interface ToolExecutionContext {
  userId: string;
  channelId: string;
  requestApproval: (toolName: string, args: Record<string, unknown>, rationale: string) => Promise<boolean>;
}

export type LocalToolFn = (args: Record<string, unknown>) => Promise<string>;

const localTools = new Map<string, { schema: Tool; fn: LocalToolFn }>();

/** Register a local tool implementation. */
export function registerLocalTool(schema: Tool, fn: LocalToolFn): void {
  localTools.set(schema.name, { schema, fn });
  logger.debug({ toolName: schema.name }, 'Local tool registered');
}

/** Get all available tools (MCP + local) for Anthropic API consumption. */
export function getAllTools(): Tool[] {
  const mcpTools = getAllMcpTools();
  const localToolSchemas = Array.from(localTools.values()).map((t) => t.schema);
  return [...mcpTools, ...localToolSchemas];
}

/**
 * Execute a tool by name.
 * If the tool is high-risk, request HITL approval first.
 * Returns a ToolResultBlockParam for inclusion in the next API call.
 */
export async function executeTool(
  toolUseId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolResultBlockParam> {
  logger.info(
    { toolName, userId: context.userId, isHighRisk: isHighRisk(toolName) },
    'Tool execution requested'
  );

  // HITL gate for high-risk tools
  if (isHighRisk(toolName)) {
    const rationale = `Tool '${toolName}' is classified as high-risk and requires your approval.`;
    const approved = await context.requestApproval(toolName, toolArgs, rationale);

    if (!approved) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `Tool '${toolName}' was rejected by the user. Execution cancelled.`,
        is_error: false,
      };
    }

    logger.info({ toolName, userId: context.userId }, 'HITL: Tool approved, proceeding');
  }

  try {
    // Try local tool first, then MCP
    const localTool = localTools.get(toolName);

    if (localTool) {
      const result = await localTool.fn(toolArgs);
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: result,
      };
    }

    // Fall through to MCP
    const mcpResult = await executeMcpTool(toolName, toolArgs);
    const textContent = mcpResult.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: textContent || '(no output)',
      is_error: mcpResult.isError,
    };
  } catch (err) {
    logger.error({ toolName, err }, 'Tool execution failed');
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Error: ${String(err)}`,
      is_error: true,
    };
  }
}
