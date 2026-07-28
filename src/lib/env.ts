import "server-only";
import { z } from "zod";

/**
 * The single environment chokepoint for required server configuration.
 *
 * Rules (docs/DESIGN.md, LEARNINGS §Next.js):
 * - Never read process.env at module top level anywhere in the app — the build
 *   must succeed with no environment populated. Read via env() inside the
 *   function/handler body that needs the value.
 * - Missing or invalid configuration fails fast at first use, never silently.
 *
 * Optional Vercel platform metadata (VERCEL_REGION, VERCEL_GIT_COMMIT_SHA, …)
 * may be read inline with a null fallback; required config goes through here.
 */
const schema = z.object({
  /** Postgres connection string (Neon pooled in prod, Docker locally). */
  DATABASE_URL: z.string().min(1),
  /** Auth.js JWT/cookie signing secret. */
  AUTH_SECRET: z.string().min(1),
  /** Resend API key for magic-link email. */
  AUTH_RESEND_KEY: z.string().min(1),
  /** Verified sender address for auth email. */
  AUTH_EMAIL_FROM: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ");
      throw new Error(`Missing or invalid environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}
