# Bootstrap — Runtime, Package Manager, Tooling

When starting a new TypeScript project (or scripting against the world), the choice of runtime, package manager, framework, and toolchain compounds. The wrong default at minute zero costs hours every week. The right defaults for 2026:

## Runtime decision tree

```
Is this a CLI / script / single-binary tool?
└─ Yes → Bun (single executable, hot reload, native TS)
        Use `bun run script.ts` directly. No build step.

Is this a backend service?
├─ Edge (Cloudflare Workers / Vercel / Deno Deploy) → match the platform
├─ Bun-supported runtime          → Bun + Hono
├─ Need Node-only deps (sharp, native modules without Bun support) → Node + Hono
└─ Otherwise                       → Bun + Hono

Is this a frontend?
└─ Vite (regardless of framework). Bun for the package manager.

Is this a library to publish to npm?
└─ tsdown (or unbuild). Targets Node 20+. Use pnpm for monorepo workspaces.
```

## Bun is the default runtime

Use Bun for:
- Scripts and CLIs (`bun run` is faster than `tsx` and `ts-node`)
- New backends (Hono runs natively, hot reload via `bun --hot`)
- Test runner (`bun test` is built-in, faster than vitest for small suites)
- Package manager (`bun install` is faster than `pnpm` and far faster than `npm`)

Use Node when:
- A dependency uses native modules Bun can't load (rare in 2026; check the dep's release notes)
- Production target is a Node-specific platform (some serverless platforms don't run Bun yet)
- You're contributing to a Node-only project

`bunx` replaces `npx`. `bun create` scaffolds projects.

## Package manager — pnpm > npm

If you must use Node, use pnpm. NEVER npm except in legacy projects you don't control.

Why pnpm:
- Content-addressable store: 10x less disk usage on a machine with many projects
- Strict node_modules layout: phantom dependencies fail at install time, not at runtime
- Workspaces are first-class
- Significantly faster than npm

Why not yarn:
- Yarn classic is unmaintained
- Yarn berry's "PnP" mode breaks with editor tooling more often than it should
- pnpm has caught up on every yarn berry feature people actually use

Why not npm:
- Slowest of the three
- No proper workspace story until very recently
- Phantom dependencies allowed by default

```bash
# Convert npm/yarn → pnpm
pnpm import   # reads package-lock.json or yarn.lock and produces pnpm-lock.yaml
rm -rf node_modules package-lock.json yarn.lock
pnpm install
```

## Backend framework — Hono

Use Hono for any new HTTP service. It is:
- Type-safe end-to-end (request/response types flow through middleware)
- Edge-compatible (runs on Bun, Node, Cloudflare Workers, Deno, AWS Lambda)
- Faster than Express, Fastify, and most of its peers in synthetic benchmarks
- Maintained, opinionated, and documented well

When Hono → ALWAYS pair with `hono-openapi` + `@scalar/hono-api-reference` + `@hono/swagger-ui`. Full setup with copy-pasteable `app.ts`: [backend-hono.md](backend-hono.md).

NEVER:
- Express for new services. Express is the COBOL of Node — works, but writes itself out of every benchmark.
- Fastify for new services. Hono ships with better TypeScript ergonomics.
- NestJS for new services. The Angular-flavoured DI/decorator stack is overkill for ~95% of services.
- Bare `Bun.serve` or `node:http` unless you have a specific reason. Lose middleware, routing, validation. Reinvent everything.

## Frontend tooling — Vite

Vite for any frontend. Replaces webpack, parcel, rollup-as-app-bundler. Works with React, Vue, Svelte, Solid, Preact, vanilla.

```bash
bun create vite my-app -- --template react-ts
cd my-app
bun install
bun run dev
```

## Lint + format — Biome

Biome replaces ESLint + Prettier with one tool, written in Rust, ~30x faster.

```bash
bun add --dev @biomejs/biome
bun biome init
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 }
}
```

Use ESLint only when:
- You have an ESLint plugin Biome doesn't replicate (rare in 2026)
- You're contributing to an existing ESLint project

Never run both — pick one.

## Test runner — bun test or vitest

| Runner | Use when |
|---|---|
| `bun test` | Bun project, simple unit tests, no TypeScript path aliases that need vite-style resolution |
| `vitest` | Vite-based frontend, complex test infrastructure (DOM testing, snapshot, in-browser tests), or you need vitest-specific features |

NEVER Jest for a new project. Jest's CommonJS-first design fights every modern Node/TS project.

## TypeScript

`tsconfig.json` for a Bun + Hono backend:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

`verbatimModuleSyntax: true` enforces explicit `import type { ... }` for type-only imports — pairs with the no-excuse rule on type-only imports.

`noEmit: true` because `bun run` and `bun build` handle compilation. The `tsc` command becomes a typechecker only.

## Quick-start: Bun + Hono backend

```bash
mkdir my-api && cd my-api
bun init -y
bun add hono hono-openapi @scalar/hono-api-reference @hono/swagger-ui zod
bun add --dev @biomejs/biome typescript
bun biome init
```

`package.json` scripts:

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --target bun --outdir dist",
    "typecheck": "tsc --noEmit",
    "lint": "biome check --write src tests",
    "test": "bun test"
  }
}
```

Wire the `app.ts` from [backend-hono.md](backend-hono.md). You have a documented, validated, OpenAPI-spec-emitting service in ~15 minutes.

## When NOT to bootstrap from scratch

| Situation | Use |
|---|---|
| Internal tool with auth/admin/dashboards | Next.js (full-stack) - lots of free wiring |
| Documentation site | Astro or VitePress |
| Real-time features (WebRTC, complex sockets) | Bun + Hono + a real-time library |
| Data-heavy SPA | Vite + React + TanStack Query + TanStack Router |

For greenfield backend services, Bun + Hono. Always.
