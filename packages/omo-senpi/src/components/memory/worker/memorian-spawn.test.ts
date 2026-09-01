import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadMemorianPersona, type RecallCandidate } from "@oh-my-opencode/memory-core"

import { rmEfaultTolerant } from "../teardown.test-support"
import { MEMORIAN_NUDGE_EXTENSION_FILENAME, MEMORIAN_NUDGE_EXTENSION_SOURCE } from "./memorian-nudge-extension"
import { prepareMemorianSpawn } from "./spawn"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

async function root(): Promise<string> {
  const path = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memorian-spawn-")))
  roots.push(path)
  return path
}

const CANDIDATES: readonly RecallCandidate[] = [
  { path: "reference/kubernetes-rollouts.md", description: "Rollout policy", excerpt: "drain first", score: 1 },
]

async function prepare(overrides: Partial<Parameters<typeof prepareMemorianSpawn>[0]> = {}) {
  const runDir = join(await root(), "run-1")
  return prepareMemorianSpawn({
    runDir,
    candidates: CANDIDATES,
    surfaced: ["notes/old.md"],
    maxItems: 2,
    transcript: [
      { role: "user", text: "how do we handle kubernetes rollouts here" },
      { role: "assistant", text: "let me check the deployment" },
    ],
    model: "omo-mock/mock-1",
    env: {},
    senpiCommand: "/bin/senpi",
    ...overrides,
  })
}

describe("prepareMemorianSpawn argv", () => {
  test("#given a prepared gate spawn #when the argv is read #then discovery stays off while the nudge extension loads explicitly", async () => {
    // given / when
    const prepared = await prepare()

    // then: --no-extensions suppresses DISCOVERY only; an explicit -e still loads
    expect(prepared.args).toContain("--no-extensions")
    const extensionIndex = prepared.args.indexOf("-e")
    expect(extensionIndex).toBeGreaterThan(-1)
    expect(prepared.args[extensionIndex + 1]).toBe(join(prepared.paths.runDir, MEMORIAN_NUDGE_EXTENSION_FILENAME))
  })

  test("#given a prepared gate spawn #when the tools allowlist is read #then it admits the extension tool alongside read", async () => {
    // given / when
    const prepared = await prepare()

    // then: --tools filters extension-registered tools too, so nudge must be listed
    const toolsIndex = prepared.args.indexOf("--tools")
    expect(toolsIndex).toBeGreaterThan(-1)
    const toolsValue = prepared.args[toolsIndex + 1] ?? ""
    expect(toolsValue.split(",")).toContain("nudge")
    expect(toolsValue.split(",")).toContain("read")
  })

  test("#given a prepared gate spawn #when the full argv is compared #then it equals the canonical child command line", async () => {
    // given / when
    const prepared = await prepare()

    // then
    expect(prepared.command).toBe("/bin/senpi")
    expect(prepared.args).toEqual([
      "-p",
      "--system-prompt", join(prepared.paths.runDir, "memorian-persona.md"),
      "--tools", "nudge,read",
      "-e", join(prepared.paths.runDir, MEMORIAN_NUDGE_EXTENSION_FILENAME),
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--session-dir", prepared.paths.runDir,
      "--model", "omo-mock/mock-1",
      `Read ${prepared.paths.candidates} and ${prepared.paths.transcript}, then follow the system prompt.`,
    ])
  })

  test("#given an injected senpi prefix #when the spawn is prepared #then the prefix leads the argv", async () => {
    // given / when
    const prepared = await prepare({ senpiCommand: "/usr/bin/node", senpiPrefixArgs: ["/cli.js"] })

    // then
    expect(prepared.command).toBe("/usr/bin/node")
    expect(prepared.args[0]).toBe("/cli.js")
    expect(prepared.args[1]).toBe("-p")
  })
})

describe("prepareMemorianSpawn payload", () => {
  test("#given a prepared gate spawn #when the child env is read #then the gate paths and sentinels are exported", async () => {
    // given / when
    const prepared = await prepare()

    // then
    expect(prepared.env.MEMORIAN_NUDGE_PATH).toBe(prepared.paths.nudges)
    expect(prepared.env.MEMORIAN_CANDIDATES_PATH).toBe(prepared.paths.candidates)
    expect(prepared.env.MEMORIAN_TRANSCRIPT_PATH).toBe(prepared.paths.transcript)
    expect(prepared.env.SENPI_MEMORY_MEMORIAN).toBe("1")
    expect(prepared.env.SENPI_PTY_FORCE_PIPE).toBe("1")
    expect(prepared.detached).toBe(true)
  })

  test("#given a prepared gate spawn #when the candidates file is read #then it carries the cap, the candidates and the surfaced paths read-only", async () => {
    // given / when
    const prepared = await prepare()

    // then
    const payload = JSON.parse(await readFile(prepared.paths.candidates, "utf8")) as Record<string, unknown>
    expect(payload).toEqual({
      version: 1,
      maxItems: 2,
      candidates: [
        { path: "reference/kubernetes-rollouts.md", description: "Rollout policy", excerpt: "drain first", score: 1 },
      ],
      surfaced: ["notes/old.md"],
    })
    const candidatesMode = (await stat(prepared.paths.candidates)).mode
    expect(candidatesMode & 0o222).toBe(0)
    expect(candidatesMode & 0o400).toBe(0o400)
  })

  test("#given a prepared gate spawn #when the transcript window is read #then both roles are present in order", async () => {
    // given / when
    const prepared = await prepare()

    // then
    const window = await readFile(prepared.paths.transcript, "utf8")
    expect(window).toContain("user: how do we handle kubernetes rollouts here")
    expect(window).toContain("assistant: let me check the deployment")
    expect(window.indexOf("user:")).toBeLessThan(window.indexOf("assistant:"))
  })

  test("#given a prepared gate spawn #when the run dir is inspected #then the persona and the nudge extension are materialized", async () => {
    // given / when
    const prepared = await prepare()

    // then
    expect(await readFile(join(prepared.paths.runDir, "memorian-persona.md"), "utf8")).toBe(loadMemorianPersona())
    expect(await readFile(join(prepared.paths.runDir, MEMORIAN_NUDGE_EXTENSION_FILENAME), "utf8"))
      .toBe(MEMORIAN_NUDGE_EXTENSION_SOURCE)
  })
})
