// A rule as a writer supplies it (no id, number or defaults yet) and its materialized record.

import type { RuleRecord, RuleScope } from "./format"

export type NewRule = Omit<RuleRecord, "id" | "n" | "scope" | "gate" | "params" | "status" | "supersedes" | "locked" | "applies_to"> & {
  readonly scope: Partial<RuleScope> & { readonly gateway: string }
  readonly gate?: RuleRecord["gate"]
  readonly params?: RuleRecord["params"]
  readonly applies_to?: RuleRecord["applies_to"]
  readonly supersedes?: string | null
  readonly locked?: boolean
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function newRuleId(now: number = Date.now()): string {
  let time = ""
  let remaining = now
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD.charAt(remaining % 32) + time
    remaining = Math.floor(remaining / 32)
  }
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => CROCKFORD.charAt(byte % 32)).join("")
  return `r_${time}${random}`
}

export function newRecord(input: NewRule, n: number): RuleRecord {
  const { scope, ...rest } = input
  return {
    ...rest,
    id: newRuleId(),
    n,
    scope: {
      gateway: scope.gateway,
      surface: scope.surface ?? null,
      chat: scope.chat ?? null,
      thread: scope.thread ?? null,
      user: scope.user ?? null,
      agent: scope.agent ?? null,
    },
    gate: input.gate ?? null,
    params: input.params ?? (input.kind === "mechanical" ? {} : null),
    applies_to: input.applies_to ?? ["lead", "worker"],
    status: "active",
    supersedes: input.supersedes ?? null,
    locked: input.locked ?? false,
  }
}
