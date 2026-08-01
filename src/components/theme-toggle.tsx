"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Theme control (docs/DESIGN-SYSTEM.md §2) — the mockup's single icon button.
 *
 * Still three states, not a two-way switch: a user who chose "System" must be
 * able to get back to it. The button cycles Light -> Dark -> System, and the
 * icon names the CURRENT state rather than the next one, so what you see is
 * what is set.
 *
 * A cycling button rather than a dropdown menu because the alternative is a
 * Radix dropdown dependency for three options, and rather than a <select>
 * because the approved design is an icon button. The accessible name carries
 * both halves — current state and what the next press does — since the icon
 * alone cannot say that.
 *
 * `mounted` is the documented next-themes pattern, and it is load-bearing:
 * `theme` is undefined on the server and on the first client render, so
 * branching the icon on it directly renders one glyph on the server and
 * another after hydration. Rendering the neutral System icon until mounted
 * keeps both passes identical. Note this sets state in an effect deliberately
 * — it is a mount latch, not the state-reset-in-effect pattern lint rejects.
 */
const ORDER = ["light", "dark", "system"] as const;

const LABELS: Record<(typeof ORDER)[number], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted
    ? ((ORDER.find((value) => value === theme) ?? "system") as
        "light" | "dark" | "system")
    : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-8"
      aria-label={`Theme: ${LABELS[current]}. Switch to ${LABELS[next].toLowerCase()}.`}
      onClick={() => setTheme(next)}
    >
      {current === "light" ? (
        <Sun aria-hidden="true" />
      ) : current === "dark" ? (
        <Moon aria-hidden="true" />
      ) : (
        <Monitor aria-hidden="true" />
      )}
    </Button>
  );
}
