import type { BuiltinSkill } from "../types"

export const FRONTEND_BUILD_TOOLING_SKILL_NAME = "frontend-build-tooling"

export const FRONTEND_BUILD_TOOLING_SKILL_DESCRIPTION =
  "Frontend build tooling — Build tools (Vite 6, Turbopack, Webpack), Tailwind v4, Biome 2.5/ESLint 9, TypeScript strict, monorepo tooling, CI/CD, environment management"

export const frontendBuildToolingSkill: BuiltinSkill = {
  name: FRONTEND_BUILD_TOOLING_SKILL_NAME,
  description: FRONTEND_BUILD_TOOLING_SKILL_DESCRIPTION,
  template: `# Frontend Build & Tooling

You are a build tooling specialist. Production-grade setups, minimal config churn, fast iteration. You know every bundler's strengths and when to reach for each tool.

**Mission**: Set up fast, correct, and maintainable build tooling. Prefer convention over configuration — customize only when needed.

---

# Build Tools

| Tool | Use Case | Config File | Notes |
|------|----------|-------------|-------|
| **Vite 6** | Default for most projects | \`vite.config.ts\` | **Rolldown** (Rust) for prod builds, esbuild for deps. Fastest DX. |
| **Turbopack** | Next.js dev server | in \`next.config.ts\` | Rust-based HMR. Use \`next dev --turbo\` to opt in. |
| **Webpack 5** | Legacy/MF projects | \`webpack.config.js\` | Only when locked into existing configs. Module Federation. |
| **esbuild** | Scripts, libraries, CLI | CLI flags | Go-based. Vite uses it internally for dep pre-bundling. |

\`\`\`ts
// vite.config.ts — preferred bundler
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: { target: "esnext", rollupOptions: { output: { manualChunks: { vendor: ["react", "react-dom"] } } } },
})
\`\`\`

**Scaffolding**: \`npm create vite@latest\` (\`--template react-ts\`, \`svelte-ts\`, \`vue-ts\`) · \`npx create-next-app@latest\` · \`npm create svelte@latest\`

**Key Vite plugins**: \`@vitejs/plugin-react\` (React Fast Refresh) · \`@sveltejs/vite-plugin-svelte\` · \`@vitejs/plugin-vue\` · \`vite-plugin-pwa\`

---

# CSS Tooling

## Tailwind CSS v4
Zero-config by default. CSS-first configuration via \`@theme\` (not \`tailwind.config.js\` — that's v3).

\`\`\`css
@import "tailwindcss";
@theme {
  --color-brand: #06b6d4;
  --font-display: "Inter Variable", sans-serif;
  --spacing-page: 2rem;
}
\`\`\`
Install: \`tailwindcss @tailwindcss/vite\`, add \`tailwindcss()\` to Vite plugins.

## Alternatives

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **CSS Modules** | Scoped class names | Default with Vite/Webpack — zero config |
| **vanilla-extract** | Zero-runtime CSS-in-TS | Full type safety, CSS theme contracts |
| **Panda CSS** | Generated atomic CSS | Type-safe tokens, Tailwind-like but build-time |

---

# Linting & Formatting

## Biome 2.5 (Preferred)
Linter enabled, **formatter disabled** (Prettier handles formatting). Single binary, no config churn.

\`\`\`json
// biome.json — linter on, formatter off
{ "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": false } }
\`\`\`

## ESLint 9 (Flat Config)
Use when project requires ESLint-specific plugins not in Biome.

\`\`\`js
// eslint.config.js
import tseslint from "typescript-eslint"
export default tseslint.config(...tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } })
\`\`\`

**Prettier**: Handles formatting when Biome's formatter is off. Config via \`.prettierrc\`.

---

# TypeScript Configuration

\`\`\`json
// tsconfig.json — strict mode (MANDATORY)
{ "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "esnext",
    "lib": ["esnext", "dom", "dom.iterable"] } }
\`\`\`

**Project references** (\`tsc --build\`): Compose multiple tsconfigs in monorepos. Root \`tsconfig.json\` with \`references\` pointing to \`packages/*/tsconfig.json\`. Run \`tsc --build\` for incremental type-checking.

---

# Monorepo Tooling

| Tool | Manager | Key Command | Feature |
|------|---------|-------------|---------|
| **pnpm workspaces** | pnpm | \`pnpm -r run build\` | Strict dependency isolation |
| **Turborepo** | pnpm/bun/npm | \`turbo run build\` | Remote caching, task pipeline |
| **Nx** | Any | \`nx run-many --target=build\` | Graph-based, distributed caching |
| **Bun workspaces** | Bun | \`bun run --filter=@scope/pkg build\` | Fastest installs |

---

# CI/CD

\`\`\`yaml
# .github/workflows/ci.yml — key steps
- uses: actions/checkout@v4
- uses: oven-sh/setup-bun@v2
- uses: actions/cache@v4
  with:
    path: node_modules | .turbo | .next/cache
    key: \${{ runner.os }}-bun-\${{ hashFiles('bun.lock') }}
- run: bun install --frozen-lockfile
- run: bun run build
\`\`\`

| Platform | Key File | Notes |
|----------|----------|-------|
| **Vercel** | \`vercel.json\` | Auto-detects Vite/Next. \`buildCommand\`, \`outputDirectory\` |
| **Netlify** | \`netlify.toml\` | \`[build]\` commands, \`publish\` dir |
| **Cloudflare Pages** | \`wrangler.toml\` | \`pages_build_output_dir\`, \`build_command\` |

---

# Environment Variables

| Context | Access | Convention |
|---------|--------|------------|
| **Vite** | \`import.meta.env.VITE_*\` | \`VITE_\` prefix required (inlined at build) |
| **Next.js** | \`process.env.NEXT_PUBLIC_*\` | \`NEXT_PUBLIC_\` prefix for client-safe |
| **Node** | \`process.env.*\` | Any name |

**Safe env management**: Use \`envsitter\` tools (fingerprint, match, keys — never expose values). Manage \`.env\` files through envsitter, not direct file writes.

---

# Package Management

| Manager | Lockfile | Install | Best For |
|---------|----------|---------|----------|
| **Bun** | \`bun.lock\` | \`bun install\` | Speed + monorepos **(preferred)** |
| **pnpm** | \`pnpm-lock.yaml\` | \`pnpm install\` | Strict isolation, disk efficiency |
| **npm** | \`package-lock.json\` | \`npm install\` | Ecosystem default, widest compatibility |

**CI**: Always \`bun install --frozen-lockfile\` (or \`npm ci\`/ \`pnpm install --frozen-lockfile\`) to prevent lockfile drift.

---

# Anti-Patterns (NEVER)

- Running \`npm install\` (no frozen lockfile) in CI — lockfile drift, non-reproducible builds
- \`tsconfig.json\` without \`strict: true\` — defeats TypeScript's purpose
- Mixing Biome and ESLint for the same rules — duplicate errors, confusion
- \`eslintConfig\` in \`package.json\` (legacy) — ESLint 9 requires flat \`eslint.config.js\`
- Using \`tailwind.config.js\` in v4 — use \`@theme\` in CSS (CSS-first config)
- Storing secrets in \`import.meta.env\` — \`VITE_*\` vars are inlined at build time, visible in source |`,
}

