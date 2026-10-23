/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  customMessage,
  editResult,
  evalRun,
  type FixtureEntry,
  hostBash,
  toolCall,
  toolResult,
} from "./entries.test-support"
import { buildTimeline } from "./evidence"

function checks(entries: readonly FixtureEntry[]): Array<[string, string, number]> {
  return buildTimeline(entries).checks.map((check) => [check.kind, check.outcome, Math.floor(check.at)])
}

describe("claim-receipt evidence timeline", () => {
  describe("#given a check run through an eval host bash call", () => {
    it("#then reads the outcome from ok and the result preview", () => {
      const passed = evalRun("c1", { code: "await tool.bash({ command: 'bun test' })" }, [hostBash("bun test src", " 12 pass\n 0 fail")])
      const failed = evalRun("c2", { code: "await tool.bash({ command: 'tsgo --noEmit' })" }, [hostBash("tsgo --noEmit", "error TS2322: nope", false)])
      expect(checks(passed)).toEqual([["test", "passed", 1]])
      expect(checks(failed)).toEqual([["typecheck", "failed", 1]])
    })
  })

  describe("#given a check command inside eval cell code", () => {
    it("#then a cell can support a claim but never contradicts one, because free-form cell code cannot attribute a failure", () => {
      expect(checks(evalRun("c1", { code: "await sh(`bun test x`)", output: " 35 pass\n 0 fail" }))).toEqual([["test", "passed", 1]])
      expect(checks(evalRun("c2", { code: "await sh(`bun test x`)", output: "boom", status: "error" }))).toEqual([["test", "unknown", 1]])
      expect(checks(evalRun("c5", { code: "await sh(`bun test x`)", output: " 3 pass\n 1 fail" }))).toEqual([["test", "unknown", 1]])
      expect(checks(evalRun("c3", { code: "await sh(`bun test x`)", output: "still going" }))).toEqual([["test", "unknown", 1]])
      expect(checks(evalRun("c4", { code: "await sh(`ls`)", output: "a\nb" }))).toEqual([])
    })

    it("#then a deliberate mutation probe that fails is not a failed check", () => {
      const probe = evalRun("m1", { code: "const mut = orig.replace(a, b)\nawait sh(`bun test x`)", output: " 3 pass\n 1 fail" })
      expect(checks(probe)).toEqual([["test", "unknown", 1]])
    })

    it("#then a detached cell that later fails stays unknown, like any cell failure", () => {
      const entries = [
        ...evalRun("call_8", { code: "await sh(`bun test x`)", output: "", status: "detached" }),
        customMessage("senpi-codemode:notification", "<system-reminder>Detached eval cell call_8 (py) failed.\n 1 fail</system-reminder>"),
      ]
      expect(checks(entries)).toEqual([["test", "unknown", 1], ["test", "unknown", 2]])
    })

    it("#then reads vitest summaries and vp test runs", () => {
      const vitest = evalRun("vt", { code: "await sh(`vp run --filter server test`)", output: " Test Files  3 passed (3)\n      Tests  8 passed (8)" })
      const red = evalRun("vr", { code: "await tool.bash({ command: 'vp test' })" }, [hostBash("vp test x", "      Tests  1 failed | 12 passed (13)")])
      expect(checks(vitest)).toEqual([["test", "passed", 1]])
      expect(checks(red)).toEqual([["test", "failed", 1]])
    })

    it("#then recognises CI status and combined check commands", () => {
      const ci = evalRun("g1", { code: "await tool.bash({ command: 'gh pr checks 12' })" }, [hostBash("gh pr checks 12", "build\tpass\t1m\thttps://x\ntest\tpass\t2m\thttps://y")])
      const pending = evalRun("g2", { code: "await tool.bash({ command: 'gh pr checks 12' })" }, [hostBash("gh pr checks 12", "build\tpass\t1m\thttps://x\ntest\tpending\t0\thttps://y")])
      const vp = evalRun("v1", { code: "await sh(`vp check`)", output: "Found 0 errors and 3 warnings" })
      expect(checks(ci)).toEqual([["test", "passed", 1]])
      expect(checks(pending)).toEqual([["test", "unknown", 1]])
      expect(checks(vp)).toEqual([["typecheck", "passed", 1], ["lint", "passed", 1]])
    })

    it("#then resolves a detached cell from its completion notification", () => {
      const entries = [
        ...evalRun("call_7", { code: "await sh(`bun run typecheck`)", output: "", status: "detached" }),
        customMessage("senpi-codemode:notification", "<system-reminder>Detached eval cell call_7 (js) completed.\nTYPECHECK_EXIT=0</system-reminder>"),
      ]
      expect(checks(entries)).toEqual([["typecheck", "unknown", 1], ["typecheck", "passed", 2]])
    })
  })

  describe("#given a background check that reports through a notification", () => {
    const start = (command: string, id: string) =>
      evalRun("c1", { code: "await tool.bash({ run_in_background: true })" }, [
        hostBash(command, `Command running in background with ID: ${id}`, true, { run_in_background: true }),
      ])

    it("#then the matching terminal notification decides the outcome at its own position", () => {
      const ok = [...start("bun test", "bash_2"), customMessage("senpi-terminal:notification", "<system-reminder>Background terminal session bash_2 finished: completed (exit code 0).</system-reminder>")]
      const bad = [...start("bun test", "bash_2"), customMessage("senpi-terminal:notification", "<system-reminder>Background terminal session bash_2 finished: completed (exit code 1).</system-reminder>")]
      const killed = [...start("bun test", "bash_2"), customMessage("senpi-terminal:notification", "<system-reminder>Background terminal session bash_2 finished: killed (exit code 0).</system-reminder>")]
      const other = [...start("bun test", "bash_2"), customMessage("senpi-terminal:notification", "<system-reminder>Background terminal session bash_9 finished: completed (exit code 0).</system-reminder>")]
      expect(checks(ok)).toEqual([["test", "passed", 2]])
      expect(checks(bad)).toEqual([["test", "failed", 2]])
      expect(checks(killed)).toEqual([])
      expect(checks(other)).toEqual([])
    })

    it("#then a monitor that failed to start or timed out is not a failed check", () => {
      const refused = evalRun("c9", { code: "await tool.monitor(spec)" }, [{ name: "monitor", ok: false, args: { command: "bun test" }, resultPreview: "" }])
      const timedOut = [
        ...start("bun test", "bash_7"),
        customMessage("senpi-monitor:notification", "<system-reminder>Monitor event(suites): watcher timed_out (exit code 1)</system-reminder>", { monitors: [{ id: "bash_7" }] }),
      ]
      expect(checks(refused)).toEqual([])
      expect(checks(timedOut)).toEqual([])
      const testTimeout = [
        ...start("bun test", "bash_8"),
        customMessage("senpi-monitor:notification", "<system-reminder>Monitor event(t): (fail) x > y [5001ms] timed out after 5000ms\n 3 pass\n 1 fail\nwatcher completed (exit code 1)</system-reminder>", { monitors: [{ id: "bash_8" }] }),
      ]
      expect(checks(testTimeout)).toEqual([["test", "failed", 2]])
    })

    it("#then a monitor event for that id decides it, including one bundled inside a wake", () => {
      const content = "<system-reminder>Monitor event(run tests): TEST_EXIT=0\nwatcher completed (exit code 0)</system-reminder>"
      const direct = [...start("bun test", "bash_3"), customMessage("senpi-monitor:notification", content, { monitors: [{ id: "bash_3" }] })]
      const wake = [
        ...start("bun test", "bash_3"),
        customMessage("omo-senpi:wake", `prefix\n${content}`, [
          { customType: "senpi-monitor:notification", details: { monitors: [{ id: "bash_3" }] }, contentRange: [7, 7 + content.length] },
        ]),
      ]
      expect(checks(direct)).toEqual([["test", "passed", 2]])
      expect(checks(wake)).toEqual([["test", "passed", 2]])
    })

    it("#then key=value summaries are read by their value, never by the number before them", () => {
      const settle = (line: string) => [
        ...start("while true; do o=$(gh pr checks 9); done", "bash_4"),
        customMessage("senpi-monitor:notification", `<system-reminder>Monitor event(CI settle): ${line}\nwatcher completed (exit code 0)</system-reminder>`, { monitors: [{ id: "bash_4" }] }),
      ]
      expect(checks(settle("CI_SETTLED total=46 fail=0"))).toEqual([["test", "passed", 2]])
      expect(checks(settle("CI_SETTLED #1197 fail=[] #1198 fail=[]"))).toEqual([["test", "passed", 2]])
      expect(checks(settle("CI_SETTLED total=46 fail=2"))).toEqual([["test", "failed", 2]])
      expect(checks(settle("CI_SETTLED #1197 fail=[lint] #1198 fail=[]"))).toEqual([["test", "failed", 2]])
    })
  })

  describe("#given a command that only mentions a check", () => {
    const bash = (id: string, command: string, text: string, isError = false) => [
      toolCall(id, "bash", { command }),
      toolResult(id, "bash", { text, isError }),
    ]

    it("#then echo, grep, rg and git messages are not check runs (a grep is at most a lookup)", () => {
      expect(checks(bash("m1", "echo bun test", "bun test"))).toEqual([])
      expect(checks(bash("m2", "grep -rn vitest packages/", "a.ts: FAIL vitest"))).toEqual([["lookup", "passed", 1]])
      expect(checks(bash("m3", 'rg -n "bun test" docs/', "docs/x.md: FAIL: 2 fail"))).toEqual([["lookup", "passed", 1]])
      expect(checks(bash("m4", 'git commit -m "fix lint and tsc"', "[main 1] fix lint"))).toEqual([])
      const host = evalRun("m5", { code: "await tool.bash({ command: 'echo bun test' })" }, [hostBash("echo bun test && grep vitest x", " 1 fail")])
      expect(checks(host)).toEqual([["lookup", "passed", 1]])
    })

    it("#then real invocations behind cd, env, timeout, bash -c and heavy-slot still count, one kind per segment", () => {
      expect(checks(bash("r1", "cd pkg && CI=1 timeout -k 10 300 bun test src", " 3 pass\n 0 fail"))).toEqual([["test", "passed", 1]])
      expect(checks(bash("r2", "bash -c 'bunx tsgo --noEmit -p x'", "", true))).toEqual([["typecheck", "failed", 1]])
      expect(checks(bash("r3", "HEAVY_BUDGET=600 ~/.omo/omocat/heavy-slot.sh lab -- bun run test:senpi", " 9 pass\n 0 fail"))).toEqual([["test", "passed", 1]])
      expect(checks(bash("r4", "npx vitest run && pnpm run lint", "Found 0 errors"))).toEqual([["test", "passed", 1], ["lint", "passed", 1]])
    })

    it("#then runners, task tools, scripts and wrapper flags still reach the real check", () => {
      const kinds = (command: string) => checks(bash("w", command, " 3 pass\n 0 fail")).map(([kind]) => kind)
      expect(kinds("uv run pytest tests/")).toEqual(["test"])
      expect(kinds("python -m pytest -q")).toEqual(["test"])
      expect(kinds("poetry run pytest")).toEqual(["test"])
      expect(kinds("python3 -m mypy src")).toEqual(["typecheck"])
      expect(kinds("make test")).toEqual(["test"])
      expect(kinds("just lint")).toEqual(["lint"])
      expect(kinds("bun run scripts/qa/claim-receipt-e2e.mjs out")).toEqual(["run"])
      expect(kinds("bash packages/x/scripts/qa/run.sh")).toEqual(["run"])
      expect(kinds("./scripts/qa/run.sh")).toEqual(["run"])
      expect(kinds("env -i HOME=/h PATH=/p bun test x")).toEqual(["test"])
      expect(kinds("time -p bun test x")).toEqual(["test"])
    })

    it("#then heredoc bodies are file contents, not commands", () => {
      expect(checks(bash("h", "cat > run.sh <<'EOF'\nbun test x\nEOF", ""))).toEqual([])
    })

    it("#then an eval cell counts only shell strings that invoke a check, not prose or greps about one", () => {
      expect(checks(evalRun("e1", { code: 'print("run bun test later")', output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e2", { code: "await sh(`grep -c vitest log.txt`)", output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e5", { code: 'log("bun test passed")\nconst label = "tsc --noEmit"', output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e6", { code: "r = subprocess.run(['bash','-c','bun test x'])", output: " 3 pass\n 0 fail" }))).toEqual([["test", "passed", 1]])
      expect(checks(evalRun("e7", { code: "await tool.bash({ command: 'bun test x' })", output: " 3 pass\n 0 fail" }))).toEqual([["test", "passed", 1]])
      expect(checks(evalRun("e8", { code: "print(await q(`gh pr checks 213 --repo o/r 2>&1 | head`))", output: "lint\tpass\t1m\te2e\tpass\t2m" }))).toEqual([["test", "passed", 1]])
      expect(checks(evalRun("e9", { code: "const p = Bun.spawn(['gh', 'pr', 'checks', String(n)], { stdout: 'pipe' })", output: "lint\tpass\t1m" }))).toEqual([["test", "passed", 1]])
      expect(checks(evalRun("e11", { code: 'for c in ["bun test packages/x", "tsgo --noEmit"]:\n    sh(c)', output: " 3 pass\n 0 fail" })).map(([kind]) => kind)).toEqual(["test", "typecheck"])
      expect(checks(evalRun("e12", { code: 'tool.edit({ edits: [{ newText: "bun test packages/x" }] })\nPath(p).write_text("bun test x")\nexpect(argv).toEqual(["bun", "test"])', output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e13", { code: 'render("bun test x")\nconst hint = done ? "tsc --noEmit" : ""', output: " 3 pass\n 0 fail" }))).toEqual([])
      const runners = 'await sh2(`bun test a`)\nrd("vp check")\nos.system("tsgo --noEmit")\nconst cmd = "bun run build"\nawait tool.monitor({ command: `bun run lint` })'
      expect(checks(evalRun("e14", { code: runners, output: " 3 pass\n 0 fail" })).map(([kind]) => kind).sort()).toEqual(["build", "lint", "test", "typecheck"])
      const textNames = 'summary = "bun test x passed"\nstatus: "tsgo --noEmit ok"\nshow("bun test passed")\nruntime("bun test x")\nx.should("bun test x")\ncommand_output = "bun test x"\nf(["a"], "bun test x")'
      expect(checks(evalRun("e15", { code: textNames, output: " 3 pass\n 0 fail" }))).toEqual([])
      const argvWithMessage = 'subprocess.run(["git", "commit", "-m", "bun test x green"])\nsh(["gh", "pr", "comment", "1", "-b", "tsgo --noEmit passes"])'
      expect(checks(evalRun("e16", { code: argvWithMessage, output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e17", { code: 's = f"bun test {x}"\ncmds = ["bun test a"]\nsh(cmds[0])', output: " 3 pass\n 0 fail" })).map(([kind]) => kind)).toEqual(["test"])
      expect(checks(evalRun("e10", { code: "write(f'{R}/run.sh', 'bun test x')\nopen(f, 'w').write('tsc --noEmit')\nassert 'bun test' in s", output: " 3 pass\n 0 fail" }))).toEqual([])
      expect(checks(evalRun("e3", { code: "await sh(`cd ${WT} && bun test x`)", output: " 3 pass\n 0 fail" }))).toEqual([["test", "passed", 1]])
      const python = 'r = subprocess.run(f"""cd {W0} &&\n CI=1 bun test packages/x 2>&1 | tail -3""", shell=True)'
      expect(checks(evalRun("e4", { code: python, output: " 3 pass\n 0 fail" }))).toEqual([["test", "passed", 1]])
    })
  })

  describe("#given a lookup that shows something exists", () => {
    it("#then read, grep and symbol lookups are recorded as passed lookups", () => {
      const read = [toolCall("k1", "read", { path: "src/a.ts" }), toolResult("k1", "read", { text: "export const x = 1" })]
      const grep = [toolCall("k2", "bash", { command: "rg -n flag src/config.ts" }), toolResult("k2", "bash", { text: "12: flag" })]
      const missing = [toolCall("k3", "read", { path: "src/b.ts" }), toolResult("k3", "read", { text: "ENOENT", isError: true })]
      expect(checks(read)).toEqual([["lookup", "passed", 1]])
      expect(checks(grep)).toEqual([["lookup", "passed", 1]])
      expect(checks(missing)).toEqual([])
    })
  })

  describe("#given a check the harness refused before it ran", () => {
    it("#then the refusal is not a failed check", () => {
      const missing = [toolCall("b1", "bash", { command: "bun test" }), toolResult("b1", "bash", { isError: true, text: "Tool bash not found. Run bash inside an eval cell." })]
      const denied = evalRun("b2", { code: "await tool.bash({ command: 'bun test' })" }, [hostBash("bun test", "Permission denied by policy: bash", false)])
      const ran = [toolCall("b3", "bash", { command: "bun test" }), toolResult("b3", "bash", { isError: true, text: " 2 pass\n 1 fail" })]
      expect(checks(missing)).toEqual([["test", "unknown", 1]])
      expect(checks(denied)).toEqual([["test", "unknown", 1]])
      expect(checks(ran)).toEqual([["test", "failed", 1]])
    })
  })

  describe("#given a managed lsp diagnostics result", () => {
    it("#then a clean report is a passed lsp check", () => {
      const entries = [toolCall("l1", "lsp_diagnostics", { filePath: "src" }), toolResult("l1", "lsp_diagnostics", { text: "Files scanned: 6\nFiles with errors: 0\nTotal diagnostics: 0" })]
      expect(checks(entries)).toEqual([["lsp", "passed", 1]])
    })
  })

  describe("#given file edits", () => {
    it("#then marks code edits relevant and notes or evidence edits not relevant", () => {
      const timeline = buildTimeline([
        ...editResult("e1", "src/a.ts"),
        ...editResult("e2", ".omo/evidence/run/summary.md"),
        ...editResult("e3", "/Users/Shared/omo-runs/lane/rerun.sh"),
      ])
      expect(timeline.edits.map((edit) => [edit.paths, edit.relevant])).toEqual([
        [["src/a.ts"], true],
        [[".omo/evidence/run/summary.md"], false],
        [["/Users/Shared/omo-runs/lane/rerun.sh"], false],
      ])
    })

    it("#then writes and git commands inside eval cells are not edits, because cells write scratch files and compose text", () => {
      const edits = (code: string) => buildTimeline(evalRun("w", { code, output: " 3 pass\n 0 fail" })).edits
      expect(edits("await Bun.write(`${W}/zzScratch.test.ts`, s)\nawait sh(`bun test`)")).toEqual([])
      expect(edits("open(p, 'w').write(brief)")).toEqual([])
      expect(edits("await sh(`git merge-tree --write-tree HEAD origin/dev`)")).toEqual([])
    })
  })
})
