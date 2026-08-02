import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  eslintConfigPrettier,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      // Stryker's sandbox (`tempDirName` in stryker.config.mjs) and its HTML
      // report. The sandbox is a full copy of the tree with `// @ts-nocheck`
      // injected atop every file, which is 110 `ban-ts-comment` errors — and
      // .husky/pre-push lints the whole repo, so without this a single
      // mutation run makes `git push` fail. Keep in sync with `tempDirName`.
      ".stryker-tmp/**",
      "reports/**",
      "next-env.d.ts",
      // Agent worktrees are created under .claude/worktrees/, i.e. INSIDE the
      // repo. They are gitignored, but eslint does not read .gitignore — so a
      // full-repo sweep walks straight into another branch's working copy and
      // lints code that is not on this branch at all. `.husky/pre-push` runs
      // `pnpm lint && pnpm typecheck` over everything, so without this a push
      // from the main checkout fails on errors belonging to a parallel task.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
