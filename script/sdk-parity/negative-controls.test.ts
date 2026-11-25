import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { ULW_LOOP_MANIFEST } from "../../packages/omo-codex/plugin/components/ulw-loop/src/sdk/manifest"
import { cellProblems } from "./cells"
import { argvProblems, commanderProblems, manifestProblems, routeFlagProblems } from "./inventory-check"
import { scanArgvComparisons } from "./native-inventory"
import { opencodeInventory } from "./opencode-inventory"
import { descriptorCallProblems } from "./recording-root"
import { allRows, loadDomainFiles, TEMPLATE_PATH } from "./registry"
import { registryProblems, rowProblems, type Row } from "./schema"
import { toolProblems } from "./tool-check"
import { discoverOmoTools } from "./tool-registry"

// Negative controls of design 7.6 for the registry and its inventories, and the regressions of review H1 and M1-M4 on
// #14970: each one breaks one thing and expects the check to fail with a message naming what to fix.

const files = loadDomainFiles()
const rows = allRows(files)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const row = (id: string): Row => {
  const found = rows.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return clone(found)
}
const replaced = (next: Row): Row[] => rows.map((candidate) => (candidate.id === next.id ? next : candidate))
const LAUNCHER = "packages/omo-native/bin/lib/launcher.js"

describe("negative controls: routes and flags (7.6)", () => {
  test("#given a verb with no row #then the native inventory names it", () => {
    const findings = scanArgvComparisons(LAUNCHER, 'export function run(args) { if (args[0] === "frobnicate") return 1 }\n')
    expect(argvProblems(findings, rows, { edition: "native", own: "launcher", also: ["engine"] }, {})).toContainEqual(
      expect.stringContaining('compares argv with "frobnicate", which no native row names'),
    )
  })

  test("#given a branch that dispatches outside the dispatch function, in an entry file and in a delegated module #then both are named", () => {
    const entry = scanArgvComparisons("packages/omo-native/bin/omo.js", 'if (process.argv[2] === "sideways") run()\n')
    const delegated = scanArgvComparisons("packages/omo-native/remote-cli.ts", 'const [verb] = args\nif (verb === "detour") go()\n')
    const problems = argvProblems([...entry, ...delegated], rows, { edition: "native", own: "launcher", also: ["engine"] }, {})
    expect(problems).toContainEqual(expect.stringContaining('"sideways"'))
    expect(problems).toContainEqual(expect.stringContaining('"detour"'))
  })

  test("#given a flag with no mapping #then the schema names the field to add", () => {
    const send = row("threads.send")
    const thread = send.cli.find((entry) => entry.route.join(" ") === "thread send")
    if (thread === undefined) throw new Error("no thread send entry")
    Object.assign(thread.flags, { "--urgency": "urgency" })
    expect(rowProblems(send)).toContainEqual(expect.stringContaining('fills "urgency", which threads.send does not take'))
  })

  test("#given a Commander command, alias or option with no row #then each is named (OpenCode edition)", async () => {
    const inventory = await opencodeInventory()
    const extra = {
      root: inventory.root,
      routes: [
        ...inventory.routes,
        { route: ["telemetry"], hidden: false, flags: ["--off"] },
        { route: ["doctor-alias"], hidden: false, flags: [] },
        ...inventory.routes.filter((route) => route.route.join(" ") === "doctor").map((route) => ({ ...route, flags: [...route.flags, "--deep"] })),
      ],
    }
    const problems = commanderProblems(extra, rows)
    expect(problems).toContainEqual(expect.stringContaining('Commander command "telemetry" has no row'))
    expect(problems).toContainEqual(expect.stringContaining('Commander command "doctor-alias" has no row'))
    expect(problems).toContainEqual(expect.stringContaining('option --deep of "doctor" has no row mapping'))
  }, 30_000)

  test("#given one route drops a flag another route of the same dispatcher keeps (review H1) #then that route is named", () => {
    const send = row("threads.send")
    for (const entry of send.cli) if (entry.route.join(" ") === "thread send") delete (entry.flags as Record<string, string>)["--all-scope"]
    const findings = scanArgvComparisons("packages/omo-native/bin/lib/thread.js", 'const COMMON = ["--json", "--all-scope"]\nconst COMMANDS = { list: {}, send: {}, read: {}, close: {} }\n')
    expect(routeFlagProblems(findings, replaced(send))).toEqual([
      'packages/omo-native/bin/lib/thread.js:1 accepts --all-scope on every thread verb; map it on "thread send" too',
    ])
  })
})

