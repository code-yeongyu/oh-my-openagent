import assert from "node:assert/strict"

import { hostSuiteSettings, startHostWorld } from "../../runners/rpc-host/__fixtures__/host-world"
import { runTaskSend } from "../../tools/control/send"

/**
 * The host-session variant of the real cold revival: the SAME real manager, lifecycle, steering
 * engine and store as `real-cold-revive.ts`, with the child living as a SESSION of a daemon instead
 * of a child process. The daemon is faked at the socket (no provider, no network, no engine), but
 * everything omo owns is real - including the JSONL transcript the daemon writes, which is what a
 * cold revival needs on disk to consider the child continuable at all.
 *
 * What it proves: an idle-parked daemon child is reopened at its RECORDED session path exactly once,
 * the message is delivered into that reopened session, the original prompt is never replayed, and
 * the session path never has two writers.
 */

export type HostColdReviveResult = {
  readonly parkedResidency: string
  readonly revivedResidency: string
  readonly revivedStatus: string
  readonly sendOutcome: string
  readonly prompts: readonly string[]
  readonly opens: number
  readonly peakAttachments: number
  readonly finalResponse: string | undefined
  readonly sessionPath: string
  readonly transcriptRetained: boolean
}

export async function realColdReviveHostSession(): Promise<HostColdReviveResult> {
  const world = await startHostWorld({ transcripts: true })
  const settings = hostSuiteSettings()
  let now = Date.parse("2026-09-17T00:00:00.000Z")
  try {
    const parent = world.connect("parent-cold", { now: () => now })
    await parent.startChildren(1)
    const taskId = parent.taskIds()[0]
    const session = world.host.sessions()[0]
    assert(taskId !== undefined && session !== undefined)

    // The child answers its turn, so the record settles terminal - the only thing the idle
    // reclaimer ever parks.
    world.host.completeTurn(session.routingId, "COLD_HOST_SENTINEL")
    const settled = await parent.manager.waitFor(taskId, { signal: AbortSignal.timeout(15_000) })
    assert.equal(settled.status, "completed")

    now += settings.resident_idle_timeout_ms + 1
    assert.deepEqual(await parent.lifecycle.reclaimIdleResidents?.(), [taskId])
    const parked = parent.store.load(taskId)
    assert(parked?.host_session !== undefined)

    const sent = await runTaskSend(parent.manager, { to: taskId, message: "CONTINUE_HOST_SENTINEL" }, "parent-cold")
    const revived = parent.store.load(taskId)
    assert(revived !== null)
    const sessionPath = parked.host_session.session_path
    return {
      parkedResidency: parked.residency_state,
      revivedResidency: revived.residency_state,
      revivedStatus: revived.status,
      sendOutcome: sent.details.kind,
      prompts: world.prompts(),
      opens: world.commandsOfType("open_session"),
      peakAttachments: world.host.peakAttachments(sessionPath),
      finalResponse: settled.final_response,
      sessionPath,
      transcriptRetained: world.host.sessions().some((live) => live.sessionPath === sessionPath),
    }
  } finally {
    await world.cleanup()
  }
}
