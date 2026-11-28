import {
  type AtomicChange,
  AtomicChangeSchema,
  type AtomicDiff,
  AtomicDiffSchema,
  type AtomicLogEntry,
  AtomicLogSchema,
  type AtomicStatus,
  AtomicStatusSchema,
  type AtomicTriageReview,
  AtomicTriageReviewSchema,
  type AtomicViewList,
  AtomicViewListSchema,
  parseJsonContract,
} from "./contracts"
import type { AtomicCallOptions, AtomicRunner } from "./client-runner"

const READ = { sideEffectsPossible: false }

export type AtomicVcsOperations = {
  status(call: AtomicCallOptions): Promise<AtomicStatus>
  diff(call: AtomicCallOptions): Promise<AtomicDiff>
  log(call: AtomicCallOptions & { readonly limit?: number }): Promise<readonly AtomicLogEntry[]>
  change(call: AtomicCallOptions & { readonly hash: string }): Promise<AtomicChange>
  viewList(call: AtomicCallOptions): Promise<AtomicViewList>
  triageReview(call: AtomicCallOptions & { readonly view?: string; readonly into?: string }): Promise<AtomicTriageReview>
}

export function createVcsOperations(run: AtomicRunner): AtomicVcsOperations {
  return {
    async status(call) {
      const stdout = await run({ operation: "status", args: ["status", "--json"], mutation: false }, call)
      return parseJsonContract(AtomicStatusSchema, stdout, { operation: "status", ...READ })
    },
    async diff(call) {
      const stdout = await run({ operation: "diff", args: ["diff", "--json"], mutation: false }, call)
      return parseJsonContract(AtomicDiffSchema, stdout, { operation: "diff", ...READ })
    },
    async log(call) {
      const count = call.limit === undefined ? [] : [`--count=${call.limit}`]
      const stdout = await run({ operation: "log", args: ["log", "--format", "json", ...count], mutation: false }, call)
      return parseJsonContract(AtomicLogSchema, stdout, { operation: "log", ...READ })
    },
    async change(call) {
      const args = ["change", "--format", "json", "--", call.hash]
      const stdout = await run({ operation: "change", args, mutation: false }, call)
      return parseJsonContract(AtomicChangeSchema, stdout, { operation: "change", ...READ })
    },
    async viewList(call) {
      const stdout = await run({ operation: "view list", args: ["view", "list", "--json"], mutation: false }, call)
      return parseJsonContract(AtomicViewListSchema, stdout, { operation: "view list", ...READ })
    },
    async triageReview(call) {
      const into = call.into === undefined ? [] : [`--into=${call.into}`]
      const view = call.view === undefined ? [] : ["--", call.view]
      const args = ["triage", "review", "--json", ...into, ...view]
      const stdout = await run({ operation: "triage review", args, mutation: false }, call)
      return parseJsonContract(AtomicTriageReviewSchema, stdout, { operation: "triage review", ...READ })
    },
  }
}
