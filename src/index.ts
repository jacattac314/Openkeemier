/**
 * OpenKeemier — Entry Point
 * Wires all subsystems: Slack Gateway, Agent Core, Memory, Heartbeat.
 */

import 'node:process';
import { config } from './config.js';
import { logger } from './logger.js';
import { app, startSlackApp } from './gateway/slackApp.js';
import { registerMessageHandlers } from './gateway/messageHandler.js';
import { registerHitlApp, requestApproval } from './gateway/hitl.js';
import { runAgent } from './agent/agentRunner.js';
import { initializeMcpServers, disconnectAllServers } from './agent/mcpClient.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/heartbeatRunner.js';

// Global error handlers
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

async function main(): Promise<void> {
  logger.info({ version: '0.1.0', model: config.DEFAULT_MODEL }, 'OpenKeemier starting');

  // 1. Initialize MCP servers
  await initializeMcpServers(config.MCP_SERVERS);

  // 2. Register HITL with Bolt app
  registerHitlApp(app);

  // 3. Register message handlers
  registerMessageHandlers(app, async ({ userId, channelId, text, say }) => {
    try {
      const result = await runAgent({
        userId,
        channelId,
        userText: text,
        requestApproval: async (toolName, args, rationale) => {
          const decision = await requestApproval({
            toolName,
            toolArgs: args,
            rationale,
            requestedBy: userId,
            channelId,
          });
          return decision.approved;
        },
        onChunk: (chunk) => {
          logger.trace({ userId, chunkLength: chunk.length }, 'Response chunk');
        },
      });

      await say(result.response);
    } catch (err) {
      logger.error({ userId, channelId, err }, 'Agent run failed');
      await say('Sorry, I encountered an error. Please try again.');
    }
  });

  // 4. Start Slack Socket Mode
  await startSlackApp();

  // 5. Start heartbeat engine
  startHeartbeat(async (action) => {
    logger.info({ action }, 'Heartbeat triggered action — implement proactive messaging here');
    // TODO: Route heartbeat actions to appropriate Slack channel
  });

  logger.info('OpenKeemier fully initialized and listening');
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');
  stopHeartbeat();
  await disconnectAllServers();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main();
