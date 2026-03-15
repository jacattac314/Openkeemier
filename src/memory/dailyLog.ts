/**
 * Convenience wrapper for the daily log — typed event emitters.
 */

import { logToDaily } from './memoryManager.js';

export const dailyLog = {
  userMessage: (userId: string, channelId: string, text: string) =>
    logToDaily('user_message', text, { userId, channelId }),

  agentResponse: (text: string, metadata?: Record<string, unknown>) =>
    logToDaily('agent_response', text, metadata),

  toolCall: (toolName: string, args: unknown) =>
    logToDaily('tool_call', toolName, { args }),

  toolResult: (toolName: string, result: unknown, isError = false) =>
    logToDaily('tool_result', toolName, { result, isError }),

  heartbeat: (status: 'ok' | 'action', details?: string) =>
    logToDaily('heartbeat', status, { details }),

  error: (message: string, err: unknown) =>
    logToDaily('error', message, { err: String(err) }),
};
