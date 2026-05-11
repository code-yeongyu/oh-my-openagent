# web/ — Marketing Site (Next.js + Cloudflare Workers)

**Generated:** 2026-05-08

## OVERVIEW

Public-facing marketing site for oh-my-opencode / oh-my-openagent. Next.js 15 (App Router) deployed to Cloudflare Workers via [@opennextjs/cloudflare](https://opennext.js.org/cloudflare). Independent of the npm plugin — its own `package.json`, `bun.lock`, and `tsconfig.json`.

## STACK

| Layer          | Choice                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| Framework      | Next.js 15.5 (App Router, RSC)                                                      |
| Runtime target | Cloudflare Workers (`compatibility_flags: ["nodejs_compat"]`)                       |
| Adapter        | `@opennextjs/cloudflare` (build → `.open-next/worker.js`)                           |
| Styling        | Tailwind v4 (`@tailwindcss/postcss`) + shadcn/ui (`components.json`)                |
| i18n           | `next-intl` with `app/[locale]/...` routing; 4 locales (en/ja/ko/zh) in `messages/` |
| Animation      | `motion` (Framer Motion v12)                                                        |
| E2E            | Playwright (`e2e/*.spec.ts`)                                                        |
| Lint/Format    | ESLint flat config + Prettier (Tailwind plugin)                                     |

## STRUCTURE

```
web/
├── app/[locale]/         # localized routes (App Router)
├── components/           # shared UI primitives + shadcn-generated
├── lib/                  # utility helpers (cn, etc.)
├── messages/{en,ja,ko,zh}.json  # i18n strings
├── i18n/                 # next-intl request/routing config
├── middleware.ts         # next-intl middleware
├── public/               # static assets (largest dir, ~4 MB)
├── e2e/                  # Playwright tests
├── scripts/prepare-build.mjs    # purges .next/cache/fetch-cache before build
├── next.config.ts
├── open-next.config.ts
├── wrangler.toml         # worker name + compatibility settings
├── playwright.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── tsconfig.json
├── components.json       # shadcn config
└── package.json
```

## SCRIPTS

```bash
# from web/ directory
bun install
bun run dev              # next dev (local Node.js)
bun run lint             # eslint
bun run lint:fix
bun run format           # prettier --write
bun run format:check
bun run type-check       # tsc --noEmit
bun run build            # next build (Node target — for sanity)
bun run preview          # opennextjs-cloudflare build + preview locally
bun run deploy           # opennextjs-cloudflare build + deploy to Cloudflare
bun run test:e2e         # playwright test
bun run cf-typegen       # regenerate cloudflare-env.d.ts from wrangler.toml bindings
```

## CI/CD

| Workflow                           | Trigger                                                 | What                                                                    |
| ---------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `.github/workflows/web-ci.yml`     | push/PR to master/dev that touches `web/**`             | format check, lint, type-check, next build, opennextjs-cloudflare build |
| `.github/workflows/web-deploy.yml` | push to master that touches `web/**` OR manual dispatch | full deploy via `cloudflare/wrangler-action@v3`                         |

**Required secrets** (must be configured in repo settings before deploy works):

- `CLOUDFLARE_API_TOKEN` — token with `Workers Scripts: Edit` permission
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

A `web-production` GitHub environment is referenced by the deploy workflow so deploys can be gated behind required reviewers / wait timers if desired.

## RELATIONSHIP TO npm PACKAGE

The npm package `oh-my-opencode` ships only `dist/`, `bin/`, and `postinstall.mjs` (see root `package.json` `files` field). `web/` is **not** included in any npm publish — it is exclusively a separate Cloudflare deployment target.

Root `bun test` is scoped to `bin script src` (see root `package.json`) so `web/e2e/*.spec.ts` does not pollute plugin tests.

## CONVENTIONS

- **No path aliases globally** in the omo project, but `web/` is a Next.js app where `@/*` aliases are the framework default. Keep `@/*` confined to web/.
- Use the existing shadcn primitives in `components/ui/` rather than installing new UI libs.
- All user-facing copy goes through `messages/{locale}.json`; never hardcode strings in components.
- Format with prettier before commit — `web-ci.yml` enforces `format:check`.

## ANTI-PATTERNS

- Never run `npm install` in `web/`. Use `bun install` only. (Root `.gitignore` already blocks `package-lock.json`.)
- Never commit `.next/`, `.open-next/`, `.wrangler/`, `node_modules/` (covered by `web/.gitignore`).
- Never deploy locally with `bun run deploy` against production — use the GitHub Actions workflow so Cloudflare credentials live in one place.
