/**
 * Isolated test: Session queue serialization and collect mode.
 * Validates that tasks execute sequentially and that collect mode buffers correctly.
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

describe('Session Queue — serial execution', () => {
  it('should execute tasks in order for a single user', async () => {
    const { enqueueTask } = await import('../src/gateway/sessionQueue.js');

    const executionOrder: number[] = [];
    const results: Array<Promise<void>> = [];

    // Enqueue 3 tasks that take different amounts of time
    for (let i = 0; i < 3; i++) {
      const taskIndex = i;
      enqueueTask('user_test_serial', async () => {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, (2 - taskIndex) * 10)
        );
        executionOrder.push(taskIndex);
      });
    }

    // Wait for queue to drain
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(executionOrder).toEqual([0, 1, 2]);
  });
});

describe('Session Queue — collect mode', () => {
  it('should buffer tasks in collect mode and drain after exit', async () => {
    const { enqueueTask, enterCollectMode, exitCollectMode } = await import(
      '../src/gateway/sessionQueue.js'
    );

    const executed: string[] = [];

    enterCollectMode('user_test_collect');

    enqueueTask('user_test_collect', async () => {
      executed.push('task1');
    });
    enqueueTask('user_test_collect', async () => {
      executed.push('task2');
    });

    // Tasks should NOT have run yet
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(executed).toEqual([]);

    exitCollectMode('user_test_collect');

    // Tasks should now drain
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(executed).toEqual(['task1', 'task2']);
  });
});
