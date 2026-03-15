/**
 * Tests for the /status slash command handler (src/gateway/statusCommand.ts).
 *
 * Since formatUptime and formatBytes are module-private, they are tested
 * indirectly through the blocks produced by the command's respond() call.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock: logger
// ---------------------------------------------------------------------------
jest.mock('../src/logger.js', () => ({
  logger: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: config
// ---------------------------------------------------------------------------
jest.mock('../src/config.js', () => ({
  config: {
    DEFAULT_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_API_KEY: 'test-key',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    SLACK_SIGNING_SECRET: 'test-secret',
    MCP_SERVERS: [],
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock: heartbeatRunner
// ---------------------------------------------------------------------------
const mockGetHeartbeatState = jest.fn();
jest.mock('../src/heartbeat/heartbeatRunner.js', () => ({
  getHeartbeatState: mockGetHeartbeatState,
}));

// ---------------------------------------------------------------------------
// Mock: hitl (getPendingHookCount)
// ---------------------------------------------------------------------------
const mockGetPendingHookCount = jest.fn();
jest.mock('../src/gateway/hitl.js', () => ({
  getPendingHookCount: mockGetPendingHookCount,
}));

// ---------------------------------------------------------------------------
// Helper types mirroring Bolt's respond / ack shapes
// ---------------------------------------------------------------------------
type RespondArgument = {
  response_type: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Invoke the registered /status handler with controlled process state. */
async function invokeStatusCommand(opts: {
  uptimeSeconds: number;
  heapUsedBytes: number;
  isRunning?: boolean;
  lastRunAt?: number | null;
  toolCallHistoryLength?: number;
  hitlCount?: number;
}): Promise<{
  ackCalled: boolean;
  ackCalledBeforeRespond: boolean;
  respondPayload: RespondArgument;
}> {
  const {
    uptimeSeconds,
    heapUsedBytes,
    isRunning = false,
    lastRunAt = null,
    toolCallHistoryLength = 0,
    hitlCount = 0,
  } = opts;

  // Control process.uptime and process.memoryUsage
  const uptimeSpy = jest
    .spyOn(process, 'uptime')
    .mockReturnValue(uptimeSeconds);
  const memSpy = jest
    .spyOn(process, 'memoryUsage')
    .mockReturnValue({
      heapUsed: heapUsedBytes,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
      rss: 0,
    });

  mockGetHeartbeatState.mockReturnValue({
    isRunning,
    lastRunAt,
    toolCallHistory: new Array(toolCallHistoryLength),
  });
  mockGetPendingHookCount.mockReturnValue(hitlCount);

  const callOrder: string[] = [];

  const ack = jest.fn(async () => {
    callOrder.push('ack');
  });
  const respond = jest.fn(async (_payload: RespondArgument) => {
    callOrder.push('respond');
  });

  // Import (or re-use cached module) and register the command.
  // We capture the handler by intercepting boltApp.command.
  let capturedHandler: (ctx: { ack: typeof ack; respond: typeof respond }) => Promise<void> = async () => {};

  const fakeBoltApp = {
    command: jest.fn((_cmdName: string, handler: typeof capturedHandler) => {
      capturedHandler = handler;
    }),
  };

  // Dynamic import so mocks are resolved first.
  const { registerStatusCommand } = await import('../src/gateway/statusCommand.js');
  registerStatusCommand(fakeBoltApp as never);

  await capturedHandler({ ack, respond });

  uptimeSpy.mockRestore();
  memSpy.mockRestore();

  return {
    ackCalled: ack.mock.calls.length === 1,
    ackCalledBeforeRespond: callOrder[0] === 'ack' && callOrder[1] === 'respond',
    respondPayload: (respond.mock.calls[0] as [RespondArgument])[0],
  };
}

/** Return the text of all mrkdwn fields found in any section block. */
function collectFieldTexts(blocks: Array<Record<string, unknown>>): string[] {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'section' && Array.isArray(block.fields)) {
      for (const field of block.fields as Array<{ type: string; text: string }>) {
        if (field.type === 'mrkdwn') {
          texts.push(field.text);
        }
      }
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/status command — formatUptime (tested indirectly)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetHeartbeatState.mockReset();
    mockGetPendingHookCount.mockReset();
  });

  it('formats 3600 seconds as "1h 0m 0s"', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 3600,
      heapUsedBytes: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const uptimeField = texts.find((t) => t.startsWith('*Uptime*'));
    expect(uptimeField).toBeDefined();
    expect(uptimeField).toContain('1h 0m 0s');
  });

  it('formats 3661 seconds as "1h 1m 1s"', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 3661,
      heapUsedBytes: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const uptimeField = texts.find((t) => t.startsWith('*Uptime*'));
    expect(uptimeField).toBeDefined();
    expect(uptimeField).toContain('1h 1m 1s');
  });

  it('formats 90 seconds as "0h 1m 30s"', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 90,
      heapUsedBytes: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const uptimeField = texts.find((t) => t.startsWith('*Uptime*'));
    expect(uptimeField).toBeDefined();
    expect(uptimeField).toContain('0h 1m 30s');
  });
});

