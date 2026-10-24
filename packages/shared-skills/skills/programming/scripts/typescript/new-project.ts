#!/usr/bin/env bun
/**
 * Scaffold a new TypeScript project with ultra-strict defaults.
 *
 * ─── How to run ───
 * 1. Install Bun: curl -fsSL https://bun.sh/install | bash
 * 2. Run:
 *      bun run scripts/new-project.ts my-api
 *      bun run scripts/new-project.ts my-api --path ./projects
 * ──────────────────
 *
 * Creates:
 *   <name>/
 *     package.json          (Bun + Hono + Zod + oxlint + oxfmt)
 *     tsconfig.json         (static ultra-strict config copied from oxc/)
 *     .oxlintrc.json         (strict rules and local copy plugin)
 *     .oxfmtrc.json          (format defaults)
 *     lint/oxlint-plugin/    (plain-JS rules and MIT license)
 *     src/index.ts          (minimal Hono entrypoint)
 *     .gitignore
 */

import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    path: { type: "string", default: "." },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help || positionals.length === 0) {
  console.log(`Usage: bun run new-project.ts <name> [--path <dir>]

Arguments:
  name        Project directory name (kebab-case)

Options:
  --path      Parent directory (default: current dir)
  -h, --help  Show this help`);
  process.exit(positionals.length === 0 ? 2 : 0);
}

const name = positionals[0];
if (!name) throw new Error("Project name is required");
const root = resolve(values.path ?? ".", name);

if (existsSync(root)) {
  console.error(`Error: ${root} already exists`);
  process.exit(1);
}

// ── Directory structure ──
mkdirSync(join(root, "src"), { recursive: true });

// ── package.json ──
const pkg = {
  name,
  version: "0.0.1",
  private: true,
  type: "module",
  scripts: {
    dev: "bun --hot src/index.ts",
    start: "bun src/index.ts",
    lint: "oxlint --type-aware --deny-warnings",
    fmt: "oxfmt",
    "fmt:check": "oxfmt --check",
    typecheck: "tsc --noEmit",
    check: "bun run lint && bun run fmt:check && bun run typecheck && bun test",
    "check:fix": "oxlint --type-aware --fix && oxfmt",
    test: "bun test",
  },
  dependencies: {
    hono: "^4.12.5",
    zod: "^3.24.0",
  },
  devDependencies: {
    "@types/bun": "latest",
    oxfmt: "0.74.0",
    oxlint: "1.89.0",
    "oxlint-tsgolint": "7.0.2005",
    typescript: "^5.8.0",
  },
};
writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// Copy the formatted strict configs and plugin documented in oxc-lint.md.
cpSync(join(import.meta.dir, "oxc"), root, { recursive: true });

// ── src/index.ts ──
const indexTs = `import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.json({ status: "ok" }));

export default app;
`;
writeFileSync(join(root, "src/index.ts"), indexTs);

// ── .gitignore ──
const gitignore = `node_modules/
dist/
*.tsbuildinfo
.env
.env.*
`;
writeFileSync(join(root, ".gitignore"), gitignore);

console.log(`✓ Created: ${root}`);
console.log(`  cd ${name} && bun install && bun run check`);
