import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { ULW_LOOP_MANIFEST } from "../../packages/omo-codex/plugin/components/ulw-loop/src/sdk/manifest"
import { mappingProblems } from "./cell-mappings"
import { arityProblems, nativeTableArity } from "./arity-check"
import { cellProblems } from "./cells"
import { takesValue } from "./descriptor-dispatch"
import { argvProblems, commanderProblems, manifestProblems, routeFlagProblems } from "./inventory-check"
import { nativeArgvInventory, scanArgvComparisons } from "./native-inventory"
import { opencodeInventory } from "./opencode-inventory"
import { descriptorCallProblems } from "./recording-root"
import { allRows, loadDomainFiles, REPO_ROOT, TEMPLATE_PATH } from "./registry"
import { registryProblems, rowProblems, type Row } from "./schema"
import { toolProblems } from "./tool-check"
import { discoverOmoTools } from "./tool-registry"

// Negative controls of design 7.6 for the registry and its inventories, and the regressions of review H1 and M1-M4 on
// #14970: each one breaks one thing and expects the check to fail with a message naming what to fix.

const files = loadDomainFiles()
// Scanned once for the file: the inventory walks every reachable native module.
const NATIVE_FINDINGS = nativeArgvInventory(REPO_ROOT)
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
    const findings = scanArgvComparisons(
      LAUNCHER,
      'export function run(args) { if (args[0] === "frobnicate") return 1 }\n',
    )
    expect(argvProblems(findings, rows, { edition: "native", own: "launcher", also: ["engine"] }, {})).toContainEqual(
      expect.stringContaining('compares argv with "frobnicate", which no native row names'),
    )
  })

  test("#given a branch that dispatches outside the dispatch function, in an entry file and in a delegated module #then both are named", () => {
    const entry = scanArgvComparisons("packages/omo-native/bin/omo.js", 'if (process.argv[2] === "sideways") run()\n')
    const delegated = scanArgvComparisons(
      "packages/omo-native/remote-cli.ts",
      'const [verb] = args\nif (verb === "detour") go()\n',
    )
    const problems = argvProblems(
      [...entry, ...delegated],
      rows,
      { edition: "native", own: "launcher", also: ["engine"] },
      {},
    )
    expect(problems).toContainEqual(expect.stringContaining('"sideways"'))
    expect(problems).toContainEqual(expect.stringContaining('"detour"'))
  })

  test("#given a value table of a positional that no row names (P1a finding on remote control|wake) #then the inventory names each value", () => {
    const findings = scanArgvComparisons(
      "packages/omo-native/remote-local.ts",
      'const MODE_VALUES = ["loud", "quiet"] as const\nexport const parse = (args) => MODE_VALUES.includes(args[1])\n',
    )
    const problems = argvProblems(findings, rows, { edition: "native", own: "launcher", also: ["engine"] }, {})
    expect(problems).toContainEqual(expect.stringContaining('compares argv with "loud", which no native row names'))
    expect(problems).toContainEqual(expect.stringContaining('compares argv with "quiet", which no native row names'))
  })

  test("#given a flag with no mapping #then the schema names the field to add", () => {
    const send = row("threads.send")
    const thread = send.cli.find((entry) => entry.route.join(" ") === "thread send")
    if (thread === undefined) throw new Error("no thread send entry")
    Object.assign(thread.flags, { "--urgency": "urgency" })
    expect(rowProblems(send)).toContainEqual(
      expect.stringContaining('fills "urgency", which threads.send does not take'),
    )
  })

  test("#given a Commander command, alias or option with no row #then each is named (OpenCode edition)", async () => {
    const inventory = await opencodeInventory()
    const extra = {
      root: inventory.root,
      routes: [
        ...inventory.routes,
        { route: ["telemetry"], hidden: false, flags: ["--off"] },
        { route: ["doctor-alias"], hidden: false, flags: [] },
        ...inventory.routes
          .filter((route) => route.route.join(" ") === "doctor")
          .map((route) => ({ ...route, flags: [...route.flags, "--deep"] })),
      ],
    }
    const problems = commanderProblems(extra, rows)
    expect(problems).toContainEqual(expect.stringContaining('Commander command "telemetry" has no row'))
    expect(problems).toContainEqual(expect.stringContaining('Commander command "doctor-alias" has no row'))
    expect(problems).toContainEqual(expect.stringContaining('option --deep of "doctor" has no row mapping'))
  })

  test("#given one route drops a flag another route of the same dispatcher keeps (review H1) #then that route is named", () => {
    const send = row("threads.send")
    for (const entry of send.cli)
      if (entry.route.join(" ") === "thread send") delete (entry.flags as Record<string, string>)["--all-scope"]
    const findings = scanArgvComparisons(
      "packages/omo-native/bin/lib/thread.js",
      'const COMMON = ["--json", "--all-scope"]\nconst COMMANDS = { list: {}, send: {}, read: {}, close: {} }\n',
    )
    expect(routeFlagProblems(findings, replaced(send))).toContainEqual(
      'packages/omo-native/bin/lib/thread.js:1 accepts --all-scope on every thread verb; map it on "thread send" too',
    )
  })
})

