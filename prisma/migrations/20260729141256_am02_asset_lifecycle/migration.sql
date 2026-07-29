-- DropForeignKey
ALTER TABLE "AssetEvent" DROP CONSTRAINT "AssetEvent_actorId_fkey";

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- CreateIndex
CREATE INDEX "Asset_siteId_idx" ON "Asset"("siteId");

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tag invariant, enforced in SQL rather than application code: a tag is
-- mandatory from delivery onwards. Hand-written — Prisma's schema language has
-- no CHECK primitive, so this block must be preserved if the migration is ever
-- regenerated.
--
-- Exempt statuses:
--   ON_ORDER  — ordered, not yet delivered, so not yet tagged (the whole point
--               of Asset.tag being nullable).
--   RETIRED   — kit that never earned a tag can still be retired; dead-on-
--               arrival hardware goes back to the supplier untagged.
--
-- Everything else (IN_STOCK, ASSIGNED, IN_REPAIR) is an asset the client is
-- tracking on premises, and an untracked-but-tagless asset is exactly the state
-- the register exists to prevent. AM-04's import inherits this: a tagless
-- in-stock row fails loudly rather than landing untagged.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tag_required_when_tracked"
  CHECK ("status" IN ('ON_ORDER', 'RETIRED') OR "tag" IS NOT NULL);
