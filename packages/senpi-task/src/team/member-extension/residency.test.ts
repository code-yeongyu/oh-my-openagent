import { type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { terminateRpcChild } from "../../runners/rpc/terminate"
import { spawnFakeChild } from "../../runners/rpc/__fixtures__/spawn-fake"
import { RpcProcessRunner } from "../../runners/rpc-process"
import { createMemberSelfPoller } from "./self-poller"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222"
const roots: string[] = []
const children: ChildProcess[] = []

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop()
    if (child !== undefined) await terminateRpcChild(child, { sigkillDelayMs: 100 })
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member injection residency", () => {
  test("#given a member whose initial turn ended without a wait #when lead mail is injected #then its resident RPC session revives into a working turn", async () => {
    // given an ended but resident member session
    const root = mkdtempSync(join(tmpdir(), "senpi-member-residency-"))
    roots.push(root)
    const config = TeamModeConfigSchema.parse({ base_dir: join(root, "teams") })
    const sessionDir = join(root, "sessions")
    const runner = new RpcProcessRunner({
      spawnChild: (descriptor) => {
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    })
    const handle = await runner.start({ task_id: "st_00000001", cwd: root, state_dir: root, prompt: "first" })
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("first")

    let injected = Promise.resolve()
    const poller = createMemberSelfPoller({
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      config,
      sessionDir,
      inject: (content) => { injected = handle.followUp(content) },
    })
    await sendMessage({
      version: 1,
      messageId: MESSAGE_ID,
      from: "lead",
      to: "alice",
      kind: "message",
      body: "continue with injected work",
      timestamp: 1,
    }, TEAM_RUN_ID, config, { isLead: true, activeMembers: ["alice"] })

    // when the member inbox poller injects the lead mail
    await poller.pollOnce()
    await injected
    const workingTurn = handle.waitForIdle()
    let completed = false
    void workingTurn.then(() => { completed = true })
    await Promise.resolve()

    // then the prior completed turn did not satisfy the new turn, and work can proceed
    expect(completed).toBe(false)
    await handle.steer("complete")
    await workingTurn
    expect(handle.lastAssistantText()).toBe("steered-complete")
    await handle.dispose()
  })
})
