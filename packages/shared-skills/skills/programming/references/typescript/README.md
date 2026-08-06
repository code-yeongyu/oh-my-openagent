
# TypeScript Programmer

Modern TypeScript. Type-strict, stack-first, async-correct.

## Philosophy

The compiler is your proof system. Make illegal states unrepresentable. Parse at boundaries. Every function has a contract; the type system enforces it.

## Hard rules

These are deliberate project choices. Violations are always wrong, not "style preferences".

### Tooling

| Category | Use | Never |
|---|---|---|
| Runtime | Bun (native TS, single binary) | ts-node, tsx |
| Package manager | `pnpm` | npm, yarn (unless workspace requires it) |
| Linter + formatter | Biome | ESLint, Prettier |
| Type checker | `tsc --noEmit` with strict config | skip type checking |
| Web framework | Hono | Express |
| Validation | Zod | joi, yup, class-validator |
| Testing | `bun test` or vitest | jest |
| ORM | Drizzle | TypeORM, Prisma (unless already in project) |

### The iron list

1. **Readonly by default** — all `type`/`interface` properties are `readonly`. Arrays are `readonly T[]`. Mutable only when mutation is the documented purpose.
2. **Branded types for distinct IDs** — `type UserId = Brand<string, "UserId">`. Never pass raw `string` where a branded type exists.
3. **Exhaustive switch** — every `switch` on a discriminated union ends with `default: assertNever(x)`. No fall-through.
4. **No any** — `any` is banned in annotations, returns, and parameters. Use `unknown` and narrow.
5. **No type assertions** — `as any`, `as unknown` banned. `as const` and `satisfies` are fine.
6. **No non-null assertion** — `x!` is banned. Use narrowing or optional chaining (`x?.y`).
7. **No @ts-ignore / @ts-expect-error** — fix the type.
8. **No enum** — use `as const` objects + literal union types.
9. **Zod at boundaries** — external input (API, user, file) → Zod schema. Internal → plain types.
10. **Typed errors** — Error subclasses with typed fields. No `throw new Error("bare string")` for domain errors. Use Result for expected failures within 1-2 call levels; throw for propagation across many layers.
11. **as const for constants** — module-level constant objects and arrays use `as const`.
12. **import type** — type-only imports use `import type`. Enforced by `verbatimModuleSyntax`.
13. **Named exports only** — no `export default`. Exception: framework requirement (Next.js pages, etc.).
14. **No empty catch, no catch-and-swallow** — every `catch` block must either (a) narrow the error with `instanceof` and handle each case, or (b) re-throw. Empty catch blocks and `catch (e) { console.error(e) }` without narrowing or re-throw are banned — they hide bugs. At top-level boundaries (CLI entry, HTTP handler), opt out with `// no-excuse-ok: catch`.

### Data modeling — which construct, when

| Situation | Use |
|---|---|
| User input, API request/response | Zod schema + `z.infer` |
| Internal value object | `type` with `readonly` properties |
| Function with multiple outcomes | Discriminated union (`kind` field) |
| Contract for implementations | `interface` |
| Fixed constants | `as const` + literal union |
| Distinct primitive (UserId vs OrderId) | Branded type |
| Key-value map | `Record<K, V>` or index signature |

**The one rule**: data crosses trust boundary → Zod. Everything else → plain `type` with `readonly`.

Load `data-modeling.md` for the full decision flowchart and comparison.

### When readonly does not apply

- **Framework state** (React `useState`, signals) — managed by framework.
- **Builder / accumulator** — object exists to be mutated (buffer, cache). Document why.
- **ORM mutations** — Drizzle insert/update objects.

### Why empty/unhandled catch is banned

In TypeScript, every `catch` receives `unknown`. The language gives you no type safety in catch blocks — you must earn it with `instanceof`. A bare `catch (e) { console.error(e) }` swallows `TypeError`, `RangeError`, and your domain errors identically. When a new error type appears, nothing warns you.

```typescript
// BANNED — empty catch
try { await fetchData() } catch {}
try { await fetchData() } catch (e) { /* will fix later */ }

// BANNED — catch-and-swallow (no narrowing, no rethrow)
try {
  const data = await api.get("/users")
} catch (e) {
  console.error("failed", e)
}

// GOOD — narrow with instanceof
try {
  const data = await api.get("/users")
} catch (e) {
  if (e instanceof HttpError) {
    logger.warn(`API ${e.status}: ${e.message}`)
    return fallback
  }
  throw e  // unknown errors propagate
}

// GOOD — top-level boundary (only place catch-all is acceptable)
async function main(): Promise<void> {  // no-excuse-ok: catch
  try {
    await run()
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}
```

### Libraries

