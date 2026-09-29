import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// End-to-end through the real CLI with fake `herdr`, `agent-discordbot`, and `senpi` executables on
// PATH. The fakes are POSIX shell scripts and herdr itself is POSIX-only, hence the platform gate.
const cli = join(import.meta.dir, "..", "omomeow.mjs")

let root: string
let binDir: string
let tabsFile: string
let sentLog: string
let senpiLog: string

function run(args: string[], input?: string) {
  const env = {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    HOME: join(root, "home"),
    OMOMEOW_HOME: join(root, "state"),
    OMOMEOW_SENPI_BIN: join(binDir, "senpi"),
    FAKE_TABS: tabsFile,
    FAKE_SENT: sentLog,
    FAKE_SENPI: senpiLog,
  }
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: join(root, "home"), env, encoding: "utf8", input })
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? ""
  return { status: result.status, stderr: result.stderr, json: lastLine.startsWith("{") ? JSON.parse(lastLine) : null }
}

function setTabs(tabs: Array<[string, string, string]>) {
  writeFileSync(tabsFile, JSON.stringify({ result: { tabs: tabs.map(([tab_id, agent_status, label]) => ({ tab_id, agent_status, label, workspace_id: "w1" })) } }))
}

function sentMessages(): string[][] {
  if (!existsSync(sentLog)) return []
  return readFileSync(sentLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

function writeFake(name: string, body: string) {
  const path = join(binDir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omomeow-cli-"))
  binDir = join(root, "bin")
  mkdirSync(binDir)
  mkdirSync(join(root, "home"))
  tabsFile = join(root, "tabs.json")
  sentLog = join(root, "sent.jsonl")
  senpiLog = join(root, "senpi.jsonl")
  writeFake("herdr", `[ "$1 $2" = "tab list" ] && cat "$FAKE_TABS"`)
  writeFake("agent-discordbot", `${JSON.stringify(process.execPath)} -e 'require("fs").appendFileSync(process.env.FAKE_SENT, JSON.stringify(process.argv.slice(1)) + "\\n")' -- "$@"\necho '{"id":"m-1"}'`)
  writeFake("senpi", `${JSON.stringify(process.execPath)} -e 'require("fs").appendFileSync(process.env.FAKE_SENPI, JSON.stringify(process.argv.slice(1)) + "\\n")' -- "$@"`)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === "win32")("omomeow CLI", () => {
  test("#given an owner and a running task #when nudged twice #then one DM goes out and the unchanged repeat stays silent", () => {
    expect(run(["owner", "set", "--platform", "discordbot", "--target", "dm-1", "--bot", "meow"]).status).toBe(0)
    setTabs([["w1:t1", "working", "fix-login"], ["w1:t2", "idle", "old-tab"]])

    const first = run(["nudge"])
    const second = run(["nudge"])

    expect(first.json.sent).toEqual([{ recipient: "discordbot:meow:dm-1", items: 1, messageId: "m-1" }])
    expect(second.json.sent).toEqual([])
    expect(second.json.reason).toBe("unchanged")
    const messages = sentMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].slice(0, 5)).toEqual(["--bot", "meow", "message", "send", "dm-1"])
  })

  test("#given a mapped task reports progress #when nudged again #then a second DM goes out", () => {
    run(["owner", "set", "--platform", "discordbot", "--target", "dm-1"])
    setTabs([["w1:t1", "working", "fix-login"]])
    run(["session", "set", "w1:t1", "--title", "Fix login", "--thread", "https://chat/t/1"])
    run(["nudge"])

    run(["session", "progress", "w1:t1", "tests", "green"])
    const again = run(["nudge"])

    expect(again.json.sent).toHaveLength(1)
    expect(sentMessages()).toHaveLength(2)
  })

  test("#given nothing is working or blocked #when nudged #then nothing is sent", () => {
    run(["owner", "set", "--platform", "discordbot", "--target", "dm-1"])
    setTabs([["w1:t1", "idle", "a"], ["w1:t2", "done", "b"]])

    const result = run(["nudge"])

    expect(result.json.reason).toBe("nothing_running")
    expect(sentMessages()).toEqual([])
  })

  test("#given the nudge is disabled in omo.json #when nudged #then nothing is read or sent", () => {
    mkdirSync(join(root, "home", ".omo"))
    writeFileSync(join(root, "home", ".omo", "omo.jsonc"), `{ "omomeow": { "nudge": { "enabled": false } } }`)
    run(["owner", "set", "--platform", "discordbot", "--target", "dm-1"])
    setTabs([["w1:t1", "working", "a"]])

    expect(run(["nudge"]).json.reason).toBe("disabled")
    expect(sentMessages()).toEqual([])
  })

  test("#given a scheduled nudge job on stdin #when the hook runs #then it sends the nudge without resuming any session", () => {
    run(["owner", "set", "--platform", "discordbot", "--target", "dm-1"])
    setTabs([["w1:t1", "blocked", "needs-answer"]])
    const prompt = run(["nudge-prompt"]).json.prompt
    const job = { type: "scheduled_prompt", id: "sch_1", sessionId: "s", cwd: join(root, "home"), prompt, message: `[header]\n${prompt}`, fireCount: 1 }

    const result = run(["schedule-hook"], JSON.stringify(job))

    expect(result.status).toBe(0)
    expect(result.json).toMatchObject({ event: "nudge", job: "sch_1" })
    expect(sentMessages()).toHaveLength(1)
    expect(existsSync(senpiLog)).toBe(false)
    const logged = readFileSync(join(root, "state", "logs", "nudge.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(logged.map((line: { job: string; sent: unknown[] }) => [line.job, line.sent.length])).toEqual([["sch_1", 1]])
  })

  test("#given any other scheduled prompt #when the hook runs #then it resumes that session headlessly like default delivery", () => {
    const job = { type: "scheduled_prompt", id: "sch_2", sessionId: "s-2", sessionFile: "/x/s-2.jsonl", cwd: join(root, "home"), prompt: "remind me", message: "[Scheduled prompt sch_2]\nremind me" }

    const result = run(["schedule-hook"], JSON.stringify(job))

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(senpiLog, "utf8").trim())).toEqual(["-p", "--session", "/x/s-2.jsonl", "[Scheduled prompt sch_2]\nremind me"])
    expect(sentMessages()).toEqual([])
  })

  test("#given an old install and the new manifest #when reconciled through the CLI #then only the new feature is pending", () => {
    const oldManifest = join(root, "old-manifest.json")
    writeFileSync(oldManifest, JSON.stringify({ schemaVersion: 1, features: [{ id: "setup", version: 1, doc: "features/setup.md" }] }))
    expect(run(["reconcile", "--manifest", oldManifest]).json.install.map((entry: { id: string }) => entry.id)).toEqual(["setup"])
    expect(run(["record", "setup", "--manifest", oldManifest]).status).toBe(0)

    const plan = run(["reconcile"]).json

    expect(plan.install.map((entry: { id: string }) => entry.id)).toEqual(["nudge"])
    expect(plan.current).toEqual(["setup"])
  })

  test("#given a runner render #when inspected #then the service runs senpi schedule with the omomeow hook from the runtime copy", () => {
    const result = run(["runner", "render", "--senpi-bin", "/opt/bin/senpi", "--agent-dir", join(root, "agent")])

    expect(result.json.spec.programArgs.slice(0, 5)).toEqual(["/opt/bin/senpi", "schedule", "run", "--watch", "--exec"])
    expect(result.json.spec.programArgs[5]).toContain(join(root, "state", "runtime", "scripts", "omomeow.mjs"))
    expect(result.json.spec.programArgs[5].endsWith(" schedule-hook")).toBe(true)
    expect(result.json.spec.env.SENPI_CODING_AGENT_DIR).toBe(join(root, "agent"))
  })
})
