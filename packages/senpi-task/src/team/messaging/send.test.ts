import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { NotificationConfig } from "../../completion"
import { writeMemberTaskMap } from "../member-map"
import { ensureTeamRuntimeDirs, resolveTeamMemberInboxDir, resolveTeamRuntimeDirs, teamStorageBaseDir } from "../storage"
import { toTeamCoreConfig } from "../runtime-config"
import { sendTeamMessage } from "./send"
import type { MemberTaskMap } from "./types"
import {
  FakeDeliveryPort,
  FakeLeadNotifier,
  cleanupMessagingTmp,
  memberRecord,
  stateDirConfig,
  tempProjectDir,
} from "./__fixtures__/messaging-fakes"
import { taskSettings } from "../__fixtures__/runtime-fakes"

const TEAM_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const NOTIFICATION: NotificationConfig = { deliver_as: "followUp" }

afterEach(() => {
  cleanupMessagingTmp()
})

async function setup(memberMap: MemberTaskMap) {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  await ensureTeamRuntimeDirs(stateDir, TEAM_RUN_ID, Object.keys(memberMap))
  const runtimeDir = resolveTeamRuntimeDirs(stateDir, TEAM_RUN_ID).runtimeDir
  await writeMemberTaskMap(runtimeDir, memberMap)
  return { stateDir, config }
}

function deps(
  stateDir: ReturnType<typeof stateDirConfig>,
  config: ReturnType<typeof toTeamCoreConfig>,
  delivery: FakeDeliveryPort,
  leadNotifier: FakeLeadNotifier,
) {
  return {
    teamRunId: TEAM_RUN_ID,
    stateDir,
    config,
    delivery,
    leadNotifier,
    notificationConfig: NOTIFICATION,
    parentState: () => ({ kind: "idle" as const }),
  }
}

describe("sendTeamMessage member direction", () => {
  test("#given a lead broadcast to 3 members #when sent #then 3 inbox files are written and 3 deliveries happen", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b", gamma: "st_g" }
    const { stateDir, config } = await setup(map)
    const delivery = new FakeDeliveryPort()
    for (const taskId of Object.values(map)) {
      delivery.setMember(taskId, { record: memberRecord(taskId, { status: "running", residency_state: "resident" }) })
    }
    const leadNotifier = new FakeLeadNotifier()

    // when
    const result = await sendTeamMessage(
      { from: "lead", to: "*", body: "all-hands" },
      deps(stateDir, config, delivery, leadNotifier),
    )

    // then
    expect(result.kind).toBe("to_members")
    if (result.kind !== "to_members") throw new Error("unreachable")
    expect(result.deliveries).toHaveLength(3)
    expect(result.deliveries.every((d) => d.kind === "steered")).toBe(true)
    expect(delivery.steered).toHaveLength(3)
    for (const member of ["alpha", "beta", "gamma"]) {
      const processed = join(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, member), "processed", `${result.messageId}.json`)
      expect(existsSync(processed)).toBe(true)
    }
  })

  test("#given a member-to-member message #when sent #then a single delivery to the named recipient occurs", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const delivery = new FakeDeliveryPort()
    delivery.setMember("st_b", { record: memberRecord("st_b", { status: "running", residency_state: "resident" }) })
    const leadNotifier = new FakeLeadNotifier()

    // when
    const result = await sendTeamMessage(
      { from: "alpha", to: "beta", body: "ping" },
      deps(stateDir, config, delivery, leadNotifier),
    )

    // then
    expect(result.kind).toBe("to_members")
    if (result.kind !== "to_members") throw new Error("unreachable")
    expect(result.deliveries).toEqual([{ kind: "steered", member: "beta", messageId: result.messageId }])
  })

  test("#given a payload over the byte cap #when sent #then a backpressure/payload error is raised before delivery", async () => {
    // given
    const map: MemberTaskMap = { beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const oversized = { ...config, message_payload_max_bytes: 8 }
    const delivery = new FakeDeliveryPort()
    delivery.setMember("st_b")
    const leadNotifier = new FakeLeadNotifier()

    // when
    const attempt = sendTeamMessage(
      { from: "alpha", to: "beta", body: "this body is definitely longer than eight bytes" },
      deps(stateDir, oversized, delivery, leadNotifier),
    )

    // then
    await expect(attempt).rejects.toMatchObject({ name: "PayloadTooLargeError" })
    expect(delivery.steered).toHaveLength(0)
  })

  test("#given a message to an unknown member #when sent #then it rejects naming the recipient", async () => {
    // given
    const map: MemberTaskMap = { beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const delivery = new FakeDeliveryPort()
    const leadNotifier = new FakeLeadNotifier()

    // when
    const attempt = sendTeamMessage(
      { from: "alpha", to: "ghost", body: "x" },
      deps(stateDir, config, delivery, leadNotifier),
    )

    // then
    await expect(attempt).rejects.toThrow(/ghost/)
  })
})

describe("sendTeamMessage lead direction", () => {
  test("#given a member message to the lead sentinel #when sent #then it routes through the lead notifier, not an inbox", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a" }
    const { stateDir, config } = await setup(map)
    const delivery = new FakeDeliveryPort()
    const leadNotifier = new FakeLeadNotifier()

    // when
    const result = await sendTeamMessage(
      { from: "alpha", to: "lead", body: "need a call" },
      deps(stateDir, config, delivery, leadNotifier),
    )

    // then
    expect(result.kind).toBe("to_lead")
    if (result.kind !== "to_lead") throw new Error("unreachable")
    expect(result.lead).toEqual({ kind: "delivered", decision: "wake" })
    expect(leadNotifier.enqueued).toHaveLength(1)
    expect(leadNotifier.enqueued[0]?.customType).toBe("senpi-task.team-message")
    expect(leadNotifier.enqueued[0]?.from).toBe("alpha")
  })
})
