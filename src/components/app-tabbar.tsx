import Link from "next/link";
import type { Role } from "@prisma/client";
import { Boxes, LayoutList, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Mobile navigation (docs/DESIGN-SYSTEM.md §5, AM-06).
 *
 * A bottom bar rather than a hamburger drawer: these destinations sit in thumb
 * reach, where a drawer would bury all of them behind a tap in the hardest
 * corner of the screen to reach one-handed.
 *
 * Two or three tabs, never four. People is out — /people has no index route
 * (see AppRail) — and Account is out because the app bar carries the user chip
 * and Sign out at every width. Adding routes to fill a grid is how dead
 * navigation gets shipped.
 *
 * The role check is COSMETIC, mirroring the register's own canWrite: it hides
 * a door that would slam. /assets/new's requireRole is what actually refuses.
 */
export function AppTabBar({ role }: { role: Role }) {
  const canWrite = role === "ADMIN_IT" || role === "PROCUREMENT";

  return (
    <nav
      aria-label="Main"
      className={cn(
        "bg-background fixed inset-x-0 bottom-0 grid border-t md:hidden",
        canWrite ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      <Tab href="/assets" icon={<Boxes />} label="Register" />
      <Tab href="/me/assignments" icon={<LayoutList />} label="Mine" />
      {canWrite ? <Tab href="/assets/new" icon={<Plus />} label="Add" /> : null}
    </nav>
  );
}

function Tab({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground flex flex-col items-center gap-1 py-2 text-[0.65rem] [&_svg]:size-[17px]"
    >
      {icon}
      {label}
    </Link>
  );
}
