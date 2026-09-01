# Hono Backend Stack Reference (2026)

> **Canonical stack**: `hono` + `hono-openapi` + `@scalar/hono-api-reference` + `@hono/swagger-ui`
> **Runtime**: Bun (TypeScript-first)
> **Validator**: Zod v4 (Standard Schema compliant, zero extra deps for OpenAPI)

---

## 1. Package Versions (Latest Stable)

| Package | Version | Source |
|---------|---------|--------|
| `hono` | `^4.12.5` | [peer dep of scalar](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/integrations/hono/package.json#L66) |
| `hono-openapi` | `^1.3.0` | [npm](https://registry.npmjs.org/hono-openapi) — published Mar 2, 2026 |
| `@scalar/hono-api-reference` | `^0.10.11` | [npm](https://www.npmjs.com/package/@scalar/hono-api-reference) — published Apr 28, 2026 |
| `@hono/swagger-ui` | `^0.6.1` | [npm](https://www.npmjs.com/package/@hono/swagger-ui) — published Apr 2026 |
| `zod` | `^4.4.1` | [npm registry](https://registry.npmjs.org/zod) — latest stable v4 |

### `package.json` dependency block

```json
{
  "dependencies": {
    "hono": "^4.12.5",
    "hono-openapi": "^1.3.0",
    "@scalar/hono-api-reference": "^0.10.11",
    "@hono/swagger-ui": "^0.6.1",
    "zod": "^4.4.1"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/bun": "latest"
  }
}
```

> **Peer dependencies auto-installed by `hono-openapi`**:
> - `@hono/standard-validator@^0.2.0`
> - `@standard-community/standard-json@^0.3.5`
> - `@standard-community/standard-openapi@^0.2.9`
> - `openapi-types@^12.1.3`
>
> [Source: `hono-openapi/package.json` peerDependencies](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/package.json#L50-L65)

---

## 2. Complete `app.ts` — Copy-Pasteable

```typescript
import { Hono } from 'hono'
import { describeRoute, openAPIRouteHandler, resolver, validator } from 'hono-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { swaggerUI } from '@hono/swagger-ui'
import { z } from 'zod'

// ───────────────────────────────────────────────────────────────
// 1. Schema definitions (Zod v4 — Standard Schema native)
// ───────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  name: z.string().optional(),
})

const ResponseSchema = z.object({
  message: z.string(),
})

const JsonBodySchema = z.object({
  name: z.string(),
  age: z.number().int().min(0),
})

// ───────────────────────────────────────────────────────────────
// 2. Hono app with described routes
// ───────────────────────────────────────────────────────────────

const app = new Hono()

// Health check (no validation)
app.get('/health', (c) => c.json({ status: 'ok' }))

// A fully-documented route
app.get(
  '/hello',
  describeRoute({
    tags: ['Greetings'],
    summary: 'Say hello',
    description: 'Returns a greeting message',
    responses: {
      200: {
        description: 'Successful greeting',
        content: {
          'application/json': {
            schema: resolver(ResponseSchema),
          },
        },
      },
    },
  }),
  validator('query', QuerySchema),
  (c) => {
    const query = c.req.valid('query')
    return c.json({ message: `Hello ${query.name ?? 'Hono'}!` })
  },
)

// A POST route with JSON body validation
app.post(
  '/users',
  describeRoute({
    tags: ['Users'],
    summary: 'Create a user',
    responses: {
      200: {
        description: 'User created',
        content: {
          'application/json': {
            schema: resolver(ResponseSchema),
          },
        },
      },
    },
  }),
  validator('json', JsonBodySchema),
  (c) => {
    const body = c.req.valid('json')
    return c.json({ message: `Created user ${body.name}` })
  },
)

// ───────────────────────────────────────────────────────────────
// 3. OpenAPI spec endpoint
// ───────────────────────────────────────────────────────────────

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'Hono API',
        version: '1.0.0',
        description: 'Example Hono API with OpenAPI',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Local server' },
      ],
    },
  }),
)

// ───────────────────────────────────────────────────────────────
// 4. Scalar API Reference UI
// ───────────────────────────────────────────────────────────────

app.get(
  '/scalar',
  Scalar({
    url: '/openapi.json',
    theme: 'saturn',
    pageTitle: 'Hono API Reference',
  }),
)

// ───────────────────────────────────────────────────────────────
// 5. Swagger UI (parallel mount)
// ───────────────────────────────────────────────────────────────

app.get(
  '/swagger',
  swaggerUI({
    url: '/openapi.json',
    title: 'Swagger UI',
  }),
)

// ───────────────────────────────────────────────────────────────
// 6. Bun canonical entrypoint
// ───────────────────────────────────────────────────────────────

export default app
```

---

## 3. `hono-openapi` API Reference

### Import paths

**There is only one import path.** `hono-openapi` exports everything from its root:

```typescript
import {
  describeRoute,      // middleware to annotate a route with OpenAPI metadata
  describeResponse,   // attach response schemas directly to a handler
  validator,          // validation middleware (wraps @hono/standard-validator)
  resolver,           // wrap a Zod/Valibot/etc schema for OpenAPI responses
  openAPIRouteHandler, // serve the generated OpenAPI JSON document
  generateSpecs,      // programmatically generate the spec (for build-time caching)
} from 'hono-openapi'
```

**Evidence** ([`src/index.ts`](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/index.ts#L1-L9)):

```typescript
export { generateSpecs, openAPIRouteHandler } from "./handler.js";
export {
  describeResponse,
  describeRoute,
  loadVendor,
  resolver,
  validator,
} from "./middlewares.js";
```

> **No subpath exports** such as `hono-openapi/zod` or `hono-openapi/valibot`. The package uses Standard Schema and auto-detects the validator vendor.

### `describeRoute()` middleware

Attach OpenAPI metadata to any Hono route. Use `resolver()` for response body schemas.

```typescript
app.get(
  '/path',
  describeRoute({
    tags: ['Users'],
    summary: 'Get user',
    description: 'Retrieve a single user by ID',
    responses: {
      200: {
        description: 'User found',
        content: {
          'application/json': {
            schema: resolver(UserSchema),
          },
        },
      },
      404: {
        description: 'User not found',
      },
    },
  }),
  handler,
)
```

**Evidence** ([`src/middlewares.ts`](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/middlewares.ts#L244-L254)):

```typescript
export function describeRoute(spec: DescribeRouteOptions): MiddlewareHandler {
  const middleware: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return Object.assign(middleware, {
    [uniqueSymbol]: { spec },
  });
}
```

### `validator()` middleware

Validates `query`, `json`, `param`, or `form` and **automatically** injects the request schema into the OpenAPI document. No manual `request` block in `describeRoute()` is required.

```typescript
validator('query', QuerySchema)   // ?name=foo
validator('json', JsonBodySchema) // POST body
validator('param', ParamSchema)   // /users/:id
validator('form', FormSchema)     // multipart/form-data
```

**Evidence** ([`src/middlewares.ts`](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/middlewares.ts#L199-L237)):

```typescript
export function validator<Schema extends StandardSchemaV1, ...>(
  target: Target,
  schema: Schema,
  hook?: Hook<...>,
  options?: ResolverReturnType["options"],
): MiddlewareHandler<E, P, V> {
  const middleware = sValidator(target, schema, hook);
  return Object.assign(middleware, {
    [uniqueSymbol]: { target, ...resolver(schema, options), options },
  });
}
```

### `openAPIRouteHandler()` — serving the spec

```typescript
app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: { title: 'Hono API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:3000' }],
    },
  }),
)
```

**Evidence** ([`src/handler.ts`](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/handler.ts#L42-L59)):

```typescript
export function openAPIRouteHandler<...>(
  hono: Hono<E, S, P>,
  options?: Partial<GenerateSpecOptions>,
): MiddlewareHandler<E, P, I> {
  let specs: OpenAPIV3_1.Document;
  return async (c) => {
    if (specs) return c.json(specs);
    specs = await generateSpecs(hono, options, c);
    return c.json(specs);
  };
}
```

> **Mount path convention**: `/openapi.json` is the most common. Some projects use `/openapi/spec.json` (e.g. [NamesMT/starter-monorepo](https://github.com/NamesMT/starter-monorepo/blob/main/apps/backend/src/openAPI.ts)).

---

## 4. `@scalar/hono-api-reference` Setup

### Import path and package name

```typescript
import { Scalar } from '@scalar/hono-api-reference'
```

> **Deprecated**: `apiReference` is still exported but deprecated in favor of `Scalar` ([PR #5297](https://github.com/scalar/scalar/pull/5297)).

**Evidence** ([`integrations/hono/src/index.ts`](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/integrations/hono/src/index.ts#L1-L9)):

```typescript
import { Scalar } from './scalar'
export {
  Scalar,
  /**
   * @deprecated Use `Scalar` instead.
   */
  Scalar as apiReference,
}
```

### Mount path convention

Common choices:
- `/scalar` — matches the middleware name
- `/docs` — generic documentation endpoint
- `/openapi/ui` — nested under the OpenAPI prefix

### Configuration options

The Hono middleware accepts the **universal Scalar configuration** plus Hono-specific overrides (`pageTitle`, `cdn`).

```typescript
app.get('/scalar', Scalar({
  // ── Source (required) ──
  url: '/openapi.json',          // URL to the OpenAPI spec

  // ── Appearance ──
  theme: 'saturn',               // 'alternate' | 'default' | 'moon' | 'purple'
                                 // | 'solarized' | 'bluePlanet' | 'deepSpace'
                                 // | 'saturn' | 'kepler' | 'elysiajs' | 'fastify'
                                 // | 'mars' | 'laserwave' | 'none'
  pageTitle: 'My API Docs',      // HTML <title>
  customCss: '.sidebar { ... }', // injected <style> block
  metaData: { title: '...' },    // SEO meta tags (unhead format)
  favicon: '/favicon.svg',

  // ── Behavior ──
  layout: 'modern',              // 'modern' | 'classic'
  darkMode: true,
  forceDarkModeState: 'dark',    // 'dark' | 'light'
  hideDarkModeToggle: false,
  hideModels: false,
  hideSearch: false,
  hideTestRequestButton: false,
  showOperationId: false,
  showSidebar: true,

  // ── Proxy / Server ──
  proxyUrl: 'https://proxy.scalar.com',
  baseServerURL: 'http://localhost:3000',
  servers: [{ url: 'http://localhost:3000' }],

  // ── CDN ──
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference',

  // ── Advanced ──
  authentication: { ... },
  hiddenClients: ['unirest'],
  defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
  plugins: [...],
  pathRouting: { basePath: '/reference' },
  mcp: { name: 'My MCP', url: '...' },
}))
```

**Evidence** — Scalar types define the full schema:
- [Base configuration (themes, proxy, etc.)](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/packages/types/src/api-reference/base-configuration.ts#L110-L129)
- [HTML rendering configuration (`pageTitle`, `cdn`)](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/packages/types/src/api-reference/html-rendering-configuration.ts#L8-L23)
- [Source configuration (`url`, `content`)](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/packages/types/src/api-reference/source-configuration.ts#L8-L55)
- [Full API reference configuration](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/packages/types/src/api-reference/api-reference-configuration.ts#L22-L379)

### Dynamic configuration (request-aware)

```typescript
app.get('/scalar', Scalar((c) => ({
  url: '/openapi.json',
  proxyUrl: c.env.ENVIRONMENT === 'development'
    ? 'https://proxy.scalar.com'
    : undefined,
})))
```

**Evidence** ([`integrations/hono/src/scalar.ts`](https://github.com/scalar/scalar/blob/8bcf8bf52a0da667d44eeec08648e3b1da044f97/integrations/hono/src/scalar.ts#L75-L94)):

```typescript
export const Scalar = <E extends Env>(configOrResolver: Configuration<E>): MiddlewareHandler<E> => {
  return async (c) => {
    let resolvedConfig: Partial<ApiReferenceConfiguration> = {}
    if (typeof configOrResolver === 'function') {
      resolvedConfig = await configOrResolver(c)
    } else {
      resolvedConfig = configOrResolver
    }
    // ...
  }
}
```

---

## 5. `@hono/swagger-ui` Setup

### Import path and package name

```typescript
import { swaggerUI } from '@hono/swagger-ui'
```

**Evidence** ([`packages/swagger-ui/src/index.ts`](https://github.com/honojs/middleware/blob/eb443a2fbda674bbe12d3f30e96854bb0cad6232/packages/swagger-ui/src/index.ts#L93)):

```typescript
export { middleware as swaggerUI, SwaggerUI }
```

### Mount path convention

Common choices:
- `/swagger` — explicit
- `/ui` — used in Hono official examples
- `/docs` — generic

### Configuration options

```typescript
app.get('/swagger', swaggerUI({
  url: '/openapi.json',          // URL to the OpenAPI spec (required)
  title: 'Swagger UI',           // HTML page title
  version: 'latest',             // Swagger UI CDN version
  // Any standard Swagger UI option also works:
  // presets, plugins, urls, etc.
}))
```

**Evidence** ([`packages/swagger-ui/src/index.ts`](https://github.com/honojs/middleware/blob/eb443a2fbda674bbe12d3f30e96854bb0cad6232/packages/swagger-ui/src/index.ts#L8-L43)):

```typescript
type SwaggerUIOptions = OriginalSwaggerUIOptions & DistSwaggerUIOptions

const middleware = <E extends Env>(options: SwaggerUIOptions): MiddlewareHandler<E> =>
  async (c) => {
    const title = options?.title ?? 'SwaggerUI'
    return c.html(/* html */ `...`)
  }
```

---

## 6. Bun Runtime Entrypoint

### Canonical shape for `bun run`

```typescript
import { Hono } from 'hono'

const app = new Hono()
// ... routes ...

export default app
```

**Evidence** ([Hono Bun docs](https://hono.dev/docs/getting-started/bun)):

> ```ts
> import { Hono } from 'hono'
> const app = new Hono()
> app.get('/', (c) => c.text('Hello Bun!'))
> export default app
> ```

### Custom port

```typescript
export default {
  port: 3000,
  fetch: app.fetch,
}
```

**Evidence** ([Hono Bun docs — Change port number](https://hono.dev/docs/getting-started/bun)):

> ```ts
> export default {
>   port: 3000,
>   fetch: app.fetch,
> }
> ```

### `package.json` scripts for Bun

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "build": "tsc --noEmit"
  }
}
```

---

## 7. OpenAPI Version

### `hono-openapi` emits **OpenAPI 3.1.0** by default

This is **hardcoded** in the source and **not configurable** at runtime:

**Evidence** ([`src/handler.ts` line 120](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/handler.ts#L120)):

```typescript
return {
  openapi: "3.1.0",
  ..._documentation,
  // ...
} satisfies OpenAPIV3_1.Document;
```

> If you need OpenAPI 3.0.x, you must post-process the generated spec or use `@hono/zod-openapi` (the older package) instead. The user explicitly requested `hono-openapi`, so document that 3.1.0 is the only output.

---

## 8. Zod v3 vs Zod v4

| Feature | Zod v3 | Zod v4 |
|---------|--------|--------|
| Standard Schema | ❌ No | ✅ Yes (native) |
| `hono-openapi` extra deps | `zod-openapi@4` | None |
| Import path | `import { z } from 'zod'` | `import { z } from 'zod'` (or `zod/v4` for explicit) |

**For Zod v3 users**, install the compatibility layer:

```bash
npm install zod-openapi@4
```

Then use `zod-openapi`'s `.openapi()` for metadata and `.meta({ ref: 'Name' })` for component references. `hono-openapi`'s `resolver()` will still work, but the underlying schema conversion relies on `zod-openapi@4`.

**Evidence** ([HonoHub Zod docs](https://honohub.dev/docs/openapi/zod)):

> "For zod v3, you can use the `zod-openapi` library. You need to install `zod-openapi@4` for this to work properly."

**For Zod v4 users** (recommended in 2026), no extra packages are needed. `z.date()` is automatically converted to `{ type: 'string', format: 'date-time' }`.

**Evidence** ([`src/middlewares.ts` Zod v4 date override](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/middlewares.ts#L63-L71)):

```typescript
const zodV4DateOverride = (ctx: { ... }) => {
  if (ctx.zodSchema._zod.def.type === "date") {
    ctx.jsonSchema.type = "string";
    ctx.jsonSchema.format = "date-time";
  }
};
```

---

## 9. Real-World Example

**NamesMT/starter-monorepo** — a public monorepo starter using `hono-openapi` + `@scalar/hono-api-reference` together:

- File: [`apps/backend/src/openAPI.ts`](https://github.com/NamesMT/starter-monorepo/blob/main/apps/backend/src/openAPI.ts)
- Pattern: mounts spec at `/openapi/spec.json` and Scalar UI at `/openapi/ui`

```typescript
import type { Hono } from 'hono'
import { Scalar } from '@scalar/hono-api-reference'
import { openAPIRouteHandler } from 'hono-openapi'

export function setupOpenAPI(app: Hono<any, any>, prefix = '/openapi') {
  app.get(
    `${prefix}/spec.json`,
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: `starter-monorepo's backend`,
          version: '1.0.0',
          description: 'My amazing API',
        },
      },
    }),
  )

  app.get(
    `${prefix}/ui`,
    Scalar({
      theme: 'deepSpace',
      url: `${prefix}/spec.json`,
    }),
  )
}
```

> **Note**: No public repo was found using all four (`hono-openapi` + `Scalar` + `swagger-ui` + `hono`) in a single file. The canonical combination in the wild is `hono-openapi` + `Scalar`. Adding `swagger-ui` is a trivial parallel mount (shown in the `app.ts` above).

---

## 10. Common Pitfalls

1. **Using `openAPISpecs` instead of `openAPIRouteHandler`**
   Some docs (e.g. HONC) use `openAPISpecs` — this is **not** the current export name. The correct function is `openAPIRouteHandler` ([source](https://github.com/rhinobase/hono-openapi/blob/10f45a66ede3764b5e6065805fb60fd5df090466/src/index.ts#L1)).

2. **Importing from `hono-openapi/zod`**
   There are **no subpath exports**. Always import from `hono-openapi` directly.

3. **Forgetting `@hono/standard-validator`**
   It is a peer dependency of `hono-openapi`. Modern package managers (npm ≥ 7, pnpm, bun) auto-install it. If you see validation errors, ensure it is present in `node_modules`.

4. **Using `@hono/zod-openapi` (the OLD package)**
   The user explicitly wants `hono-openapi` (the newer, middleware-based, Standard Schema package). Do not confuse with `@hono/zod-openapi` which wraps the `Hono` class into `OpenAPIHono`.

5. **Swagger UI `spec` option**
   `@hono/swagger-ui` does **not** accept a `spec` option to embed the document directly. It only accepts `url` (or `urls`) pointing to an external spec endpoint. If you need embedded specs, use Scalar's `content` option instead.

---

## 11. Quick Start Commands

```bash
# 1. Create project
mkdir my-api && cd my-api
bun init -y

# 2. Install dependencies
bun add hono hono-openapi @scalar/hono-api-reference @hono/swagger-ui zod

# 3. Add TypeScript
bun add -d typescript @types/bun

# 4. Write app.ts (copy from section 2 above)
# 5. Run
bun run --hot app.ts
```

Endpoints after startup:
- `GET /health` — health check
- `GET /hello?name=world` — documented route
- `POST /users` — validated JSON body route
- `GET /openapi.json` — raw OpenAPI 3.1.0 spec
- `GET /scalar` — Scalar API Reference UI
- `GET /swagger` — Swagger UI
