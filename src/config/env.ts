import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  PUBLIC_BASE_URL: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),

  GHL_API_BASE_URL: z.string().url().default("https://services.leadconnectorhq.com"),
  GHL_PRIVATE_INTEGRATION_TOKEN: z.string().min(1),
  GHL_API_VERSION: z.string().min(1).default("2021-07-28"),
  GHL_LOCATION_ID: z.string().min(1),
  GHL_CUSTOM_PROVIDER_ID: z.string().min(1),
  GHL_CUSTOM_PROVIDER_SECRET: z.string().min(16).optional(),

  WEBHOOK_SHARED_SECRET: z.string().min(16).optional()
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${message}`);
}

export const env = parsed.data;
