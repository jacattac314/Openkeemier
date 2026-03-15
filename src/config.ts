import { z } from 'zod';

const ConfigSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  DEFAULT_MODEL: z.string().default('claude-sonnet-4-6'),
  HEARTBEAT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  HEARTBEAT_CRON: z.string().default('*/30 * * * *'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MCP_SERVERS: z
    .string()
    .default('[]')
    .transform((s) => JSON.parse(s) as McpServerConfig[]),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration. Missing or invalid env vars: ${missing}`);
  }
  return result.data;
}

export const config = loadConfig();
