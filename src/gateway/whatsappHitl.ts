/**
 * WhatsApp HITL (Human-in-the-Loop) module.
 *
 * When a high-risk tool is called, execution suspends. A WhatsApp message
 * with Approve / Reject quick-reply buttons is sent via Twilio Content API.
 * The button response is parsed from the incoming webhook and resolves the
 * pending promise, allowing the agent to continue.
 */

import { twilioClient, sendMessage } from './whatsappClient.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface HitlRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  rationale: string;
  requestedBy: string; // phone number (whatsapp:+1234...)
  channelId: string;   // same as requestedBy for WhatsApp (no separate channel concept)
}

export interface HitlDecision {
  approved: boolean;
  decidedBy: string;
}

// Map of hookId -> { resolve, reject } for pending HITL requests
const pendingHooks = new Map<
  string,
  { resolve: (decision: HitlDecision) => void; reject: (err: Error) => void; to: string }
>();

/**
 * Suspend execution and request human approval via WhatsApp interactive buttons.
 * Returns a promise resolved when the user taps Approve or Reject.
 */
export async function requestApproval(request: HitlRequest): Promise<HitlDecision> {
  const hookId = `hitl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const to = request.requestedBy.startsWith('whatsapp:')
    ? request.requestedBy
    : `whatsapp:${request.requestedBy}`;

  logger.info(
    { hookId, toolName: request.toolName, to },
    'HITL: Suspending execution, awaiting WhatsApp approval'
  );

  // Try to send with interactive buttons via Content API; fall back to text prompt
  const sent = await trySendInteractiveApproval(hookId, request, to);
  if (!sent) {
    await sendTextApproval(hookId, request, to);
  }

  return new Promise<HitlDecision>((resolve, reject) => {
    pendingHooks.set(hookId, { resolve, reject, to });

    // Auto-reject after 10 minutes
    setTimeout(() => {
      if (pendingHooks.has(hookId)) {
        pendingHooks.delete(hookId);
        reject(
          new Error(
            `HITL timeout: No response for tool '${request.toolName}' within 10 minutes`
          )
        );
      }
    }, 10 * 60 * 1000);
  });
}

/**
 * Called by the message handler when a button payload or APPROVE/REJECT text is received.
 * Resolves the matching pending HITL hook.
 */
export function resolveHitlResponse(
  from: string,
  buttonPayload: string | undefined,
  bodyText: string
): boolean {
  const normalizedFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

  // Find a pending hook for this user
  for (const [hookId, hook] of pendingHooks.entries()) {
    if (hook.to !== normalizedFrom) continue;

    const signal = (buttonPayload ?? bodyText).trim().toLowerCase();
    const approved =
      signal === 'approve' ||
      signal === 'yes' ||
      signal === 'y' ||
      signal === '1' ||
      signal.startsWith('approve');

    const rejected =
      signal === 'reject' ||
      signal === 'no' ||
      signal === 'n' ||
      signal === '2' ||
      signal.startsWith('reject');

    if (!approved && !rejected) continue;

    pendingHooks.delete(hookId);
    hook.resolve({ approved, decidedBy: from });

    const confirmText = approved
      ? '✅ Approved. The agent will proceed.'
      : '❌ Rejected. The action has been cancelled.';

    void sendMessage(normalizedFrom, confirmText);

    logger.info({ hookId, approved, decidedBy: from }, 'HITL: Decision received');
    return true;
  }

  return false;
}

/** Returns true if there is a pending HITL hook for this user. */
export function hasPendingHook(from: string): boolean {
  const normalized = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  for (const hook of pendingHooks.values()) {
    if (hook.to === normalized) return true;
  }
  return false;
}

/** Count of all pending HITL hooks (for /status). */
export function getPendingHookCount(): number {
  return pendingHooks.size;
}

// ── Private helpers ───────────────────────────────────────────────────────

async function trySendInteractiveApproval(
  hookId: string,
  request: HitlRequest,
  to: string
): Promise<boolean> {
  try {
    // Create a Content template with quick-reply buttons
    const contentBody = [
      `⚠️ *Approval Required*`,
      ``,
      `Tool: \`${request.toolName}\``,
      `Rationale: ${request.rationale}`,
      ``,
      `Arguments:`,
      `\`\`\``,
      JSON.stringify(request.toolArgs, null, 2).slice(0, 500),
      `\`\`\``,
      ``,
      `Hook ID: ${hookId}`,
    ].join('\n');

    const content = await twilioClient.content.v1.contents.create({
      friendlyName: `hitl_${hookId}`,
      language: 'en',
      types: {
        'twilio/quick-reply': {
          body: contentBody,
          actions: [
            { id: 'approve', title: '✅ Approve' },
            { id: 'reject', title: '❌ Reject' },
          ],
        },
      },
    });

    const from = config.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')
      ? config.TWILIO_WHATSAPP_FROM
      : `whatsapp:${config.TWILIO_WHATSAPP_FROM}`;

    await twilioClient.messages.create({
      from,
      to,
      contentSid: content.sid,
    });

    logger.debug({ hookId, contentSid: content.sid }, 'HITL: Interactive approval message sent');
    return true;
  } catch (err) {
    logger.warn({ hookId, err }, 'HITL: Content API failed, falling back to text prompt');
    return false;
  }
}

async function sendTextApproval(
  hookId: string,
  request: HitlRequest,
  to: string
): Promise<void> {
  const argsStr = JSON.stringify(request.toolArgs, null, 2).slice(0, 300);
  const msg = [
    `⚠️ *Approval Required*`,
    ``,
    `Tool: ${request.toolName}`,
    `Rationale: ${request.rationale}`,
    `Args: ${argsStr}`,
    ``,
    `Reply *APPROVE* or *REJECT*`,
    `(Hook: ${hookId})`,
  ].join('\n');

  await sendMessage(to, msg);
}