describe('/status command — formatBytes (tested indirectly)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetHeartbeatState.mockReset();
    mockGetPendingHookCount.mockReset();
  });

  it('formats 1048576 bytes as "1.0 MB"', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 1048576,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const memField = texts.find((t) => t.startsWith('*Memory*'));
    expect(memField).toBeDefined();
    expect(memField).toContain('1.0 MB');
  });

  it('formats 5242880 bytes as "5.0 MB"', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 5242880,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const memField = texts.find((t) => t.startsWith('*Memory*'));
    expect(memField).toBeDefined();
    expect(memField).toContain('5.0 MB');
  });
});

describe('/status command — handler behaviour', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetHeartbeatState.mockReset();
    mockGetPendingHookCount.mockReset();
  });

  it('calls ack() before respond()', async () => {
    const { ackCalledBeforeRespond } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    expect(ackCalledBeforeRespond).toBe(true);
  });

  it('calls ack() exactly once', async () => {
    const { ackCalled } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    expect(ackCalled).toBe(true);
  });

  it('responds with response_type ephemeral', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    expect(respondPayload.response_type).toBe('ephemeral');
  });

  it('includes Node.js version field', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const nodeField = texts.find((t) => t.startsWith('*Node.js*'));
    expect(nodeField).toBeDefined();
    expect(nodeField).toContain(process.version);
  });

  it('includes model field with configured DEFAULT_MODEL', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const modelField = texts.find((t) => t.startsWith('*Model*'));
    expect(modelField).toBeDefined();
    expect(modelField).toContain('claude-sonnet-4-6');
  });

  it('shows "✅ Idle" heartbeat status when isRunning=false', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      isRunning: false,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const hbField = texts.find((t) => t.startsWith('*Heartbeat*'));
    expect(hbField).toBeDefined();
    expect(hbField).toContain('✅ Idle');
  });

  it('shows "⚠️ Currently running" heartbeat status when isRunning=true', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      isRunning: true,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const hbField = texts.find((t) => t.startsWith('*Heartbeat*'));
    expect(hbField).toBeDefined();
    expect(hbField).toContain('⚠️ Currently running');
  });

  it('shows "never" for last heartbeat when lastRunAt is null', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      lastRunAt: null,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const lastHbField = texts.find((t) => t.startsWith('*Last Heartbeat*'));
    expect(lastHbField).toBeDefined();
    expect(lastHbField).toContain('never');
  });

  it('shows ISO timestamp for last heartbeat when lastRunAt is set', async () => {
    const ts = new Date('2025-01-15T12:00:00.000Z').getTime();
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      lastRunAt: ts,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const lastHbField = texts.find((t) => t.startsWith('*Last Heartbeat*'));
    expect(lastHbField).toBeDefined();
    expect(lastHbField).toContain('2025-01-15T12:00:00.000Z');
  });

  it('shows "✅ None pending" HITL status when hitlCount=0', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      hitlCount: 0,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const hitlField = texts.find((t) => t.startsWith('*HITL Hooks*'));
    expect(hitlField).toBeDefined();
    expect(hitlField).toContain('✅ None pending');
  });

  it('shows pending count in HITL status when hitlCount > 0', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      hitlCount: 3,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const hitlField = texts.find((t) => t.startsWith('*HITL Hooks*'));
    expect(hitlField).toBeDefined();
    expect(hitlField).toContain('3 pending approval(s)');
  });

  it('shows tool call history entry count', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
      toolCallHistoryLength: 7,
    });
    const texts = collectFieldTexts(respondPayload.blocks);
    const histField = texts.find((t) => t.startsWith('*Tool Call History*'));
    expect(histField).toBeDefined();
    expect(histField).toContain('7 entries');
  });

  it('includes a header block with OpenKeemier Status text', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    const headerBlock = respondPayload.blocks.find((b) => b.type === 'header');
    expect(headerBlock).toBeDefined();
    const headerText = (headerBlock?.text as { text: string } | undefined)?.text;
    expect(headerText).toContain('OpenKeemier Status');
  });

  it('includes a divider block', async () => {
    const { respondPayload } = await invokeStatusCommand({
      uptimeSeconds: 0,
      heapUsedBytes: 0,
    });
    const divider = respondPayload.blocks.find((b) => b.type === 'divider');
    expect(divider).toBeDefined();
  });
});
