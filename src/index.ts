/**
 * OpenKeemier — Entry Point
 * Wires all subsystems: Slack Gateway, Agent Core, Memory, Heartbeat, Dev Team.
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
import { runOrchestrator } from './devteam/orchestrator.js';
import { formatJobResultBlocks } from './devteam/slackReporter.js';
import { registerDevTeamTools } from './devteam/localTools.js';

// Global error handlers
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

/** Detect if the message is a dev team task (starts with /dev or @devteam). */
function isDevTeamRequest(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower.startsWith('/dev ') || lower.startsWith('@devteam ');
}

function stripDevTeamPrefix(text: string): string {
  return text.trim().replace(/^\/dev\s+|^@devteam\s+/i, '');
}

async function main(): Promise<void> {
  logger.info({ version: '0.1.0', model: config.DEFAULT_MODEL }, 'OpenKeemier starting');

  // 1. Initialize MCP servers
  await initializeMcpServers(config.MCP_SERVERS);

  // 2. Register dev team local tools
  registerDevTeamTools();

  // 3. Register HITL with Bolt app
  registerHitlApp(app);

  // 4. Register message handlers
  registerMessageHandlers(app, async ({ userId, channelId, text, say }) => {
    if (isDevTeamRequest(text)) {
      // Route to orchestrator
      const taskText = stripDevTeamPrefix(text);

      await say(`⚙️ *Dev team activated.* Planning: _${taskText.slice(0, 100)}_…`);

      try {
        const result = await runOrchestrator({
          userId,
          channelId,
          userMessage: taskText,
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
        });

        // Post rich Block Kit report
        await app.client.chat.postMessage({
          channel: channelId,
          text: result.summary,
          blocks: formatJobResultBlocks(result),
        });
      } catch (err) {
        logger.error({ userId, channelId, err }, 'Dev team job failed');
        await say(`❌ Dev team encountered an error: ${String(err)}`);
      }
    } else {
      // Route to generic agent
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
        });

        await say(result.response);
      } catch (err) {
        logger.error({ userId, channelId, err }, 'Agent run failed');
        await say('Sorry, I encountered an error. Please try again.');
      }
    }
  });

  // 5. Start Slack Socket Mode
  await startSlackApp();

  // 6. Start heartbeat engine
  startHeartbeat(async (action) => {
    logger.info({ action }, 'Heartbeat triggered action');
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
