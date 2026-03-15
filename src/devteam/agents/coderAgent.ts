/**
 * Coder specialist agent.
 * Writes, edits, and refactors code based on task descriptions.
 * Has access to: read_file, write_file, list_files.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { DevTask, DevTaskResult } from '../types.js';
import type { ToolExecutionContext } from '../../agent/toolRegistry.js';
import { executeTool, getAllTools } from '../../agent/toolRegistry.js';

const CODER_SYSTEM = `You are an expert software engineer (Coder) on an autonomous dev team.

Your job:
- Read existing code carefully before modifying it
- Write clean, idiomatic TypeScript with strict ESM (always use .js extensions on imports)
- Follow the project's CLAUDE.md rules: pino logging, zod validation, no any types
- Make targeted, minimal changes — don't refactor beyond what was asked
- After writing files, summarize what you changed and why

Available tools: read_file, write_file, list_files

When done, provide a concise summary of:
1. Files created or modified
2. What changed and why
3. Any caveats or follow-up needed`;

const MAX_ITERATIONS = 15;

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function runCoderAgent(
  task: DevTask,
  toolContext: ToolExecutionContext
): Promise<DevTaskResult> {
  logger.info({ taskId: task.id, role: 'coder' }, 'Coder agent started');

  const userPrompt = buildCoderPrompt(task);
  const history: MessageParam[] = [{ role: 'user', content: userPrompt }];
  const tools = getAllTools().filter((t) =>
    ['read_file', 'write_file', 'list_files'].includes(t.name)
  );

  const filesModified: string[] = [];
  let finalOutput = '';
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: config.DEFAULT_MODEL,
        max_tokens: 4096,
        system: CODER_SYSTEM,
        messages: history,
        tools,
      });

      const textBlocks = response.content.filter((b) => b.type === 'text');
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      );

      const text = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
      if (text) finalOutput = text;

      history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tu) => {
          const args = tu.input as Record<string, unknown>;
          if (tu.name === 'write_file' && args['path']) {
            filesModified.push(String(args['path']));
          }
          return executeTool(tu.id, tu.name, args, toolContext);
        })
      );

      history.push({ role: 'user', content: toolResults });
    }

    return {
      taskId: task.id,
      role: 'coder',
      success: true,
      output: finalOutput || '(no output)',
      filesModified,
    };
  } catch (err) {
    logger.error({ taskId: task.id, err }, 'Coder agent failed');
    return {
      taskId: task.id,
      role: 'coder',
      success: false,
      output: `Coder failed: ${String(err)}`,
    };
  }
}

function buildCoderPrompt(task: DevTask): string {
  const parts = [`## Task\n${task.description}`];
  if (task.context) parts.push(`## Context from Previous Steps\n${task.context}`);
  if (task.filePaths?.length) parts.push(`## Relevant Files\n${task.filePaths.join('\n')}`);
  return parts.join('\n\n');
}
