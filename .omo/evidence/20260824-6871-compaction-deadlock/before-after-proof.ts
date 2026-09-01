// #6871 before/after proof: a rejected required compaction (the deadlock family)
// driven through the real component registration seam.
// BEFORE (component absent): nothing intercepts the rejection -> no rescue apply,
//   no persisted diagnosis, no guidance. Session stays stuck above threshold.
// AFTER (component registered): deterministic shrinking-suffix rescue is applied
//   through the sanctioned applyCompaction port.
import { FakeExtensionAPI } from "../../../packages/omo-senpi/test-support/fake-extension-api"
import { createCompactionRecoveryComponent } from "../../../packages/omo-senpi/src/components/compaction-recovery/index"

const rejectionEvent = {
  type: "session_compact",
  reason: "threshold",
  requestId: "req-6871-proof",
  accepted: false,
  rejectionCause: "cancelled-by-extension",
  fromExtension: false,
  willRetry: false,
}

function messageEntry(id: string, role: string, text: string): Record<string, unknown> {
  return { id, type: "message", message: { role, content: [{ type: "text", text }] } }
}

const branchEntries = [
  messageEntry("e0", "user", "old context ".repeat(200)),
  messageEntry("e1", "assistant", "answer"),
  messageEntry("e2", "user", "latest question"),
]

const eventCtx = {
  getContextUsage: () => ({ tokens: 236744, contextWindow: 272000 }),
  getCompactionSettings: () => ({ enabled: true, reserveTokens: 40000 }),
  isCompacting: () => false,
  applyCompaction: async (precomputed: unknown) => {
    const plan = precomputed as { firstKeptEntryId?: string }
    console.log(`  applyCompaction CALLED firstKeptEntryId=${plan.firstKeptEntryId}`)
    return { applied: true, reason: "ok" }
  },
  sessionManager: { getBranch: () => branchEntries },
}

async function drive(label: string, withComponent: boolean): Promise<void> {
  console.log(`[${label}]`)
  const pi = new FakeExtensionAPI()
  if (withComponent) {
    createCompactionRecoveryComponent({ schedule: (fn) => fn(), resolveAgentHomeDir: () => undefined })
      .register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
  }
  await pi.dispatch("session_compact", rejectionEvent, eventCtx)
  await Bun.sleep(0)
  const guidance = pi.messages.filter((m) => m.message["customType"] === "omo-compaction-recovery:guidance")
  console.log(`  guidance messages emitted: ${guidance.length}`)
}

await drive("BEFORE FIX (no recovery component registered)", false)
await drive("AFTER FIX (compaction-recovery registered)", true)
