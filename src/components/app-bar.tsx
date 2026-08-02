import type { Role } from "@prisma/client";

import { signOut } from "@/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * The app bar (docs/DESIGN-SYSTEM.md §4). Visible at every width, which is why
 * the mobile tab bar carries no Account destination — the user chip and Sign
 * out live here and never go away.
 */
/**
 * Up to two initials from a display name. The avatar is decorative — the name
 * sits beside it above sm, and the element is aria-hidden — so a name this
 * cannot parse (an email fallback, a single word) degrades to one letter
 * rather than needing a placeholder glyph.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppBar({ name, role }: { name: string; role: Role }) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-2">
      {/* Global search lands in AM-07. No placeholder input here: a search box
          that does nothing when typed into is worse than no search box. AM-07
          inherits the AssetEvent.notes constraint from CLAUDE.md — any feature
          indexing notes must exclude them from STAFF_RO reach. */}
      <span className="text-muted-foreground hidden text-sm md:inline">
        Asset Register
      </span>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full text-[0.65rem] font-semibold"
          >
            {initials(name)}
          </span>
          <span className="hidden text-sm sm:inline">{name}</span>
        </span>
        {/* Prose, not the enum, and so no longer mono: the chip names what this
            person is allowed to do, and `STAFF_RO` named a database value. */}
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
          {ROLE_LABELS[role]}
        </span>
        <form
          action={async () => {
            "use server";
            // Sign-out is a session mutation on the caller's own cookie, not a
            // data mutation — the one action that deliberately has no
            // requireRole (any authenticated role may sign out). Lifted
            // verbatim from the home page this shell replaced.
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
