/**
 * Core agentic loop.
 * Orchestrates multi-turn conversations with tool use.
 * Maintains conversation state per user session.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { loadMemoryContext } from '../memory/memoryManager.js';
import { dailyLog } from '../memory/dailyLog.js';
import { getAllTools, executeTool, type ToolExecutionContext } from './toolRegistry.js';
import { findMatchingSkills, loadSkillInstructions } from '../skills/skillLoader.js';

const MAX_ITERATIONS = 20;
const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Per-user conversation history (in-memory; for persistent sessions use DB)
const conversationHistory = new Map<string, MessageParam[]>();

export interface AgentRunParams {
  userId: string;
  channelId: string;
  userText: string;
  requestApproval: (toolName: string, args: Record<string, unknown>, rationale: string) => Promise<boolean>;
  onChunk?: (text: string) => void;
}

export interface AgentRunResult {
  response: string;
  toolsUsed: string[];
  iterations: number;
}

/** Run the agentic loop for a user message. */
export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const { userId, channelId, userText, requestApproval, onChunk } = params;

  logger.info({ userId, channelId }, 'Agent run started');
  await dailyLog.userMessage(userId, channelId, userText);

  // Load memory context and matching skills
  const [memCtx, matchingSkills] = await Promise.all([
    loadMemoryContext(),
    findMatchingSkills(userText),
  ]);

  // Load skill instructions if any skills matched
  let skillsSection = '';
  if (matchingSkills.length > 0) {
    const skillInstructions = await Promise.all(
      matchingSkills.map((s) => loadSkillInstructions(s.name))
    );
    skillsSection = skillInstructions
      .filter(Boolean)
      .map((inst, i) => `## Skill: ${matchingSkills[i]?.name ?? 'unknown'}\n${inst}`)
      .join('\n\n');
  }

  const systemPrompt = buildSystemPrompt(memCtx, skillsSection);

  // Initialize or retrieve conversation history
  let history = conversationHistory.get(userId) ?? [];
  history.push({ role: 'user', content: userText });

  const toolContext: ToolExecutionContext = { userId, channelId, requestApproval };
  const tools = getAllTools();
  const toolsUsed: string[] = [];
  let iterations = 0;
  let finalResponse = '';

  // Agentic loop
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    logger.debug({ userId, iteration: iterations }, 'Agent iteration');

    const response = await client.messages.create({
      model: config.DEFAULT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: history,
      tools: tools.length > 0 ? tools : undefined,
    });

    logger.debug(
      { userId, stopReason: response.stop_reason, contentBlocks: response.content.length },
      'Agent response received'
    );

    // Extract text and tool calls from response
    const textBlocks = response.content.filter(
      (b): b is ContentBlock & { type: 'text' } => b.type === 'text'
    );
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use'
    );

    const responseText = textBlocks.map((b) => b.text).join('');
    if (responseText && onChunk) onChunk(responseText);

    // Add assistant turn to history
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      finalResponse = responseText;
      break;
    }

    // Process tool calls
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        toolsUsed.push(toolUse.name);
        await dailyLog.toolCall(toolUse.name, toolUse.input);

        const args = toolUse.input as Record<string, unknown>;
        const result = await executeTool(toolUse.id, toolUse.name, args, toolContext);

        await dailyLog.toolResult(toolUse.name, result.content, result.is_error === true);
        return result;
      })
    );

    // Add tool results to history
    history.push({ role: 'user', content: toolResults });
  }

  if (iterations >= MAX_ITERATIONS) {
    logger.warn({ userId, iterations }, 'Agent hit max iterations');
    finalResponse = finalResponse || 'I reached the maximum number of steps. Please try a simpler request.';
  }

  // Persist updated history (cap at last 50 turns to manage memory)
  if (history.length > 50) {
    history = history.slice(history.length - 50);
  }
  conversationHistory.set(userId, history);

  await dailyLog.agentResponse(finalResponse, { userId, toolsUsed, iterations });

  logger.info({ userId, iterations, toolsUsed }, 'Agent run complete');

  return { response: finalResponse, toolsUsed, iterations };
}

/** Clear conversation history for a user (e.g., on /clear command). */
export function clearHistory(userId: string): void {
  conversationHistory.delete(userId);
  logger.info({ userId }, 'Conversation history cleared');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  memCtx: Awaited<ReturnType<typeof loadMemoryContext>>,
  skillsSection: string
): string {
  return `${memCtx.soul}

## Long-Term Memory
${memCtx.memory || '(no long-term memory yet)'}

## Today's Activity Log (Summary)
${memCtx.todayLog || '(no activity yet today)'}

${skillsSection ? `## Active Skills\n${skillsSection}\n` : ''}

## Current Date & Time
${new Date().toISOString()}

## Guidelines
- Be concise and helpful. Use Slack formatting (bold, code blocks) for clarity.
- Always explain what tool you are about to use before calling it.
- If a tool fails, explain the failure clearly and suggest alternatives.
- Never fabricate tool results — if a tool returns an error, report it honestly.`;
}
