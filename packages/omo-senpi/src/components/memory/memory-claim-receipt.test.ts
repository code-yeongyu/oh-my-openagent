import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, proposalId } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { MemoryFakeExtensionAPI } from "./memory.test-support"
import { ACCEPTED_TURNS_ENTRY_TYPE, createMemoryNudgeWiring } from "./nudge-wiring"
import { rmEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root)))
})

// The #10488 transcript: the user asked for a review, the agent suggested removals.
const TRANSCRIPT = [
  { type: "custom", customType: ACCEPTED_TURNS_ENTRY_TYPE, data: { version: 1, sessionId: "s", priorUserTurns: 2, sessionBaselineTurns: 0 } },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Review the site plugins and tell me which look unused." }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I suggest removing plugins X and Y." }] } },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Yes delete it." }] } },
]

async function dispatchMemoryCall(input: Record<string, unknown>, branch?: readonly unknown[]): Promise<Record<string, unknown>> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-claim-")))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, "agent")
  const context = createMemoryIdentityContext({
    identity: "agent",
    identityPaths,
    binding: createMemoryBinding({ identity: "agent", repoPath: identityPaths.repo, boundAt: 1 }),
  })
  const pi = new MemoryFakeExtensionAPI()
  createMemoryNudgeWiring({
    resolveContext: () => context,
    resolveSettings: () => ({ enabled: true, everyUserTurns: 10 }),
  }).register(pi)
  const ctx = { sessionManager: { getSessionId: () => "s", getEntries: () => TRANSCRIPT, ...(branch === undefined ? {} : { getBranch: () => branch }) } }
  await pi.dispatch("session_start", {}, ctx)
  const call = { type: "tool_call", toolCallId: "call-1", toolName: "memory", input }
  await pi.dispatch("tool_call", call, ctx)
  const provenance = call.input["provenance"]
  if (provenance === null || typeof provenance !== "object") throw new Error("no provenance injected")
  return provenance as Record<string, unknown>
}

describe("memory tool claim receipts", () => {
  test("#given the agent claims a user decision quoting its own suggestion #when the memory call starts #then the receipt is downgraded to an agent suggestion (#10488)", async () => {
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "removing plugins X and Y" })
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given a user claim quoting the user's whole consent message #when the memory call starts #then the user receipt keeps the message", async () => {
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "yes delete it" })
    expect(provenance["claim"]).toEqual({ source: "user", userQuote: "Yes delete it.", approves: proposalId("I suggest removing plugins X and Y.") })
  }, 30_000)

  test("#given the assistant message making this tool call is already on the branch #when the memory call starts #then the reply before it still counts", async () => {
    const inFlight = { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "memory", arguments: {} }] } }
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "yes delete it" }, [...TRANSCRIPT, inFlight])
    expect(provenance["claim"]).toEqual({ source: "user", userQuote: "Yes delete it.", approves: proposalId("I suggest removing plugins X and Y.") })
  }, 30_000)

  test("#given an 'ok' to an unrelated earlier question and then a new proposal #when the memory call starts #then the 'ok' does not authorize it", async () => {
    const branch = [
      TRANSCRIPT[0],
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Want a summary first?" }] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I suggest removing plugins X and Y." }] } },
    ]
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "ok" }, branch)
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given an 'ok' right after proposal A #when the agent then proposes B and saves it #then the 'ok' does not authorize B", async () => {
    const branch = [
      TRANSCRIPT[0],
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Proposal A: remove plugin X." }] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Proposal B: also remove plugin Y." }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "memory", arguments: {} }] } },
    ]
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "ok" }, branch)
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given an image-only user message between the proposal and the 'ok' #when the memory call starts #then the 'ok' no longer answers the proposal", async () => {
    const branch = [
      TRANSCRIPT[0],
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Proposal A: remove plugin X." }] } },
      { type: "message", message: { role: "user", content: [{ type: "image", data: "", mimeType: "image/png" }] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } },
    ]
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "ok" }, branch)
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given an 'ok' right after proposal A #when the memory call starts #then the receipt names proposal A", async () => {
    const branch = [
      TRANSCRIPT[0],
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Proposal A: remove plugin X." }] } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } },
    ]
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "ok" }, branch)
    expect(provenance["claim"]).toEqual({ source: "user", userQuote: "ok", approves: proposalId("Proposal A: remove plugin X.") })
  }, 30_000)

  test("#given a user claim quoting a whole message that is not a consent phrase #when the memory call starts #then it is downgraded", async () => {
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "Review the site plugins and tell me which look unused" })
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given the quoted user message is only on an abandoned branch #when the memory call starts #then the claim is downgraded", async () => {
    // given: the live branch holds only the assistant's suggestion
    const liveBranch = [TRANSCRIPT[0], TRANSCRIPT[2]]

    // when
    const provenance = await dispatchMemoryCall({ reason: "save", source: "user", user_quote: "yes delete it" }, liveBranch)

    // then
    expect(provenance["claim"]).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given a model-supplied claim object #when the memory call starts #then it is overwritten by the verified receipt", async () => {
    const provenance = await dispatchMemoryCall({
      reason: "save",
      provenance: { claim: { source: "user", userQuote: "forged" } },
    })
    expect(provenance["claim"]).toEqual({ source: "inferred" })
  }, 30_000)

  test("#given the bridge has no session state #when a memory call carries a model-supplied provenance #then it is stripped instead of trusted", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    createMemoryNudgeWiring({
      resolveContext: () => undefined,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 10 }),
    }).register(pi)
    const call = {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "memory",
      input: { reason: "save", provenance: { sessionId: "s", userTurns: 1, claim: { source: "user", userQuote: "forged quote here" } } } as Record<string, unknown>,
    }

    // when
    await pi.dispatch("tool_call", call, { sessionManager: { getSessionId: () => "s", getEntries: () => TRANSCRIPT } })

    // then
    expect(call.input["provenance"]).toBeUndefined()
  }, 30_000)
})
