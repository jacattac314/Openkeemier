# CLAUDE.md — OpenKeemier Project Rules

## Project Identity
Autonomous AI agent daemon built on Node.js 22 + TypeScript ESM strict mode.
Connects to Slack via Socket Mode, executes tools via MCP, and uses Anthropic SDK.

## TypeScript Rules (ENFORCED)
- Module system: ESM only. Every import MUST include `.js` extension (e.g., `import { foo } from './foo.js'`).
- Strict mode: `"strict": true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- No `any` types. Use `unknown` and narrow with zod or type guards.
- No `require()`. No CommonJS. No `.cjs` files.
- All async functions must handle errors explicitly — no unhandled promise rejections.

## Logging (ENFORCED)
- Use `pino` exclusively. No `console.log` in production code.
- Import logger from `src/logger.ts` — never instantiate pino directly in modules.
- Log at appropriate levels: `trace` for tool steps, `debug` for state, `info` for milestones, `warn` for recoverable issues, `error` for failures.
- Include structured context objects, e.g.: `logger.info({ userId, channel }, 'Processing message')`.

## Directory Structure
```
src/
  index.ts          # Entry point — wires all subsystems
  logger.ts         # Singleton pino logger
  config.ts         # Zod-validated env config
  gateway/          # Slack Socket Mode, session queue, HITL
    slackApp.ts     # Bolt App initialization
    sessionQueue.ts # Per-user serialized command queue
    hitl.ts         # Human-in-the-loop Block Kit + action resolver
  agent/            # Core LLM orchestration
    agentRunner.ts  # Agentic loop with tool execution
    toolRegistry.ts # MCP tool schema registry
    mcpClient.ts    # MCP protocol client
  memory/           # File-based semantic memory
    memoryManager.ts
    dailyLog.ts
  heartbeat/        # Proactive background engine
    heartbeatRunner.ts
  skills/           # Dynamic SKILL.md loader
    skillLoader.ts
  tools/            # Local tool implementations
data/
  memory/
    SOUL.md         # Agent persona and inviolable rules
    MEMORY.md       # Long-term accumulated facts
  logs/             # Daily chronological logs (gitignored)
tests/              # Isolated mock test scripts
```

## Naming Conventions
- Files: `camelCase.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Zod schemas: suffix with `Schema` (e.g., `ConfigSchema`)

## Security Rules
- Never log secrets, tokens, or API keys.
- All user-facing destructive tools require HITL approval before execution.
- High-risk tool list is maintained in `src/tools/highRiskTools.ts`.
- Validate all external inputs (Slack events, MCP responses) with zod before use.

## MCP Integration
- Do NOT hardcode API calls. Route all external integrations through MCP servers.
- MCP server configs loaded from `MCP_SERVERS` env var (JSON array).
- Tool schemas fetched dynamically from MCP servers at startup.

## Heartbeat Rules
- Runs every 30 min via node-cron.
- MUST use `HEARTBEAT_MODEL` (Haiku) regardless of global default.
- If no action needed, emit `HEARTBEAT_OK` token and discard silently.
- Clear `toolCallHistory` if time delta between executions exceeds 60 seconds.

## Error Handling
- Wrap all top-level async entry points with a global `process.on('unhandledRejection')` handler.
- Retry transient Slack/Anthropic API errors with exponential backoff (max 3 retries).
- Never swallow errors silently — always log with context before discarding.

## Testing
- Write isolated mock scripts in `tests/` for HITL promise resolution and heartbeat queue.
- Use `node --experimental-vm-modules` for Jest with ESM.
- Test files suffix: `.test.ts`

## Context Management
- When switching between unrelated domains (e.g., gateway routing vs. memory mapping), run `/clear` in Claude Code to avoid context pollution.
- Keep individual files under 300 lines. Extract helpers into sibling files.
