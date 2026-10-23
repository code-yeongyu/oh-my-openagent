import { describe, expect, test } from "bun:test"

import type { ProcessInfo } from "@oh-my-opencode/utils/process-sweep"

import { optsOut, processIsolationVerdict, processScope, scopeCommand, SCOPE_ENV } from "./runtime"

const OWN_SCOPE = "omo:mine"
const SCOPES: Readonly<Record<number, string>> = { 100: "omo:other", 101: OWN_SCOPE, 200: "omo:other" }

const PROCESS_TABLE: readonly ProcessInfo[] = [
  { pid: 100, ppid: 1, command: "npx playwright test --workers=3" },
  { pid: 101, ppid: 1, command: "node server.js" },
  { pid: 200, ppid: 1, command: "C:\\Windows\\notepad.exe" },
]

const readScope = async (pid: number): Promise<string | undefined> => SCOPES[pid]

function evaluate(command: string): Promise<string | undefined> {
  return processIsolationVerdict(command, OWN_SCOPE, {
    listProcesses: async () => PROCESS_TABLE,
    readScope,
  })
}

describe("processScope() / scopeCommand()", () => {
  test("#given a session id #when scoped #then the tag is stable and session-specific", () => {
    expect(processScope("session-a")).toBe("omo:session-a")
    expect(processScope("session-b")).not.toBe(processScope("session-a"))
  })

  test("#given a command #when scoped #then every descendant inherits the export", () => {
    expect(scopeCommand("npx playwright test", "omo:s")).toBe(`export ${SCOPE_ENV}='omo:s'\nnpx playwright test`)
  })
})

describe("optsOut()", () => {
  test("#given a leading assignment #when the value is off #then the command opts out", () => {
    expect(optsOut("OMO_PROCESS_ISOLATION=off pkill playwright")).toBe(true)
    expect(optsOut("export OMO_PROCESS_ISOLATION=off; pkill playwright")).toBe(true)
    expect(optsOut("FOO=1 OMO_PROCESS_ISOLATION=off kill 42")).toBe(true)
  })

  test("#given a mention in an argument #when inspected #then it cannot disable isolation", () => {
    expect(optsOut("echo OMO_PROCESS_ISOLATION=off")).toBe(false)
    expect(optsOut(`python -c "OMO_PROCESS_ISOLATION=off"`)).toBe(false)
    expect(optsOut("OMO_PROCESS_ISOLATION=on kill 42")).toBe(false)
  })
})

describe("processIsolationVerdict()", () => {
  test("#given a pid owned by another session #when killed #then the command is blocked", async () => {
    const reason = await evaluate("kill -9 100")

    expect(reason).toContain("pid 100")
    expect(reason).toContain("another OmO session")
    expect(reason).toContain("OMO_PROCESS_ISOLATION=off")
  })

  test("#given pids this session owns or nobody owns #when killed #then the command is allowed", async () => {
    expect(await evaluate("kill -9 101")).toBeUndefined()
    expect(await evaluate("kill -9 999")).toBeUndefined()
  })

  test("#given an existence probe #when inspected #then it is not a termination", async () => {
    expect(await evaluate("kill -0 100")).toBeUndefined()
    expect(await evaluate("kill -s 0 100")).toBeUndefined()
  })

  test("#given an all-process or group target #when inspected #then the command is blocked", async () => {
    expect(await evaluate("kill 1")).toContain("all-process")
    expect(await evaluate("kill -- -42")).toContain("all-process")
  })

  test("#given the command's own process group #when signalled #then it is allowed", async () => {
    expect(await evaluate("kill -9 0")).toBeUndefined()
  })

  test("#given a pattern that reaches another session #when pkill runs #then the whole command is blocked", async () => {
    expect(await evaluate("pkill -f playwright")).toContain("pid 100")
  })

  test("#given a pattern only this session owns #when pkill runs #then the command is allowed", async () => {
    expect(await evaluate("pkill -f server.js")).toBeUndefined()
  })

  test("#given pkill without -f #when the pattern matches only the full command line #then nothing matches", async () => {
    expect(await evaluate("pkill playwright")).toBeUndefined()
  })

  test("#given killall by name #when another session owns the process #then the command is blocked", async () => {
    expect(await evaluate("killall npx")).toContain("pid 100")
  })

  test("#given wrappers and redirections #when parsed #then the real target is still found", async () => {
    expect(await evaluate("sudo kill -9 100")).toContain("pid 100")
    expect(await evaluate("kill -9 100 > /dev/null 2>&1")).toContain("pid 100")
  })

  test("#given a quoted mention or an unsupported filter #when inspected #then the command is allowed", async () => {
    expect(await evaluate(`echo "kill -9 100"`)).toBeUndefined()
    expect(await evaluate("pkill -P 42 node")).toBeUndefined()
    expect(await evaluate("npm test")).toBeUndefined()
  })

  test("#given the process table is unavailable #when a pattern runs #then the guard fails open", async () => {
    const reason = await processIsolationVerdict("pkill -f playwright", OWN_SCOPE, {
      listProcesses: async () => {
        throw new Error("ps failed")
      },
      readScope,
    })
    expect(reason).toBeUndefined()
  })

  test("#given a scope read fails #when a pid is killed #then the guard fails open", async () => {
    const reason = await processIsolationVerdict("kill -9 100", OWN_SCOPE, {
      readScope: async () => {
        throw new Error("permission denied")
      },
    })
    expect(reason).toBeUndefined()
  })
})
