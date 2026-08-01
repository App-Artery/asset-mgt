"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Thin client boundary around next-themes (docs/DESIGN-SYSTEM.md §2).
 *
 * It wraps {children} without consuming them, so server components passed
 * through it stay server components — the root layout remains a server
 * component and `force-dynamic` rendering is unaffected. Theme resolution is
 * entirely client-side and reads localStorage, so nothing here interacts with
 * the env-free build requirement.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
