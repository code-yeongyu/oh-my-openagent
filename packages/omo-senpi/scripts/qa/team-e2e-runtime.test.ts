import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import { evaluateCrashRecovery, hasCrashLivenessEvent, runCrashRestartScenario } from "./team-e2e-crash.mjs"
import { createOutDir, resolveSenpi, TEAM_E2E_OMO_CONFIG } from "./team-e2e.mjs"
import * as runtime from "./team-e2e-runtime.mjs"

describe("team e2e output paths", () => {
  it("#given a configured relative output path #when the capture directory is created #then it is absolute", () => {
    // given
    const configured = join(".omo", "evidence", "relative-team-e2e")

    // when
    const output = createOutDir(configured)

    // then
    expect(output).toEqual({ outDir: resolve(configured), cleanup: false })
    expect(isAbsolute(output.outDir)).toBe(true)
  })
})

describe("team e2e Senpi discovery", () => {
  it("#given native and npm Windows candidates #when discovering Senpi #then the native executable wins", () => {
    const executable = "C:\\native\\senpi.exe"

    const resolved = resolveSenpi({
      platform: "win32",
      env: { PATH: "C:\\native;C:\\npm" },
      existsSync: (path: string) => path === executable || path === "C:\\npm\\senpi.cmd",
    })

    expect(resolved).toBe(executable)
  })

  it("#given only a Windows npm shim and a backslash absolute override #when discovering Senpi #then both paths are supported", () => {
    const shim = "C:\\npm\\senpi.cmd"
    const absolute = "C:\\Tools\\Senpi\\senpi.exe"

    expect(resolveSenpi({
      platform: "win32",
      env: { PATH: "C:\\npm" },
      existsSync: (path: string) => path === shim,
    })).toBe(shim)
    expect(resolveSenpi({
      platform: "win32",
      env: { SENPI_BIN: absolute, PATH: "" },
      existsSync: (path: string) => path === absolute,
    })).toBe(absolute)
  })
})

describe("team e2e crash recovery config", () => {
  it("#given the restart-liveness scenario #when its OmO config is seeded #then dead prior members are marked lost instead of reattached", () => {
    expect(TEAM_E2E_OMO_CONFIG.task?.reattach_on_reconcile).toBe(false)
  })
})

describe("team e2e crash recovery evidence", () => {
  it("#given both processes were live and ordered termination completed #when crash recovery is evaluated #then the kill and exact-mailbox contract pass", () => {
    const checks = evaluateCrashRecovery({
      target: { ready: true },
      parentAliveAtHold: true,
      memberAliveAtHold: true,
      before: { reservedExists: true, processedExists: false, eventCount: 0 },
      memberKilled: true,
      memberTerminal: { kind: "exit" },
      parentAliveBeforeTermination: true,
      parentTermination: { kind: "terminated", pid: 5151, platform: "win32" },
      reservationAged: true,
      afterReclaim: { reservedExists: false, unreadExists: true },
      afterReplacement: { reservedExists: false, unreadExists: false, processedExists: true, eventCount: 1, envelopeCount: 1 },
      initialStatus: null,
      restartStatus: 0,
      livenessInjected: true,
      afterRestartRecord: { notification: { run_epoch: 0, liveness_notified_epoch: 0 } },
    })

    expect(Object.values(checks).every(Boolean)).toBe(true)
  })

  it("#given the parent already exited before the ordered tree kill #when crash recovery is evaluated #then the kill-at-hold check fails", () => {
    const checks = evaluateCrashRecovery({
      target: { ready: true },
      parentAliveAtHold: true,
      memberAliveAtHold: true,
      before: { reservedExists: true, processedExists: false, eventCount: 0 },
      memberKilled: true,
      memberTerminal: { kind: "exit" },
      parentAliveBeforeTermination: false,
      parentTermination: { kind: "already-exited", pid: 5151, platform: "win32" },
      initialStatus: 1,
      afterReclaim: {},
      afterReplacement: {},
    })

    expect(checks.crashKilledMemberAtHold).toBe(false)
  })

  it("#given parent tree termination failed #when crash recovery is evaluated #then the kill-at-hold check fails", () => {
    const checks = evaluateCrashRecovery({
      target: { ready: true },
      parentAliveAtHold: true,
      memberAliveAtHold: true,
      before: { reservedExists: true, processedExists: false, eventCount: 0 },
      memberKilled: true,
      memberTerminal: { kind: "exit" },
      parentAliveBeforeTermination: true,
      parentTermination: { kind: "failed", pid: 5151, platform: "win32", status: 1, error: "still alive" },
      initialStatus: 1,
      restartStatus: 0,
      livenessInjected: true,
      afterRestartRecord: { notification: { run_epoch: 0 } },
      afterReclaim: {},
      afterReplacement: {},
    })

    expect(checks.crashKilledMemberAtHold).toBe(false)
    expect(checks.crashLivenessAcknowledged).toBe(false)
  })
})

