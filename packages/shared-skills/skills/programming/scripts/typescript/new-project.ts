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
 *     package.json          (Bun + Hono + Zod + Drizzle + Biome)
 *     tsconfig.json         (ultra-strict from tsconfig-strict.md)
 *     biome.json            (strict from tsconfig-strict.md)
 *     src/index.ts          (minimal Hono entrypoint)
 *     .gitignore
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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

const name = positionals[0]!;
const root = resolve(values.path!, name);

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
    check: "bunx biome check . && bunx tsc --noEmit && bun test",
    "check:fix": "bunx biome check --write .",
    test: "bun test",
  },
  dependencies: {
    hono: "^4.12.5",
    zod: "^3.24.0",
  },
  devDependencies: {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    typescript: "^5.8.0",
  },
};
writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// ── tsconfig.json (ultra-strict) ──
const tsconfig = {
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noFallthroughCasesInSwitch: true,
    forceConsistentCasingInFileNames: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    target: "ESNext",
    lib: ["ESNext"],
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    outDir: "dist",
    rootDir: "src",
    module: "ESNext",
    moduleResolution: "bundler",
    types: ["bun-types"],
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src/**/*.ts"],
  exclude: ["node_modules", "dist"],
};
writeFileSync(
  join(root, "tsconfig.json"),
  JSON.stringify(tsconfig, null, 2) + "\n",
);

// ── biome.json (strict) ──
const biome = {
  $schema: "https://biomejs.dev/schemas/1.9.0/schema.json",
  organizeImports: { enabled: true },
  formatter: {
    enabled: true,
    indentStyle: "space",
    indentWidth: 2,
    lineWidth: 100,
  },
  linter: {
    enabled: true,
    rules: {
      recommended: true,
      complexity: {
        noBannedTypes: "error",
        noExtraBooleanCast: "error",
        noUselessConstructor: "error",
        noUselessRename: "error",
        noVoid: "error",
      },
      correctness: {
        noUnusedVariables: "error",
        noUnusedImports: "error",
        useExhaustiveDependencies: "warn",
      },
      style: {
        noNonNullAssertion: "error",
        useConst: "error",
        noParameterAssign: "error",
      },
      suspicious: {
        noExplicitAny: "error",
        noAssertion: "warn",
      },
    },
  },
};
writeFileSync(join(root, "biome.json"), JSON.stringify(biome, null, 2) + "\n");

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
