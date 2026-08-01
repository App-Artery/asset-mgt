import Link from "next/link";
import type { AssetStatus } from "@prisma/client";

import { StatusChip } from "@/components/ui/status-chip";

/**
 * The phone shape of the register (docs/DESIGN-SYSTEM.md §5, AM-06).
 *
 * The table sets whitespace-nowrap and lets its wrapper scroll sideways, which
 * is right for a desktop and wrong for a thumb — answering "who has AST-0412?"
 * should not require side-scrolling seven columns. Same rows, chosen by
 * breakpoint, never by a media-query hook: a hook would make this a client
 * component and re-fetch nothing useful.
 *
 * `holder` is null for STAFF_RO because the page never fetched it. This
 * component renders what it is handed; it is NOT where the privacy rule lives.
 */
export type AssetCardRow = {
  id: string;
  tag: string | null;
  make: string;
  model: string;
  status: AssetStatus;
  categoryName: string;
  siteName: string | null;
  holder: { id: string; name: string } | null;
};

export function AssetCardList({ assets }: { assets: AssetCardRow[] }) {
  return (
    <ul
      data-testid="asset-card-list"
      className="flex flex-col gap-2 md:hidden"
      aria-label="Asset register"
    >
      {assets.map((asset) => (
        <li key={asset.id}>
          <Link
            href={`/assets/${asset.id}`}
            className="hover:bg-muted/50 flex flex-col gap-1.5 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              {/* The tag is the headline: looking one up is the entire reason
                  someone opens this away from a desk. */}
              {asset.tag ? (
                <span className="font-mono text-sm font-medium tabular-nums">
                  {asset.tag}
                </span>
              ) : (
                // "Untagged", matching the table and the detail page's
                // "Untagged asset". One vocabulary for one state: the card and
                // the row are the same register at two widths, and a reader
                // who learns a word in one must not meet a new one in the
                // other.
                <span className="text-muted-foreground rounded border border-dashed px-1.5 font-mono text-xs">
                  Untagged
                </span>
              )}
              <StatusChip status={asset.status} />
            </div>
            <span className="text-sm">
              {asset.make} {asset.model}
            </span>
            <span className="text-muted-foreground text-xs">
              {[asset.holder?.name, asset.siteName, asset.categoryName]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
