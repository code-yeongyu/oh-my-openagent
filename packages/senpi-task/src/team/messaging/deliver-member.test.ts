import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { resolveTeamMemberInboxDir, teamStorageBaseDir } from "../storage"
import { toTeamCoreConfig } from "../runtime-config"
import { deliverToMember } from "./deliver-member"
import { buildTeamMessage } from "./message"
import {
  FakeDeliveryPort,
  cleanupMessagingTmp,
  memberRecord,
  stateDirConfig,
  tempProjectDir,
} from "./__fixtures__/messaging-fakes"
import { taskSettings } from "../__fixtures__/runtime-fakes"

const TEAM_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

afterEach(() => {
  cleanupMessagingTmp()
})

function setup() {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  return { stateDir, config }
}

async function seedInboxMessage(config: ReturnType<typeof setup>["config"], recipient: string, from = "alpha") {
  const message = buildTeamMessage({ from, to: recipient, body: "hello" })
  await sendMessage(message, TEAM_RUN_ID, config, { isLead: from === "lead", activeMembers: [recipient] })
  return message
}

function inboxFile(stateDir: ReturnType<typeof setup>["stateDir"], recipient: string, name: string): string {
  return join(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, recipient), name)
}

describe("deliverToMember", () => {
  test("#given a running resident recipient #when delivered #then it is steered and the reservation is committed to processed/", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await seedInboxMessage(config, "beta")
    const delivery = new FakeDeliveryPort()
    delivery.setMember("st_beta", { record: memberRecord("st_beta", { status: "running", residency_state: "resident" }) })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result).toEqual({ kind: "steered", member: "beta", messageId: message.messageId })
    expect(delivery.steered).toHaveLength(1)
    expect(delivery.steered[0]?.text).toContain("<peer_message")
    expect(existsSync(inboxFile(stateDir, "beta", `${message.messageId}.json`))).toBe(false)
    expect(existsSync(inboxFile(stateDir, "beta", `.delivering-${message.messageId}.json`))).toBe(false)
    expect(existsSync(inboxFile(stateDir, "beta", join("processed", `${message.messageId}.json`)))).toBe(true)
  })

  test("#given the steer throws #when delivered #then the reservation is released and the message stays listed unread", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await seedInboxMessage(config, "beta")
    const delivery = new FakeDeliveryPort()
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "running", residency_state: "resident" }),
      steer: "throw",
    })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result.kind).toBe("delivery_failed")
    expect(existsSync(inboxFile(stateDir, "beta", `${message.messageId}.json`))).toBe(true)
    expect(existsSync(inboxFile(stateDir, "beta", `.delivering-${message.messageId}.json`))).toBe(false)
  })

  test("#given an idle terminal-resident recipient #when delivered #then it is revived via followUp and committed", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await seedInboxMessage(config, "beta")
    const delivery = new FakeDeliveryPort({ sendOutcome: { kind: "revived", task_id: "st_beta", run_epoch: 2 } })
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "resident" }),
      liveHandle: false,
    })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result).toEqual({ kind: "revived", member: "beta", messageId: message.messageId })
    expect(delivery.revived).toHaveLength(1)
    expect(delivery.revived[0]?.deliverAs).toBe("followUp")
    expect(delivery.revived[0]?.message).toContain("<peer_message")
    expect(existsSync(inboxFile(stateDir, "beta", join("processed", `${message.messageId}.json`)))).toBe(true)
  })

  test("#given the revive path is not continuable #when delivered #then the reservation is released", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await seedInboxMessage(config, "beta")
    const delivery = new FakeDeliveryPort({
      sendOutcome: { kind: "not_continuable", task_id: "st_beta", reason: "disposed", suggestion: "read output" },
    })
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "resident" }),
      liveHandle: false,
    })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result.kind).toBe("delivery_failed")
    expect(existsSync(inboxFile(stateDir, "beta", `${message.messageId}.json`))).toBe(true)
  })

  test("#given a non-continuable recipient (disposed) #when delivered #then the message is left unread for injection fallback", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await seedInboxMessage(config, "beta")
    const delivery = new FakeDeliveryPort()
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "disposed" }),
      liveHandle: false,
    })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result.kind).toBe("left_unread")
    expect(delivery.steered).toHaveLength(0)
    expect(delivery.revived).toHaveLength(0)
    expect(existsSync(inboxFile(stateDir, "beta", `${message.messageId}.json`))).toBe(true)
  })

  test("#given no task mapping for the recipient #when delivered #then it is left unread without touching handles", async () => {
    // given
    const { config } = setup()
    const message = buildTeamMessage({ from: "alpha", to: "ghost", body: "x" })
    const delivery = new FakeDeliveryPort()

    // when
    const result = await deliverToMember({
      message,
      recipient: "ghost",
      teamRunId: TEAM_RUN_ID,
      config,
      memberTaskMap: {},
      delivery,
    })

    // then
    expect(result.kind).toBe("left_unread")
    expect(delivery.steered).toHaveLength(0)
  })
})
