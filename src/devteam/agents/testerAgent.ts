/**
 * Tester specialist agent.
 * Writes tests and runs the test suite. Reports pass/fail results.
 * Has access to: read_file, write_file, list_files, run_tests.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { DevTask, DevTaskResult, TestResult } from '../types.js';
import type { ToolExecutionContext } from '../../agent/toolRegistry.js';
import { executeTool, getAllTools } from '../../agent/toolRegistry.js';

const TESTER_SYSTEM = `You are an expert QA engineer and test author on an autonomous dev team.

Your job:
- Read the code changes to understand what needs testing
- Write focused, isolated Jest tests for new or modified functionality
- Use mocking for external dependencies (Anthropic, Slack, filesystem)
- Follow the existing test patterns in /tests (ESM, ts-jest, .js imports)
- Run the tests with the run_tests tool and report results

When done, output a structured result in this EXACT JSON format:
{
  "summary": "X tests passed, Y failed",
  "passed": <number>,
  "failed": <number>,
  "failures": ["description of failure 1", ...]
}

If you wrote new test files, list them first before running tests.`;

const MAX_ITERATIONS = 15;
const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function runTesterAgent(
  task: DevTask,
  toolContext: ToolExecutionContext
): Promise<DevTaskResult> {
  logger.info({ taskId: task.id, role: 'tester' }, 'Tester agent started');

  const userPrompt = buildTesterPrompt(task);
  const history: MessageParam[] = [{ role: 'user', content: userPrompt }];
  const tools = getAllTools().filter((t) =>
    ['read_file', 'write_file', 'list_files', 'run_tests'].includes(t.name)
  );

  const filesModified: string[] = [];
  let finalOutput = '';
  let testResults: TestResult | undefined;
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: config.DEFAULT_MODEL,
        max_tokens: 4096,
        system: TESTER_SYSTEM,
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

    testResults = parseTestResults(finalOutput);

    return {
      taskId: task.id,
      role: 'tester',
      success: (testResults?.failed ?? 0) === 0,
      output: finalOutput || '(no test output)',
      filesModified,
      testResults,
    };
  } catch (err) {
    logger.error({ taskId: task.id, err }, 'Tester agent failed');
    return {
      taskId: task.id,
      role: 'tester',
      success: false,
      output: `Tester failed: ${String(err)}`,
    };
  }
}

function buildTesterPrompt(task: DevTask): string {
  const parts = [`## Testing Task\n${task.description}`];
  if (task.context) parts.push(`## Context (Code Changes)\n${task.context}`);
  if (task.filePaths?.length) {
    parts.push(`## Files to Test\n${task.filePaths.join('\n')}`);
  }
  return parts.join('\n\n');
}

function parseTestResults(output: string): TestResult | undefined {
  try {
    const jsonMatch = /\{[\s\S]*"passed"[\s\S]*\}/.exec(output);
    if (!jsonMatch) return undefined;

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      passed?: number;
      failed?: number;
      failures?: string[];
    };

    return {
      summary: String(parsed.summary ?? ''),
      passed: Number(parsed.passed ?? 0),
      failed: Number(parsed.failed ?? 0),
      failures: Array.isArray(parsed.failures) ? parsed.failures.map(String) : [],
    };
  } catch {
    return undefined;
  }
}
