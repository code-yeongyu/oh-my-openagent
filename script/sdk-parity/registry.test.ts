import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ULW_LOOP_MANIFEST } from "../../packages/omo-codex/plugin/components/ulw-loop/src/sdk/manifest"
import { type Baseline, baselineProblems, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { cellProblems } from "./cells"
import { conformanceProblems } from "./conformance"
import { argvProblems, commanderProblems, engineProblems, manifestProblems, routeFlagProblems } from "./inventory-check"
import { nativeArgvInventory } from "./native-inventory"
import { NOT_ARGV } from "./not-argv"
import { opencodeInventory } from "./opencode-inventory"
import { allRows, DESIGN_PATH, loadDomainFiles, REPO_ROOT, TEMPLATE_PATH } from "./registry"
import { firstDifferences, renderSection6, section6Of } from "./render"
import { registryProblems } from "./schema"
import { toolProblems } from "./tool-check"
import { discoverOmoTools } from "./tool-registry"

// The SDK parity registry of #14943 (design sections 6 and 7) over the real tree: each check is exact, and its own
// negative controls live in negative-controls.test.ts.

const files = loadDomainFiles()
const rows = allRows(files)
const repoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")
const LOOP_CLI = "packages/omo-codex/plugin/components/ulw-loop/src/cli.ts"

describe("SDK parity registry (#14947)", () => {
  test("#given the rows #then every row satisfies the schema, sdk included", () => {
    expect(registryProblems(files)).toEqual([])
  })

  test("#given the rows #then section 6 rendered from them is the design's text byte for byte", () => {
    const rendered = renderSection6(readFileSync(TEMPLATE_PATH, "utf8"), files)
    const committed = section6Of(readFileSync(DESIGN_PATH, "utf8"))
    expect(firstDifferences(rendered, committed)).toEqual([])
    expect(rendered).toBe(committed)
    expect(cellProblems(readFileSync(TEMPLATE_PATH, "utf8"), files)).toEqual([])
  })

  test("#given every native dispatcher #then each flag is mapped on the route that accepts it, shared flags on every verb", () => {
    expect(routeFlagProblems(nativeArgvInventory(REPO_ROOT), rows)).toEqual([])
  })

  test("#given the rows counted as built #then each has effect scenarios and no stub outcome", () => {
    const open = new Set((JSON.parse(repoFile(UNRESOLVED_PATH)) as Baseline).entries.map((entry) => entry.id))
    expect(conformanceProblems(rows, open, [])).toEqual([])
  })

  test("#given both native entry points #then every argv comparison has a row and every launcher row token is compared", () => {
    const findings = nativeArgvInventory(REPO_ROOT)
    expect(argvProblems(findings, rows, { edition: "native", own: "launcher", also: ["engine"] }, NOT_ARGV)).toEqual([])
  })

  test("#given the delegated loop component #then its argv and its manifest match the toolkit rows", () => {
    const findings = nativeArgvInventory(REPO_ROOT, [LOOP_CLI])
    expect(argvProblems(findings, rows, { edition: "opencode", own: "loop", also: [] }, {})).toEqual([])
    expect(manifestProblems(ULW_LOOP_MANIFEST.operations, rows)).toEqual([])
  })

  test("#given the OpenCode edition's Commander program #then every command, alias, option and root option has a row", async () => {
    expect(commanderProblems(await opencodeInventory(), rows)).toEqual([])
  })

  test("#given the pinned engine snapshot #then the forwarded rows list the same leaves and flags", () => {
    expect(engineProblems(JSON.parse(repoFile("script/sdk-parity/engine-snapshot.json")), rows)).toEqual([])
  })

  test("#given a test engine session's tool registry #then every tool branch's schema equals its SDK call's input", async () => {
    const tools = await discoverOmoTools()
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      "thread_archive",
      "thread_close",
      "thread_create",
      "thread_handoff",
      "thread_interrupt",
      "thread_list",
      "thread_read",
      "thread_rename",
      "thread_send",
      "thread_set_model",
      "thread_set_reasoning",
    ])
    expect(toolProblems(tools, rows)).toEqual([])
  })

  test("#given the initializing pull request #then the original, its pin and the manifest are admitted together", () => {
    const state = {
      rows,
      originalText: repoFile(ORIGINAL_PATH),
      pinText: repoFile(PIN_PATH),
      unresolved: JSON.parse(repoFile(UNRESOLVED_PATH)) as Baseline,
      ranAtHead: new Set<string>(),
      atBase: { originalText: undefined, pinText: undefined, unresolved: undefined },
    }
    expect(baselineProblems(state)).toEqual([])
  })
})
