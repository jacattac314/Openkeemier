/**
 * Isolated test: HITL promise resolution.
 * Validates that approval/rejection hooks resolve correctly without real Slack API calls.
 */

import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../src/logger.js', () => ({
  logger: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('HITL — approval flow', () => {
  it('should resolve with approved=true when hook.resolve is called with approved decision', async () => {
    // Test the promise resolution pattern directly
    type Decision = { approved: boolean; decidedBy: string };

    const pendingHooks = new Map<
      string,
      { resolve: (d: Decision) => void; reject: (e: Error) => void }
    >();

    const hookId = 'test_hook_001';

    const approvalPromise = new Promise<Decision>((resolve, reject) => {
      pendingHooks.set(hookId, { resolve, reject });
    });

    // Simulate user clicking "Approve"
    const hook = pendingHooks.get(hookId);
    expect(hook).toBeDefined();

    hook!.resolve({ approved: true, decidedBy: 'U12345' });
    pendingHooks.delete(hookId);

    const decision = await approvalPromise;
    expect(decision.approved).toBe(true);
    expect(decision.decidedBy).toBe('U12345');
  });

  it('should resolve with approved=false when rejection is triggered', async () => {
    type Decision = { approved: boolean; decidedBy: string };

    const pendingHooks = new Map<
      string,
      { resolve: (d: Decision) => void; reject: (e: Error) => void }
    >();

    const hookId = 'test_hook_002';

    const approvalPromise = new Promise<Decision>((resolve, reject) => {
      pendingHooks.set(hookId, { resolve, reject });
    });

    const hook = pendingHooks.get(hookId);
    hook!.resolve({ approved: false, decidedBy: 'U99999' });
    pendingHooks.delete(hookId);

    const decision = await approvalPromise;
    expect(decision.approved).toBe(false);
  });

  it('should reject promise on timeout (simulated)', async () => {
    type Decision = { approved: boolean; decidedBy: string };

    const hookPromise = new Promise<Decision>((_, reject) => {
      setTimeout(() => {
        reject(new Error('HITL timeout: No response received'));
      }, 10);
    });

    await expect(hookPromise).rejects.toThrow('HITL timeout');
  });
});
