import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A tag, everywhere it appears.
 *
 * Mono and tabular-nums because a tag is an identifier read down a column and
 * compared against a barcode — in a proportional font AST-0411 and AST-0417 are
 * different widths. Three near-copies of this existed, only one of which was
 * mono.
 *
 * "Untagged" is the app's one word for a tagless asset, matching the register,
 * the card and the detail page's "Untagged asset". A tag is mandatory from
 * delivery onwards and ON_ORDER/RETIRED are the exempt states, so this is a real
 * value rather than a placeholder for missing data.
 */
export function AssetTagLink({
  id,
  tag,
  className,
}: {
  id: string;
  tag: string | null;
  className?: string;
}) {
  return (
    <Link
      href={`/assets/${id}`}
      className={cn(
        "font-mono tabular-nums underline underline-offset-4",
        className,
      )}
    >
      {tag ?? "Untagged"}
    </Link>
  );
}
