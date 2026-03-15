import bolt from '@slack/bolt';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { App } = bolt;

export const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: config.SLACK_APP_TOKEN,
  logLevel: config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace' ? 'debug' : 'warn',
});

export async function startSlackApp(): Promise<void> {
  await app.start();
  logger.info('Slack Socket Mode connection established');
}
