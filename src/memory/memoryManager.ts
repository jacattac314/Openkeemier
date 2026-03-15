/**
 * File-based semantic memory manager.
 * Manages SOUL.md (persona), MEMORY.md (long-term facts), HEARTBEAT.md (checklist),
 * and daily chronological logs.
 */

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

const DATA_DIR = join(process.cwd(), 'data');
const MEMORY_DIR = join(DATA_DIR, 'memory');
const LOGS_DIR = join(DATA_DIR, 'logs');

export interface MemoryContext {
  soul: string;
  memory: string;
  heartbeatChecklist: string;
  todayLog: string;
}

/** Load all memory context for injection into the agent's system prompt. */
export async function loadMemoryContext(): Promise<MemoryContext> {
  const [soul, memory, heartbeatChecklist, todayLog] = await Promise.all([
    readFileSafe(join(MEMORY_DIR, 'SOUL.md')),
    readFileSafe(join(MEMORY_DIR, 'MEMORY.md')),
    readFileSafe(join(MEMORY_DIR, 'HEARTBEAT.md')),
    readFileSafe(getDailyLogPath()),
  ]);

  return { soul, memory, heartbeatChecklist, todayLog };
}

/** Append a new fact or summary to MEMORY.md under the appropriate section. */
export async function appendToMemory(section: string, content: string): Promise<void> {
  const memoryPath = join(MEMORY_DIR, 'MEMORY.md');
  const timestamp = new Date().toISOString();
  const entry = `\n<!-- ${timestamp} -->\n${content}\n`;

  const current = await readFileSafe(memoryPath);

  if (current.includes(`## ${section}`)) {
    // Append after the section header
    const updated = current.replace(
      `## ${section}`,
      `## ${section}\n${entry}`
    );
    await writeFile(memoryPath, updated, 'utf-8');
  } else {
    // Add new section
    await appendFile(memoryPath, `\n## ${section}\n${entry}`, 'utf-8');
  }

  logger.debug({ section }, 'Memory updated');
}

/** Log an event to the daily chronological log. */
export async function logToDaily(
  type: 'user_message' | 'agent_response' | 'tool_call' | 'tool_result' | 'heartbeat' | 'error',
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await ensureLogsDir();

  const logPath = getDailyLogPath();
  const timestamp = new Date().toISOString();
  const entry = JSON.stringify({ timestamp, type, content, ...metadata }) + '\n';

  await appendFile(logPath, entry, 'utf-8');
}

/** Read today's log as structured entries. */
export async function readTodayLog(): Promise<Array<{
  timestamp: string;
  type: string;
  content: string;
  [key: string]: unknown;
}>> {
  const raw = await readFileSafe(getDailyLogPath());
  if (!raw) return [];

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { timestamp: string; type: string; content: string };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

/** Summarize and compress MEMORY.md if it exceeds the size threshold. */
export async function compressMemoryIfNeeded(
  summarizeFn: (text: string) => Promise<string>,
  thresholdBytes = 50_000
): Promise<boolean> {
  const memoryPath = join(MEMORY_DIR, 'MEMORY.md');
  const content = await readFileSafe(memoryPath);
  const byteSize = Buffer.byteLength(content, 'utf-8');

  if (byteSize < thresholdBytes) return false;

  logger.info({ byteSize, thresholdBytes }, 'Memory compression triggered');

  const summary = await summarizeFn(content);
  const header = `# MEMORY.md — Long-Term Agent Memory\n\n*Last compressed: ${new Date().toISOString()}*\n\n`;
  await writeFile(memoryPath, header + summary, 'utf-8');

  return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getDailyLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOGS_DIR, `${date}.ndjson`);
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function ensureLogsDir(): Promise<void> {
  if (!existsSync(LOGS_DIR)) {
    await mkdir(LOGS_DIR, { recursive: true });
  }
}
