/**
 * Formats dev team job results as rich Slack Block Kit messages.
 */

import type { TeamJobResult, DevTaskResult, ReviewComment } from './types.js';

export function formatJobResultBlocks(result: TeamJobResult): object[] {
  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🤖 Dev Team Report', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: result.summary },
    },
    { type: 'divider' },
  ];

  for (const task of result.tasks) {
    blocks.push(...formatTaskBlock(task));
  }

  return blocks;
}

function formatTaskBlock(task: DevTaskResult): object[] {
  const icon = task.success ? '✅' : '❌';
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${task.role.toUpperCase()}* — Task \`${task.taskId}\``,
      },
    },
  ];

  // Show truncated output
  const truncated = task.output.slice(0, 2800);
  if (truncated) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `\`\`\`${truncated}\`\`\`` },
    });
  }

  // Review comments
  if (task.reviewComments && task.reviewComments.length > 0) {
    const commentLines = task.reviewComments
      .slice(0, 5) // cap at 5 in Slack
      .map((c: ReviewComment) => {
        const loc = c.line ? `${c.file}:${c.line}` : c.file;
        const emoji = c.severity === 'error' ? '🔴' : c.severity === 'warning' ? '🟡' : 'ℹ️';
        return `${emoji} \`${loc}\` — ${c.message}`;
      });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: commentLines.join('\n') },
    });
  }

  // Test results
  if (task.testResults) {
    const t = task.testResults;
    const emoji = t.failed === 0 ? '🟢' : '🔴';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Tests:* ${t.passed} passed / ${t.failed} failed\n${t.summary}`,
      },
    });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}
