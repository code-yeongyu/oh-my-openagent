import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { judgeProfiles } from "../.github/scripts/ci-test-telemetry-report.mjs"
import { descendants, instrumentArguments } from "../.github/scripts/ci-test-telemetry.mjs"

// fileURLToPath, not URL.pathname: the pathname is "/D:/..." on Windows, which Bun cannot resolve.
const collector = fileURLToPath(new URL("../.github/scripts/ci-test-telemetry.mjs", import.meta.url))

async function runCollector(root, args) {
  const child = Bun.spawn([process.execPath, collector, ...args], {
    cwd: root, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GITHUB_STEP_SUMMARY: join(root, "summary.md"), CI_TEST_SHA: "diagnostic-sha" },
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  return { code, output: stdout + stderr, stderr }
}

// Guards the CI wrapper contract: the profile reports its own verdict, separate from the test exit.
test("profile verdict flags missing, fallback, sample-less and erroring profiles", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-profile-verdict-"))
  try {
    const write = (name, value) => writeFileSync(join(root, name), JSON.stringify(value))
    expect(judgeProfiles(join(root, "absent")).problems).toEqual(["no profiled invocation left a boundary snapshot"])
    write("complete.json", {})
    write("complete-profile.json", { fallback: false, sampleCount: 3, errors: [] })
    write("complete-files.json", { files: {} })
    expect(judgeProfiles(root)).toEqual({ invocations: ["complete"], problems: [] })
    write("missing.json", {})
    write("fallback.json", {})
    write("fallback-profile.json", { fallback: true, sampleCount: 0, errors: [{ stage: "setup", type: "TypeError" }] })
    write("erroring.json", {})
    write("erroring-profile.json", { fallback: false, sampleCount: 2, errors: [{ stage: "sample", type: "SyntaxError" }] })
    expect(judgeProfiles(root).problems.sort()).toEqual([
      'erroring: capture errors [{"stage":"sample","type":"SyntaxError"}]',
      'fallback: capture errors [{"stage":"setup","type":"TypeError"}]',
      "fallback: no samples",
      "fallback: ran unprofiled (setup fallback)",
      "missing: profile missing",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("preflight loads every collector module without running anything", async () => {
  const root = mkdtempSync(join(tmpdir(), "ci-profile-preflight-"))
  try {
    const { code, output } = await runCollector(root, ["--preflight"])
    expect(code, output).toBe(0)
    expect(readdirSync(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Guards the cost contract from #10820 review: one long-lived probe process, not one per sample.
test("a run spanning several sample intervals is sampled by one long-lived probe process", async () => {
  const root = mkdtempSync(join(tmpdir(), "ci-profile-sampler-"))
  try {
    writeFileSync(join(root, "bunfig.toml"), '[test]\npreload = ["./setup.mjs"]\n')
    writeFileSync(join(root, "setup.mjs"), "")
    // The fixture's duration is the input: it must outlast at least two 2-second sample intervals.
    writeFileSync(join(root, "slow.test.ts"), 'import {test} from "bun:test"; test("slow", async () => { await Bun.sleep(5000) }, 15000)\n')
    const { code, output } = await runCollector(root, [join(root, "artifacts"), "slow", "2", "test", "--parallel", "./slow.test.ts"])
    expect(code, output).toBe(0)
    const profile = JSON.parse(readFileSync(join(root, "artifacts", "slow-profile.json"), "utf8"))
    expect(profile.errors).toEqual([])
    expect(profile.sampleCount).toBeGreaterThanOrEqual(2)
    const samples = readFileSync(join(root, "artifacts", "slow-samples.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
    const samplerPids = new Set(samples.map((sample) => sample.samplerPid))
    expect(samplerPids.size).toBe(1)
    expect([...samplerPids][0]).toBeGreaterThan(0)
    expect(profile.samplerProcess?.pid).toBe([...samplerPids][0])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30000)

test("diagnostics preserve serial and existing crash-wrapper arguments", () => {
  expect(instrumentArguments(["test", "--timeout", "30000", "one.test.ts"], "config", "files", "2"))
    .toEqual(["--config=config", "test", "--timeout", "30000", "one.test.ts", "--timings=files", "--update-timings"])
  expect(instrumentArguments([
    "script/bun-panic-retry.ts", "--config=original", "test", "--parallel", "rpc-host",
  ], "config", "files", "2")).toEqual([
    "script/bun-panic-retry.ts", "--config=config", "test", "--parallel=2", "rpc-host",
    "--timings=files", "--update-timings",
  ])
})

test("process inventory includes nested children, not unrelated processes", () => {
  const rows = [
    { pid: 10, parentPid: 1, creationTimeUtc: "root" },
    { pid: 12, parentPid: 11, creationTimeUtc: "grandchild" },
    { pid: 11, parentPid: 10, creationTimeUtc: "child" },
    { pid: 13, parentPid: 1, creationTimeUtc: "unrelated" },
  ]
  expect(descendants(rows, 10)).toEqual(rows.slice(0, 3))
})

// A missing file is an ENOENT (name "Error"); a wrong preload shape is the collector's own TypeError.
for (const [name, bunfig, setupMarker, errorType] of [
  ["missing bunfig", null, "absent", "Error"],
  ["string-valued preload", '[test]\npreload = "./setup.mjs"\n', "loaded", "TypeError"],
]) {
  test(`setup failure (${name}) runs the original tests unchanged and records a capture error`, async () => {
    const root = mkdtempSync(join(tmpdir(), "ci-profile-fallback-"))
    const summary = join(root, "summary.md")
    try {
      if (bunfig) writeFileSync(join(root, "bunfig.toml"), bunfig)
      writeFileSync(join(root, "setup.mjs"), 'globalThis.profileSetup = "loaded"\n')
      writeFileSync(join(root, "pass.test.ts"), `import {expect, test} from "bun:test"; test("pass", () => expect(globalThis.profileSetup ?? "absent").toBe(${JSON.stringify(setupMarker)}))\n`)
      writeFileSync(join(root, "fail.test.ts"), 'import {expect, test} from "bun:test"; test("fail", () => expect(1).toBe(2))\n')
      for (const [invocation, file, expectedExit] of [
        ["passed", "./pass.test.ts", 0], ["failed", "./fail.test.ts", 1],
      ]) {
        const { code, output, stderr } = await runCollector(root, [join(root, "artifacts"), invocation, "2", "test", "--parallel", file])
        expect(code, output).toBe(expectedExit)
        expect(stderr).toContain(`[ci-profile] setup capture failed: ${errorType};`)
        const profile = JSON.parse(readFileSync(join(root, "artifacts", `${invocation}-profile.json`), "utf8"))
        expect(profile).toMatchObject({
          fallback: true, exitCode: expectedExit, sampleCount: 0, sha: "diagnostic-sha",
          errors: [{ stage: "setup", type: errorType }],
        })
      }
      expect(readFileSync(summary, "utf8")).toContain("tests ran unprofiled")
      expect(readdirSync(root).some((entry) => entry.startsWith(".ci-telemetry-"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20000)
}

for (const workers of ["4", "2"]) {
  test(`real collector records native file/preload/resource data with ${workers} workers and preserves failures`, async () => {
    const root = mkdtempSync(join(tmpdir(), "ci-profile-"))
    const summary = join(root, "summary.md")
    try {
      writeFileSync(join(root, "bunfig.toml"), '[test]\npreload = ["./setup.mjs"]\n')
      writeFileSync(join(root, "setup.mjs"), 'globalThis.profileSetup = "loaded"\n')
      writeFileSync(join(root, "pass.test.ts"), 'import {expect, test} from "bun:test"; test("pass", () => expect(globalThis.profileSetup).toBe("loaded"))\n')
      writeFileSync(join(root, "fail.test.ts"), 'import {expect, test} from "bun:test"; test("fail", () => expect(1).toBe(2))\n')
      for (const [invocation, file, expectedExit] of [
        ["passed", "./pass.test.ts", 0], ["failed", "./fail.test.ts", 1],
      ]) {
        const child = Bun.spawn([
          process.execPath, collector, join(root, "artifacts"), invocation, workers,
          "test", "--parallel", file,
        ], {
          cwd: root, stdout: "pipe", stderr: "pipe",
          env: { ...process.env, GITHUB_STEP_SUMMARY: summary, CI_TEST_SHA: "diagnostic-sha" },
        })
        const [code, stdout, stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ])
        expect(code, stdout + stderr).toBe(expectedExit)
        const prefix = join(root, "artifacts", invocation)
        const profile = JSON.parse(readFileSync(`${prefix}-profile.json`, "utf8"))
        expect(profile.exitCode).toBe(expectedExit)
        expect(profile.sha).toBe("diagnostic-sha")
        expect(profile.configuredWorkers).toBe(Number(workers))
        expect(profile.sampleCount).toBeGreaterThan(0)
        expect(profile.errors).toEqual([])
        expect(profile.totalMemoryBytes).toBeGreaterThan(0)
        expect(profile.availableCpus).toBeGreaterThan(0)
        expect(profile.preloadEvaluations).toBeGreaterThan(0)
        expect(Object.keys(profile.files).some((path) => path.endsWith(file.slice(2)))).toBe(true)
        const samples = readFileSync(`${prefix}-samples.jsonl`, "utf8").trim().split("\n").map(JSON.parse)
        expect(samples.every((sample) => sample.availableMemoryBytes > 0)).toBe(true)
        expect(samples.every((sample) => sample.childProcessCount >= 0)).toBe(true)
        expect(samples.flatMap((sample) => sample.processes).every((row) => row.creationTimeUtc)).toBe(true)
        const preload = readFileSync(`${prefix}-preload.jsonl`, "utf8").trim().split("\n").map(JSON.parse)
        expect(preload.every((row) => row.module === "./setup.mjs" && row.durationMs >= 0)).toBe(true)
      }
      expect(readFileSync(summary, "utf8")).toContain("diagnostic-sha")
      expect(readdirSync(root).some((name) => name.startsWith(".ci-telemetry-"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20000)
}
