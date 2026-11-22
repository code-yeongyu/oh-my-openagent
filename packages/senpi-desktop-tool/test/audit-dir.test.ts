// O13 (brain/hand split): on a hand the call runs in an execution scope with no transcript and no model, so
// the audit file, the session id on audit records and the capture policy come from that scope. Fused
// sessions are pinned by audit-dir.characterization.test.ts (X17).
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service"
import { afterEach, describe, expect, it } from "vitest"
import type { ComputerHandle } from "../src/activation"
import {
  AUDIT_FILE_NAME,
  type ComputerExecutionScope,
  type ComputerHostContext,
  type ComputerModel,
  runSnapshot,
} from "../src/session"
import { resolveComputerSettings } from "../src/settings"
import { createComputerTool } from "../src/tool"
import { closeDesktops, desktopFixture } from "./fixtures"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }

afterEach(closeDesktops)

const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"))

function toolFor(handle: ComputerHandle) {
  return createComputerTool({ handle, executeTool: noTools })
}

function scope(sessionId: string, coordinateSafe = true): ComputerExecutionScope {
  return {
    sessionId,
    auditDir: join("/runtime/audit", sessionId),
    capture: {
      coordinateSafe,
      maxWidth: 1280,
      maxHeight: 800,
      maxBytes: 400_000,
      screenshotGc: { staleMs: 120_000, scanIntervalMs: 10_000 },
    },
  }
}

/** A hand's context: its session manager and model belong to no transcript, so reading either fails the test. */
function handContext(executionScope: ComputerExecutionScope, model?: ComputerModel): ComputerHostContext {
  return {
    cwd: "/work/scope-root",
    get model(): ComputerModel | undefined {
      if (model === undefined) throw new Error("a hand has no model of its own")
      return model
    },
    sessionManager: {
      getSessionId: () => {
        throw new Error("a hand has no session")
      },
      getSessionDir: () => {
        throw new Error("a hand has no session directory")
      },
    },
    executionScope,
  }
}

function openParams(log: ReturnType<typeof desktopFixture>["log"]) {
  return log.requests
    .filter((request) => request.method === "session.open")
    .map((request) => {
      const { auditPath, artifactDir, screenshotGc, captureCaps } = request.params as Record<string, unknown>
      return { auditPath, artifactDir, screenshotGc, captureCaps }
    })
}

const clickOnce = `const w = await desktop.window({ app: "Code" }); await w.screenshot({ silent: true }); await w.click(1, 1);`

describe("O13: computer-use audit and capture from a hand's execution scope", HANG_GUARD, () => {
  it("#given a hand scope #when the tool activates #then the audit file is in the scope's audit directory, artifacts stay in the OS tmpdir, and capture follows the scope's policy", async () => {
    // Given
    const { handle, log } = desktopFixture()

    // When
    await toolFor(handle).execute(
      "call-1",
      { action: "capabilities" },
      undefined,
      undefined,
      handContext(scope("owner-a")),
    )

    // Then
    expect(openParams(log)).toEqual([
      {
        auditPath: join("/runtime/audit/owner-a", AUDIT_FILE_NAME),
        artifactDir: tmpdir(),
        screenshotGc: { staleMs: 120_000, scanIntervalMs: 10_000 },
        captureCaps: { maxWidth: 1280, maxHeight: 800, coordinateSafe: true, maxBytes: 400_000 },
      },
    ])
  })

  it("#given a hand context whose own model would choose differently #when the tool activates #then coordinate-safe sizing is the policy's, not the model's", async () => {
    // Given
    const { handle, log } = desktopFixture()
    const claude: ComputerModel = { id: "claude-x", provider: "anthropic", api: "anthropic-messages" }

    // When
    await toolFor(handle).execute(
      "call-1",
      { action: "capabilities" },
      undefined,
      undefined,
      handContext(scope("owner-a", false), claude),
    )

    // Then
    expect(openParams(log).map((params) => params.captureCaps)).toEqual([
      { maxWidth: 1280, maxHeight: 800, coordinateSafe: false, maxBytes: 400_000 },
    ])
  })

  it("#given auditing is off #when a hand scope activates #then no audit path is sent", async () => {
    // Given
    const { handle, log } = desktopFixture({ auditLog: { enabled: false } })

    // When
    await toolFor(handle).execute(
      "call-1",
      { action: "capabilities" },
      undefined,
      undefined,
      handContext(scope("owner-a")),
    )

    // Then
    expect(openParams(log).map((params) => params.auditPath)).toEqual([null])
  })

  it("#given a run on a hand scope #when it clicks #then its audit record carries the calling session's id and a run id", async () => {
    // Given
    const { handle } = desktopFixture()

    // When
    const result = await toolFor(handle).execute(
      "run-1",
      { action: "run", code: clickOnce },
      undefined,
      undefined,
      handContext(scope("owner-a")),
    )

    // Then
    const audit = result.details.audit ?? []
    expect(audit.map((record) => record.sessionId)).toEqual(["owner-a"])
    expect(audit[0]?.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("MULTI #given two scopes of different owners on one hand #when each runs #then each gets its own audit file and its own session id on its records", async () => {
    // Given
    const { handle, log } = desktopFixture()
    const tool = toolFor(handle)

    // When
    const a = await tool.execute(
      "run-a",
      { action: "run", code: clickOnce },
      undefined,
      undefined,
      handContext(scope("owner-a")),
    )
    const b = await tool.execute(
      "run-b",
      { action: "run", code: clickOnce },
      undefined,
      undefined,
      handContext(scope("owner-b")),
    )

    // Then
    expect(openParams(log).map((params) => params.auditPath)).toEqual([
      join("/runtime/audit/owner-a", AUDIT_FILE_NAME),
      join("/runtime/audit/owner-b", AUDIT_FILE_NAME),
    ])
    expect([a, b].map((result) => (result.details.audit ?? []).map((record) => record.sessionId))).toEqual([
      ["owner-a"],
      ["owner-b"],
    ])
  })

  it("#given a hand scope #when a run snapshot is taken #then the session id and capture caps come from the scope", () => {
    // Given
    const settings = resolveComputerSettings({ maxWidth: 1024, maxHeight: 768, screenshotMaxBytes: 99 }, "linux")

    // When
    const snapshot = runSnapshot(settings, handContext(scope("owner-a")), false)

    // Then
    expect(snapshot).toMatchObject({
      cwd: "/work/scope-root",
      sessionId: "owner-a",
      captureMaxWidth: 1280,
      captureMaxHeight: 800,
      captureMaxBytes: 400_000,
    })
  })
})
