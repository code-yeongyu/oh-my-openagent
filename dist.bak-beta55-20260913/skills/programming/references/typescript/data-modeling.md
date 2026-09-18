# Data Modeling

Which construct to use, how to structure data, and why readonly is the default.

---

## Decision flowchart

```
Is it a fixed set of named constants?
  YES → as const object + literal union type
  NO ↓
Is it just branding a primitive (string, number)?
  YES → Branded type
  NO ↓
Is it an interface / contract?
  YES → interface (structural typing is the default in TS)
  NO ↓
Does the data cross a trust boundary (user input, API, file)?
  YES → Zod schema + z.infer<typeof schema>
  NO ↓
Is it a union of possible outcomes?
  YES → Discriminated union (kind/type field)
  NO ↓
Is it structured data with named fields?
  YES → type alias with readonly properties
  NO → you probably don't need a new type
```

---

## Container reference

### type alias — internal data

The default for structured data inside your codebase. Zero runtime cost.

```typescript
type User = {
  readonly id: UserId
  readonly name: string
  readonly email: string
}

type Point = {
  readonly x: number
  readonly y: number
}
```

All properties `readonly`. Mutable only when mutation is the documented purpose.

### interface — contracts and extension

Use when you need declaration merging or `extends`.

```typescript
interface Repository<T> {
  get(id: string): Promise<T | null>
  save(entity: T): Promise<void>
}

interface UserRepository extends Repository<User> {
  findByEmail(email: string): Promise<User | null>
}
```

### interface vs type — when to use which

| Use | When |
|---|---|
| `type` | Union types, intersections, mapped types, utility types, internal data shapes |
| `interface` | Contracts that will be `implements`ed or `extends`ed, declaration merging needed |
| **Default** | **`type` — unless you have a specific reason for `interface`** |

### Zod schema — trust boundary guardian

Use when data enters your system. Validates at runtime, infers types at compile time.

```typescript
import { z } from "zod"

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().min(0),
})
type CreateUser = z.infer<typeof CreateUserSchema>

const UserResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
})
type UserResponse = z.infer<typeof UserResponseSchema>
```

**The one rule**: data crosses a trust boundary → Zod. Everything else → plain type/interface.
Never use Zod for internal-only data. The runtime validation cost and Zod coupling are unnecessary.

### as const — fixed constants

Replaces `enum` entirely. Type-safe, tree-shakeable, no runtime overhead.

```typescript
const ROLES = ["admin", "user", "guest"] as const
type Role = (typeof ROLES)[number]

const STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  DELETED: "deleted",
} as const
type Status = (typeof STATUS)[keyof typeof STATUS]
```

### Discriminated union — multiple outcomes

```typescript
type GetUserResult =
  | { readonly kind: "found"; readonly user: User }
  | { readonly kind: "not_found"; readonly id: UserId }
  | { readonly kind: "forbidden"; readonly reason: string }
```

Each variant has a `kind` discriminant. TypeScript narrows on `switch (result.kind)`.

---

## Quick lookup

| Situation | Use |
|---|---|
| User input, API request/response | Zod schema + `z.infer` |
| Internal value object | `type` with `readonly` properties |
| Function with multiple outcomes | Discriminated union |
| Contract for implementations | `interface` |
| Fixed constants | `as const` + literal union |
| Distinct primitive (UserId vs OrderId) | Branded type |
| Dict shape / key-value map | `Record<K, V>` or index signature |

---

## Readonly by default

Every property is `readonly` unless mutation is the documented purpose.

```typescript
// DEFAULT — readonly
type Config = {
  readonly apiUrl: string
  readonly timeout: number
}

// Arrays too
function getUsers(): readonly User[] { ... }

// Utility for existing types
type ReadonlyUser = Readonly<User>
type DeepReadonlyConfig = Readonly<Config>
```

For mutable state (rare), document why:

```typescript
/** Counter state — mutation is the entire purpose. */
type CounterState = {
  count: number  // intentionally mutable
}
```

---

## Parse, don't validate

Validate at the boundary. Inside the boundary, types are proof of validity.

```typescript
// BAD — validate then pass raw data
function processEmail(email: string): void {
  if (!email.includes("@")) throw new Error("invalid")
  // still a raw string downstream
}

// GOOD — parse into typed value at boundary
const EmailSchema = z.string().email().brand("Email")
type Email = z.infer<typeof EmailSchema>

function sendWelcome(email: Email): void { ... }

// Boundary code
const parsed = EmailSchema.parse(rawInput)  // Email or throws
sendWelcome(parsed)  // no re-validation needed
```

---

## Sources

- TypeScript Handbook: [Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html)
- Zod: [docs](https://zod.dev)
- Total TypeScript: [Type vs Interface](https://www.totaltypescript.com/type-vs-interface-which-should-you-use)
