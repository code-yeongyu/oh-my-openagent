import type { Row } from "./schema"

// Design 3.2 and 7.2: a descriptor's call is its row's `sdk` key, and a test runs the descriptor against a recording
// root to confirm the one member it invokes. The root is a proxy that records every member path called on it.

export type Invocation = { readonly member: string; readonly args: readonly unknown[] }

export function recordInvocations(invoke: (root: unknown) => unknown): Invocation[] {
  const invocations: Invocation[] = []
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => (typeof key === "string" ? node([...path, key]) : undefined),
      apply: (_target, _self, args: unknown[]) => {
        invocations.push({ member: path.join("."), args })
        return { kind: "ok", value: null }
      },
    })
  invoke(node([]))
  return invocations
}

export const recordCalls = (invoke: (root: unknown) => unknown): string[] =>
  recordInvocations(invoke).map((invocation) => invocation.member)

export function descriptorCallProblems(row: Row, invoke: (root: unknown) => unknown): string[] {
  const calls = recordCalls(invoke)
  if (calls.length === 1 && calls[0] === row.sdk) return []
  if (calls.length === 0) return [`the descriptor of ${row.id} invokes no SDK member; it must call ${row.sdk}`]
  if (calls.length > 1)
    return [`the descriptor of ${row.id} invokes ${calls.join(", ")}; an adapter calls exactly one member, ${row.sdk}`]
  return [`the descriptor of ${row.id} invokes ${calls[0]}, but its row's call is ${row.sdk}`]
}
