import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { join } from "node:path"

import { taskEventLogPath } from "../store/event-log"
import {
  assistantMessage,
  cleanupRoots,
  PARENT_SESSION_ID,
  startHeldRun,
} from "./node-projection.test-harness"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("dag node activity projection (#8674)", () => {
  test("#given a running node #when the snapshot is projected #then lastActivityAt is the child transcript log's own clock", async () => {
    const fixture = await startHeldRun(["only"])
    await fixture.whenNodeRunning("only")
    fixture.runner.child("only").emit(assistantMessage("still working"))

    const node = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]
    const logPath = taskEventLogPath(fixture.store.stateDir, node?.taskId ?? "")
    expect(node?.state).toBe("running")
    expect(node?.lastActivityAt).toBe(new Date(fs.statSync(logPath).mtimeMs).toISOString())

    fixture.runner.child("only").settle({ status: "completed", finalResponse: "done" })
    await fixture.run
  })

  test("#given a running node whose child went quiet 30 minutes ago #when the snapshot is projected #then that silence is visible", async () => {
    const fixture = await startHeldRun(["only"])
    await fixture.whenNodeRunning("only")
    fixture.runner.child("only").emit(assistantMessage("last thing it ever said"))

    const taskId = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]?.taskId ?? ""
    const quietSince = new Date(Date.now() - 30 * 60_000)
    fs.utimesSync(taskEventLogPath(fixture.store.stateDir, taskId), quietSince, quietSince)

    const node = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]
    expect(node?.state).toBe("running")
    expect(node?.lastActivityAt).toBe(quietSince.toISOString())

    fixture.runner.child("only").settle({ status: "completed", finalResponse: "done" })
    await fixture.run
  })

  test("#given a stat fault on the transcript log #when the snapshot is projected #then it degrades to no clock instead of throwing", async () => {
    const fixture = await startHeldRun(["only"])
    await fixture.whenNodeRunning("only")
    const logsDir = join(fixture.store.stateDir, "logs")
    fs.rmSync(logsDir, { recursive: true, force: true })
    fs.writeFileSync(logsDir, "not a directory", "utf8")

    const node = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]
    expect(node?.state).toBe("running")
    expect(node?.lastActivityAt).toBeUndefined()

    fs.rmSync(logsDir, { force: true })
    fixture.runner.child("only").settle({ status: "completed", finalResponse: "done" })
    await fixture.run
  })

  test("#given a settled node #when the snapshot is projected #then lastActivityAt is absent because the clock only describes a live child", async () => {
    const fixture = await startHeldRun(["only"])
    await fixture.whenNodeRunning("only")
    fixture.runner.child("only").emit(assistantMessage("working"))
    fixture.runner.child("only").settle({ status: "completed", finalResponse: "done" })
    await fixture.run

    const node = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]
    expect(node?.state).toBe("completed")
    expect(node?.lastActivityAt).toBeUndefined()
  })
})
