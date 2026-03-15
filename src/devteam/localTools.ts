/**
 * Local tool implementations for the dev team agents.
 * Registered in the tool registry so agents can use them via the standard tool execution path.
 *
 * Tools:
 *  - read_file:   read a file at a given path
 *  - write_file:  write/overwrite a file (HITL-gated as high-risk)
 *  - list_files:  list files in a directory (glob pattern)
 *  - run_tests:   run `npm test` and return stdout/stderr (HITL-gated)
 *  - run_command: run an arbitrary shell command (HITL-gated as high-risk)
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import { registerLocalTool } from '../agent/toolRegistry.js';
import { HIGH_RISK_TOOLS } from '../tools/highRiskTools.js';
import { logger } from '../logger.js';

const execAsync = promisify(exec);
const PROJECT_ROOT = process.cwd();

// ── Tool schemas ────────────────────────────────────────────────────────────

const readFileSchema: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Path is relative to the project root.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to project root' },
    },
    required: ['path'],
  },
};

const writeFileSchema: Tool = {
  name: 'write_file',
  description: 'Write or overwrite a file with new content. Path is relative to project root. This is a DESTRUCTIVE operation and requires approval.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to project root' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
  },
};

const listFilesSchema: Tool = {
  name: 'list_files',
  description: 'List files in a directory. Path is relative to the project root.',
  input_schema: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Directory path relative to project root' },
      recursive: { type: 'boolean', description: 'Whether to list recursively (default: false)' },
    },
    required: ['directory'],
  },
};

const runTestsSchema: Tool = {
  name: 'run_tests',
  description: 'Run the project test suite via `npm test`. Returns stdout and stderr. Requires approval.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Optional test file pattern to run (e.g. "hitl")' },
    },
    required: [],
  },
};

const runCommandSchema: Tool = {
  name: 'run_command',
  description: 'Run an arbitrary shell command in the project root. Requires approval.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
  },
};

// ── Tool implementations ────────────────────────────────────────────────────

async function readFileTool(args: Record<string, unknown>): Promise<string> {
  const path = String(args['path'] ?? '');
  const fullPath = resolve(PROJECT_ROOT, path);

  // Safety: prevent path traversal outside project root
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return `Error: Access denied — path is outside project root`;
  }

  if (!existsSync(fullPath)) {
    return `Error: File not found: ${path}`;
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    return content;
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
}

async function writeFileTool(args: Record<string, unknown>): Promise<string> {
  const path = String(args['path'] ?? '');
  const content = String(args['content'] ?? '');
  const fullPath = resolve(PROJECT_ROOT, path);

  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return `Error: Access denied — path is outside project root`;
  }

  try {
    await writeFile(fullPath, content, 'utf-8');
    logger.info({ path }, 'File written by dev team agent');
    return `File written successfully: ${path} (${content.length} bytes)`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
}

async function listFilesTool(args: Record<string, unknown>): Promise<string> {
  const directory = String(args['directory'] ?? '.');
  const recursive = args['recursive'] === true;
  const fullPath = resolve(PROJECT_ROOT, directory);

  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return `Error: Access denied — path is outside project root`;
  }

  if (!existsSync(fullPath)) {
    return `Error: Directory not found: ${directory}`;
  }

  try {
    const files = await collectFiles(fullPath, recursive, PROJECT_ROOT);
    return files.join('\n') || '(empty directory)';
  } catch (err) {
    return `Error listing files: ${String(err)}`;
  }
}

async function runTestsTool(args: Record<string, unknown>): Promise<string> {
  const pattern = args['pattern'] ? String(args['pattern']) : '';
  const cmd = pattern
    ? `npm test -- --testPathPattern="${pattern}" 2>&1`
    : `npm test 2>&1`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
    });
    return [stdout, stderr].filter(Boolean).join('\n').slice(0, 8000);
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const out = [execErr.stdout, execErr.stderr, execErr.message]
      .filter(Boolean)
      .join('\n');
    return `Tests failed:\n${out}`.slice(0, 8000);
  }
}

async function runCommandTool(args: Record<string, unknown>): Promise<string> {
  const command = String(args['command'] ?? '');
  if (!command) return 'Error: No command provided';

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
    });
    return [stdout, stderr].filter(Boolean).join('\n').slice(0, 8000);
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    return `Command failed:\n${[execErr.stdout, execErr.stderr, execErr.message].filter(Boolean).join('\n')}`.slice(0, 8000);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function collectFiles(
  dir: string,
  recursive: boolean,
  root: string,
  depth = 0
): Promise<string[]> {
  if (depth > 5) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    const relPath = fullPath.replace(root + '/', '');

    if (entry.isDirectory()) {
      results.push(`${relPath}/`);
      if (recursive) {
        const sub = await collectFiles(fullPath, true, root, depth + 1);
        results.push(...sub);
      }
    } else {
      results.push(relPath);
    }
  }

  return results;
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all dev team local tools. Call once at startup. */
export function registerDevTeamTools(): void {
  // Ensure write_file and run_command are in the high-risk set
  HIGH_RISK_TOOLS.add('write_file');
  HIGH_RISK_TOOLS.add('run_command');
  HIGH_RISK_TOOLS.add('run_tests');

  registerLocalTool(readFileSchema, readFileTool);
  registerLocalTool(writeFileSchema, writeFileTool);
  registerLocalTool(listFilesSchema, listFilesTool);
  registerLocalTool(runTestsSchema, runTestsTool);
  registerLocalTool(runCommandSchema, runCommandTool);

  logger.info('Dev team local tools registered (read_file, write_file, list_files, run_tests, run_command)');
}
