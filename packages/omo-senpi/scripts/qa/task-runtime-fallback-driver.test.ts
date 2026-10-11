/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runFallbackDriver } from "./task-runtime-fallback-driver"

const expected = [{ runner: "child-process", scenario: "user-fallback" }]
const passing = { result: "PASS", scenarios: [{ ...expected[0], result: "PASS", checks: { exit_zero: "PASS" } }] }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-fallback-diagnostics-"))
  const outDir = join(root, "out")
  const evidenceRoot = join(root, "retained")
  mkdirSync(outDir)
  // Native Windows process inspection needs its system module locations in a nested driver too.
  const systemKeys = ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PSModulePath", "ProgramFiles",
    "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "ALLUSERSPROFILE"]
  const env = { ...Object.fromEntries(systemKeys.map((key) => [key, process.env[key]])),
    HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, TMPDIR: root, TEMP: root, TMP: root, OUT: outDir }
  return {
    root, outDir, evidenceRoot, env,
    run: (source: string, overrides: Record<string, unknown> = {}) => runFallbackDriver({
      command: "node", args: ["-e", source], cwd: root, env, outDir, evidenceRoot,
      expected, timeoutMs: 10_000, ...overrides,
    }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
const writeVerdict = (value: unknown) => `require('node:fs').writeFileSync(require('node:path').join(process.env.OUT,'verdict.json'),${JSON.stringify(JSON.stringify(value))});`

async function failure(promise: Promise<unknown>): Promise<string> {
  try { await promise }
  catch (error) { return String(error) }
  throw new Error("expected the driver run to fail")
}

// The real subprocess boundary owns these regressions: mocks cannot lose close arguments or orphan a child.
describe("fallback driver failure evidence", () => {
  test.each([
    { name: "nonzero without verdict", source: "process.exitCode=23;", reason: "exit code=23 signal=null" },
    { name: "malformed verdict", source: "require('node:fs').writeFileSync(require('node:path').join(process.env.OUT,'verdict.json'),'{broken');", reason: "aggregate verdict missing or malformed" },
    { name: "oversized verdict", source: "require('node:fs').writeFileSync(require('node:path').join(process.env.OUT,'verdict.json'),'x'.repeat(1024*1024+1));", reason: "oversized JSON evidence excluded" },
    { name: "nonregular verdict", source: "require('node:fs').mkdirSync(require('node:path').join(process.env.OUT,'verdict.json'));", reason: "non-file evidence excluded" },
    { name: "invalid verdict shape", source: writeVerdict({ scenarios: null }), reason: "aggregate verdict invalid" },
    { name: "missing expected scenario", source: writeVerdict({ result: "PASS", scenarios: [] }), reason: "expected scenarios" },
    { name: "failed checks behind PASS", source: writeVerdict({ ...passing, scenarios: [{ ...passing.scenarios[0], checks: { cleanup: "FAIL" } }] }), reason: "fallback scenario failure" },
    { name: "nonzero with passing verdict", source: writeVerdict(passing) + "process.exitCode=9;", reason: "exit code=9 signal=null" },
  ])("#given $name #when the real child exits #then failure output and evidence survive", async ({ source, reason }) => {
    const f = fixture()
    try {
      // given / when
      const message = await failure(f.run(`console.log('driver stdout sentinel');console.error('driver stderr sentinel');${source}`))
      // then
      expect(message).toContain(reason)
      expect(message).toContain("driver stdout sentinel")
      expect(message).toContain("driver stderr sentinel")
      expect(message).toContain("Retained fallback evidence:")
      expect(existsSync(f.outDir)).toBe(true)
      const retained = join(f.evidenceRoot, readdirSync(f.evidenceRoot)[0]!, "driver-diagnostics.txt")
      expect(readFileSync(retained, "utf8")).toContain(reason)
    } finally { f.cleanup() }
  }, 40_000)

  test("#given a missing executable #when spawn fails #then its error is primary and evidence remains", async () => {
    const f = fixture()
    try {
      const message = await failure(f.run("", { command: join(f.root, "missing-driver") }))
      expect(message).toContain("spawn/process error")
      expect(message).toContain("ENOENT")
      expect(message.indexOf("spawn/process error")).toBeLessThan(message.indexOf("aggregate verdict"))
      expect(readdirSync(f.evidenceRoot)).toHaveLength(1)
    } finally { f.cleanup() }
  }, 40_000)

  test("#given an endless driver #when its deadline expires #then it is reaped and timeout evidence remains", async () => {
    const f = fixture()
    try {
      const source = `const fs=require('node:fs'),p=require('node:path');const stateDir=p.join(process.env.TMPDIR,'owned-state');fs.mkdirSync(p.join(stateDir,'tasks'),{recursive:true});fs.mkdirSync(p.join(stateDir,'logs'));fs.writeFileSync(p.join(stateDir,'tasks','bg_fixture.json'),JSON.stringify({task_id:'bg_fixture',status:'running'}));fs.writeFileSync(p.join(stateDir,'logs','bg_fixture.jsonl'),'task-start-event');fs.writeFileSync(p.join(process.env.OUT,'progress.json'),JSON.stringify({scenarios:[{runner:'child-process',scenario:'user-fallback',stateDir,state:'RUNNING'}]}));console.log('driver-pid='+process.pid);setInterval(()=>{},1000)`
      const message = await failure(f.run(source, { timeoutMs: 2_000 }))
      expect(message, message).toContain("deadline expired after 2000ms")
      const pid = Number(/driver-pid=(\d+)/.exec(message)?.[1])
      expect(pid).toBeGreaterThan(0)
      expect(() => process.kill(pid, 0)).toThrow()
      expect(message).not.toContain("driver did not close after termination")
      expect(message).not.toContain("driver cleanup failed")
      expect(readdirSync(f.evidenceRoot)).toHaveLength(1)
      const retained = join(f.evidenceRoot, readdirSync(f.evidenceRoot)[0]!, "child-process", "user-fallback")
      expect(JSON.parse(readFileSync(join(retained, "task.json"), "utf8")).status).toBe("running")
      expect(readFileSync(join(retained, "task.jsonl.log"), "utf8")).toBe("task-start-event")
    } finally { f.cleanup() }
  }, 40_000)

  test("#given a driver exits leaving a pipe-holding child #when its deadline expires #then the owned descendant is stopped", async () => {
    const f = fixture()
    let unrelated: ReturnType<typeof spawn> | undefined
    let running: Promise<string> | undefined
    try {
      const source = `const {spawn}=require('node:child_process');const fs=require('node:fs'),p=require('node:path');const ready=p.join(process.env.OUT,'child-ready');const child=spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",ready,process.env.TMPDIR],{stdio:['ignore','inherit','inherit'],detached:true});child.once('error',e=>{console.error(e);process.exit(1)});console.log('descendant-pid='+child.pid);const wait=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(wait);process.exit(0)}},10)`
      running = failure(f.run(source, { timeoutMs: 2_000 }))
      const sandbox = readdirSync(f.outDir).find((name) => name.startsWith("driver-sandboxes-"))!
      // A sibling owned by the test, not by the driver's Windows process tree, is truly unrelated.
      unrelated = spawn("node", ["-e", "setInterval(()=>{},1000)", `${join(realpathSync.native(f.outDir), sandbox)}-unrelated`], {
        cwd: f.root, env: f.env, stdio: "ignore",
      })
      await new Promise<void>((resolve, reject) => { unrelated!.once("spawn", resolve); unrelated!.once("error", reject) })
      const message = await running
      expect(message, message).toContain("deadline expired after 2000ms")
      const pid = Number(/descendant-pid=(\d+)/.exec(message)?.[1])
      expect(pid).toBeGreaterThan(0)
      expect(() => process.kill(pid, 0)).toThrow()
      expect(message).not.toContain("driver did not close after termination")
      expect(message).not.toContain("driver cleanup failed")
      expect(unrelated.pid).toBeGreaterThan(0)
      expect(() => process.kill(unrelated!.pid!, 0)).not.toThrow()
    } finally {
      try {
        if (unrelated?.pid !== undefined && unrelated.exitCode === null && unrelated.signalCode === null) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("unrelated fixture did not close")), 5_000)
            unrelated!.once("close", () => { clearTimeout(timer); resolve() })
            try { unrelated!.kill("SIGKILL") }
            catch (error) { clearTimeout(timer); reject(error) }
          })
        }
      } finally { try { await running } finally { f.cleanup() } }
    }
  }, 40_000)

  test.skipIf(process.platform === "win32")("#given a signalled driver #when it closes #then the signal survives missing verdict parsing", async () => {
    const f = fixture()
    try {
      const message = await failure(f.run("process.kill(process.pid,'SIGTERM')"))
      expect(message).toContain("exit code=null signal=SIGTERM")
      expect(message).toContain("aggregate verdict missing or malformed")
    } finally { f.cleanup() }
  }, 40_000)

  test("#given a passing driver #when all expected checks pass #then temporary evidence is removed", async () => {
    const f = fixture()
    try {
      expect(await f.run(writeVerdict(passing))).toEqual(passing.scenarios)
      expect(existsSync(f.outDir)).toBe(false)
      expect(existsSync(f.evidenceRoot)).toBe(false)
    } finally { f.cleanup() }
  }, 40_000)

  test("#given large output and private artifacts #when failure evidence is retained #then only bounded redacted fixture files are copied", async () => {
    const f = fixture()
    try {
      // given: malformed records must not mask the original exit either.
      const dir = join(f.outDir, "child-process", "user-fallback")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "task.json"), "{broken")
      writeFileSync(join(dir, "task.jsonl.log"), "{partial event")
      writeFileSync(join(dir, "auth.json"), "private-file-sentinel")
      writeFileSync(join(dir, "stderr.log"), "fictional-secret-value")
      writeFileSync(join(f.outDir, "progress.json"), JSON.stringify({ active: expected[0], state: "RUNNING" }))
      // when
      const message = await failure(f.run("console.log('x'.repeat(100000)+'stdout-end');console.error(process.env.FAKE_API_KEY);console.log(JSON.stringify({credential_digest_before:'private-hash-sentinel'}));process.exitCode=17", {
        env: { ...f.env, FAKE_API_KEY: "fictional-secret-value" },
      }))
      // then
      expect(message).toContain("exit code=17")
      expect(message).toContain("stdout-end")
      expect(message).toContain("[REDACTED]")
      expect(message).toContain('"state":"RUNNING"')
      expect(message).not.toContain("fictional-secret-value")
      expect(message).not.toContain("private-hash-sentinel")
      expect(message.length).toBeLessThan(15_000)
      const retained = join(f.evidenceRoot, readdirSync(f.evidenceRoot)[0]!)
      expect(existsSync(join(retained, "child-process", "user-fallback", "auth.json"))).toBe(false)
      expect(readFileSync(join(retained, "child-process", "user-fallback", "stderr.log"), "utf8")).toBe("[REDACTED]")
    } finally { f.cleanup() }
  }, 40_000)

  test("#given a symlinked scenario directory #when diagnostics are captured #then outside private data never enters output or artifacts", async () => {
    const f = fixture()
    try {
      const outside = join(f.root, "private")
      mkdirSync(outside)
      for (const file of ["task.json", "task.jsonl.log", "stderr.log"]) writeFileSync(join(outside, file), "outside-private-sentinel")
      mkdirSync(join(f.outDir, "child-process"))
      symlinkSync(outside, join(f.outDir, "child-process", "user-fallback"), process.platform === "win32" ? "junction" : "dir")
      const source = `const fs=require('node:fs'),p=require('node:path');const stateDir=p.join(process.env.TMPDIR,'owned-state');fs.mkdirSync(p.join(stateDir,'tasks'),{recursive:true});fs.mkdirSync(p.join(stateDir,'logs'));fs.writeFileSync(p.join(stateDir,'tasks','bg_fixture.json'),'owned-task');fs.writeFileSync(p.join(stateDir,'logs','bg_fixture.jsonl'),'owned-event');fs.writeFileSync(p.join(process.env.OUT,'progress.json'),JSON.stringify({scenarios:[{runner:'child-process',scenario:'user-fallback',stateDir}]}));process.exitCode=31`
      const message = await failure(f.run(source))
      expect(readdirSync(outside).sort()).toEqual(["stderr.log", "task.json", "task.jsonl.log"])
      for (const file of readdirSync(outside)) expect(readFileSync(join(outside, file), "utf8")).toBe("outside-private-sentinel")
      expect(message).toContain("exit code=31")
      expect(message).toContain("symlink evidence path excluded")
      expect(message).not.toContain("outside-private-sentinel")
      const retained = join(f.evidenceRoot, readdirSync(f.evidenceRoot)[0]!)
      expect(readFileSync(join(retained, "driver-diagnostics.txt"), "utf8")).not.toContain("outside-private-sentinel")
      expect(existsSync(join(retained, "child-process", "user-fallback", "task.json"))).toBe(false)
    } finally { f.cleanup() }
  }, 40_000)

  test("#given the real driver cannot start Senpi #when it finishes #then durable progress identifies the failed runner and scenario", () => {
    const f = fixture()
    try {
      // This drives the actual script with a missing binary, without loading a plugin or contacting a provider.
      const result = spawnSync("node", [fileURLToPath(new URL("./task-runtime-fallback-e2e.mjs", import.meta.url))], {
        cwd: f.root, env: { ...f.env, SENPI_BIN: join(f.root, "missing-senpi"), TASK_RUNTIME_FALLBACK_OUT_DIR: f.outDir,
          TASK_RUNTIME_FALLBACK_RUNNERS: "child-process", TASK_RUNTIME_FALLBACK_SCENARIOS: "user-fallback" },
        encoding: "utf8", timeout: 15_000,
      })
      expect(result.status, result.stderr).toBe(1)
      const progress = JSON.parse(readFileSync(join(f.outDir, "progress.json"), "utf8"))
      expect(progress.state, `${result.stderr}\n${JSON.stringify(progress)}`).toBe("FAIL")
      expect(progress.active).toBeNull()
      expect(progress.scenarios).toEqual([{ ...expected[0], state: "FAIL", stateDir: expect.any(String), checks: expect.objectContaining({ exit_zero: "FAIL", cleanup: "PASS" }),
        process: { code: null, signal: null, error: expect.stringContaining("ENOENT"), deadline: false } }])
    } finally { f.cleanup() }
  }, 40_000)
})