| Domain | Library | Why |
|---|---|---|
| HTTP framework | Hono | Lightweight, multi-runtime, middleware, OpenAPI |
| Validation | Zod | Runtime validation + type inference |
| ORM | Drizzle | Type-safe SQL, no codegen |
| HTTP client | `ky` | Thin fetch wrapper (5KB); auto-throw on non-2xx, retry, timeout, hooks, prefixUrl. Browser + Node + Bun + Deno |
| HTTP client (perf) | `undici` (direct API) | When a Node backend needs connection pooling, HTTP/2, or pipelining |

> **HTTP client rule** - production code must not use bare `fetch()`. It has no retry, timeout, or error-handling policy and causes silent failures during incidents. Install **`ky`** by default, and use the **`undici`** direct API when a Node backend needs high-volume requests, connection pooling, HTTP/2, or pipelining. ~~`axios`~~ is forbidden after the supply-chain compromise (2026-03). `node-fetch` is unnecessary because Node 18+ includes built-in fetch.
| Testing | `bun test` / vitest | Fast, ESM-native |
| Logging | `pino` | Structured JSON, fast |
| CLI | `@clack/prompts` + `commander` | Interactive + parsing |

## tsconfig — the one true config

Scaffold a new project with all strict defaults pre-configured:

```bash
bun run ../../scripts/typescript/new-project.ts my-api
bun run ../../scripts/typescript/new-project.ts my-api --path ./projects
```

Creates: `package.json` (Hono + Zod + Biome), `tsconfig.json` (ultra-strict), `biome.json`, `src/index.ts`, `.gitignore`. Works on macOS, Linux, Windows.

For manual setup: `bunx tsc --init`, then load `tsconfig-strict.md` for the full strict config.

Key flags beyond `"strict": true`:

| Flag | What it catches |
|---|---|
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined`, forces check |
| `exactOptionalPropertyTypes` | `{ x?: string }` ≠ `{ x: string \| undefined }` |
| `verbatimModuleSyntax` | Forces `import type` for type-only imports |
| `noFallthroughCasesInSwitch` | Forgotten `break` / `return` |
| `noPropertyAccessFromIndexSignature` | `.key` on index sig → bracket notation |

## Reference loading

Load on demand — not all at once.

| Need | Load |
|---|---|
| Strict tsconfig + Biome config | `tsconfig-strict.md` |
| Type patterns (branded, as const, satisfies, narrowing, assertNever) | `type-patterns.md` |
| Data modeling (type vs interface vs Zod, readonly, parse-don't-validate) | `data-modeling.md` |
| Error handling (Result, typed errors, union vs throw) | `error-handling.md` |
| Bootstrapping a new project (Bun, pnpm, Hono, Vite) | `bootstrap.md` |
| Hono backend stack (hono-openapi, Scalar, Swagger) | `backend-hono.md` |

## No-excuse audit

Violations caught by `../../scripts/typescript/check-no-excuse-rules.ts`. Run after every edit session.

| Rule ID | Catches | Opt-out |
|---|---|---|
| `no-any-assertion` | `as any` | None — redesign types |
| `no-unknown-assertion` | `as unknown` | None — redesign types |
| `no-ts-ignore` | `@ts-ignore` | None — fix the type |
| `no-ts-expect-error` | `@ts-expect-error` | None — fix the type |
| `no-enum` | `enum` declarations | None — use `as const` |
| `no-non-null-assertion` | `x!` postfix | None — narrow or `?.` |
| `no-throw-literal` | `throw "string"` / `throw 123` | None — throw Error subclass |
| `no-mutable-export` | `export let` / `export var` | None — use `export const` |
| `no-any-annotation` | `: any` in parameter/return/variable types | `// no-excuse-ok: any` |
| `no-explicit-any-return` | `(): any` or `(): Promise<any>` return types | `// no-excuse-ok: any` |
| `empty-catch` | `catch { }` or `catch (e) { }` with empty body | `// no-excuse-ok: catch` |
| `catch-without-narrowing` | `catch (e)` used without `instanceof` or re-throw | `// no-excuse-ok: catch` |

Biome enforces additional rules (noExplicitAny, noNonNullAssertion, noDefaultExport, useImportType). The script catches what Biome cannot.

## In tests

Tests are strict too, with these exceptions (configure in `biome.jsonc` overrides):

| In tests you may | Why |
|---|---|
| Use `expect()` assertions | That's how testing works |
| Use magic numbers | Test data |
| Access private members via bracket notation | Testing internals |
| Skip readonly on test fixtures | Mutable setup/teardown |

Tests still follow the iron list — branded types, typed errors, exhaustive switch.

## Existing codebases

When editing an existing file that doesn't follow these rules: **write new code in strict style, don't refactor existing code in the same change.**

## Activation

This skill activates whenever you are writing or modifying any `.ts` or `.tsx` file. Even one-off scripts get the strict treatment.
