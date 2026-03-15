/**
 * OpenKeemier — Entry Point
 * Wires all subsystems: WhatsApp Gateway, Agent Core, Memory, Heartbeat, Dev Team.
 */

import 'node:process';
import { config } from './config.js';
import { logger } from './logger.js';
import { startWhatsAppServer } from './gateway/whatsappClient.js';
import { registerWhatsAppHandlers } from './gateway/whatsappHandler.js';
import { initializeMcpServers, disconnectAllServers } from './agent/mcpClient.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/heartbeatRunner.js';
import { registerDevTeamTools } from './devteam/localTools.js';

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

  // 2. Register dev team local tools
  registerDevTeamTools();

  // 3. Register WhatsApp message handlers
  registerWhatsAppHandlers();

  // 4. Start WhatsApp webhook server
  await startWhatsAppServer();

  // 5. Start heartbeat engine
  startHeartbeat(async (action) => {
    logger.info({ action }, 'Heartbeat triggered proactive action');
    // TODO: send proactive WhatsApp message to admin number
  });

  logger.info(
    { port: config.WEBHOOK_PORT, path: config.WEBHOOK_PATH },
    'OpenKeemier fully initialized and listening'
  );
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
