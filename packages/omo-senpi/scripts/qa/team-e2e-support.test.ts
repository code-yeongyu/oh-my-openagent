import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { analyzeMain } from "./team-e2e-analysis.mjs"
import { sessionEnvelopeCount } from "./team-e2e-support.mjs"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("team e2e injection evidence", () => {
  it("#given injected member and lead envelopes #when main evidence is analyzed #then injection delivery and a drained lead inbox are proven", () => {
    // given
    const fixture = createFixture()
    seedInjectionEvidence(fixture)

    // when
    const checks = analyzeMain(
      { events: fixture.events, status: 0 },
      { cwd: fixture.project },
      fixture.obsDir,
    )

    // then
    expect(checks.memberEnvelopeEchoed).toBe(true)
    expect(checks.memberToLeadInjected).toBe(true)
    expect(checks.leadInboxDrained).toBe(true)
    expect(checks.noBlockingTeamWaitCalls).toBe(true)
  })

  it("#given a missing observation directory #when main evidence is analyzed #then injection evidence is written", () => {
    // given
    const fixture = createFixture()
    seedInjectionEvidence(fixture)
    rmSync(fixture.obsDir, { recursive: true, force: true })
    mkdirSync(fixture.obsDir, { recursive: true })

    // when
    analyzeMain(
      { events: fixture.events, status: 0 },
      { cwd: fixture.project },
      fixture.obsDir,
    )

    // then
    expect(existsSync(join(fixture.obsDir, "team-injection-evidence.json"))).toBe(true)
  })

  it("#given one JSON-escaped peer envelope #when crash evidence counts the message id #then it reports exactly one envelope", () => {
    // given
    const fixture = createFixture()
    writeSessionLine(fixture, {
      type: "message",
      message: {
        role: "user",
        content: [{
          type: "text",
          text: `<peer_message from="lead" messageId="${fixture.leadMessageId}">\nCRASH-ONCE\n</peer_message>`,
        }],
      },
    })

    // when
    const count = sessionEnvelopeCount(fixture.project, fixture.taskId, fixture.leadMessageId)

    // then
    expect(count).toBe(1)
  })
})

type Fixture = ReturnType<typeof createFixture>

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-team-e2e-support-"))
  roots.push(root)
  const project = join(root, "project")
  const obsDir = join(root, "obs")
  const runId = "11111111-1111-4111-8111-111111111111"
  const taskId = "st_00000001"
  const leadMessageId = "22222222-2222-4222-8222-222222222222"
  mkdirSync(project, { recursive: true })
  mkdirSync(obsDir, { recursive: true })
  return {
    project,
    obsDir,
    runId,
    taskId,
    leadMessageId,
    events: [
      toolEvent("team_create", { kind: "created", team_run_id: runId, members: [{ name: "quick" }, { name: "fixture" }] }),
      toolEvent("task_send", {
        kind: "team_message",
        team: { kind: "to_members", message_id: leadMessageId, recipients: ["quick"] },
      }),
    ],
  }
}

function seedInjectionEvidence(fixture: Fixture): void {
  const runtime = join(fixture.project, ".omo", "senpi-task", "teams", "runtime", fixture.runId)
  const processed = join(runtime, "inboxes", "lead", "processed")
  const sessions = join(fixture.project, ".omo", "senpi-task", "children", fixture.taskId, "sessions", fixture.taskId)
  mkdirSync(processed, { recursive: true })
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(runtime, "senpi-task-members.json"), `${JSON.stringify({ quick: fixture.taskId })}\n`)
  writeFileSync(join(processed, "member-reply.json"), "{}\n")
  writeSessionLine(fixture, {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text: `<peer_message from="lead" messageId="${fixture.leadMessageId}">\nLEAD2QUICK\n</peer_message>` }],
    },
  })
  writeFileSync(join(fixture.obsDir, "lead-received.txt"), "custom-message\nQUICK2LEAD member report delivered by injection\n")
}

function writeSessionLine(fixture: Fixture, event: object): void {
  const sessions = join(
    fixture.project,
    ".omo",
    "senpi-task",
    "children",
    fixture.taskId,
    "sessions",
    fixture.taskId,
  )
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify(event)}\n`)
}

function toolEvent(toolName: string, details: object): object {
  return {
    type: "tool_execution_end",
    toolName,
    result: { content: [], details },
    isError: false,
  }
}
