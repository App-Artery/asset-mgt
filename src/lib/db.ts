import "server-only";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

/**
 * Lazily initialised Prisma client: a plain PrismaClient instance held as a
 * globalThis singleton (survives dev hot-reload). Never wrap it in a JS Proxy
 * (docs/DESIGN.md). Nothing is instantiated at import time — the first getDb()
 * call constructs the client, which is what keeps `next build` env-free.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForPrisma.prisma ??= new PrismaClient({
    datasourceUrl: env().DATABASE_URL,
  });
  return globalForPrisma.prisma;
}
