import type { Role } from "@prisma/client";

import { signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * The app bar (docs/DESIGN-SYSTEM.md §4). Visible at every width, which is why
 * the mobile tab bar carries no Account destination — the user chip and Sign
 * out live here and never go away.
 */
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
        <span className="hidden text-sm sm:inline">{name}</span>
        <span className="text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[0.65rem]">
          {role}
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
