import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { generatedPath as protocolGeneratedPath } from "../packages/omo-computer-protocol/scripts/generate-protocol.ts"

import { parseWriteScope, runGuard } from "./computer-v3-guards.ts"

// Each guard runs against a temporary git repository that this test owns: one tree that passes and one that
// violates it. A pass exits 0 with no finding; a violation exits 1 with one line per finding naming the path.

const guardScript = join(import.meta.dir, "computer-v3-guards.ts")

// The guard and the fixture git calls see no inherited GIT_* variable and no system git config. Their global config
// is the repository's hermetic test git config (test-hermetic-home.ts: HOME and GIT_CONFIG_GLOBAL name it), never the
// user's: it turns off the detached `git maintenance run --auto` that could outlive a fixture's removal.
const isolatedEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        (!entry[0].startsWith("GIT_") || entry[0] === "GIT_CONFIG_GLOBAL") && entry[1] !== undefined,
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
}

type Tree = Record<string, string>

type Repo = {
  readonly root: string
  readonly run: string
  git(...args: string[]): string
  write(tree: Tree): void
  remove(...paths: string[]): void
  commit(message: string): void
  guard(...args: string[]): { readonly exitCode: number; readonly findings: readonly string[] }
}

function withRepo(body: (repo: Repo) => void): void {
  const top = mkdtempSync(join(tmpdir(), "cu-v3-guards-"))
  const root = join(top, "repo")
  const run = join(top, "run")
  mkdirSync(root)
  mkdirSync(join(run, "evidence"), { recursive: true })
  const git = (...args: string[]): string => {
    const result = Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=guard-test",
        "-c",
        "user.email=guard-test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        cwd: root,
        env: isolatedEnv,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
    return result.stdout.toString()
  }
  const writeTree = (base: string, tree: Tree): void => {
    for (const [path, content] of Object.entries(tree)) {
      mkdirSync(dirname(join(base, path)), { recursive: true })
      writeFileSync(join(base, path), content)
    }
  }
  git("init", "-q", "-b", "dev")
  const repo: Repo = {
    root,
    run,
    git,
    write: (tree) => writeTree(root, tree),
    remove: (...paths) => {
      for (const path of paths) rmSync(join(root, path), { recursive: true, force: true })
    },
    commit: (message) => {
      git("add", "-A")
      git("commit", "-q", "--allow-empty", "-m", message)
    },
    guard: (...args) => runGuard(args, { cwd: root, env: isolatedEnv }),
  }
  try {
    body(repo)
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
}

const numbered = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}: ${(index * 7919) % 1013}`).join("\n") + "\n"

const sha256 = (content: string): string => new Bun.CryptoHasher("sha256").update(content).digest("hex")

function expectPass(result: { readonly exitCode: number; readonly findings: readonly string[] }): void {
  expect(result.findings).toEqual([])
  expect(result.exitCode).toBe(0)
}

function expectFindings(
  result: { readonly exitCode: number; readonly findings: readonly string[] },
  ...needles: string[]
): void {
  expect(result.exitCode).toBe(1)
  expect(result.findings).toHaveLength(needles.length)
  for (const needle of needles) expect(result.findings.filter((line) => line.includes(needle))).toHaveLength(1)
}

describe("computer-v3-guards --residue", () => {
  test("residue_refuses_an_old_name_outside_the_exclusions_and_a_remaining_class_a_or_b_path", () => {
    withRepo((repo) => {
      // given a tree where the old name survives only in the legacy-name exclusions
      repo.write({
        "README.md": "the computer module\n",
        "CHANGELOG.md": "- senpi-desktop-engine was removed\n",
        "changes/unreleased/1.md": "senpi-desktop is gone\n",
        "packages/omo-native/changes.md": "SENPI_DESKTOP_BACKEND dropped\n",
        "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv": "new path\told path\nx\tcrates/senpi-desktop-core/x\n",
        "crates/omo-computer-safety/src/legacy_marker.rs": "// reads <runtime>/senpi-desktop/<uid>/stop\n",
      })
      repo.commit("clean")
      expectPass(repo.guard("--residue"))

      // when a doc names the old engine, an old crate and a class B workflow are present
      repo.write({
        "docs/guide.md": "run Senpi_Desktop-engine --serve\n",
        "crates/senpi-desktop-core/README.md": "old\n",
        ".github/workflows/desktop-engine.yml": "name: old\n",
      })
      repo.commit("residue")

      // then each is one finding
      expectFindings(
        repo.guard("--residue"),
        "docs/guide.md:1:",
        "crates/senpi-desktop-core still exists",
        ".github/workflows/desktop-engine.yml still exists",
      )
    })
  })

  test("residue_refuses_a_dangling_symlink_left_at_a_class_a_or_b_removal_path", () => {
    withRepo((repo) => {
      // given a tree where the removal paths are truly absent
      repo.write({ "README.md": "the computer module\n" })
      repo.commit("clean")
      expectPass(repo.guard("--residue"))

      // when a dangling symlink sits at a class A path and at a class B path (neither name matches the old family)
      mkdirSync(join(repo.root, "crates"))
      mkdirSync(join(repo.root, ".github/workflows"), { recursive: true })
      symlinkSync("missing-crate", join(repo.root, "crates/desktop"))
      symlinkSync("missing-workflow.yml", join(repo.root, ".github/workflows/desktop-engine.yml"))

      // then each one is a finding, because a directory entry is still there
      expectFindings(
        repo.guard("--residue"),
        "crates/desktop still exists",
        ".github/workflows/desktop-engine.yml still exists",
      )
    })
  })
})

describe("computer-v3-guards --no-legacy-edge", () => {
  test("no_legacy_edge_refuses_an_old_name_or_an_old_crate_path_under_the_new_directories", () => {
    withRepo((repo) => {
      // given new directories that never name the old family, while a doc outside them does
      repo.write({
        "docs/guide.md": "senpi-desktop-engine is the old engine\n",
        "crates/omo-computer-core/Cargo.toml": '[package]\nname = "omo-computer-core"\n[dependencies]\nserde = "1"\n',
        "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv": "x\tcrates/senpi-desktop-core/x\n",
        "packages/omo-computer-sdk/package.json": '{ "name": "@oh-my-opencode/omo-computer-sdk" }\n',
        "packages/omo-senpi/src/components/computer-use/index.ts": "export const old = 'senpi-desktop'\n",
      })
      repo.commit("clean")
      expectPass(repo.guard("--no-legacy-edge"))

      // when a new crate depends on an old crate by path, a package names the old ABI and a QA scenario the old engine
      repo.write({
        "crates/omo-computer-safety/Cargo.toml":
          '[package]\nname = "omo-computer-safety"\n[dependencies]\nold = { path = "../desktop" }\n',
        "packages/omo-computer-sdk/src/index.ts": 'export const abi = "Senpi_Desktop/1"\n',
        "script/qa/computer/linux/boot.ts": "spawn('SENPI-DESKTOP-ENGINE')\n",
      })
      repo.commit("edges")

      // then each file is one finding
      expectFindings(
        repo.guard("--no-legacy-edge"),
        "crates/omo-computer-safety/Cargo.toml",
        "packages/omo-computer-sdk/src/index.ts:1:",
        "script/qa/computer/linux/boot.ts:1:",
      )
    })
  })
})

describe("computer-v3-guards --copy <ref>", () => {
  test("copy_refuses_a_new_source_that_renames_or_copies_an_old_one", () => {
    withRepo((repo) => {
      const oldSource = numbered("old", 40)
      repo.write({
        "crates/senpi-desktop-core/src/lib.rs": oldSource,
        "crates/senpi-desktop-core/src/tiny.rs": numbered("tiny", 10),
      })
      repo.commit("base")
      repo.git("branch", "base")

      // given fresh sources, an old payload copied only into fixtures and a copy under 20 lines
      repo.write({
        "crates/omo-computer-core/src/lib.rs": numbered("fresh", 40),
        "crates/omo-computer-core/fixtures/conformance/data.rs": oldSource,
        "crates/omo-computer-core/src/tiny.rs": numbered("tiny", 10),
      })
      repo.commit("fresh")
      expectPass(repo.guard("--copy", "base"))

      // when a new implementation source is a copy of an old one
      repo.write({ "crates/omo-computer-session/src/lib.rs": oldSource })
      repo.commit("copied")

      // then the copy names both paths
      const result = repo.guard("--copy", "base")
      expectFindings(result, "crates/omo-computer-session/src/lib.rs")
      expect(result.findings[0]).toContain("crates/senpi-desktop-core/src/lib.rs")
    })
  })
})

const plan = [
  "# plan",
  "## Todos",
  "- [ ] 1. Open the frame",
  "  Parallelization: Wave 1 (gates) | Blocked by: - | Blocks: 2",
  "  Write scope: `$CU_RUN/ (outside the repository)`; `GitHub issue (tracking)`",
  "- [ ] 2. Ship the guards",
  "  Parallelization: Wave 2 (gates) | Blocked by: 1 | Blocks: 3, 4",
  "  Write scope: `script/computer-v3-guards.ts`; `docs/x-<pr>.md (a note; with a semicolon)`; `$CU_RUN/BASE`",
  "- [ ] 3. Core frames",
  "  Parallelization: Wave 3 (core) | Blocked by: 2 | Blocks: 5",
  "  Write scope: `crates/omo-computer-core/src/frame/**`; `crates/omo-computer-core/data/table.json`; `script/qa/computer/replay.ts`",
  "- [ ] 4. Safety gates",
  "  Parallelization: Wave 3 (core) | Blocked by: 2 | Blocks: -",
  "  Write scope: `crates/omo-computer-safety/src/gate/**`; `docs/sibling.md`",
  "- [ ] 5. Session settle",
  "  Parallelization: Wave 4 (session) | Blocked by: 3 | Blocks: -",
  "  Write scope: `crates/omo-computer-session/src/settle/**`; `crates/omo-computer-backend-x11/src/input/**`",
  "- [ ] 47. X11 capture and the Linux live driver",
  "  Parallelization: Wave 11 (os) | Blocked by: 2 | Blocks: 48",
  "  Write scope: `crates/omo-computer-backend-x11/src/capture/**`; `script/qa/computer/linux.ts`; `script/qa/computer/linux/**`",
  "- [ ] 48. AT-SPI accessibility",
  "  Parallelization: Wave 12 (os) | Blocked by: 47 | Blocks: -",
  "  Write scope: `crates/omo-computer-backend-atspi/src/**`",
  "- [ ] 80. Remove the old implementation",
  "  Parallelization: Wave 28 (removal) | Blocked by: 5 | Blocks: -",
  "  Write scope: `every path of the Removal inventory (classes A-D)`; `changes/unreleased/<pr>.md`",
  "## Final verification wave",
  "",
].join("\n")

function scopeRepo(repo: Repo, planText: string = plan): (row: string) => ReturnType<Repo["guard"]> {
  writeFileSync(join(repo.run, "plan.md"), planText)
  repo.write({ "README.md": "base\n", "script/qa/computer/linux/existing.ts": "export {}\n" })
  repo.commit("base")
  repo.git("branch", "base")
  return (row) => repo.guard("--scope", row, "base", "--plan", join(repo.run, "plan.md"))
}

describe("computer-v3-guards --copy physical lines", () => {
  test("copy_counts_physical_lines_including_blank_ones", () => {
    withRepo((repo) => {
      // given an old 19-line file and an old 24-line file whose every other line is blank
      const short = Array.from({ length: 19 }, (_, index) => `export const short_${index} = ${index};\n`).join("")
      const spaced = Array.from({ length: 12 }, (_, index) => `export const copied_${index} = ${index};\n\n`).join("")
      repo.write({
        "packages/senpi-desktop-tool/src/short.ts": short,
        "packages/senpi-desktop-tool/src/gate-copy-source.ts": spaced,
      })
      repo.commit("base")
      repo.git("branch", "base")

      // when the 19-line file is copied, it is short and passes
      repo.write({ "packages/omo-computer-tool/src/short.ts": short })
      repo.commit("short copy")
      expectPass(repo.guard("--copy", "base"))

      // when the 24-line file (12 of them blank) is copied byte for byte
      repo.write({ "packages/omo-computer-tool/src/gate-copy.ts": spaced })
      repo.commit("spaced copy")

      // then it is a finding: 24 physical lines are not shorter than 20
      expectFindings(repo.guard("--copy", "base"), "packages/omo-computer-tool/src/gate-copy.ts")
    })
  })
})

describe("computer-v3-guards --scope <row> <ref> --plan <file>", () => {
  test("scope_refuses_a_path_outside_the_row_write_scope", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)

      // given the row's own patterns, a note-carrying entry, the shared-append list and a new scenario file
      repo.write({
        "script/computer-v3-guards.ts": "export {}\n",
        "docs/x-123.md": "note\n",
        "Cargo.toml": "[workspace]\n",
        "changes/unreleased/77.md": "fragment\n",
        "crates/omo-computer-core/parity/test-parity-manifest.tsv": "unit\n",
        "script/qa/computer/linux/new-scenario.ts": "export {}\n",
        "crates/omo-computer-core/fixtures/conformance/v3-settle.json": "{}\n",
      })
      repo.commit("in scope")
      expectPass(scope("2"))

      // when the row edits a path no rule names, an existing scenario file and a path matching only another row
      repo.write({
        "docs/other.md": "outside\n",
        "script/qa/computer/linux/existing.ts": "export const edited = 1\n",
        "docs/sibling.md": "row 4 owns this\n",
      })
      repo.commit("out of scope")

      // then each is a finding naming the row
      expectFindings(
        scope("2"),
        "docs/other.md is outside row 2's write scope",
        "script/qa/computer/linux/existing.ts",
        "docs/sibling.md",
      )
    })
  })

  test("scope_accepts_wiring_and_call_path_files_of_a_touched_unit_and_refuses_them_for_an_untouched_unit", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)

      // given row 5, whose entries fall under the session crate and the X11 backend crate
      repo.write({
        "crates/omo-computer-session/src/settle/table.rs": "// settle\n",
        "crates/omo-computer-session/Cargo.toml": "[package]\n",
        "crates/omo-computer-session/src/lib.rs": "mod settle;\n",
        "crates/omo-computer-session/src/settle/wait/mod.rs": "mod a;\n",
        "crates/omo-computer-session/src/session.rs": "// one gate line\n",
        "crates/omo-computer-session/src/mutate/stage.rs": "// one stage line\n",
        "crates/omo-computer-backend-x11/src/backend.rs": "// one delegating body\n",
        "crates/omo-computer-engine/src/route.rs": "// one registration line\n",
      })
      repo.commit("wiring of touched units")
      expectPass(scope("5"))

      // when it edits the wiring and call-path files of units none of its entries falls under, and a non-wiring file
      repo.write({
        "crates/omo-computer-safety/src/lib.rs": "mod x;\n",
        "crates/omo-computer-backend-macos/src/backend.rs": "// body\n",
        "crates/omo-computer-session/src/other.rs": "// logic outside the row's files\n",
      })
      repo.commit("untouched units")

      // then those three are findings
      expectFindings(
        scope("5"),
        "crates/omo-computer-safety/src/lib.rs",
        "crates/omo-computer-backend-macos/src/backend.rs",
        "crates/omo-computer-session/src/other.rs",
      )
    })
  })

  test("scope_accepts_a_regenerated_file_of_the_generated_list_in_any_row", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)

      // given rows 2 and 4, neither of which owns a generated file, regenerating outputs of the generated list
      repo.write({
        "crates/omo-computer-core/schema/engine.schema.json": "{}\n",
        "crates/omo-computer-core/docs/methods.md": "# methods\n",
        "packages/omo-computer-sdk/facade-manifest.json": "{}\n",
        "packages/omo-computer-tool/src/skill/SKILL.md": "skill\n",
      })
      repo.commit("regenerated")
      expectPass(scope("2"))
      expectPass(scope("4"))

      // when a file beside a generated one, but not on the list, changes
      repo.write({ "crates/omo-computer-core/schema/hand-written.json": "{}\n" })
      repo.commit("not generated")

      // then only that file is a finding
      expectFindings(scope("2"), "crates/omo-computer-core/schema/hand-written.json")
    })
  })

  test("scope_accepts_the_protocol_generators_output_path_as_generated", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)

      // given the path the protocol generator writes, taken from the generator itself
      const output = relative(join(import.meta.dir, ".."), protocolGeneratedPath)
      repo.write({ [output]: "export {}\n" })
      repo.commit("regenerated protocol")

      // then a row that does not own it may still regenerate it
      expectPass(scope("2"))
    })
  })

  test("scope_accepts_a_listed_path_owned_by_a_transitive_blocker_and_refuses_an_unlisted_one_or_one_owned_by_a_non_blocker", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)
      const blockerEdits = join(repo.run, "evidence", "task-5.blocker-edits.txt")

      // given row 5 editing a path of row 3 (its blocker) and one of row 2 (a transitive blocker), both listed
      writeFileSync(
        blockerEdits,
        "crates/omo-computer-core/data/table.json\tthe settle constants row 5 adds\ndocs/x-12.md\tthe note row 5 extends\n",
      )
      repo.write({ "crates/omo-computer-core/data/table.json": "{}\n", "docs/x-12.md": "note\n" })
      repo.commit("listed blocker edits")
      expectPass(scope("5"))

      // when it edits an unlisted path of a transitive blocker, a listed path of row 4 (not a blocker),
      // and a listed QA driver entry file of a blocker (entry files change only in the row that owns them)
      writeFileSync(
        blockerEdits,
        "crates/omo-computer-core/data/table.json\tthe settle constants row 5 adds\ndocs/sibling.md\tnot a blocker\nscript/qa/computer/replay.ts\ta new flag\ndocs/x-12.md\tthe note\n",
      )
      repo.write({
        "script/computer-v3-guards.ts": "export {}\n",
        "docs/sibling.md": "row 4\n",
        "script/qa/computer/replay.ts": "export {}\n",
      })
      repo.commit("unlisted and non-blocker edits")

      // then those three are findings
      expectFindings(scope("5"), "script/computer-v3-guards.ts", "docs/sibling.md", "script/qa/computer/replay.ts")
    })
  })

  test("scope_refuses_a_listed_edit_of_an_existing_scenario_file_even_when_a_blocker_owns_it", () => {
    withRepo((repo) => {
      const scope = scopeRepo(repo)
      const blockerEdits = join(repo.run, "evidence", "task-48.blocker-edits.txt")
      const listedCapture = "crates/omo-computer-backend-x11/src/capture/frame.rs\tthe frame hook row 48 reads\n"

      // given row 48 adding a new scenario file and making a listed edit to a non-scenario path of row 47 (its blocker)
      writeFileSync(blockerEdits, listedCapture)
      repo.write({
        "crates/omo-computer-backend-x11/src/capture/frame.rs": "// hook\n",
        "script/qa/computer/linux/atspi-walk.ts": "export {}\n",
      })
      repo.commit("new scenario and listed blocker edit")
      expectPass(scope("48"))

      // when it edits row 47's existing scenario file and lists that edit
      writeFileSync(blockerEdits, `${listedCapture}script/qa/computer/linux/existing.ts\tWalk AT-SPI for row 48.\n`)
      repo.write({ "script/qa/computer/linux/existing.ts": 'export const scenario = "changed by row 48"\n' })
      repo.commit("edit another row's scenario")

      // then the scenario edit is a finding: no row edits another row's scenario file
      expectFindings(scope("48"), "script/qa/computer/linux/existing.ts")
    })
  })

  test("scope_accepts_every_removal_inventory_path_for_the_removal_entry", () => {
    withRepo((repo) => {
      repo.write({
        "crates/senpi-desktop-core/src/lib.rs": "old\n",
        ".github/workflows/desktop-engine.yml": "old\n",
        "script/qa/desktop/a.ts": "old\n",
        "knip.base.jsonc": "{}\n",
        "script/knip.workspace.jsonc": "{}\n",
      })
      const scope = scopeRepo(repo)

      // given row 80 deleting class A and B paths and editing class C and D files
      repo.remove("crates/senpi-desktop-core", ".github/workflows/desktop-engine.yml", "script/qa/desktop")
      repo.write({
        "knip.base.jsonc": "{ }\n",
        "script/knip.workspace.jsonc": "{ }\n",
        "script/ci-fast-path.mjs": "// re-pointed\n",
        "packages/omo-senpi/scripts/qa/fused-equivalence-golden/linux-x64/E21.json": "{}\n",
        "changes/unreleased/80.md": "removed\n",
      })
      repo.commit("removal")

      // then the removal row passes and row 2 does not
      expectPass(scope("80"))
      expect(scope("2").exitCode).toBe(1)
    })
  })

  test("scope_reports_bad_plan_grammar_and_a_malformed_blocker_edits_line_as_findings", () => {
    withRepo((repo) => {
      const scope = scopeRepo(
        repo,
        plan
          .replace("`crates/omo-computer-safety/src/gate/**`; ", "crates/omo-computer-safety/src/gate/**; ")
          .replace("Blocked by: 3 |", "Blocked by: three |"),
      )
      repo.write({ "docs/x-1.md": "note\n" })
      repo.commit("change")
      writeFileSync(join(repo.run, "evidence", "task-2.blocker-edits.txt"), "docs/x-1.md\n")

      // when the row is missing, an entry is not backtick-quoted, a Blocked-by line is malformed or a blocker-edits line has no reason
      // then each run exits 1 with one finding, never 0
      expectFindings(scope("9"), "row 9")
      expectFindings(scope("4"), "Write scope")
      expectFindings(scope("5"), "Blocked by")
      expectFindings(scope("2"), "task-2.blocker-edits.txt line 1")
    })
  })

  test("scope_reports_an_unreadable_plan_as_one_finding_line", () => {
    withRepo((repo) => {
      scopeRepo(repo)

      // when --plan names a directory
      const result = Bun.spawnSync([process.execPath, guardScript, "--scope", "2", "base", "--plan", repo.run], {
        cwd: repo.root,
        env: isolatedEnv,
        stdout: "pipe",
        stderr: "pipe",
      })

      // then the CLI prints exactly one finding naming the plan and exits 1, not a stack trace
      const lines = result.stdout
        .toString()
        .split("\n")
        .filter((line) => line.length > 0)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`plan file ${repo.run}`)
      expect(result.stderr.toString()).toBe("")
      expect(result.exitCode).toBe(1)
    })
  })

  test("parse_write_scope_drops_notes_and_entries_outside_the_repository", () => {
    const parsed = parseWriteScope(
      "  Write scope: `Cargo.toml (workspace members, shared-append)`; `package.json (workspaces, `test:computer` script; shared-append)`; `crates/omo-computer-backend-macos/probes/*.{sh,ps1}`; `omo-desktop-app repository: `.github/workflows/release.yml`, `x.yml` (three places)`; `$CU_RUN/evidence/ (no repository change)`; `<session working directory>/.omo/omo.jsonc (one added key)`; `GitHub issues and PR comments`; `changes/unreleased/<pr>.md`",
    )
    expect(parsed).toEqual([
      "Cargo.toml",
      "package.json",
      "crates/omo-computer-backend-macos/probes/*.{sh,ps1}",
      "changes/unreleased/<pr>.md",
    ])
  })
})

describe("computer-v3-guards --old-frozen <ref>", () => {
  test("old_frozen_refuses_a_change_under_an_old_directory", () => {
    withRepo((repo) => {
      repo.write({
        "README.md": "base\n",
        "crates/senpi-desktop-core/src/lib.rs": "old\n",
        "packages/senpi-desktop-tool/src/a.ts": "old\n",
      })
      repo.commit("base")
      repo.git("branch", "base")

      // given a branch that leaves the old directories untouched
      repo.write({ "README.md": "changed\n", "crates/omo-computer-core/src/lib.rs": "new\n" })
      repo.commit("new")
      expectPass(repo.guard("--old-frozen", "base"))

      // when it edits one old file and renames another out of an old directory
      repo.write({ "crates/senpi-desktop-core/src/lib.rs": "old\n// one more line\n" })
      repo.git("mv", "packages/senpi-desktop-tool/src/a.ts", "packages/a.ts")
      repo.commit("touch old")

      // then both old paths are findings
      expectFindings(
        repo.guard("--old-frozen", "base"),
        "old-frozen: crates/senpi-desktop-core/src/lib.rs",
        "old-frozen: packages/senpi-desktop-tool/src/a.ts",
      )
    })
  })
})

const manifestPath = "crates/omo-computer-core/parity/test-parity-manifest.tsv"
const legsPath = "crates/omo-computer-core/parity/DEFERRED-LEGS.tsv"
const manifestHeader = "unit\tkind\ttest id\tstatus\tnote\n"
const legsHeader = "design row\tleg\trecorded by row\towed to row\tstatus\n"

describe("computer-v3-guards --parity", () => {
  test("parity_refuses_a_blank_unknown_or_malformed_status", () => {
    withRepo((repo) => {
      // given every status form, pending included
      repo.write({
        [manifestPath]:
          manifestHeader +
          "core\trust\tcore::frame::tests::crop\tpending\t\n" +
          "core\trust\tcore::keys::tests::chord\tported:omo-computer-core::keys::tests::chord\t\n" +
          "tool\tvitest\ttool/a.test.ts::does x\tsuperseded:AC-12\t\n" +
          "script\tbun\tscript/a.test.ts::builds\tdropped:osascript canary\tnote\n",
      })
      repo.commit("manifest")
      expectPass(repo.guard("--parity"))

      // when one status is blank, one unknown and one line has too few columns
      repo.write({
        [manifestPath]:
          manifestHeader + "core\trust\tcore::a\t\t\n" + "core\trust\tcore::b\tdone\t\n" + "core\trust\tcore::c\n",
      })
      repo.commit("broken")

      // then each line is a finding
      expectFindings(repo.guard("--parity"), "core::a", "core::b", "line 4")
    })
  })

  test("parity_accepts_pending_and_parity_final_refuses_it", () => {
    withRepo((repo) => {
      // given a pending test and a fixture row, and a ledger with one leg owed after row 74 and one passed
      repo.write({
        [manifestPath]:
          manifestHeader +
          "core\trust\tcore::frame::tests::crop\tpending\t\n" +
          "crates/senpi-desktop-core/fixtures/conformance/new.json\tfixture\tnew.json\tpending\t\n",
        [legsPath]:
          legsHeader + "C17\tthe serve leg\t28\t75\towed\n" + "C18\tthe daemon leg\t28\t29\tpassed:v3-daemon-uds\n",
      })
      repo.commit("pending")

      // then --parity accepts pending and --parity --final refuses each pending row
      expectPass(repo.guard("--parity"))
      expectFindings(repo.guard("--parity", "--final"), "core::frame::tests::crop", "new.json")

      // when nothing is pending, --final passes; a leg owed to row 74 and a malformed leg are refused
      repo.write({ [manifestPath]: manifestHeader + "core\trust\tcore::frame::tests::crop\tported:v3::crop\t\n" })
      repo.commit("ported")
      expectPass(repo.guard("--parity", "--final"))
      repo.write({ [legsPath]: legsHeader + "C17\tthe serve leg\t28\t74\towed\n" + "C19\tmalformed\t28\n" })
      repo.commit("owed")
      expectFindings(repo.guard("--parity", "--final"), "C17", "line 3")
    })
  })

  test("parity_refuses_an_empty_or_headerless_manifest_and_legs_file", () => {
    withRepo((repo) => {
      // given a zero-byte manifest and a zero-byte legs file
      repo.write({ [manifestPath]: "", [legsPath]: "" })
      repo.commit("empty")

      // then --parity --final names both files and exits 1
      expectFindings(
        repo.guard("--parity", "--final"),
        "test-parity-manifest.tsv is empty",
        "DEFERRED-LEGS.tsv is empty",
      )

      // when each file holds one data line and no header
      repo.write({
        [manifestPath]: "core\trust\tcore::a\tpending\t\n",
        [legsPath]: "C17\tthe serve leg\t28\t74\towed\n",
      })
      repo.commit("headerless")

      // then the missing header is a finding for each file, never a skipped row
      expectFindings(repo.guard("--parity", "--final"), "test-parity-manifest.tsv line 1", "DEFERRED-LEGS.tsv line 1")

      // when the manifest is valid and the legs file holds only one malformed record
      repo.write({ [manifestPath]: manifestHeader + "core\trust\tx\tported:case-x\t\n", [legsPath]: "C17\tbroken\n" })
      repo.commit("malformed only")

      // then that record is not taken for a header
      expectFindings(repo.guard("--parity", "--final"), "DEFERRED-LEGS.tsv line 1")
    })
  })
})

const provenancePath = "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv"
const deltasPath = "crates/omo-computer-core/parity/ORACLE-DELTAS.tsv"
const provenanceHeader = "new path\told path\tbase sha\told sha256\tnew sha256\tsubstitutions\n"
const deltasHeader = "file\tpointer\tkind\tsource\trow\timported value\tv3 value\n"
const objectCasePath = "crates/omo-computer-core/fixtures/conformance/action-report-object.json"
const nullCasePath = "crates/omo-computer-core/fixtures/conformance/action-report-legacy.json"
const parametersPath = "packages/omo-computer-tool/test/fixtures/published-parameters.fixture.json"

const caseFile = (reportMode: string | undefined): string =>
  JSON.stringify(
    {
      description: "a case",
      steps: [
        {
          send: { id: 1, method: "engine.hello", params: {} },
          expect: [{ message: { id: 1, result: { abi: "omo-computer/1", features: ["action-report"] } } }],
        },
        {
          send: { id: 2, method: "session.open", params: reportMode === undefined ? {} : { reportMode } },
          expect: [{ message: { id: 2, result: { disposition: "delivered_unverified", effect: "unverifiable" } } }],
        },
      ],
    },
    null,
    2,
  ) + "\n"

const parametersFile =
  JSON.stringify(
    { computer: { properties: { action: { type: "string", description: "call: one chain" } } } },
    null,
    2,
  ) + "\n"

function oracleTree(deltaLines: string): Tree {
  // The null-mode case opens reportMode "object" on purpose: only its place on the null-mode list may refuse a replaced line in it.
  const files: Tree = {
    [objectCasePath]: caseFile("object"),
    [nullCasePath]: caseFile("object"),
    [parametersPath]: parametersFile,
  }
  const provenance = Object.entries(files)
    .map(
      ([path, content]) =>
        `${path}\tcrates/senpi-desktop-core/x/${path.split("/").at(-1)}\td79bc6cc\t${sha256("old")}\t${sha256(content)}\t1;0;0\n`,
    )
    .join("")
  return { ...files, [provenancePath]: provenanceHeader + provenance, [deltasPath]: deltasHeader + deltaLines }
}

describe("computer-v3-guards --oracle", () => {
  test("oracle_refuses_an_edited_or_missing_imported_fixture_and_an_unlisted_case_without_the_v3_prefix", () => {
    withRepo((repo) => {
      // given imported files byte-equal to their provenance rows and new cases prefixed v3-
      repo.write({
        ...oracleTree(""),
        "crates/omo-computer-core/fixtures/conformance/v3-settle.json": "{}\n",
        "crates/omo-computer-backend-fake/fixtures/v3-busy.json": "{}\n",
      })
      repo.commit("oracle")
      expectPass(repo.guard("--oracle"))

      // when an imported fixture is edited, another is deleted and an unprefixed new file appears
      repo.write({
        [objectCasePath]: caseFile("object") + " ",
        "crates/omo-computer-backend-fake/fixtures/extra.json": "{}\n",
      })
      repo.remove(nullCasePath)
      repo.commit("edited")

      // then each is a finding
      expectFindings(repo.guard("--oracle"), "action-report-object.json", "action-report-legacy.json", "extra.json")
    })
  })

  test("oracle_refuses_an_empty_or_headerless_provenance_or_deltas_ledger", () => {
    withRepo((repo) => {
      // given zero-byte ORACLE-PROVENANCE and ORACLE-DELTAS files
      repo.write({ [provenancePath]: "", [deltasPath]: "" })
      repo.commit("empty")

      // then --oracle names both files and exits 1
      expectFindings(repo.guard("--oracle"), "ORACLE-PROVENANCE.tsv is empty", "ORACLE-DELTAS.tsv is empty")

      // when each file holds one junk line instead of its header
      repo.write({
        [provenancePath]: "junk\n",
        [deltasPath]: `${objectCasePath}\t/result/abi\tadditive\tAC-1\t12\t\t\n`,
      })
      repo.commit("headerless")

      // then the missing header is a finding for each file
      expectFindings(repo.guard("--oracle"), "ORACLE-PROVENANCE.tsv line 1", "ORACLE-DELTAS.tsv line 1")
    })
  })

  test("oracle_rejects_a_delta_line_that_would_relax_a_member_an_imported_expectation_lists", () => {
    withRepo((repo) => {
      // given additive lines for members no imported expectation lists, and a reworded description
      repo.write(
        oracleTree(
          `${objectCasePath}\t/result/generation\tadditive\td-arch.md hello\t12\t\t\n` +
            `*\t/**/settle\tadditive\tAC-40\t19\t\t\n` +
            `${parametersPath}\t/computer/properties/*/description\treworded\tAC-3\t34\t\t\n`,
        ),
      )
      repo.commit("additive")
      expectPass(repo.guard("--oracle"))

      // when an additive line matches a listed member, a wildcard one matches a listed member, and a reworded one is no description
      repo.write(
        oracleTree(
          `${objectCasePath}\t/result/abi\tadditive\tAC-1\t12\t\t\n` +
            `*\t/**/features/*\tadditive\tAC-2\t12\t\t\n` +
            `${parametersPath}\t/computer/properties/action/type\treworded\tAC-3\t34\t\t\n` +
            `${objectCasePath}\t/result/x\tmistyped\tAC-3\t34\t\t\n`,
        ),
      )
      repo.commit("relaxing")

      // then each line is a finding
      expectFindings(
        repo.guard("--oracle"),
        "/result/abi",
        "/**/features/*",
        "/computer/properties/action/type",
        "mistyped",
      )
    })
  })

  test("oracle_rejects_a_replaced_line_in_a_null_mode_case_or_with_a_wrong_imported_value", () => {
    withRepo((repo) => {
      // given a replaced line in an object-mode case naming the imported value and a differing v3 value
      repo.write(
        oracleTree(`${objectCasePath}\t/result/disposition\treplaced\tAC-61\t13\t"delivered_unverified"\t"observed"\n`),
      )
      repo.commit("replaced")
      expectPass(repo.guard("--oracle"))

      // when a replaced line sits in a null-mode case, names a wrong imported value, keeps the value, or cites no contract criterion
      repo.write(
        oracleTree(
          `${nullCasePath}\t/result/disposition\treplaced\tAC-61\t13\t"delivered_unverified"\t"observed"\n` +
            `${objectCasePath}\t/result/effect\treplaced\tAC-61\t13\t"verified"\t"observed"\n` +
            `${objectCasePath}\t/result/disposition\treplaced\tAC-61\t13\t"delivered_unverified"\t"delivered_unverified"\n` +
            `${objectCasePath}\t/result/disposition\treplaced\td-safety.md only\t13\t"delivered_unverified"\t"observed"\n`,
        ),
      )
      repo.commit("bad replaced")

      // then each line is a finding
      expectFindings(repo.guard("--oracle"), "line 2", "line 3", "line 4", "line 5")
    })
  })
})

describe("computer-v3-guards --stubs", () => {
  test("stubs_refuses_unimplemented_todo_skip_only_and_a_bare_ignore", () => {
    withRepo((repo) => {
      // given new sources with a live-ignored test, and stub words only outside the new directories
      repo.write({
        "crates/omo-computer-core/src/lib.rs":
          '#[cfg(test)]\nmod tests {\n    #[test]\n    #[ignore = "live: needs a display"]\n    fn capture() {}\n}\n',
        "packages/omo-computer-sdk/test/a.test.ts": 'import { it } from "vitest"\nit("works", () => {})\n',
        "docs/notes.md": "unimplemented!() and it.skip( are forbidden\n",
      })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when the new directories carry each forbidden form
      repo.write({
        "crates/omo-computer-session/src/lib.rs":
          'fn a() { unimplemented!() }\nfn b() { todo!("later") }\n#[test]\n#[ignore]\nfn c() {}\n',
        "packages/omo-computer-tool/test/a.test.ts": 'it.skip("a", () => {})\ndescribe.only("b", () => {})\n',
      })
      repo.commit("stubs")

      // then each line is a finding
      expectFindings(
        repo.guard("--stubs"),
        "crates/omo-computer-session/src/lib.rs:1:",
        "crates/omo-computer-session/src/lib.rs:2:",
        "crates/omo-computer-session/src/lib.rs:4:",
        "packages/omo-computer-tool/test/a.test.ts:1:",
        "packages/omo-computer-tool/test/a.test.ts:2:",
      )
    })
  })
})

describe("computer-v3-guards --stubs domain and --residue on disk", () => {
  test("stubs_scans_every_file_under_the_new_directories", () => {
    withRepo((repo) => {
      // given a .test.tsx file under a new package with no stub
      repo.write({ "packages/omo-computer-sdk/test/ok.test.tsx": 'it("runs", () => {})\n' })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when a .test.tsx file skips a test
      repo.write({ "packages/omo-computer-sdk/test/missed.test.tsx": 'test.skip("must run", () => {})\n' })
      repo.commit("skipped")

      // then it is a finding, whatever the extension
      expectFindings(repo.guard("--stubs"), "packages/omo-computer-sdk/test/missed.test.tsx:1:")
    })
  })

  test("residue_refuses_a_tracked_or_on_disk_file_path_that_names_the_old_family", () => {
    withRepo((repo) => {
      // given old names only in the paths of the legacy-name exclusions
      repo.write({
        "README.md": "the computer module\n",
        "changes/unreleased/senpi-desktop-removal.md": "removed\n",
        "crates/omo-computer-core/parity/senpi_desktop-ids.tsv": "ids\n",
      })
      repo.commit("clean")
      expectPass(repo.guard("--residue"))

      // when a tracked doc and an ignored on-disk file carry the old name in their path, with neutral content
      repo.write({
        "docs/senpi-desktop-notes.md": "notes\n",
        ".gitignore": "*.log\n",
        "logs/SENPI_Desktop.log": "neutral\n",
      })
      repo.commit("named paths")

      // then each path is a finding
      expectFindings(repo.guard("--residue"), "docs/senpi-desktop-notes.md", "logs/SENPI_Desktop.log")
    })
  })

  test("stubs_refuses_a_skip_or_only_reached_through_a_modifier", () => {
    withRepo((repo) => {
      // given modifier chains that neither skip nor focus
      repo.write({
        "packages/omo-computer-sdk/test/a.test.ts":
          'it.concurrent("runs", () => {})\ntest.each([1])("case %d", () => {})\ndescribe.each([1])("group", () => {})\n',
      })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when a chain skips or focuses through a modifier
      repo.write({
        "packages/omo-computer-sdk/test/b.test.ts":
          'it.concurrent.skip("a", () => {})\ntest.skip.each([1])("b", () => {})\ndescribe.only.each([1])("c", () => {})\n',
      })
      repo.commit("chains")

      // then each line is a finding
      expectFindings(repo.guard("--stubs"), "b.test.ts:1:", "b.test.ts:2:", "b.test.ts:3:")
    })
  })

  test("stubs_refuses_a_todo_test", () => {
    withRepo((repo) => {
      // given tests whose titles or variables merely say todo
      repo.write({
        "packages/omo-computer-tool/test/a.test.ts": 'const todo = 1\nit("keeps the todo list", () => {})\n',
      })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when test.todo and it.todo declare placeholder tests
      repo.write({ "packages/omo-computer-tool/test/b.test.ts": 'test.todo("later")\nit.todo("later too")\n' })
      repo.commit("todos")

      // then each line is a finding
      expectFindings(repo.guard("--stubs"), "b.test.ts:1:", "b.test.ts:2:")
    })
  })

  test("stubs_refuses_an_ignore_through_cfg_attr_and_keeps_the_live_reason_form", () => {
    withRepo((repo) => {
      // given a live-ignored test and a cfg_attr that does not ignore
      repo.write({
        "crates/omo-computer-core/src/lib.rs":
          '#[cfg_attr(test, derive(Debug))]\nstruct A;\n#[test]\n#[ignore = "live: needs a display"]\nfn capture() {}\n',
      })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when cfg_attr ignores a test, with or without a reason
      repo.write({
        "crates/omo-computer-safety/src/lib.rs":
          '#[test]\n#[cfg_attr(test, ignore)]\nfn a() {}\n#[cfg_attr(target_os = "linux", ignore = "flaky")]\nfn b() {}\n',
      })
      repo.commit("cfg_attr")

      // then each is a finding
      expectFindings(
        repo.guard("--stubs"),
        "crates/omo-computer-safety/src/lib.rs:2:",
        "crates/omo-computer-safety/src/lib.rs:4:",
      )
    })
  })

  test("stubs_refuses_a_cfg_attr_ignore_with_nested_arguments_or_across_lines", () => {
    withRepo((repo) => {
      // given cfg_attr attributes whose attribute list has no ignore: flat, nested, and across lines with "ignore" only in the condition
      repo.write({
        "crates/omo-computer-core/src/lib.rs": [
          "#[cfg_attr(test, derive(Debug))]",
          "struct A;",
          "#[cfg_attr(all(test, unix), derive(Debug, Clone))]",
          "struct B;",
          "#[cfg_attr(",
          '    feature = "ignore",',
          "    derive(Debug)",
          ")]",
          "struct C;",
          "#[test]",
          '#[ignore = "live: needs a display"]',
          "fn capture() {}",
          "",
        ].join("\n"),
      })
      repo.commit("clean")
      expectPass(repo.guard("--stubs"))

      // when cfg_attr ignores under a nested condition, across lines, and after another attribute in its list
      repo.write({
        "crates/omo-computer-session/src/lib.rs": [
          "#[cfg_attr(all(test, unix), ignore)]",
          "fn a() {}",
          "#[cfg_attr(",
          "    test,",
          "    ignore",
          ")]",
          "fn b() {}",
          '#[cfg_attr(any(windows, target_os = "macos"), derive(Debug), ignore = "flaky")]',
          "fn c() {}",
          "",
        ].join("\n"),
      })
      repo.commit("nested and multi-line cfg_attr")

      // then each attribute is one finding at the line where it opens
      expectFindings(
        repo.guard("--stubs"),
        "crates/omo-computer-session/src/lib.rs:1:",
        "crates/omo-computer-session/src/lib.rs:3:",
        "crates/omo-computer-session/src/lib.rs:8:",
      )
    })
  })

  test("residue_refuses_a_class_a_path_that_exists_on_disk_as_an_empty_or_ignored_directory", () => {
    withRepo((repo) => {
      repo.write({ "README.md": "the computer module\n" })
      repo.commit("clean")
      expectPass(repo.guard("--residue"))

      // when the old crate's directory remains on disk, empty
      mkdirSync(join(repo.root, "crates/senpi-desktop-core"), { recursive: true })

      // then it is a finding
      expectFindings(repo.guard("--residue"), "crates/senpi-desktop-core still exists")

      // when it holds only a file that git ignores
      repo.write({ ".gitignore": "crates/\n", "crates/senpi-desktop-core/retained.txt": "kept\n" })
      repo.commit("ignore crates")

      // then it is still a finding
      expectFindings(repo.guard("--residue"), "crates/senpi-desktop-core still exists")
    })
  })
})

describe("computer-v3-guards command line", () => {
  test("cli_prints_one_line_per_finding_and_exits_1_and_exits_0_silently_after_a_clean_scan", () => {
    withRepo((repo) => {
      repo.write({ "crates/senpi-desktop-core/src/lib.rs": "old\n" })
      repo.commit("base")
      repo.git("branch", "base")
      const cli = (...args: string[]) =>
        Bun.spawnSync([process.execPath, guardScript, ...args], {
          cwd: repo.root,
          env: isolatedEnv,
          stdout: "pipe",
          stderr: "pipe",
        })

      // given a clean branch, then the same branch with an old file edited
      const clean = cli("--old-frozen", "base")
      expect(clean.stdout.toString()).toBe("")
      expect(clean.exitCode).toBe(0)
      repo.write({ "crates/senpi-desktop-core/src/lib.rs": "old\nmore\n" })
      repo.commit("touch")
      const dirty = cli("--old-frozen", "base")

      // then the finding is printed and the exit code is 1; an unknown ref is a finding too, never a pass
      expect(dirty.stdout.toString()).toBe("old-frozen: crates/senpi-desktop-core/src/lib.rs\n")
      expect(dirty.exitCode).toBe(1)
      const badRef = cli("--old-frozen", "no-such-ref")
      expect(badRef.exitCode).toBe(1)
      expect(badRef.stdout.toString()).toContain("no-such-ref")
    })
  })

  test("cli_prints_usage_and_exits_2_for_an_unknown_sub_command", () => {
    const result = Bun.spawnSync([process.execPath, guardScript, "--nope"], {
      cwd: tmpdir(),
      env: isolatedEnv,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr.toString()).toContain("usage")
  })
})
