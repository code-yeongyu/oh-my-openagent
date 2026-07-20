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

describe("team e2e session evidence", () => {
  it("#given a delivered member wait in child JSONL #when main evidence is analyzed #then delivery is proven without a mock observation file", async () => {
    // given
    const fixture = createFixture()
    seedWaitEvidence(fixture)
    writeSessionLine(fixture, {
      type: "message",
      message: {
        role: "toolResult",
        details: { message_id: fixture.leadMessageId, body: "LEAD2QUICK handshake" },
      },
    })

    // when
    const checks = await analyzeMain(
      { events: fixture.events, status: 0 },
      { cwd: fixture.project },
      fixture.obsDir,
    )

    // then
    expect(checks.memberEnvelopeEchoed).toBe(true)
  })

  it("#given a missing observation directory #when main evidence is analyzed #then the evidence directory is created", async () => {
    // given
    const fixture = createFixture()
    seedWaitEvidence(fixture)
    rmSync(fixture.obsDir, { recursive: true, force: true })

    // when
    await analyzeMain(
      { events: fixture.events, status: 0 },
      { cwd: fixture.project },
      fixture.obsDir,
    )

    // then
    expect(existsSync(join(fixture.obsDir, "team-wait-evidence.json"))).toBe(true)
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
  const waitMessageId = "33333333-3333-4333-8333-333333333333"
  mkdirSync(project, { recursive: true })
  mkdirSync(obsDir, { recursive: true })
  return {
    project,
    obsDir,
    runId,
    taskId,
    leadMessageId,
    waitMessageId,
    events: [
      toolEvent("team_create", { kind: "created", team_run_id: runId, members: [{ name: "quick" }] }),
      toolEvent("task_send", {
        kind: "team_message",
        team: { kind: "to_members", message_id: leadMessageId, recipients: ["quick"] },
      }),
      toolEvent("team_wait", {
        kind: "message",
        message_id: waitMessageId,
        from: "quick",
        body: "QUICK2LEAD member report",
      }),
    ],
  }
}

function seedWaitEvidence(fixture: Fixture): void {
  const runtime = join(fixture.project, ".omo", "senpi-task", "teams", "runtime", fixture.runId)
  const processed = join(runtime, "inboxes", "lead", "processed")
  const logs = join(fixture.project, ".omo", "senpi-task", "logs")
  mkdirSync(processed, { recursive: true })
  mkdirSync(logs, { recursive: true })
  writeFileSync(join(runtime, "senpi-task-members.json"), `${JSON.stringify({ quick: fixture.taskId })}\n`)
  writeFileSync(join(processed, `${fixture.waitMessageId}.json`), "{}\n")
  writeFileSync(
    join(logs, `${fixture.taskId}.jsonl`),
    `${JSON.stringify({ type: "team_message_delivered", payload: { message_id: fixture.waitMessageId } })}\n`,
  )
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
