import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OPS, foldSamples } from "./bench.mjs"
import { compareBench, dispositionHistogram, exitCodeFor, judge, mismatched, oracleRow, percentile, summarize } from "./eval-core.mjs"
import { cuaActions, modelScript, parseReadback, planCode, readbackCode, traceDisposition } from "./model-arms.mjs"
import { restoreAndObserve, runSdkTask } from "./run.mjs"
import { TASKS, pressesReached, textLanded } from "./tasks.mjs"

const byId = Object.fromEntries(TASKS.map((task) => [task.id, task]))
const sha16 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16)
const oracle = (task, outcome, mismatch = false) => {
  const surface = byId[task].fake
  return judge(surface.oracle({ ...outcome, expect: mismatch ? mismatched(surface.expect) : surface.expect }))
}

describe("cu-eval tasks", () => {
  test("#given the task table #when listed #then seven distinct tasks each carry a fake and a live surface with a restore", () => {
    // DESIGN section 10 fixes the eval set at seven tasks; run.mjs keys rows and --tasks/--mismatch by id.
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(7)
    for (const task of TASKS) {
      for (const surface of [task.fake, task.live]) {
        expect(surface.plan.length).toBeGreaterThan(0)
        expect(Array.isArray(surface.restore)).toBe(true)
        expect(typeof surface.oracle).toBe("function")
        expect(typeof surface.postcheck).toBe("function")
      }
    }
  })

  test("#given the form task's real readback #when the expected values are right #then it passes", () => {
    expect(oracle("safari-form-fill", { readback: { name: "Eval Tester", email: "eval@example.com" }, audit: [] })).toBe("pass")
  })

  test("#given the same readback #when a wrong expected value is injected #then the oracle marks the task fail", () => {
    expect(oracle("safari-form-fill", { readback: { name: "Eval Tester", email: "eval@example.com" }, audit: [] }, true)).toBe("fail")
    expect(oracle("textedit-two-windows-target", { readback: { second: "only the second window", first: "" }, audit: [] }, true)).toBe("fail")
  })

  test("#given text typed into the wrong window #when judged #then the two-window task fails", () => {
    expect(oracle("textedit-two-windows-target", { readback: { second: "", first: "only the second window" }, audit: [] })).toBe("fail")
  })

  test("#given an effect only app logic shows #when the fake ran the presses #then the task is unverified, never pass", () => {
    const audit = Array.from({ length: 4 }, () => ({ action: "ax.perform", status: "success", target: "301" }))
    expect(oracle("calculator-multiply", { readback: {}, audit })).toBe("unverified")
    expect(oracle("calculator-multiply", { readback: {}, audit: audit.slice(1) })).toBe("fail")
  })

  test("#given audit lines #when presses and typed text are checked #then AX proof, audit-only delivery and absence are told apart", () => {
    const clicks = [{ action: "click", status: "success", target: "desktop" }]
    expect(pressesReached([{ action: "ax.perform", status: "success", target: "9" }], "9", 1)).toBe(true)
    expect(pressesReached(clicks, "9", 1)).toBe(null)
    expect(pressesReached([{ action: "ax.perform", status: "error", target: "9" }], "9", 1)).toBe(false)
    expect(textLanded("hi", [], "hi")).toBe(true)
    expect(textLanded("", [{ action: "typeText", status: "success", textSha256: sha16("hi") }], "hi")).toBe(null)
    expect(textLanded("", [{ action: "typeText", status: "success", textSha256: sha16("other") }], "hi")).toBe(false)
  })
})

