import type { App } from '@slack/bolt';
import { getHeartbeatState } from '../heartbeat/heartbeatRunner.js';
import { getPendingHookCount } from './hitl.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function registerStatusCommand(boltApp: App): void {
  boltApp.command('/status', async ({ ack, respond }) => {
    await ack();

    const uptime = formatUptime(process.uptime());
    const heartbeat = getHeartbeatState();
    const hitlCount = getPendingHookCount();
    const heapUsed = formatBytes(process.memoryUsage().heapUsed);
    const lastHeartbeat = heartbeat.lastRunAt
      ? new Date(heartbeat.lastRunAt).toISOString()
      : 'never';

    const hitlStatus = hitlCount > 0
      ? `⚠️ ${hitlCount} pending approval(s)`
      : '✅ None pending';

    const heartbeatStatus = heartbeat.isRunning
      ? '⚠️ Currently running'
      : '✅ Idle';

    logger.info({ uptime, hitlCount, heapUsed }, 'Status command invoked');

    await respond({
      response_type: 'ephemeral',
      text: 'OpenKeemier Status',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🤖 OpenKeemier Status', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Uptime*\n${uptime}` },
            { type: 'mrkdwn', text: `*Memory*\n${heapUsed}` },
            { type: 'mrkdwn', text: `*Node.js*\n${process.version}` },
            { type: 'mrkdwn', text: `*Model*\n\`${config.DEFAULT_MODEL}\`` },
          ],
        },
        { type: 'divider' },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Heartbeat*\n${heartbeatStatus}` },
            { type: 'mrkdwn', text: `*Last Heartbeat*\n${lastHeartbeat}` },
            { type: 'mrkdwn', text: `*HITL Hooks*\n${hitlStatus}` },
            { type: 'mrkdwn', text: `*Tool Call History*\n${heartbeat.toolCallHistory.length} entries` },
          ],
        },
      ],
    });
  });

  logger.info('Status command registered (/status)');
}
