import { NextResponse } from "next/server";
import packageJson from "../../../package.json";

// Runtime health/build info. force-dynamic so the response reflects the
// running deployment, not a build-time snapshot. Reads below are optional
// Vercel platform metadata (null locally) — required config goes through the
// env() chokepoint, which this route deliberately does not need.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    service: packageJson.name,
    version: packageJson.version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    region: process.env.VERCEL_REGION ?? null,
    time: new Date().toISOString(),
  });
}
