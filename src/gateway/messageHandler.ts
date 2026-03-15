/**
 * Slack message event handler.
 * Routes incoming messages to the agent via the session queue.
 */

import type { App } from '@slack/bolt';
import { enqueueTask } from './sessionQueue.js';
import { logger } from '../logger.js';

export type AgentHandlerFn = (params: {
  userId: string;
  channelId: string;
  text: string;
  say: (text: string) => Promise<void>;
}) => Promise<void>;

export function registerMessageHandlers(boltApp: App, agentHandler: AgentHandlerFn): void {
  boltApp.message(async ({ message, say }) => {
    // Only handle user messages (not bot messages or system messages)
    if (message.subtype) return;

    const msg = message as { user?: string; channel: string; text?: string };
    if (!msg.user || !msg.text) return;

    const userId = msg.user;
    const channelId = msg.channel;
    const text = msg.text;

    logger.info({ userId, channelId, textLength: text.length }, 'Message received');

    enqueueTask(userId, async () => {
      await agentHandler({
        userId,
        channelId,
        text,
        say: async (responseText: string) => {
          await say(responseText);
        },
      });
    });
  });

  logger.info('Message handlers registered');
}
