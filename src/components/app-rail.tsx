import Link from "next/link";
import type { Role } from "@prisma/client";
import { Boxes, LayoutList, Settings2, UserPlus } from "lucide-react";

/**
 * The desktop navigation rail (docs/DESIGN-SYSTEM.md §4).
 *
 * Role-gating here is COSMETIC. It omits doors that would slam — each page's
 * own `requireRole` is what actually stops anyone. Never let a nav decision be
 * the only thing standing between a role and a route.
 *
 * There is deliberately NO People entry: `/people` has no index route, only
 * `/people/[id]`, reached by clicking a holder's name inside the asset detail
 * page's canViewAssignments branch. Adding an index would mean a new query
 * listing Person rows — a new PII surface needing personSelectFor, a DPA note
 * review and a Tier 3 advisor review. That is its own story, not this one.
 */
export function AppRail({ role }: { role: Role }) {
  const showAdmin = role === "ADMIN_IT";

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-6 border-r p-3 md:flex"
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-md font-mono text-[0.65rem] font-semibold">
          AR
        </span>
        <span className="text-sm font-semibold tracking-tight">
          Asset Register
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <RailLink href="/assets" icon={<Boxes />} label="Register" />
        <RailLink
          href="/me/assignments"
          icon={<LayoutList />}
          label="My assignments"
        />
      </div>

      {showAdmin ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground px-2 pb-1 font-mono text-[0.65rem] tracking-widest uppercase">
            Admin
          </span>
          <RailLink href="/admin/users" icon={<UserPlus />} label="Users" />
          <RailLink
            href="/admin/reference"
            icon={<Settings2 />}
            label="Categories &amp; sites"
          />
        </div>
      ) : null}
    </nav>
  );
}

function RailLink({
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
      className="hover:bg-muted flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm [&_svg]:size-4 [&_svg]:opacity-70"
    >
      {icon}
      {label}
    </Link>
  );
}
