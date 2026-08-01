"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A navigation link that knows whether it is the current page.
 *
 * The only client component in the shell chrome, and only because the active
 * state needs the pathname. It renders its own icon and label as children, so
 * the rail and tab bar stay server components around it.
 *
 * Matching is prefix-based with a boundary check, not `startsWith` alone:
 * `/assets` must light up on `/assets/new` and `/assets/[id]`, but a future
 * `/assets-archive` route must NOT light it up. Same class of bug as the
 * middleware matcher's anchored exclusions (LEARNINGS §Next.js).
 */
export function NavLink({
  href,
  className,
  activeClassName,
  children,
}: {
  href: string;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(className, isActive && activeClassName)}
    >
      {children}
    </Link>
  );
}