describe("runCrashRestartScenario orchestration", () => {
  it("#given controlled process and mailbox seams #when the scenario runs #then member exit precedes a terminated parent and the exact reservation is delivered once", async () => {
    const root = mkdtempSync(join(tmpdir(), "team-crash-scenario-"))
    const sandboxRoot = join(root, "sandbox")
    const cwd = join(sandboxRoot, "project")
    const outDir = join(root, "out")
    mkdirSync(cwd, { recursive: true })
    mkdirSync(outDir, { recursive: true })
    const target = {
      ready: true,
      markerPath: join(outDir, "marker.json"),
      messageId: "22222222-2222-4222-8222-222222222222",
      runId: "11111111-1111-4111-8111-111111111111",
      taskId: "st_00000009",
      pid: 202,
      leadSessionId: "lead-session",
    }
    const order: string[] = []
    let postRead = 0
    let startCount = 0
    try {
      const checks = await runCrashRestartScenario({
        senpiBin: "/fake/senpi",
        outDir,
        memberExtensionEntry: "/fake/omo-member.js",
        createSandbox: () => ({ root: sandboxRoot, cwd, agentDir: join(sandboxRoot, "agent"), xdgConfigHome: join(sandboxRoot, "xdg") }),
        seedProject: () => undefined,
        startRun: () => {
          startCount += 1
          if (startCount === 1) {
            return { pid: 101, kill: () => undefined, completion: Promise.resolve({ status: null, stdout: "", stderr: "", events: [] }) }
          }
          if (startCount === 2) {
            const stdout = JSON.stringify({
              type: "message_end",
              message: { customType: "senpi-task.team-member-liveness", details: { memberName: "crash", lastKnownState: "lost" } },
            })
            return { pid: 301, kill: () => undefined, completion: Promise.resolve({ status: 0, stdout, stderr: "", events: [] }) }
          }
          return { pid: 401, kill: () => { order.push("replacement-killed") }, completion: Promise.resolve({ status: null, stdout: "", stderr: "", events: [] }) }
        },
        operations: {
          pollUntil: async (readValue: () => Promise<unknown>) => readValue(),
          readCrashTarget: () => target,
          readCrashReservationState: () => ({ reservedExists: true, processedExists: false, eventCount: 0 }),
          isProcessAlive: () => true,
          killProcess: () => { order.push("member-killed"); return true },
          readMemberTerminal: () => { order.push("member-terminal"); return { kind: "exit" } },
          terminateProcessTree: () => { order.push("parent-terminated"); return { kind: "terminated", pid: 101, platform: "linux" } },
          ageCrashReservation: () => true,
          taskRecord: () => ({ notification: { run_epoch: 0, liveness_notified_epoch: 0 } }),
          readPostCrashMailbox: () => {
            postRead += 1
            return postRead === 1
              ? { reservedExists: false, unreadExists: true, processedExists: false, eventCount: 0, envelopeCount: 0 }
              : { reservedExists: false, unreadExists: false, processedExists: true, eventCount: 1, envelopeCount: 1 }
          },
        },
      })

      expect(order.slice(0, 3)).toEqual(["member-killed", "member-terminal", "parent-terminated"])
      expect(order.at(-1)).toBe("replacement-killed")
      expect(Object.values(checks).every(Boolean)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("team e2e crash liveness detector", () => {
  it("#given a structured crash liveness wake with error state #when detected #then the valid abnormal terminal event passes", () => {
    const stdout = JSON.stringify({
      type: "message_end",
      message: {
        customType: "omo-senpi:wake",
        content: "Team member liveness: crash exited abnormally; last known state: error.",
        details: [{
          customType: "senpi-task.team-member-liveness",
          details: { memberName: "crash", lastKnownState: "error" },
        }],
      },
    })

    expect(hasCrashLivenessEvent(stdout)).toBe(true)
  })

  it("#given liveness-like details inside an unrelated event #when detected #then the gate rejects the false positive", () => {
    const stdout = JSON.stringify({
      type: "tool_execution_end",
      message: {
        role: "assistant",
        customType: "note",
        details: [{
          customType: "senpi-task.team-member-liveness",
          details: { memberName: "crash", lastKnownState: "error" },
        }],
      },
    })

    expect(hasCrashLivenessEvent(stdout)).toBe(false)
  })

  it("#given only matching prose without structured liveness details #when detected #then it cannot satisfy the gate", () => {
    const stdout = JSON.stringify({
      type: "message_end",
      message: { customType: "note", content: "Team member liveness: crash exited abnormally; last known state: lost." },
    })

    expect(hasCrashLivenessEvent(stdout)).toBe(false)
  })
})

describe("team e2e process cleanup", () => {
  it("#given a Windows npm senpi shim #when the spawn invocation is resolved #then Node launches the package CLI without cmd shell forwarding", () => {
    // given
    const shim = "C:\\Users\\qa\\AppData\\Roaming\\npm\\senpi"
    const cli = "C:\\Users\\qa\\AppData\\Roaming\\npm\\node_modules\\@code-yeongyu\\senpi\\dist\\cli.js"

    // when
    const invocation = runtime.resolveSenpiInvocation(shim, {
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      existsSync: (path: string) => path === cli,
    })

    // then
    expect(invocation).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      prefixArgs: [cli],
    })
  })

  it("#given a project-local Windows .bin shim #when resolved on POSIX #then win32 path semantics find the adjacent package CLI", () => {
    const shim = "C:\\repo\\node_modules\\.bin\\senpi.cmd"
    const cli = "C:\\repo\\node_modules\\@code-yeongyu\\senpi\\dist\\cli.js"

    expect(runtime.resolveSenpiInvocation(shim, {
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      existsSync: (path: string) => path === cli,
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      prefixArgs: [cli],
    })
  })

  it("#given a Windows shim with no package CLI #when resolved #then the harness fails loudly instead of direct-spawning the shim", () => {
    expect(() => runtime.resolveSenpiInvocation("C:\\npm\\senpi.cmd", {
      platform: "win32",
      existsSync: () => false,
    })).toThrow("cannot be mapped to the package CLI")
  })

  it("#given a native Windows senpi executable with mixed-case extension #when resolved #then the executable is preserved verbatim", () => {
    const executable = "C:\\Program Files\\Senpi\\senpi.EXE"

    const invocation = runtime.resolveSenpiInvocation(executable, {
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      existsSync: () => true,
    })

    expect(invocation).toEqual({ command: executable, prefixArgs: [] })
  })

  it("#given invalid root pids #when process-tree termination is requested #then every platform fails closed without side effects", async () => {
    // given
    const invalidPids = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]
    const probes: number[] = []
    const windowsCalls: number[] = []
    const posixCalls: number[] = []

    // when / then
    for (const pid of invalidPids) {
      expect(await runtime.terminateProcessTree(pid, {
        platform: "win32",
        isProcessAlive: (candidate: number) => {
          probes.push(candidate)
          return true
        },
        spawnSync: () => {
          windowsCalls.push(pid)
          return { status: 0, stdout: "SUCCESS", stderr: "" }
        },
      })).toEqual({
        kind: "failed",
        pid,
        platform: "win32",
        status: null,
        error: "pid must be a positive safe integer",
      })
      expect(await runtime.terminateProcessTree(pid, {
        platform: "linux",
        isProcessAlive: (candidate: number) => {
          probes.push(candidate)
          return true
        },
        processKill: () => { posixCalls.push(pid) },
      })).toEqual({
        kind: "failed",
        pid,
        platform: "linux",
        status: null,
        error: "pid must be a positive safe integer",
      })
    }
    expect(probes).toEqual([])
    expect(windowsCalls).toEqual([])
    expect(posixCalls).toEqual([])
  })

  it("#given a live Windows QA root pid #when its process tree is terminated #then taskkill targets only that pid tree and returns structured evidence", async () => {
    // given
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const aliveReads = [true, false]

    // when
    const result = await runtime.terminateProcessTree(4242, {
      platform: "win32",
      isProcessAlive: () => aliveReads.shift() ?? false,
      spawnSync: (command: string, args: readonly string[]) => {
        calls.push({ command, args })
        return { status: 0, stdout: "SUCCESS", stderr: "" }
      },
    })

    // then
    expect(calls).toEqual([{
      command: "taskkill.exe",
      args: ["/PID", "4242", "/T", "/F"],
    }])
    expect(result).toEqual({ kind: "terminated", pid: 4242, platform: "win32" })
  })

  it("#given taskkill returns nonzero after the root disappears #when termination is evaluated #then status and stderr remain a failure", async () => {
    const aliveReads = [true, false]
    const result = await runtime.terminateProcessTree(4242, {
      platform: "win32",
      isProcessAlive: () => aliveReads.shift() ?? false,
      spawnSync: () => ({ status: 1, stdout: "", stderr: "partial tree kill" }),
    })

    expect(result).toEqual({
      kind: "failed",
      pid: 4242,
      platform: "win32",
      status: 1,
      error: "partial tree kill",
    })
  })

  it("#given a POSIX group is briefly alive after SIGKILL #when survivor polling observes it die #then termination succeeds", async () => {
    const aliveReads = [true, true, false]
    const pauses: number[] = []
    const signals: Array<[number, string]> = []

    const result = await runtime.terminateProcessTree(5151, {
      platform: "linux",
      isProcessAlive: () => aliveReads.shift() ?? false,
      processKill: (pid: number, signal: string) => { signals.push([pid, signal]) },
      pause: (ms: number) => { pauses.push(ms) },
      pollAttempts: 3,
    })

    expect(signals).toEqual([[-5151, "SIGKILL"]])
    expect(pauses).toEqual([10])
    expect(result).toEqual({ kind: "terminated", pid: 5151, platform: "linux" })
  })

  it("#given a Windows QA root pid #when the legacy group-kill seam is called #then it delegates to exact tree termination", async () => {
    // given
    const calls: number[] = []

    // when
    const killed = await runtime.killProcessGroup(5151, {
      terminateProcessTree: (pid: number) => {
        calls.push(pid)
        return { kind: "terminated", pid, platform: "win32" }
      },
    })

    // then
    expect(killed).toBe(true)
    expect(calls).toEqual([5151])
  })

  it("#given Windows QA root pids #when cleanup runs #then it terminates each exact tree and counts failed trees as leaks", async () => {
    // given
    const calls: number[] = []
    const outcomes = new Map([
      [100, { kind: "already-exited", pid: 100, platform: "win32" }],
      [200, { kind: "terminated", pid: 200, platform: "win32" }],
      [300, { kind: "failed", pid: 300, platform: "win32", status: 1, error: "still alive" }],
    ])

    // when
    const leaked = await runtime.cleanupProcessGroups([100, 200, 300], {
      platform: "win32",
      terminateProcessTree: (pid: number) => {
        calls.push(pid)
        return outcomes.get(pid)
      },
    })

    // then
    expect(calls).toEqual([100, 200, 300])
    expect(leaked).toBe(1)
  })

  it("#given an owned child has emitted close #when cleanup runs #then its recycled numeric pid is never terminated", async () => {
    const registry = runtime.createOwnedProcessRegistry()
    const terminated: number[] = []
    registry.onSpawn(8080)
    registry.onClose(8080)

    const leaked = await registry.cleanup({
      platform: "win32",
      terminateProcessTree: (pid: number) => {
        terminated.push(pid)
        return { kind: "terminated", pid, platform: "win32" }
      },
    })

    expect(terminated).toEqual([])
    expect(leaked).toBe(0)
  })

  it("#given completed and live process groups #when cleanup runs #then it skips empty groups and kills concrete survivors", async () => {
    // given
    const killed: number[] = []
    const reads = new Map<number, number>([[200, 0]])
    const listGroupPids = (groupId: number): readonly number[] => {
      if (groupId === 100) return []
      const count = reads.get(groupId) ?? 0
      reads.set(groupId, count + 1)
      return count === 0 ? [201, 202] : []
    }

    // when
    const leaked = await runtime.cleanupProcessGroups([100, 200], {
      platform: "linux",
      listGroupPids,
      killProcess: (pid: number) => {
        killed.push(pid)
        return true
      },
    })

    // then
    expect(killed).toEqual([201, 202])
    expect(leaked).toBe(0)
  })
})