describe("negative controls: tools and schemas (7.6)", () => {
  test("#given a tool input field the SDK lacks, and a nested field that became required #then each is named", async () => {
    const tools = clone(await discoverOmoTools())
    const create = tools.find((tool) => tool.name === "thread_create")
    const send = tools.find((tool) => tool.name === "thread_send")
    if (create === undefined || send === undefined) throw new Error("thread tools missing")
    Object.assign(send.parameters.properties ?? {}, { urgency: { type: "string" } })
    Object.assign(create.parameters.properties?.worktree ?? {}, { required: ["branch"] })
    const problems = toolProblems(tools, rows)
    expect(problems).toContainEqual(expect.stringContaining('tool thread_send input field "urgency" is in no SDK call'))
    expect(problems).toContainEqual(expect.stringContaining('field worktree: required is ["branch"] in the tool and [] in the SDK'))
  }, 60_000)

  test("#given a branch chosen by a present field (review M4) #then the SDK input must require it", async () => {
    const wait = row("threads.readAfterWait")
    const relaxed = { ...wait, input: { ...wait.input, required: wait.input.required.filter((field) => field !== "wait_ms") } }
    expect(toolProblems(await discoverOmoTools(), replaced(relaxed))).toContainEqual(
      expect.stringContaining("(wait -> threads.readAfterWait) field wait_ms: required in the tool"),
    )
  }, 60_000)

  test("#given a manifest enum the row does not carry (review M2) #then the loop check names it", () => {
    const create = row("toolkit.createGoals")
    Object.assign(create.input.properties, { codexGoalMode: {} })
    expect(manifestProblems(ULW_LOOP_MANIFEST.operations, replaced(create))).toContainEqual(
      expect.stringContaining('toolkit.createGoals.codexGoalMode (manifest vs row): enum is ["aggregate","per_story"]'),
    )
  })

  test("#given a nested target, a value its schema refuses, an empty reason or an unknown slice (review M5) #then each is named", () => {
    const create = row("threads.create")
    const open = create.cli.find((entry) => entry.route.join(" ") === "remote open")
    if (open === undefined) throw new Error("no remote open entry")
    Object.assign(open.flags, { "--branch": "worktree.label", "--steer": "prompt.delivery=sideways" })
    const archive = row("threads.archive")
    const broken = { ...archive, planned: { cli: "T9" }, slices: [...archive.slices, "Z1"] }
    const status = row("daemon.status")
    const silent = { ...status, omitted: { tool: "n/a" } }
    const problems = [...rowProblems(create), ...rowProblems(broken), ...rowProblems(silent)]
    expect(problems).toContainEqual(expect.stringContaining('fills "worktree.label", a path threads.create\'s input does not have'))
    expect(problems).toContainEqual(expect.stringContaining('sets prompt.delivery to "sideways"'))
    expect(problems).toContainEqual(expect.stringContaining('planned cli names "T9", which is not a slice'))
    expect(problems).toContainEqual(expect.stringContaining('slice "Z1" is not a slice of design section 8'))
    expect(problems).toContainEqual(expect.stringContaining('omitted tool needs a written reason, not "n/a"'))
  })

  test("#given a row whose sdk is empty #then the schema refuses it", () => {
    expect(registryProblems([{ domain: "x", rows: [{ ...row("threads.list"), sdk: " " }], tables: [] }])).toContainEqual(
      expect.stringContaining("sdk is required"),
    )
  })
})

describe("negative controls: descriptors and the published table (7.6)", () => {
  test("#given a descriptor whose call invokes a different member than its row #then the recording root names both", () => {
    const archive = row("threads.archive")
    type Root = { threads: { close: (input: unknown) => unknown; archive: (input: unknown) => unknown } }
    expect(descriptorCallProblems(archive, (root) => (root as Root).threads.close({}))).toEqual([
      "the descriptor of threads.archive invokes threads.close, but its row's call is threads.archive",
    ])
    expect(descriptorCallProblems(archive, (root) => (root as Root).threads.archive({}))).toEqual([])
  })

  test("#given a registry edit the published cell does not show (review M3) #then the cell is named", () => {
    const template = readFileSync(TEMPLATE_PATH, "utf8")
    const edited = files.map((file) => ({
      ...file,
      rows: file.rows.map((candidate) => (candidate.id === "threads.archive" ? { ...candidate, today: "yes" as const } : candidate)),
    }))
    expect(cellProblems(template, edited)).toContainEqual(expect.stringContaining('threads.archive is "yes" today, the cell says "no"'))
  })
})
