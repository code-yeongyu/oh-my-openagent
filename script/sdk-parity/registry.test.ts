import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ULW_LOOP_MANIFEST } from "../../packages/omo-codex/plugin/components/ulw-loop/src/sdk/manifest"
import { mappingProblems } from "./cell-mappings"
import { cliProgram } from "../../packages/omo-opencode/src/cli/cli-program"
import {
  arityProblems,
  commanderArity,
  engineParseArgs,
  engineRootArity,
  loopArity,
  nativeTableArity,
} from "./arity-check"
import { probeBase, registryBaseProblems, repoGit } from "./base-probe"
import { type Baseline, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { cellProblems } from "./cells"
import { runEffectScenarios } from "./conformance-run"
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
// Scanned once when the file loads, outside every test's timing: the scan parses every reachable native module and
// takes about a second at moderate load, several under heavy load, which a per-test default timeout must not depend on.
const NATIVE_FINDINGS = nativeArgvInventory(REPO_ROOT)
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
    expect(mappingProblems(readFileSync(TEMPLATE_PATH, "utf8"), files)).toEqual([])
  })

  test("#given each command's own parser #then every mapped flag takes a value or is presence exactly as its row writes it", async () => {
    const sources = [
      commanderArity(cliProgram),
      loopArity(join(REPO_ROOT, "packages/omo-codex/plugin/components/ulw-loop/src")),
      nativeTableArity(REPO_ROOT),
      engineRootArity(await engineParseArgs()),
    ]
    expect(arityProblems(rows, sources)).toEqual([])
  })

  test("#given every native dispatcher #then each flag is mapped on the route that accepts it, shared flags on every verb", () => {
    expect(routeFlagProblems(NATIVE_FINDINGS, rows)).toEqual([])
  })

  test("#given both native entry points #then every argv comparison has a row and every launcher row token is compared", () => {
    const findings = NATIVE_FINDINGS
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
})

// Home two of the base-tree checks (home one is gate-cli.ts in the SDK Parity job); see base-probe.ts.
const BASE = probeBase(repoGit)
describe("the head against the merge base's tree (runs whenever the merge base is readable)", () => {
  test.skipIf(!BASE.readable)(
    `#given the merge base this pull request merges into and the head's run evidence #then the baseline and the built rows hold${BASE.readable ? "" : ` [skipped: ${BASE.reason}]`}`,
    async () => {
      const head = {
        rows,
        originalText: repoFile(ORIGINAL_PATH),
        pinText: repoFile(PIN_PATH),
        unresolved: JSON.parse(repoFile(UNRESOLVED_PATH)) as Baseline,
        evidence: await runEffectScenarios(rows),
      }
      expect(registryBaseProblems(repoGit, head)).toEqual({ problems: [] })
    },
  )
})
