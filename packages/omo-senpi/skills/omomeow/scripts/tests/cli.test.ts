import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// End-to-end through the real CLI with fake `herdr`, `agent-discordbot`, and service-manager executables on
// PATH. The fakes are POSIX shell scripts and herdr itself is POSIX-only, hence the platform gate.
const cli = join(import.meta.dir, "..", "omomeow.mjs")

let root: string
let binDir: string
let tabsFile: string
let sentLog: string

function run(args: string[], input?: string, path = `${binDir}:${process.env.PATH ?? ""}`) {
  const env = {
    PATH: path,
    HOME: join(root, "home"),
    OMOMEOW_HOME: join(root, "state"),
    FAKE_TABS: tabsFile,
    FAKE_SENT: sentLog,
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
  writeFake("herdr", `[ "$1 $2" = "tab list" ] && cat "$FAKE_TABS"`)
  writeFake("agent-discordbot", `${JSON.stringify(process.execPath)} -e 'require("fs").appendFileSync(process.env.FAKE_SENT, JSON.stringify(process.argv.slice(1)) + "\\n")' -- "$@"\necho '{"id":"m-1"}'`)
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

  test("#given a scheduled run #when the timer fires the nudge #then it sends and leaves one log line per run", () => {
    run(["owner", "set", "--platform", "discordbot", "--target", "dm-1"])
    setTabs([["w1:t1", "blocked", "needs-answer"]])

    const first = run(["nudge", "--scheduled"])
    const second = run(["nudge", "--scheduled"])

    expect([first.status, second.status]).toEqual([0, 0])
    expect(sentMessages()).toHaveLength(1)
    const logged = readFileSync(join(root, "state", "logs", "nudge.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(logged.map((line: { sent: unknown[]; reason: string | null }) => [line.sent.length, line.reason])).toEqual([[1, null], [0, "unchanged"]])
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

  test("#given Herdr and a bot CLI on PATH but no state #when reconciled #then setup is new and reported as adoptable", () => {
    const adoptable = run(["reconcile"], undefined, binDir).json.install.find((entry: { id: string }) => entry.id === "setup")
    const emptyBin = join(root, "empty-bin")
    mkdirSync(emptyBin)
    const bare = run(["reconcile"], undefined, emptyBin).json.install.find((entry: { id: string }) => entry.id === "setup")

    expect(adoptable.existing).toEqual({ herdr: true, bots: ["discordbot"], adoptable: true })
    expect(bare.existing).toEqual({ herdr: false, bots: [], adoptable: false })
  })

  test("#given a service render #when inspected #then the timer runs nudge --scheduled from the runtime copy at the configured interval", () => {
    mkdirSync(join(root, "home", ".omo"))
    writeFileSync(join(root, "home", ".omo", "omo.json"), JSON.stringify({ omomeow: { nudge: { interval_minutes: 5 } } }))

    const result = run(["service", "render"])

    expect(result.status).toBe(0)
    expect(result.json.spec.programArgs.slice(1)).toEqual([join(root, "state", "runtime", "scripts", "omomeow.mjs"), "nudge", "--scheduled"])
    expect(result.json.spec.intervalSeconds).toBe(300)
    expect(existsSync(join(root, "state", "runtime", "scripts", "omomeow.mjs"))).toBe(true)
    expect(existsSync(join(root, "state", "runtime", "scripts", "tests"))).toBe(false)
  })

  test("#given the service manager cannot stop the timer #when uninstalled #then the CLI fails and keeps the service file", () => {
    const manager = process.platform === "darwin" ? "launchctl" : "systemctl"
    writeFake(manager, "exit 0")
    expect(run(["service", "install"]).status).toBe(0)
    if (manager === "launchctl") writeFake(manager, `[ "$1" = "bootout" ] && { echo "Boot-out failed: 5" >&2; exit 5; }\nexit 0`)
    else writeFake(manager, `case "$*" in *disable*) echo "Failed to connect to bus" >&2; exit 1;; esac\nexit 0`)

    const result = run(["service", "uninstall"])

    expect(result.status).toBe(1)
    expect(result.json.ok).toBe(false)
    expect(result.json.kept.length).toBeGreaterThan(0)
    for (const path of result.json.kept) expect(existsSync(path)).toBe(true)
  })
})
