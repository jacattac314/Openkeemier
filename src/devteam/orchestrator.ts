/**
 * Orchestrator agent.
 * Receives a user request, decomposes it into a plan, runs specialists,
 * aggregates results, and formats a Slack report.
 *
 * Pipeline: Decompose → [Coder → Reviewer → Tester] → Report
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type {
  TeamJobRequest,
  TeamJobResult,
  DecomposedPlan,
  DevTask,
  DevTaskResult,
} from './types.js';
import { runCoderAgent } from './agents/coderAgent.js';
import { runReviewerAgent } from './agents/reviewerAgent.js';
import { runTesterAgent } from './agents/testerAgent.js';
import type { ToolExecutionContext } from '../agent/toolRegistry.js';

const ORCHESTRATOR_SYSTEM = `You are the Orchestrator of an autonomous software dev team.
Given a user request, decompose it into a sequenced plan for your specialist agents.

Available agents:
- coder: writes and edits code files
- reviewer: reviews code for bugs, style, security
- tester: writes tests and runs the test suite

Rules:
- Only include agents that are actually needed for this task
- Typical flow for a feature: coder → reviewer → tester
- Typical flow for a bug fix: coder → tester
- Typical flow for a review-only request: reviewer
- Keep task descriptions concise and actionable
- filePaths should list specific files relevant to each task

Respond ONLY with valid JSON matching this schema:
{
  "objective": "one-sentence description of what will be accomplished",
  "tasks": [
    { "id": "task_1", "role": "coder", "description": "...", "filePaths": ["src/foo.ts"] },
    { "id": "task_2", "role": "reviewer", "description": "...", "filePaths": ["src/foo.ts"] },
    { "id": "task_3", "role": "tester", "description": "...", "filePaths": ["src/foo.ts"] }
  ],
  "sequentialPhases": [["coder"], ["reviewer"], ["tester"]]
}`;

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function runOrchestrator(request: TeamJobRequest): Promise<TeamJobResult> {
  const { userId, channelId, userMessage, requestApproval } = request;

  logger.info({ userId, channelId }, 'Orchestrator: starting job');

  // Step 1: Decompose the request into a plan
  const plan = await decomposePlan(userMessage);
  logger.info(
    { objective: plan.objective, taskCount: plan.tasks.length },
    'Orchestrator: plan decomposed'
  );

  const toolContext: ToolExecutionContext = {
    userId,
    channelId,
    requestApproval,
  };

  // Step 2: Execute tasks in sequential phases
  const allResults: DevTaskResult[] = [];
  let previousOutput = '';

  for (const phase of plan.sequentialPhases) {
    // Tasks within a phase can run in parallel
    const phaseTasks = plan.tasks.filter((t) => phase.includes(t.role));

    const phaseResults = await Promise.all(
      phaseTasks.map((task) => runTask(task, previousOutput, toolContext))
    );

    allResults.push(...phaseResults);

    // Pass the last phase's combined output as context to the next phase
    previousOutput = phaseResults.map((r) => `[${r.role}]: ${r.output}`).join('\n\n');
  }

  // Step 3: Build summary
  const summary = buildSummary(plan.objective, allResults);

  logger.info({ userId, taskCount: allResults.length }, 'Orchestrator: job complete');

  return { summary, tasks: allResults };
}

async function decomposePlan(userMessage: string): Promise<DecomposedPlan> {
  const response = await client.messages.create({
    model: config.DEFAULT_MODEL,
    max_tokens: 1024,
    system: ORCHESTRATOR_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');

  try {
    const jsonMatch = /\{[\s\S]*"tasks"[\s\S]*\}/.exec(text);
    if (!jsonMatch) throw new Error('No JSON found in orchestrator response');
    return JSON.parse(jsonMatch[0]) as DecomposedPlan;
  } catch (err) {
    logger.error({ err, text }, 'Failed to parse orchestrator plan');
    // Fallback: single coder task
    return {
      objective: userMessage.slice(0, 100),
      tasks: [
        {
          id: 'task_1',
          role: 'coder',
          description: userMessage,
        },
      ],
      sequentialPhases: [['coder']],
    };
  }
}

async function runTask(
  task: DevTask,
  context: string,
  toolContext: ToolExecutionContext
): Promise<DevTaskResult> {
  const taskWithContext: DevTask = { ...task, context: context || undefined };

  switch (task.role) {
    case 'coder':
      return runCoderAgent(taskWithContext, toolContext);
    case 'reviewer':
      return runReviewerAgent(taskWithContext, toolContext);
    case 'tester':
      return runTesterAgent(taskWithContext, toolContext);
    default:
      return {
        taskId: task.id,
        role: task.role,
        success: false,
        output: `Unknown agent role: ${task.role}`,
      };
  }
}

function buildSummary(objective: string, results: DevTaskResult[]): string {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const lines = [
    `*Objective:* ${objective}`,
    `*Result:* ${succeeded}/${results.length} tasks succeeded${failed > 0 ? ` (${failed} failed)` : ''}`,
    '',
  ];

  for (const result of results) {
    const icon = result.success ? '✅' : '❌';
    lines.push(`${icon} *${result.role.toUpperCase()}*`);

    if (result.filesModified?.length) {
      lines.push(`  Files: ${result.filesModified.join(', ')}`);
    }

    if (result.reviewComments?.length) {
      const errors = result.reviewComments.filter((c) => c.severity === 'error').length;
      const warnings = result.reviewComments.filter((c) => c.severity === 'warning').length;
      lines.push(`  Review: ${errors} errors, ${warnings} warnings`);
    }

    if (result.testResults) {
      lines.push(
        `  Tests: ${result.testResults.passed} passed, ${result.testResults.failed} failed`
      );
    }
  }

  return lines.join('\n');
}
