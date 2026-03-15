/**
 * WhatsApp message handler.
 * Routes incoming messages to HITL resolution, text commands, or the agent.
 */

import { whatsappEvents, sendMessage, sendLongMessage } from './whatsappClient.js';
import { resolveHitlResponse, hasPendingHook, getPendingHookCount } from './whatsappHitl.js';
import { requestApproval } from './whatsappHitl.js';
import { enqueueTask } from './sessionQueue.js';
import { runAgent, clearHistory } from '../agent/agentRunner.js';
import { runOrchestrator } from '../devteam/orchestrator.js';
import { getHeartbeatState } from '../heartbeat/heartbeatRunner.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

async function handleStatusCommand(from: string): Promise<void> {
  const heartbeat = getHeartbeatState();
  const hitlCount = getPendingHookCount();
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const lastHb = heartbeat.lastRunAt
    ? new Date(heartbeat.lastRunAt).toISOString()
    : 'never';

  const lines = [
    `🤖 *OpenKeemier Status*`,
    ``,
    `⏱ Uptime: ${formatUptime(process.uptime())}`,
    `💾 Memory: ${heapMB} MB`,
    `📦 Node: ${process.version}`,
    `🧠 Model: ${config.DEFAULT_MODEL}`,
    ``,
    `💓 Heartbeat: ${heartbeat.isRunning ? '⚠️ Running' : '✅ Idle'}`,
    `🕐 Last heartbeat: ${lastHb}`,
    `🔒 HITL pending: ${hitlCount > 0 ? `⚠️ ${hitlCount}` : '✅ 0'}`,
    `📋 Tool history: ${heartbeat.toolCallHistory.length} entries`,
  ];

  await sendMessage(from, lines.join('\n'));
}

function buildRequestApproval(from: string) {
  return async (
    toolName: string,
    args: Record<string, unknown>,
    rationale: string
  ): Promise<boolean> => {
    const decision = await requestApproval({
      toolName,
      toolArgs: args,
      rationale,
      requestedBy: from,
      channelId: from,
    });
    return decision.approved;
  };
}

export function registerWhatsAppHandlers(): void {
  whatsappEvents.onMessage((msg) => {
    const { from, body, buttonPayload } = msg;
    const trimmed = body.trim();

    enqueueTask(from, async () => {
      // 1. Check if this resolves a pending HITL hook
      if (hasPendingHook(from)) {
        const resolved = resolveHitlResponse(from, buttonPayload, trimmed);
        if (resolved) return;
      }

      // 2. Text commands
      const lower = trimmed.toLowerCase();

      if (lower === '!status') {
        await handleStatusCommand(from);
        return;
      }

      if (lower === '!clear') {
        clearHistory(from);
        await sendMessage(from, '🗑️ Conversation history cleared.');
        return;
      }

      if (lower.startsWith('!dev ') || lower.startsWith('/dev ')) {
        const task = trimmed.slice(5).trim();
        if (!task) {
          await sendMessage(from, 'Usage: `!dev <task description>`');
          return;
        }

        await sendMessage(from, `⚙️ Dev team activated. Planning: _${task.slice(0, 80)}_…`);

        try {
          const result = await runOrchestrator({
            userId: from,
            channelId: from,
            userMessage: task,
            requestApproval: buildRequestApproval(from),
          });

          await sendLongMessage(from, formatDevTeamResult(result.summary, result.tasks));
        } catch (err) {
          logger.error({ from, err }, 'Dev team job failed');
          await sendMessage(from, `❌ Dev team error: ${String(err)}`);
        }
        return;
      }

      // 3. Regular agent message
      try {
        const result = await runAgent({
          userId: from,
          channelId: from,
          userText: trimmed,
          requestApproval: buildRequestApproval(from),
        });

        await sendLongMessage(from, result.response);
      } catch (err) {
        logger.error({ from, err }, 'Agent run failed');
        await sendMessage(from, 'Sorry, I encountered an error. Please try again.');
      }
    });
  });

  logger.info('WhatsApp message handlers registered');
}

function formatDevTeamResult(
  summary: string,
  tasks: Array<{ role: string; success: boolean; output: string; testResults?: { passed: number; failed: number } }>
): string {
  const lines = [`🤖 *Dev Team Report*`, ``, summary, ``];

  for (const task of tasks) {
    const icon = task.success ? '✅' : '❌';
    lines.push(`${icon} *${task.role.toUpperCase()}*`);

    const truncated = task.output.slice(0, 600);
    if (truncated) lines.push(truncated);

    if (task.testResults) {
      lines.push(
        `Tests: ${task.testResults.passed} passed / ${task.testResults.failed} failed`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}
