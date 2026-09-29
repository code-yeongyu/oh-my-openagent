// `@oh-my-opencode/omo-gateway/conformance`: the adapter contract plus the suite every surface
// adapter runs, in repo or out of it. Framework-agnostic: `runAdapterConformance` returns a report
// and never touches a test runner. See docs/adapters.md for the worked example.
import { capabilitiesShape, dedupeOnReplay, eventIdUnique } from "./conformance/inbound"
import { createChat, editOwnMessage, reactionSwap, threadReplyPlacement, uploadOrdering } from "./conformance/outbound"
import { capabilityRefusals } from "./conformance/refusals"
import { streamDraftHonest } from "./conformance/stream"
import {
  type Check,
  type CheckId,
  type CheckResult,
  ConformanceFailure,
  type ConformanceFixtures,
  type ConformanceReport,
  ConformanceSkip,
  type MakeAdapter,
} from "./conformance/types"

export * from "./contract"
export { checkCapability, requiredCapabilities } from "./capability"
export { parseRich, plainText } from "./rich"
export { FakeAdapter, FAKE_DEFAULT_CAPABILITIES, type FakeAdapterOptions } from "../adapters/fake/adapter"
export { FakePlatform, type FakeHumanPost, type FakeMessage } from "../adapters/fake/platform"
export type { CheckId, CheckResult, ConformanceFixtures, ConformanceReport, MakeAdapter, PlatformMessageView } from "./conformance/types"

const CHECKS: readonly (readonly [CheckId, Check])[] = [
  ["capabilities_shape", capabilitiesShape],
  ["event_id_unique", eventIdUnique],
  ["dedupe_on_replay", dedupeOnReplay],
  ["edit_own_message", editOwnMessage],
  ["reaction_swap", reactionSwap],
  ["upload_ordering", uploadOrdering],
  ["thread_reply_placement", threadReplyPlacement],
  ["create_chat", createChat],
  ["stream_draft_honest", streamDraftHonest],
  ["capability_refusals", capabilityRefusals],
]

export const CONFORMANCE_CHECKS: readonly CheckId[] = CHECKS.map(([id]) => id)

/**
 * Run every conformance check against adapters built by `makeAdapter` (called once per check, and
 * again inside `dedupe_on_replay` to simulate a restart) on the platform `fixtures` drives.
 * Resolves to a report; `ok` is false when any check failed. Never throws for a failing adapter.
 */
export async function runAdapterConformance(makeAdapter: MakeAdapter, fixtures: ConformanceFixtures): Promise<ConformanceReport> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  let counter = 0
  const context = {
    makeAdapter,
    fixtures,
    timeoutMs: fixtures.timeoutMs ?? 5000,
    marker: (label: string) => `conformance-${run}-${label}-${(counter += 1)}`,
  }
  const checks: CheckResult[] = []
  for (const [id, check] of CHECKS) {
    try {
      const outcome = await check(context)
      checks.push(outcome instanceof ConformanceSkip ? { id, status: "skip", detail: outcome.reason } : { id, status: "pass", detail: outcome })
    } catch (error) {
      const detail = error instanceof ConformanceFailure ? error.message : `threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
      checks.push({ id, status: "fail", detail })
    }
  }
  return { platform: fixtures.chat.platform, ok: checks.every((check) => check.status !== "fail"), checks }
}

export function formatConformanceReport(report: ConformanceReport): string {
  const lines = report.checks.map((check) => `${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.detail}`)
  return [`conformance ${report.platform}: ${report.ok ? "OK" : "FAILED"}`, ...lines].join("\n")
}
