import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { buildSenpiArgs, runCompiledLauncher, shouldPrintCompiledBanner } from "../compile-entry"
import { INTERNAL_SUPERVISOR_FLAG, isInternalSupervisorLaunch } from "../supervisor-fast-path"

/**
 * The compiled binary's `omo daemon adopt`: the released session becomes this process's own launch
 * (argv rewritten, cwd moved to the session's directory), and the user's queued messages replayed
 * after `--` stay messages - none of the launch-time argv scans may read one as a flag.
 */

const roots: string[] = []
const temp = () => {
  const root = realpathSync(mkdtempSync(join(homedir(), "omo-compile-adopt-test-")))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function releasingSdk(cwd: string, userMessages: readonly string[]) {
  return {
    locate: async () => ({
      kind: "ok",
      thread: { thread_id: "dur-host", title: "host lane", cwd, status: "live", session_path: "/sessions/dur-host.jsonl", endpoint: { kind: "rpc_host", socket: "/agent/rpc/shards/i-0123456789abcdef.sock", routing_id: "rpc-1" }, surface: "desktop", alive: true },
    }),
    release: async () => ({ success: true, data: { released: true, session_path: "/sessions/dur-host.jsonl", attachments: 0, dropped: { deliveries: [], user_messages: userMessages } } }),
    dispose: async () => undefined,
  }
}

describe("compiled omo daemon adopt", () => {
  test("#given queued messages that read as launcher flags #when adopted #then the session resumes in its own directory with the plugin, and they stay messages", async () => {
    // given
    const execDir = temp()
    const sessionCwd = temp()
    writeFileSync(join(execDir, "package.json"), JSON.stringify({ version: "1.2.3-test.0" }))
    const sdk = releasingSdk(sessionCwd, ["--no-extensions", "   ", INTERNAL_SUPERVISOR_FLAG, "--mode", "rpc"])
    const savedArgv = [...process.argv]
    const savedCwd = process.cwd()
    try {
      // when
      const handled = await runCompiledLauncher(["daemon", "adopt", "dur-host"], execDir, "2026.9.29", undefined, {}, { threadSdk: async () => ({ sdk }) })
      const launch = process.argv.slice(2)
      const cwd = process.cwd()
      // then
      expect(handled).toBe(false)
      expect(launch).toEqual(["--session", "/sessions/dur-host.jsonl", "--", "--no-extensions", INTERNAL_SUPERVISOR_FLAG, "--mode", "rpc"])
      expect(realpathSync(cwd)).toBe(sessionCwd)
      expect(buildSenpiArgs(launch, execDir)).toEqual(["--extension", join(execDir, "plugin"), ...launch])
      expect(shouldPrintCompiledBanner(launch, true)).toBe(true)
      expect(isInternalSupervisorLaunch(launch)).toBe(false)
    } finally {
      process.argv.splice(0, process.argv.length, ...savedArgv)
      process.chdir(savedCwd)
    }
  })

  test("#given the launch's own flags before -- #when scanned #then they still decide the extension list, the banner and the supervisor route", () => {
    expect(buildSenpiArgs(["--no-extensions", "--", "hi"], "/provisioned")).toEqual(["--no-extensions", "--", "hi"])
    expect(buildSenpiArgs(["app-server", "--no-extensions", "--", "x"], "/provisioned")).toEqual(["app-server", "--no-extensions", "--", "x"])
    expect(buildSenpiArgs(["app-server", "daemon", "--", "--no-extensions"], "/provisioned")).toEqual(["app-server", "daemon", "--", "--no-extensions", "--extension", join("/provisioned", "plugin")])
    expect(shouldPrintCompiledBanner(["--mode", "rpc", "--", "hi"], true)).toBe(false)
    expect(isInternalSupervisorLaunch(["--extension", "/p", INTERNAL_SUPERVISOR_FLAG, "--", "hi"])).toBe(true)
  })
})
