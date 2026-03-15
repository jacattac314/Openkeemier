/**
 * Per-user serialized command queue.
 * Ensures messages are processed sequentially per user, preventing state corruption
 * during async tool execution (collect queue mode per OpenClaw spec).
 */

import { logger } from '../logger.js';

type Task = () => Promise<void>;

interface SessionState {
  queue: Task[];
  processing: boolean;
  collectionMode: boolean; // buffer incoming msgs while agent processes background task
}

const sessions = new Map<string, SessionState>();

function getSession(userId: string): SessionState {
  let session = sessions.get(userId);
  if (!session) {
    session = { queue: [], processing: false, collectionMode: false };
    sessions.set(userId, session);
  }
  return session;
}

async function drain(userId: string, session: SessionState): Promise<void> {
  if (session.processing) return;
  session.processing = true;

  while (session.queue.length > 0) {
    const task = session.queue.shift();
    if (!task) break;
    try {
      await task();
    } catch (err) {
      logger.error({ userId, err }, 'Session queue task failed');
    }
  }

  session.processing = false;
}

/**
 * Enqueue a task for a user. If collection mode is active, the task is buffered
 * and will be processed after the current background operation completes.
 */
export function enqueueTask(userId: string, task: Task): void {
  const session = getSession(userId);
  session.queue.push(task);
  logger.debug({ userId, queueLength: session.queue.length }, 'Task enqueued');

  if (!session.collectionMode) {
    void drain(userId, session);
  }
}

/** Enable collect mode: buffer incoming messages, don't drain. */
export function enterCollectMode(userId: string): void {
  getSession(userId).collectionMode = true;
  logger.debug({ userId }, 'Entered collect mode');
}

/** Disable collect mode and drain buffered tasks. */
export function exitCollectMode(userId: string): void {
  const session = getSession(userId);
  session.collectionMode = false;
  logger.debug({ userId, buffered: session.queue.length }, 'Exited collect mode');
  void drain(userId, session);
}

/** Returns true if the user's queue is currently processing. */
export function isProcessing(userId: string): boolean {
  return getSession(userId).processing;
}