describe("negative controls: exact route correspondence and the published mappings (review 6061267823 H6, M7)", () => {
  test("#given a route that maps a flag its dispatcher does not accept for that verb #then the mapping is named", () => {
    const attach = row("threads.attach")
    const entry = attach.cli.find((cli) => cli.route.join(" ") === "remote attach")
    if (entry === undefined) throw new Error("no remote attach entry")
    Object.assign(entry.flags, { "--json": "render" })
    expect(routeFlagProblems(NATIVE_FINDINGS, replaced(attach))).toEqual([
      'row threads.attach maps --json on "remote attach", which its dispatcher does not accept for attach; remove the mapping',
    ])
  })

  test("#given a delegated route module that gains an option no row maps #then that route is named", () => {
    const findings = scanArgvComparisons(
      "packages/omo-native/account-show.ts",
      'export const wide = (args) => args.includes("--wide")\n',
    )
    expect(routeFlagProblems(findings, rows)).toContainEqual(
      'packages/omo-native/account-show.ts:1 accepts --wide on "account show"; map it on that route\'s row entry',
    )
  })

  test("#given a mapped flag the cell shows that a row stops mapping, or a mapping the cell does not show #then each is named", () => {
    const template = readFileSync(TEMPLATE_PATH, "utf8")
    const edit = (change: (row: Row) => Row) =>
      files.map((file) => ({
        ...file,
        rows: file.rows.map((candidate) => (candidate.id === "threads.read" ? change(clone(candidate)) : candidate)),
      }))
    const dropped = edit((read) => {
      for (const cli of read.cli) delete (cli.flags as Record<string, string>)["--cursor"]
      return read
    })
    expect(mappingProblems(template, dropped)).toContainEqual(
      "6.1#3: the cell shows --cursor, which no entry of its rows maps",
    )
    const added = edit((read) => {
      for (const cli of read.cli)
        if (cli.route.join(" ") === "thread read") Object.assign(cli.flags, { "--since": "cursor" })
      return read
    })
    expect(mappingProblems(template, added)).toContainEqual(
      "6.1#3: threads.read maps --since, which the published cell does not show",
    )
  })
})

describe("negative controls: the parsing contract (review 6061874518 M4)", () => {
  test("#given a presence flag written as a value flag #then the parser that owns it names the row", () => {
    const read = row("threads.read")
    const entry = read.cli.find((cli) => cli.route.join(" ") === "thread read")
    if (entry === undefined) throw new Error("no thread read entry")
    Object.assign(entry.flags, { "--all-scope": "all_scope" })
    expect(arityProblems([read], [nativeTableArity(REPO_ROOT)])).toEqual([
      'row threads.read: native "thread read --all-scope" is value in the row but presence in the native parser tables; write it as all_scope=true',
    ])
  })

  test("#given a value flag whose field is typed boolean #then the schema names it and parsing does not follow the type", () => {
    const read = row("threads.read")
    const typed = {
      ...read,
      input: { ...read.input, properties: { ...read.input.properties, cursor: { type: "boolean" } } },
    }
    expect(rowProblems(typed)).toContainEqual(expect.stringContaining("takes a value but fills cursor, a boolean"))
    const entry = typed.cli.find((cli) => cli.route.join(" ") === "thread read")
    if (entry === undefined) throw new Error("no thread read entry")
    expect(takesValue(entry, "--cursor")).toBe(true)
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
    expect(problems).toContainEqual(
      expect.stringContaining('field worktree: required is ["branch"] in the tool and [] in the SDK'),
    )
  })

  test("#given a branch chosen by a present field (review M4) #then the SDK input must require it", async () => {
    const wait = row("threads.readAfterWait")
    const relaxed = {
      ...wait,
      input: { ...wait.input, required: wait.input.required.filter((field) => field !== "wait_ms") },
    }
    expect(toolProblems(await discoverOmoTools(), replaced(relaxed))).toContainEqual(
      expect.stringContaining("(wait -> threads.readAfterWait) field wait_ms: required in the tool"),
    )
  })

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
    expect(problems).toContainEqual(
      expect.stringContaining('fills "worktree.label", a path threads.create\'s input does not have'),
    )
    expect(problems).toContainEqual(expect.stringContaining('sets prompt.delivery to "sideways"'))
    expect(problems).toContainEqual(expect.stringContaining('planned cli names "T9", which is not a slice'))
    expect(problems).toContainEqual(expect.stringContaining('slice "Z1" is not a slice of design section 8'))
    expect(problems).toContainEqual(expect.stringContaining('omitted tool needs a written reason, not "n/a"'))
  })

  test("#given a row whose sdk is empty #then the schema refuses it", () => {
    expect(
      registryProblems([{ domain: "x", rows: [{ ...row("threads.list"), sdk: " " }], tables: [] }]),
    ).toContainEqual(expect.stringContaining("sdk is required"))
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
      rows: file.rows.map((candidate) =>
        candidate.id === "threads.archive" ? { ...candidate, today: "yes" as const } : candidate,
      ),
    }))
    expect(cellProblems(template, edited)).toContainEqual(
      expect.stringContaining('threads.archive is "yes" today, the cell says "no"'),
    )
  })
})
