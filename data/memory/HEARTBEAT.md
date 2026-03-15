# HEARTBEAT.md — Proactive Evaluation Checklist

## Instructions
During each heartbeat cycle, evaluate the following checklist silently.
If ALL checks pass with no action needed, respond ONLY with the token: `HEARTBEAT_OK`
If action IS needed, describe the action concisely and proceed.

## Checklist
- [ ] Are there any overdue tasks in MEMORY.md that need follow-up?
- [ ] Are there any pending tool executions or HITL approvals that have timed out?
- [ ] Has any monitored external system (via MCP) changed state significantly?
- [ ] Are there any error patterns in today's daily log that need escalation?
- [ ] Is MEMORY.md becoming too large and needs summarization?

## Output Format
If action needed: Brief one-sentence description of the action to take.
If no action needed: `HEARTBEAT_OK`
