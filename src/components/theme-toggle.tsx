"use client";

import { useTheme } from "next-themes";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Three states, not a two-way switch: a user who chose "System" must be able to
 * get back to it, which a boolean toggle makes impossible.
 *
 * A native <select> for the same reason src/components/ui/select.tsx gives —
 * three options need no Radix portal machinery, and it stays keyboard- and
 * screen-reader-accessible for free.
 *
 * `theme` is undefined until next-themes mounts and measures, on the server and
 * on the first client render alike. Do NOT seed a useState initialiser from it:
 * the initialiser never re-runs and would pin the SSR sentinel forever
 * (LEARNINGS §Frontend). The select reads the hook directly, so the first real
 * emit updates it.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="theme-select" className="sr-only">
        Theme
      </Label>
      <Select
        id="theme-select"
        value={theme ?? "system"}
        onChange={(event) => setTheme(event.target.value)}
        className="h-8"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </Select>
    </div>
  );
}
