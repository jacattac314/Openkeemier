/**
 * Human-in-the-Loop (HITL) module.
 *
 * When the agent calls a high-risk tool, execution suspends and a Slack Block Kit
 * message is sent with Approve/Reject buttons. The action listener resolves the
 * pending hook, allowing the agent workflow to continue with the human's decision.
 */

import type { App } from '@slack/bolt';
import { logger } from '../logger.js';

export interface HitlRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  rationale: string;
  requestedBy: string;
  channelId: string;
}

export interface HitlDecision {
  approved: boolean;
  decidedBy: string;
}

// Map of hookId -> { resolve, reject } for pending HITL requests
const pendingHooks = new Map<
  string,
  { resolve: (decision: HitlDecision) => void; reject: (err: Error) => void }
>();

let registeredApp: App | null = null;

/** Register the Bolt app to send messages and listen for actions. */
export function registerHitlApp(boltApp: App): void {
  registeredApp = boltApp;
  registerActionListeners(boltApp);
}

/**
 * Suspend execution and request human approval via Slack Block Kit.
 * Returns a promise that resolves when the user clicks Approve or Reject.
 */
export async function requestApproval(request: HitlRequest): Promise<HitlDecision> {
  if (!registeredApp) {
    throw new Error('HITL: Bolt app not registered. Call registerHitlApp() first.');
  }

  const hookId = `hitl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  logger.info(
    { hookId, toolName: request.toolName, channelId: request.channelId },
    'HITL: Suspending execution, awaiting human approval'
  );

  // Send Block Kit approval message
  await registeredApp.client.chat.postMessage({
    channel: request.channelId,
    text: `⚠️ High-risk tool approval required: \`${request.toolName}\``,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ Action Requires Your Approval', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Tool:* \`${request.toolName}\`\n*Requested by:* <@${request.requestedBy}>\n*Rationale:* ${request.rationale}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Arguments:*\n\`\`\`${JSON.stringify(request.toolArgs, null, 2)}\`\`\``,
        },
      },
      {
        type: 'actions',
        block_id: `hitl_actions_${hookId}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve', emoji: true },
            style: 'primary',
            action_id: `hitl_approve_${hookId}`,
            value: hookId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject', emoji: true },
            style: 'danger',
            action_id: `hitl_reject_${hookId}`,
            value: hookId,
          },
        ],
      },
    ],
  });

  // Return a promise that will be resolved by the action listener
  return new Promise<HitlDecision>((resolve, reject) => {
    pendingHooks.set(hookId, { resolve, reject });

    // Auto-reject after 10 minutes to prevent dangling promises
    setTimeout(() => {
      if (pendingHooks.has(hookId)) {
        pendingHooks.delete(hookId);
        reject(new Error(`HITL timeout: No response received for tool '${request.toolName}' within 10 minutes`));
      }
    }, 10 * 60 * 1000);
  });
}

function registerActionListeners(boltApp: App): void {
  // Match approve actions
  boltApp.action(/^hitl_approve_/, async ({ action, ack, body, client }) => {
    await ack();

    const buttonAction = action as { value?: string };
    const hookId = buttonAction.value;
    if (!hookId) return;

    const hook = pendingHooks.get(hookId);
    if (!hook) {
      logger.warn({ hookId }, 'HITL: Received approve for unknown hookId');
      return;
    }

    pendingHooks.delete(hookId);
    const decidedBy = body.user.id;

    logger.info({ hookId, decidedBy }, 'HITL: Approved by user');

    // Update the Slack message to show the decision
    const msgBody = body as { message?: { ts?: string }; channel?: { id?: string } | string };
    const ts = msgBody.message?.ts;
    const channel = typeof msgBody.channel === 'string' ? msgBody.channel : msgBody.channel?.id;

    if (ts && channel) {
      await client.chat.update({
        channel,
        ts,
        text: `✅ Tool approved by <@${decidedBy}>`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `✅ *Approved* by <@${decidedBy}>` },
          },
        ],
      });
    }

    hook.resolve({ approved: true, decidedBy });
  });

  // Match reject actions
  boltApp.action(/^hitl_reject_/, async ({ action, ack, body, client }) => {
    await ack();

    const buttonAction = action as { value?: string };
    const hookId = buttonAction.value;
    if (!hookId) return;

    const hook = pendingHooks.get(hookId);
    if (!hook) {
      logger.warn({ hookId }, 'HITL: Received reject for unknown hookId');
      return;
    }

    pendingHooks.delete(hookId);
    const decidedBy = body.user.id;

    logger.info({ hookId, decidedBy }, 'HITL: Rejected by user');

    const msgBody = body as { message?: { ts?: string }; channel?: { id?: string } | string };
    const ts = msgBody.message?.ts;
    const channel = typeof msgBody.channel === 'string' ? msgBody.channel : msgBody.channel?.id;

    if (ts && channel) {
      await client.chat.update({
        channel,
        ts,
        text: `❌ Tool rejected by <@${decidedBy}>`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `❌ *Rejected* by <@${decidedBy}>` },
          },
        ],
      });
    }

    hook.resolve({ approved: false, decidedBy });
  });
}

/** List of pending HITL hook IDs (for debugging/monitoring). */
export function getPendingHookCount(): number {
  return pendingHooks.size;
}
