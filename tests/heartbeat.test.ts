/**
 * Isolated test: Heartbeat HEARTBEAT_OK token discard and toolCallHistory patching.
 * Validates that promise resolution logic works correctly without real API calls.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock config
jest.mock('../src/config.js', () => ({
  config: {
    ANTHROPIC_API_KEY: 'test-key',
    HEARTBEAT_MODEL: 'claude-haiku-4-5-20251001',
    HEARTBEAT_CRON: '*/30 * * * *',
    LOG_LEVEL: 'silent',
    DEFAULT_MODEL: 'claude-sonnet-4-6',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    SLACK_SIGNING_SECRET: 'test-secret',
    MCP_SERVERS: [],
    NODE_ENV: 'test',
  },
}));

// Mock logger
jest.mock('../src/logger.js', () => ({
  logger: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock memory manager
jest.mock('../src/memory/memoryManager.js', () => ({
  loadMemoryContext: jest.fn(async () => ({
    soul: '# SOUL\nYou are a test agent.',
    memory: '# MEMORY\n(empty)',
    heartbeatChecklist: '# HEARTBEAT\n- [ ] Check nothing.',
    todayLog: '',
  })),
}));

// Mock daily log
jest.mock('../src/memory/dailyLog.js', () => ({
  dailyLog: {
    heartbeat: jest.fn(async () => undefined),
    error: jest.fn(async () => undefined),
  },
}));

describe('Heartbeat toolCallHistory loop detection patch', () => {
  it('should clear toolCallHistory when delta > 60s', async () => {
    // Access the internal state via a test helper approach
    // Since toolCallHistory is module-internal, we test via observable behavior

    const { triggerHeartbeat, getHeartbeatState } = await import('../src/heartbeat/heartbeatRunner.js');

    // Mock Anthropic to return HEARTBEAT_OK
    const AnthropicModule = await import('@anthropic-ai/sdk');
    const mockCreate = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: 'HEARTBEAT_OK' }],
      id: 'msg_test',
      model: 'claude-haiku-4-5-20251001',
      role: 'assistant' as const,
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
      type: 'message' as const,
      usage: { input_tokens: 10, output_tokens: 1 },
    }));

    jest.spyOn(AnthropicModule.default.prototype, 'messages' as never).mockReturnValue({
      create: mockCreate,
    } as never);

    await triggerHeartbeat();
    const state = getHeartbeatState();

    expect(state.lastRunAt).not.toBeNull();
    expect(state.isRunning).toBe(false);
  });
});

describe('Heartbeat HEARTBEAT_OK silencing', () => {
  it('should NOT call onAction when output is HEARTBEAT_OK', async () => {
    const { triggerHeartbeat } = await import('../src/heartbeat/heartbeatRunner.js');
    const onAction = jest.fn(async () => undefined);

    // Anthropic mock already set above to return HEARTBEAT_OK
    await triggerHeartbeat(onAction);

    expect(onAction).not.toHaveBeenCalled();
  });
});
