#!/usr/bin/env bash
#
# Vercel's build command (ADR-002). Migrations land BEFORE the build, so a
# production deployment can never promote code whose schema has not been
# applied.
#
# Two consequences of that ordering, both recorded in ADR-002 §Consequences and
# neither fixed here:
#
#   - The schema goes forward even if the build then fails, so any migration
#     that drops, renames or tightens breaks CURRENTLY-SERVING production the
#     moment it applies. Mitigation is the two-PR gate (#30).
#   - Instant rollback restores code but NOT schema, so every migration must be
#     survivable by the immediately previous deployment.
#
# Invoked as `bash scripts/vercel-build.sh` from vercel.json so the pipeline
# does not depend on a git mode bit surviving a checkout.
set -euo pipefail

bash "$(dirname "$0")/migrate-if-production.sh"

# `pnpm build` is the same command CI runs env-free, unchanged. That is what
# keeps the zero-env build non-negotiable intact: ci.yml calls `pnpm build`
# directly and never reaches this file.
exec pnpm build
