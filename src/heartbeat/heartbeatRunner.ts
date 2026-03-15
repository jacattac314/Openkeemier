/**
 * Proactive Heartbeat Engine.
 *
 * Runs on a configurable cron schedule (default: every 30 minutes).
 * Evaluates HEARTBEAT.md checklist + recent memory to decide if proactive action is needed.
 *
 * Key safety features:
 * - Uses cost-efficient HEARTBEAT_MODEL (Haiku) regardless of global default.
 * - Emits HEARTBEAT_OK token if no action needed (silently discarded by gateway).
 * - Patches toolCallHistory to clear state if delta between executions > 60s,
 *   preventing false-positive infinite loop detection.
 */

import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { loadMemoryContext } from '../memory/memoryManager.js';
import { dailyLog } from '../memory/dailyLog.js';

export const HEARTBEAT_OK_TOKEN = 'HEARTBEAT_OK';

interface HeartbeatState {
  lastRunAt: number | null;
  toolCallHistory: Array<{ toolName: string; calledAt: number }>;
  isRunning: boolean;
}

const state: HeartbeatState = {
  lastRunAt: null,
  toolCallHistory: [],
  isRunning: false,
};

let cronTask: cron.ScheduledTask | null = null;

/**
 * Patch toolCallHistory: if delta between now and last execution exceeds 60s,
 * clear the history to prevent false-positive loop detection triggers.
 */
function patchToolCallHistory(): void {
  const now = Date.now();
  const LOOP_DETECTION_WINDOW_MS = 60_000;

  if (state.lastRunAt !== null) {
    const delta = now - state.lastRunAt;
    if (delta > LOOP_DETECTION_WINDOW_MS) {
      logger.debug(
        { delta, previousCount: state.toolCallHistory.length },
        'Heartbeat: clearing toolCallHistory (delta > 60s)'
      );
      state.toolCallHistory = [];
    }
  }

  state.lastRunAt = now;
}

/** Record a tool call in the history. */
function recordToolCall(toolName: string): void {
  state.toolCallHistory.push({ toolName, calledAt: Date.now() });
}

/** Execute one heartbeat cycle. */
async function runHeartbeatCycle(
  onAction?: (action: string) => Promise<void>
): Promise<void> {
  if (state.isRunning) {
    logger.warn('Heartbeat: Previous cycle still running, skipping this tick');
    return;
  }

  state.isRunning = true;
  patchToolCallHistory();

  try {
    logger.debug('Heartbeat: Starting evaluation cycle');

    const memCtx = await loadMemoryContext();

    const systemPrompt = `You are an autonomous AI agent performing a silent background evaluation.

${memCtx.soul}

## Long-Term Memory
${memCtx.memory}

## Today's Activity Log
${memCtx.todayLog || '(no activity yet today)'}

## Instructions
Evaluate the following checklist. If ALL conditions pass and no proactive action is needed,
respond ONLY with the exact token: ${HEARTBEAT_OK_TOKEN}

If action IS needed, respond with a single concise sentence describing the action.
Do NOT engage in conversation. Do NOT use tools during this evaluation.`;

    const userPrompt = memCtx.heartbeatChecklist;

    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: config.HEARTBEAT_MODEL, // Always Haiku — cost optimization
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const outputBlock = response.content[0];
    const output =
      outputBlock?.type === 'text' ? outputBlock.text.trim() : HEARTBEAT_OK_TOKEN;

    if (output === HEARTBEAT_OK_TOKEN) {
      logger.debug('Heartbeat: OK — no action needed');
      await dailyLog.heartbeat('ok');
      return;
    }

    // Action needed
    logger.info({ action: output }, 'Heartbeat: Proactive action triggered');
    await dailyLog.heartbeat('action', output);

    if (onAction) {
      await onAction(output);
    }
  } catch (err) {
    logger.error({ err }, 'Heartbeat: Cycle failed');
    await dailyLog.error('Heartbeat cycle failed', err);
  } finally {
    state.isRunning = false;
  }
}

/**
 * Start the heartbeat cron scheduler.
 * @param onAction - Callback invoked when the heartbeat determines action is needed.
 *                   Receives the action description string.
 */
export function startHeartbeat(
  onAction?: (action: string) => Promise<void>
): void {
  const cronExpression = config.HEARTBEAT_CRON;

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid HEARTBEAT_CRON expression: '${cronExpression}'`);
  }

  cronTask = cron.schedule(cronExpression, () => {
    void runHeartbeatCycle(onAction);
  });

  logger.info({ cronExpression, model: config.HEARTBEAT_MODEL }, 'Heartbeat engine started');
}

/** Stop the heartbeat cron scheduler. */
export function stopHeartbeat(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Heartbeat engine stopped');
  }
}

/** Manually trigger one heartbeat cycle (useful for testing). */
export async function triggerHeartbeat(
  onAction?: (action: string) => Promise<void>
): Promise<void> {
  await runHeartbeatCycle(onAction);
}

/** Returns current heartbeat state snapshot (for monitoring/debugging). */
export function getHeartbeatState(): Readonly<HeartbeatState> {
  return { ...state, toolCallHistory: [...state.toolCallHistory] };
}
