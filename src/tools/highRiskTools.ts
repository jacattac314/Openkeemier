/**
 * Registry of high-risk tool names that require HITL approval before execution.
 * Tool names must match exactly the tool names returned by MCP servers or local tools.
 */

export const HIGH_RISK_TOOLS = new Set<string>([
  // Shell execution
  'bash',
  'shell',
  'exec',
  'run_command',
  'execute_command',

  // Database operations
  'drop_table',
  'delete_database',
  'truncate_table',
  'run_sql',

  // File system destructive ops
  'delete_file',
  'remove_directory',
  'overwrite_file',

  // Slack administrative ops
  'join_channel',
  'leave_channel',
  'kick_user',
  'archive_channel',

  // GitHub destructive ops
  'delete_repository',
  'force_push',
  'delete_branch',

  // Network/infrastructure
  'deploy',
  'rollback',
  'restart_service',
]);

export function isHighRisk(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName.toLowerCase());
}
