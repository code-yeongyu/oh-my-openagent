# Error Handling

Typed errors, exhaustive matching, Result pattern, and resource safety.

---

## Typed errors — no bare strings

Error classes carry structured data. Callers know exactly what can go wrong.

```typescript
class UserNotFoundError extends Error {
  readonly name = "UserNotFoundError"
  constructor(readonly userId: UserId) {
    super(`user ${userId} not found`)
  }
}

class PermissionDeniedError extends Error {
  readonly name = "PermissionDeniedError"
  constructor(
    readonly userId: UserId,
    readonly requiredRole: string,
  ) {
    super(`user ${userId} needs role ${requiredRole}`)
  }
}
```

```typescript
// BAD
throw new Error("user not found")
throw new Error("permission denied")

// GOOD
throw new UserNotFoundError(userId)
throw new PermissionDeniedError(userId, "admin")
```

Always set `readonly name` explicitly — `instanceof` checks survive minification, but `error.name` is more reliable for logging and serialization.

---

## Result pattern — expected failures without exceptions

For failures that are **expected** (not found, validation), return a discriminated union instead of throwing.

```typescript
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
```

### Usage

```typescript
type UserError =
  | { readonly kind: "not_found"; readonly id: UserId }
  | { readonly kind: "forbidden"; readonly reason: string }

function getUser(id: UserId): Result<User, UserError> {
  const user = db.find(id)
  if (!user) return err({ kind: "not_found", id })
  if (!user.active) return err({ kind: "forbidden", reason: "deactivated" })
  return ok(user)
}

// Caller must handle both cases
const result = getUser(userId)
if (!result.ok) {
  switch (result.error.kind) {
    case "not_found":
      log.warn(`missing: ${result.error.id}`)
      break
    case "forbidden":
      log.error(`denied: ${result.error.reason}`)
      break
    default:
      assertNever(result.error)
  }
  return
}
const user = result.value  // narrowed to User
```

### When to use which

**The heuristic**: caller is 1-2 levels away and MUST handle it → Result. Error should propagate up many layers → throw.

| Scenario | Pattern | Why |
|---|---|---|
| Repository → service (caller handles it) | Result | Caller is right there, must handle both |
| Validation at boundary (parsing input) | throw (Zod throws) | Propagates up to HTTP handler |
| Infrastructure failure (network, OOM) | throw | Can't handle locally |
| Service → service (deep internal) | throw (typed Error subclass) | Result boilerplate across many layers is worse |
| HTTP handler → response | Catch errors, convert to response | Boundary code catches and translates |

**Practical tradeoff**: Result is safest (compiler forces handling) but creates boilerplate when every caller in a chain must check `.ok`. If the error would just propagate through 3+ layers unchanged, use a typed Error subclass instead.

### Library or roll your own?

Roll your own with the `Result`, `ok`, `err` above. It's 10 lines. Libraries like `neverthrow` add chaining (`.map`, `.andThen`) — use them only if you actually chain results frequently.

---

## Error cause — chain context

Use the `cause` option to chain errors without losing the original stack.

```typescript
try {
  await db.query(sql)
} catch (error) {
  throw new DatabaseError("query failed", { cause: error })
}
```

The `cause` is available on `error.cause` and shows up in stack traces.

---

## Exhaustive error handling at boundaries

HTTP handlers catch and translate:

```typescript
app.onError((error, c) => {
  if (error instanceof UserNotFoundError) {
    return c.json({ error: error.message }, 404)
  }
  if (error instanceof PermissionDeniedError) {
    return c.json({ error: error.message }, 403)
  }
  console.error("unhandled:", error)
  return c.json({ error: "internal server error" }, 500)
})
```

---

## Async error patterns

```typescript
// Promise.allSettled — when partial failure is OK
const results = await Promise.allSettled(urls.map(fetch))
const successes = results
  .filter((r): r is PromiseFulfilledResult<Response> => r.status === "fulfilled")
  .map((r) => r.value)

// AbortSignal — cancellation
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) })
}
```

---

## Sources

- MDN: [Error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
- MDN: [Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
