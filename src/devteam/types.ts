/**
 * Shared types for the multi-agent dev team.
 */

export type AgentRole = 'orchestrator' | 'coder' | 'reviewer' | 'tester';

export interface DevTask {
  id: string;
  description: string;
  role: AgentRole;
  /** Additional context or prior agent output to pass into this task */
  context?: string;
  /** Specific file paths relevant to this task */
  filePaths?: string[];
}

export interface ReviewComment {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  summary: string;
  failures?: string[];
}

export interface DevTaskResult {
  taskId: string;
  role: AgentRole;
  success: boolean;
  output: string;
  filesModified?: string[];
  reviewComments?: ReviewComment[];
  testResults?: TestResult;
}

export interface TeamJobRequest {
  userId: string;
  channelId: string;
  userMessage: string;
  requestApproval: (
    toolName: string,
    args: Record<string, unknown>,
    rationale: string
  ) => Promise<boolean>;
}

export interface TeamJobResult {
  summary: string;
  tasks: DevTaskResult[];
}

export interface DecomposedPlan {
  objective: string;
  tasks: DevTask[];
  sequentialPhases: AgentRole[][];
}
