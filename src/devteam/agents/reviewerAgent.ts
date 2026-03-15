/**
 * Reviewer specialist agent.
 * Reviews code for bugs, style issues, security problems, and adherence to CLAUDE.md rules.
 * Has access to: read_file, list_files (read-only).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { DevTask, DevTaskResult, ReviewComment } from '../types.js';
import type { ToolExecutionContext } from '../../agent/toolRegistry.js';
import { executeTool, getAllTools } from '../../agent/toolRegistry.js';

const REVIEWER_SYSTEM = `You are an expert code reviewer on an autonomous dev team.

Your job:
- Read the specified files carefully
- Check for: bugs, logic errors, security issues (injection, path traversal, unhandled errors)
- Check for style: TypeScript strict mode compliance, no any types, .js ESM imports
- Check for architecture: follows CLAUDE.md rules (pino logging, zod validation)
- Be specific — cite file names and line numbers where possible

When done, output a structured review in this EXACT JSON format:
{
  "summary": "one-sentence overall assessment",
  "approved": true | false,
  "comments": [
    { "file": "src/foo.ts", "line": 42, "severity": "error" | "warning" | "info", "message": "..." }
  ]
}

If the code looks good, set "approved": true and comments can be empty or contain only "info" items.`;

const MAX_ITERATIONS = 10;
const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function runReviewerAgent(
  task: DevTask,
  toolContext: ToolExecutionContext
): Promise<DevTaskResult> {
  logger.info({ taskId: task.id, role: 'reviewer' }, 'Reviewer agent started');

  const userPrompt = buildReviewerPrompt(task);
  const history: MessageParam[] = [{ role: 'user', content: userPrompt }];
  const tools = getAllTools().filter((t) =>
    ['read_file', 'list_files'].includes(t.name)
  );

  let finalOutput = '';
  let reviewComments: ReviewComment[] = [];
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: config.DEFAULT_MODEL,
        max_tokens: 4096,
        system: REVIEWER_SYSTEM,
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
        toolUseBlocks.map((tu) =>
          executeTool(tu.id, tu.name, tu.input as Record<string, unknown>, toolContext)
        )
      );

      history.push({ role: 'user', content: toolResults });
    }

    // Parse structured review from output
    reviewComments = parseReviewComments(finalOutput);

    return {
      taskId: task.id,
      role: 'reviewer',
      success: true,
      output: finalOutput || '(no review output)',
      reviewComments,
    };
  } catch (err) {
    logger.error({ taskId: task.id, err }, 'Reviewer agent failed');
    return {
      taskId: task.id,
      role: 'reviewer',
      success: false,
      output: `Reviewer failed: ${String(err)}`,
    };
  }
}

function buildReviewerPrompt(task: DevTask): string {
  const parts = [`## Review Task\n${task.description}`];
  if (task.context) parts.push(`## Context (Changes Made)\n${task.context}`);
  if (task.filePaths?.length) {
    parts.push(`## Files to Review\n${task.filePaths.join('\n')}`);
  }
  return parts.join('\n\n');
}

function parseReviewComments(output: string): ReviewComment[] {
  try {
    const jsonMatch = /\{[\s\S]*"comments"[\s\S]*\}/.exec(output);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      comments?: Array<{
        file?: string;
        line?: number;
        severity?: string;
        message?: string;
      }>;
    };

    if (!Array.isArray(parsed.comments)) return [];

    return parsed.comments
      .filter((c) => c.file && c.message)
      .map((c) => ({
        file: String(c.file ?? ''),
        line: typeof c.line === 'number' ? c.line : undefined,
        severity: (['error', 'warning', 'info'].includes(String(c.severity))
          ? c.severity
          : 'info') as ReviewComment['severity'],
        message: String(c.message ?? ''),
      }));
  } catch {
    return [];
  }
}
