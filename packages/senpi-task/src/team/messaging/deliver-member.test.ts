import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { normalizeSenpiTeamSpec } from "../normalize"
import { resolveTeamMemberInboxDir, teamStorageBaseDir } from "../storage"
import { toTeamCoreConfig } from "../runtime-config"
import { deliverToMember } from "./deliver-member"
import { buildMemberUnreadInjection } from "./inject"
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

// The revive path drains the unread inbox via the injection fallback, which needs a live runtime state
// (that is where the per-member pending-injection marks live). Seed one whose sole member matches the
// recipient so injection claims resolve.
async function setupWithRuntime(memberName = "beta") {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec(
    { members: [{ name: memberName, kind: "category", category: "quick", prompt: "p" }] },
    "squad",
  )
  const runtimeState = await createRuntimeState(spec, "lead-session", "project", config)
  return { stateDir, config, teamRunId: runtimeState.teamRunId }
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
    const { stateDir, config, teamRunId } = await setupWithRuntime("beta")
    const message = buildTeamMessage({ from: "alpha", to: "beta", body: "hello" })
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const delivery = new FakeDeliveryPort({ sendOutcome: { kind: "revived", task_id: "st_beta", run_epoch: 2 } })
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "resident" }),
      liveHandle: false,
    })

    // when
    const result = await deliverToMember({
      message,
      recipient: "beta",
      teamRunId,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    expect(result).toEqual({ kind: "revived", member: "beta", messageId: message.messageId })
    expect(delivery.revived).toHaveLength(1)
    expect(delivery.revived[0]?.deliverAs).toBe("followUp")
    expect(delivery.revived[0]?.message).toContain("<peer_message")
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, "beta")
    expect(existsSync(join(inboxDir, "processed", `${message.messageId}.json`))).toBe(true)
  })

  test("#given the revive path is not continuable #when delivered #then the reservation is released", async () => {
    // given
    const { stateDir, config, teamRunId } = await setupWithRuntime("beta")
    const message = buildTeamMessage({ from: "alpha", to: "beta", body: "hello" })
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
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
      teamRunId,
      config,
      memberTaskMap: { beta: "st_beta" },
      delivery,
    })

    // then
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, "beta")
    expect(result.kind).toBe("delivery_failed")
    expect(existsSync(join(inboxDir, `${message.messageId}.json`))).toBe(true)
  })

  test("#given a prior steer-throw left a message unread #when a later revive delivers a new message #then both drain to processed with no reservation leak", async () => {
    // given: an older message left unread by a steer-throw on a running-resident member
    const { stateDir, config, teamRunId } = await setupWithRuntime("beta")
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, "beta")
    const older = buildTeamMessage(
      { from: "alpha", to: "beta", body: "older" },
      { newMessageId: () => "11111111-1111-4111-8111-111111111111" },
    )
    await sendMessage(older, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const running = new FakeDeliveryPort()
    running.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "running", residency_state: "resident" }),
      steer: "throw",
    })
    const failed = await deliverToMember({ message: older, recipient: "beta", teamRunId, config, memberTaskMap: { beta: "st_beta" }, delivery: running })
    expect(failed.kind).toBe("delivery_failed")
    expect(existsSync(join(inboxDir, `${older.messageId}.json`))).toBe(true)

    // when: the member is now terminal-resident and a NEW message triggers the revive path
    const newer = buildTeamMessage(
      { from: "alpha", to: "beta", body: "newer" },
      { newMessageId: () => "22222222-2222-4222-8222-222222222222" },
    )
    await sendMessage(newer, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const idle = new FakeDeliveryPort({ sendOutcome: { kind: "revived", task_id: "st_beta", run_epoch: 2 } })
    idle.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "resident" }),
      liveHandle: false,
    })
    const result = await deliverToMember({ message: newer, recipient: "beta", teamRunId, config, memberTaskMap: { beta: "st_beta" }, delivery: idle })

    // then: the revive prompt carries BOTH the prior-unread and the current envelope, and unread drains to 0
    expect(result.kind).toBe("revived")
    expect(idle.revived[0]?.message).toContain(older.messageId)
    expect(idle.revived[0]?.message).toContain(newer.messageId)
    expect(existsSync(join(inboxDir, `${older.messageId}.json`))).toBe(false)
    expect(existsSync(join(inboxDir, `${newer.messageId}.json`))).toBe(false)
    expect(existsSync(join(inboxDir, `.delivering-${older.messageId}.json`))).toBe(false)
    expect(existsSync(join(inboxDir, `.delivering-${newer.messageId}.json`))).toBe(false)
    expect(existsSync(join(inboxDir, "processed", `${older.messageId}.json`))).toBe(true)
    expect(existsSync(join(inboxDir, "processed", `${newer.messageId}.json`))).toBe(true)
  })

  test("#given prior unread and a revive that is not continuable #when delivered #then reservation and injection both roll back and re-injection re-includes the unread", async () => {
    // given: an older unread message plus a newer message about to revive
    const { stateDir, config, teamRunId } = await setupWithRuntime("beta")
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, "beta")
    const older = buildTeamMessage(
      { from: "alpha", to: "beta", body: "older" },
      { newMessageId: () => "33333333-3333-4333-8333-333333333333" },
    )
    await sendMessage(older, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const newer = buildTeamMessage(
      { from: "alpha", to: "beta", body: "newer" },
      { newMessageId: () => "44444444-4444-4444-8444-444444444444" },
    )
    await sendMessage(newer, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const delivery = new FakeDeliveryPort({
      sendOutcome: { kind: "not_continuable", task_id: "st_beta", reason: "disposed", suggestion: "read" },
    })
    delivery.setMember("st_beta", {
      record: memberRecord("st_beta", { status: "completed", residency_state: "resident" }),
      liveHandle: false,
    })

    // when
    const result = await deliverToMember({ message: newer, recipient: "beta", teamRunId, config, memberTaskMap: { beta: "st_beta" }, delivery })

    // then: both messages are back in unread, nothing reserved, and the injection pending mark rolled back
    expect(result.kind).toBe("delivery_failed")
    expect(existsSync(join(inboxDir, `${older.messageId}.json`))).toBe(true)
    expect(existsSync(join(inboxDir, `${newer.messageId}.json`))).toBe(true)
    expect(existsSync(join(inboxDir, `.delivering-${newer.messageId}.json`))).toBe(false)
    const reinjected = await buildMemberUnreadInjection({ sessionId: "sess-beta", memberName: "beta", teamRunId, config, turnMarker: "turn-fresh" })
    expect(reinjected.messageIds).toContain(older.messageId)
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
