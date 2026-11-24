import { test } from "bun:test"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup, owners } from "./remote-cli-harness"
useRemoteCliCleanup()
const REPLY = { isStreaming: false, currentTurnId: "7", pendingMessageCount: 0, pendingDialogs: [], disposition: "started", kind: "started", turnId: "7", interrupted: true, outcome: "unloaded", models: [{ provider: "anthropic", id: "claude" }], provider: "anthropic", id: "claude" }
test("probe", async () => {
  const base = defaultWorld(); const live = base.sessions[0]!
  const log: string[] = []
  let owner: FakeOwner | undefined
  owner = await startFakeOwner({ stateDir: privateDir(), world: { ...base, sessions: [{ ...live, delegated: { data: REPLY, frames: [] } }] }, onRequest: (t) => log.push(t + ":" + (owner?.state.commands.at(-1)?.["type"] ?? "")) })
  owners.push(owner)
  for (const args of [["send","dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ","hi","--no-wait"],["send","dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ","hi","--no-wait","--json"],["interrupt","Studio/c2Vzc2lvbi1rZXktMDAwMQ"],["interrupt","dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ","--json"],["model","dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ","anthropic/claude"],["close","dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ"],["open","Studio","--json"],["open","Studio"]]) {
    log.length = 0
    const r = await run(args, owner.stateDir, SIGNED_IN, testBootstrap(), { localPermissionPreset: () => "workspace" } as never)
    console.log(JSON.stringify(args), r.code, JSON.stringify(r.out), JSON.stringify(r.err), log.join(" "))
  }
})
