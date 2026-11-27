import { execFileSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Baseline, baselineProblems, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { isolationProblems, prepareBaseTree } from "./base-tree"
import { capabilityClosures, ImportGraph } from "./closures"
import { gateReport, goldenProblems, renderReport, type Side } from "./gate"
import { NATIVE_ENTRY_POINTS, nativeArgvInventory } from "./native-inventory"
import { loadPresentation, parsePresentation } from "./presentation"
import { readDeclaredVersions } from "./version-mask"
import { allRows, loadDomainFiles, REPO_ROOT, ROWS_DIR } from "./registry"
import type { Outcome } from "./scenario-run"
import { offenderGrowth } from "../remote-import-guard-adapter"
import { ADAPTER_OFFENDERS } from "../remote-import-guard-rules"
import { conformanceProblems } from "./conformance"
import { P0_CONTEXT, runEffectScenarios } from "./conformance-run"
import { SCENARIOS } from "./scenarios"
import { loadBaseScenarioTable } from "./declared-change"
import type { DomainFile } from "./schema"
import type { DiscoveredTool } from "./tool-check"

// The CI entry of the changed-capability gate: bun script/sdk-parity/gate-cli.ts --base <ref> [--body <file>]
// [--summary <file>]. It builds the merge base in a scratch worktree, runs the head's scenario runner on both trees,
// and prints the report; exit 1 on a failure. The merge base shares the head's installed dependencies when bun.lock is
// unchanged and installs its own otherwise.

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 << 20 })
const show = (ref: string, path: string): string | undefined => {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 << 20,
    })
  } catch {
    return undefined
  }
}
const LOOP_CLI = "packages/omo-codex/plugin/components/ulw-loop/src/cli.ts"
const OPENCODE_CLI = "packages/omo-opencode/src/cli/index.ts"
const GOLDENS_PATH = "script/sdk-parity/goldens.json"

function baseRows(ref: string): DomainFile[] | undefined {
  const listed = show(ref, "script/sdk-parity/rows/")
  if (listed === undefined) return undefined
  return listed
    .split("\n")
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(show(ref, `script/sdk-parity/rows/${name}`) ?? "{}") as DomainFile)
}

function runSide(tree: string): { outcomes: Record<string, Outcome>; tools: DiscoveredTool[] } {
  const text = execFileSync(
    process.execPath,
    [join(REPO_ROOT, "script/sdk-parity/scenario-run.ts"), "--tree", tree, "--with-tools"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 256 << 20,
    },
  )
  return JSON.parse(text) as { outcomes: Record<string, Outcome>; tools: DiscoveredTool[] }
}

