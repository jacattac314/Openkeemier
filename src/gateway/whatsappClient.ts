/**
 * WhatsApp gateway client.
 * - Twilio client for sending WhatsApp messages
 * - Express HTTP server receiving Twilio webhook POST requests
 * - Incoming messages are emitted via an EventEmitter for other modules to consume
 */

import express from 'express';
import type { Request, Response } from 'express';
import { EventEmitter } from 'events';
import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../logger.js';

// ── Twilio client ─────────────────────────────────────────────────────────

export const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

// ── Incoming message event types ──────────────────────────────────────────

export interface IncomingWhatsAppMessage {
  from: string;          // e.g. "whatsapp:+1234567890"
  to: string;            // our number e.g. "whatsapp:+14155238886"
  body: string;          // message text
  buttonPayload?: string; // set when user taps a quick-reply button
  messageSid: string;
}

// ── Event emitter ─────────────────────────────────────────────────────────

class WhatsAppEmitter extends EventEmitter {
  emitMessage(msg: IncomingWhatsAppMessage): void {
    this.emit('message', msg);
  }
  onMessage(handler: (msg: IncomingWhatsAppMessage) => void): void {
    this.on('message', handler);
  }
}

export const whatsappEvents = new WhatsAppEmitter();

// ── Express webhook server ────────────────────────────────────────────────

const expressApp = express();
expressApp.use(express.urlencoded({ extended: false }));
expressApp.use(express.json());

expressApp.post(config.WEBHOOK_PATH, (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;

  const from = body['From'] ?? '';
  const to = body['To'] ?? '';
  const text = body['Body'] ?? '';
  const buttonPayload = body['ButtonPayload'];
  const messageSid = body['MessageSid'] ?? '';

  if (!from || !to) {
    logger.warn({ body }, 'WhatsApp webhook: missing From or To');
    res.sendStatus(400);
    return;
  }

  logger.debug(
    { from, to, bodyLength: text.length, hasButton: !!buttonPayload },
    'WhatsApp message received'
  );

  whatsappEvents.emitMessage({ from, to, body: text, buttonPayload, messageSid });

  // Twilio expects a 200 or TwiML response; we handle replies asynchronously
  res.sendStatus(200);
});

// Health check
expressApp.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

export async function startWhatsAppServer(): Promise<void> {
  return new Promise((resolve) => {
    expressApp.listen(config.WEBHOOK_PORT, () => {
      logger.info(
        { port: config.WEBHOOK_PORT, path: config.WEBHOOK_PATH },
        'WhatsApp webhook server listening'
      );
      resolve();
    });
  });
}

// ── Send helpers ──────────────────────────────────────────────────────────

/** Send a plain text WhatsApp message. */
export async function sendMessage(to: string, body: string): Promise<void> {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const from = config.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')
    ? config.TWILIO_WHATSAPP_FROM
    : `whatsapp:${config.TWILIO_WHATSAPP_FROM}`;

  try {
    await twilioClient.messages.create({ from, to: toFormatted, body });
    logger.debug({ to: toFormatted }, 'WhatsApp message sent');
  } catch (err) {
    logger.error({ to: toFormatted, err }, 'Failed to send WhatsApp message');
    throw err;
  }
}

/** Send a long message split into chunks (WhatsApp 4096 char limit). */
export async function sendLongMessage(to: string, text: string): Promise<void> {
  const CHUNK_SIZE = 4000;
  if (text.length <= CHUNK_SIZE) {
    await sendMessage(to, text);
    return;
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk) {
      const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}] ` : '';
      await sendMessage(to, prefix + chunk);
    }
  }
}