describe("cu-eval arms", () => {
  test("#given a plan #when compiled for the model+tool arm #then the run code performs every step and returns a marked readback", () => {
    const surface = byId["safari-form-fill"].fake
    const code = planCode(surface, surface.plan)
    expect(code.match(/\.setValue\(/g)).toHaveLength(2)
    expect(code).toContain("CUEVAL_DONE")
    expect(readbackCode(surface)).toContain("CUEVAL_READBACK")
    expect(parseReadback('"CUEVAL_READBACK {\\"name\\":\\"a\\",\\"at\\":1}"')).toEqual({ name: "a", at: 1 })
  })

  test("#given the CUA arm #when a plan has a menu path #then the scripted model cannot reach it and sends nothing for it", () => {
    expect(cuaActions(byId["menu-path-select"].fake, byId["menu-path-select"].fake.plan)).toEqual({ actions: [], unreachable: "menu Format > Text > Show Ruler" })
    const calculator = cuaActions(byId["calculator-multiply"].fake, byId["calculator-multiply"].fake.plan)
    expect(calculator.actions[0]).toEqual({ action: "click", x: 250, y: 320 })
    expect(modelScript("model-cua", byId["calculator-multiply"].fake).own.map((step) => step.name)).toEqual(["computer", "computer_actions", "computer_actions"])
  })

  test("#given a live task whose teardown closes the window #when restored #then the oracle sees the window open and the post-check sees it closed", async () => {
    // A Finder-like window that only the teardown op closes: the oracle needs it open, the post-check closed.
    let open = true
    const computer = { windows: async () => (open ? [{ id: 1, app: "Finder", title: "Downloads" }] : []) }
    const live = {
      TEARDOWN_OPS: new Set(["closeWindow"]),
      ops: { closeWindow: async () => ((open = false), []) },
      files: () => ({}),
    }
    const shows = (windows) => windows.some((w) => w.app === "Finder" && w.title === "Downloads")
    const surface = {
      readback: [],
      restore: [{ op: "closeWindow" }],
      expect: {},
      oracle: ({ windows }) => [{ check: "a Finder window shows Downloads", kind: "ax", ok: shows(windows) }],
      postcheck: ({ windows }) => [{ check: "no eval Finder window is left open", kind: "ax", ok: !shows(windows) }],
    }
    const observed = await restoreAndObserve({ computer, win: {}, surface, live, dir: "", remembered: {}, readback: {} })
    const row = oracleRow({ task: { id: "t", title: "t" }, arm: "sdk-direct", surface, mismatch: false, outcome: { ...observed, reports: [], audit: [], restoreAudit: [], steps: 1, wallMs: 1 } })
    expect(open).toBe(false)
    expect(row.status).toBe("pass")
    expect(row.restore.status).toBe("pass")
  })

  test("#given a live task whose plan step throws #when it runs #then every restore and teardown step still runs before the scratch dir goes", async () => {
    // The shared Mac must be left as found on every exit path: a plan error used to skip restore and teardown
    // and delete the scratch files the still-open documents point at.
    const calls = []
    let taskDir
    let dirAtTeardown
    const win = { find: async () => [] }
    const computer = { window: async () => win, close: async () => void calls.push("close") }
    const liveHarness = {
      TEARDOWN_OPS: new Set(["quit"]),
      prepare: (_surface, dir) => void (taskDir = dir),
      waitForWindow: async () => undefined,
      files: () => ({}),
      ops: {
        reset: async () => {
          calls.push("restore")
          throw new Error("reset refused")
        },
        quit: async () => (calls.push("teardown"), (dirAtTeardown = existsSync(taskDir)), []),
      },
    }
    const surface = {
      window: { app: "Eval" },
      plan: [{ op: "press", el: { role: "button", name: "Missing" } }],
      readback: [],
      restore: [{ op: "reset" }, { op: "quit", app: "Eval" }],
      oracle: () => [],
      postcheck: () => [],
    }
    const scratch = mkdtempSync(join(tmpdir(), "cu-eval-test-"))
    try {
      const task = { id: "t", title: "t", live: surface }
      const row = await runSdkTask({ task, enginePath: "unused", live: true, mismatch: false, scratch, liveHarness, open: async () => computer })
      expect(row.status).toBe("error")
      expect(row.error).toContain('no button named "Missing"')
      expect(calls).toEqual(["restore", "teardown", "close"])
      expect(row.restoreErrors).toEqual(["reset: reset refused"])
      expect(dirAtTeardown).toBe(true)
      expect(existsSync(taskDir)).toBe(false)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test("#given trace replies #when folded into the histogram #then reports, legacy null replies and refusals are counted apart", () => {
    const reports = [
      { type: "reply", ok: true, report: { disposition: { delivery: "delivered_unverified" } } },
      { type: "reply", ok: true },
      { type: "reply", ok: false, code: "StaleRef" },
    ].map(traceDisposition)
    expect(dispositionHistogram(reports)).toEqual({ delivered_unverified: 1, legacy_null: 1, "refused:StaleRef": 1 })
  })

  test("#given rows #when summarized #then only fail, error, skip or a failed restore make the exit code non-zero", () => {
    const row = (status, restore = "pass") => ({ status, restore: { status: restore }, dispositions: {}, steps: 1, wallMs: 1 })
    expect(exitCodeFor(summarize([row("pass"), row("unverified")]))).toBe(0)
    expect(exitCodeFor(summarize([row("pass"), row("fail")]))).toBe(1)
    expect(exitCodeFor(summarize([row("pass", "fail")]))).toBe(1)
    expect(exitCodeFor(summarize([row("error")]))).toBe(1)
  })
})

describe("cu-eval bench", () => {
  test("#given samples #when folded #then nearest-rank p50/p95 cover wall time and engine stages", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5)
    expect(percentile([], 50)).toBe(null)
    const folded = foldSamples({ click: [{ wallMs: 1, timings: { dispatch: 10 } }, { wallMs: 3, timings: null }] })
    expect(folded.click).toEqual({ wallMs: { n: 2, p50: 1, p95: 3 }, stagesUs: { dispatch: { n: 1, p50: 10, p95: 10 } }, timedRuns: 1 })
  })

  test("#given a baseline #when an op's p50 rises past 30% and the noise floor #then it is a regression", () => {
    const at = (p50) => ({ ops: { click: { wallMs: { n: 30, p50, p95: p50 } } } })
    expect(compareBench(at(1.2), at(1)).ok).toBe(true)
    // Above 30% but within the 0.5 ms floor: noise on a sub-millisecond op, not a regression.
    expect(compareBench(at(1.45), at(1)).ok).toBe(true)
    expect(compareBench(at(2), at(1)).regressions).toEqual([{ op: "click", reason: "p50", baselineP50: 1, currentP50: 2, limit: 1.3 }])
    expect(compareBench({ ops: {} }, at(1)).regressions).toEqual([{ op: "click", reason: "missing" }])
  })

  test("#given the committed Linux fake baseline #when read #then every bench op has 30 warm samples and the host load", () => {
    const baseline = JSON.parse(readFileSync(join(import.meta.dir, "baselines", "linux-x64-fake.json"), "utf8"))
    expect(Object.keys(baseline.ops).sort()).toEqual(Object.keys(OPS).sort())
    for (const op of Object.values(baseline.ops)) expect(op.wallMs.n).toBe(30)
    expect(typeof baseline.load.before.load1).toBe("number")
  })
})