const started = Date.now()
// In CI the check runs at the pull request's own head (review 6061267823 H4), never at a synthetic merge commit: the
// digest a reviewer copies is bound to the head this compares, so a checkout of any other commit stops here.
const expectedHead = arg("--expect-head")
if (expectedHead !== undefined && git("rev-parse", "HEAD").trim() !== expectedHead) {
  process.stderr.write(
    `sdk-parity gate: checked out ${git("rev-parse", "HEAD").trim()}, not the pull request head ${expectedHead}; check out the head itself\n`,
  )
  process.exit(1)
}
const mergeBase = git("merge-base", arg("--base") ?? "origin/dev", "HEAD").trim()
const scratch = mkdtempSync(join(tmpdir(), "sdk-parity-base-"))
const baseTree = join(scratch, "tree")
git("worktree", "add", "--detach", baseTree, mergeBase)
try {
  const lockMoved = git("diff", "--name-only", mergeBase, "HEAD", "--", "bun.lock").trim() !== ""
  if (lockMoved)
    execFileSync(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: baseTree,
      stdio: "inherit",
    })
  else prepareBaseTree(REPO_ROOT, baseTree)
  const isolation = [...isolationProblems(baseTree), ...isolationProblems(REPO_ROOT)]
  if (isolation.length > 0) throw new Error(isolation.join("\n"))
  const baseVersions = readDeclaredVersions(baseTree)
  const headVersions = readDeclaredVersions(REPO_ROOT)
  if (headVersions === undefined)
    throw new Error("the head has no packages/omo-native/package.json to read versions from")
  const baseSide = runSide(baseTree)
  // The merge base's own scenario table: both trees run the head's, so only this shows a scenario the head dropped.
  // Only a merge base without the table skips the rule that a scenario's call may not change; a table that exists and
  // does not load fails the check with its error.
  let baseTableProblem: string | undefined
  const baseScenarios =
    show(mergeBase, "script/sdk-parity/scenarios.ts") === undefined
      ? undefined
      : await loadBaseScenarioTable(join(baseTree, "script/sdk-parity/scenarios.ts")).catch((error: unknown) => {
          baseTableProblem = `the merge base's scenario table exists and does not load: ${error instanceof Error ? error.message : String(error)}`
          return []
        })
  const headSide = runSide(REPO_ROOT)
  const comparedMs = Date.now() - started
  const files = loadDomainFiles(ROWS_DIR)
  const rows = allRows(files)
  const unresolvedText = readFileSync(join(REPO_ROOT, UNRESOLVED_PATH), "utf8")
  const baseUnresolvedText = show(mergeBase, UNRESOLVED_PATH)
  const findings = {
    native: nativeArgvInventory(REPO_ROOT, NATIVE_ENTRY_POINTS),
    loop: nativeArgvInventory(REPO_ROOT, [LOOP_CLI]),
    commander: nativeArgvInventory(REPO_ROOT, [OPENCODE_CLI]),
  }
  const closures = capabilityClosures(rows, findings, new ImportGraph(REPO_ROOT))
  const changedFiles = git("diff", "--name-only", mergeBase)
    .split("\n")
    .filter((line) => line !== "")
  const body =
    arg("--body") === undefined ? (process.env.SDK_PARITY_PR_BODY ?? "") : readFileSync(arg("--body") ?? "", "utf8")
  const baseRowFiles = baseRows(mergeBase)
  const base: Side = {
    rows: baseRowFiles === undefined ? undefined : allRows(baseRowFiles),
    tools: baseSide.tools,
    outcomes: baseSide.outcomes,
    unresolved: baseUnresolvedText === undefined ? undefined : (JSON.parse(baseUnresolvedText) as Baseline).entries,
  }
  const unresolved = JSON.parse(unresolvedText) as Baseline
  const goldens = JSON.parse(readFileSync(join(REPO_ROOT, GOLDENS_PATH), "utf8")) as Record<string, Outcome>
  const baseGoldensText = show(mergeBase, GOLDENS_PATH)
  const baseRowsText = show(mergeBase, "script/sdk-parity/presentation.json")
  const report = gateReport({
    base,
    head: { rows, tools: headSide.tools, outcomes: headSide.outcomes, unresolved: unresolved.entries },
    scenarios: SCENARIOS,
    closures,
    changedFiles,
    body,
    headSha: git("rev-parse", "HEAD").trim(),
    versions: { base: baseVersions, head: headVersions },
    baseScenarios,
    presentation: {
      base: baseRowsText === undefined ? undefined : parsePresentation(baseRowsText),
      head: loadPresentation(),
    },
    goldens: {
      base: baseGoldensText === undefined ? undefined : (JSON.parse(baseGoldensText) as Record<string, Outcome>),
      head: goldens,
    },
  })
  // The checks that read the merge base's tree run here, in the dedicated job that fetches it, and nowhere else: the
  // ordinary test shards have a shallow checkout without the base ref (design 7.4; train review of 6871a012b9).
  const evidence = await runEffectScenarios(rows)
  const recorded = show(mergeBase, "script/remote-import-guard-adapter-offenders.json")
  const baseFailures = [
    ...conformanceProblems(rows, new Set(unresolved.entries.map((entry) => entry.id)), evidence, P0_CONTEXT),
    ...offenderGrowth(recorded === undefined ? undefined : JSON.parse(recorded), ADAPTER_OFFENDERS),
  ]
  const baselineFailures = baselineProblems({
    rows,
    originalText: readFileSync(join(REPO_ROOT, ORIGINAL_PATH), "utf8"),
    pinText: readFileSync(join(REPO_ROOT, PIN_PATH), "utf8"),
    unresolved,
    evidence,
    context: P0_CONTEXT,
    atBase: {
      originalText: show(mergeBase, ORIGINAL_PATH),
      pinText: show(mergeBase, PIN_PATH),
      unresolved: base.unresolved === undefined ? undefined : { version: 1, entries: base.unresolved },
    },
  })
  const failures = [
    ...(baseTableProblem === undefined ? [] : [baseTableProblem]),
    ...report.failures,
    ...baselineFailures,
    ...baseFailures,
    ...goldenProblems(goldens, headSide.outcomes),
  ]
  const text = `${renderReport({ ...report, failures })}\nMerge base ${mergeBase.slice(0, 10)}; ${baseScenarios === undefined ? "no scenario table at the merge base" : `${baseScenarios.length} merge-base scenarios bound`}; ${SCENARIOS.length} scenarios on both trees in ${(comparedMs / 1000).toFixed(1)} s; gate total ${((Date.now() - started) / 1000).toFixed(1)} s.\n`
  process.stdout.write(text)
  const summary = arg("--summary") ?? process.env.GITHUB_STEP_SUMMARY
  if (summary !== undefined) appendFileSync(summary, text)
  process.exitCode = failures.length > 0 ? 1 : 0
} finally {
  git("worktree", "remove", "--force", baseTree)
  rmSync(scratch, { recursive: true, force: true })
}
