import { describe, expect, test } from "bun:test"
import { chmodSync, closeSync, constants, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

const AGENT_DIR = join(import.meta.dir, "agent")
// The hook reports the PHYSICAL fallback directory, which is /private/tmp on macOS.
const FALLBACK_LOG_FILE = join(realpathSync("/tmp"), "oh-my-openagent-cleanup.log")
const cleanup = join(AGENT_DIR, "cleanup.sh")
const cleanupHook = join(AGENT_DIR, "cleanup-hook.sh")
const posixBashTest = test.skipIf(process.platform === "win32")

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function createFixture(workerBody: string): { readonly repo: string; readonly agentDir: string; readonly logDir: string } {
  const repo = mkdtempSync(join(tmpdir(), "omo-cleanup-hook-test-"))
  const agentDir = join(repo, "script", "agent")
  const logDir = mkdtempSync(join(tmpdir(), "omo-cleanup-hook-log-"))
  mkdirSync(agentDir, { recursive: true })
  copyFileSync(cleanupHook, join(agentDir, "cleanup-hook.sh"))
  writeFileSync(join(agentDir, "cleanup.sh"), workerBody)
  chmodSync(join(agentDir, "cleanup-hook.sh"), 0o755)
  chmodSync(join(agentDir, "cleanup.sh"), 0o755)
  return { repo, agentDir, logDir }
}

// The wait itself is event-driven (the FIFO wakes it); this is only the ceiling that turns a
// hang into a failure. 3s was tight enough to expire on a loaded host while the worker was
// still alive, which made this case flake 1 run in 10 (#11640 review).
function subscribeToExactLines(path: string, expectedLines: readonly string[], timeoutMs = 30_000): readonly Promise<void>[] {
  const stream = createReadStream(path, { encoding: "utf8" })
  const pending = expectedLines.map(() => Promise.withResolvers<void>())
  let buffer = ""
  let nextLine = 0
  let settled = false
  const timeout = setTimeout(() => finish(new Error(`timed out waiting for completion line ${expectedLines[nextLine]} from ${path}`)), timeoutMs)

  const finish = (error?: Error): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    stream.destroy()
    if (error !== undefined) {
      for (const waiter of pending.slice(nextLine)) waiter.reject(error)
    }
  }

  stream.on("data", (chunk) => {
    buffer += chunk
    for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      const expected = expectedLines[nextLine]
      if (line !== expected) {
        finish(new Error(`expected completion line ${expected}, received ${line}`))
        return
      }
      pending[nextLine]?.resolve()
      nextLine += 1
      if (nextLine === expectedLines.length) {
        finish()
        return
      }
    }
  })
  stream.on("error", (error) => finish(error))
  stream.on("end", () => {
    if (nextLine !== expectedLines.length) finish(new Error(`completion FIFO ended after ${nextLine} of ${expectedLines.length} lines`))
  })

  return pending.map(({ promise }) => promise)
}

type HookEnv = Record<string, string>

// Ask the hook itself where it logs, so the test never re-implements its rules
// and passes under any TMPDIR (#10735).
function resolveLogFile(agentDir: string, env: HookEnv): string {
  const result = Bun.spawnSync({
    cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"],
    cwd: agentDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return result.stdout.toString().trim()
}

function removeFixture(fixture: { readonly repo: string; readonly logDir: string }): void {
  rmSync(fixture.repo, { recursive: true, force: true })
  rmSync(fixture.logDir, { recursive: true, force: true })
}

describe("agent cleanup and SessionEnd launcher", () => {
  test("#given cleanup scripts #when inspected #then they are executable bash with strict cleanup and deep mode", () => {
    expect(existsSync(cleanup), "script/agent/cleanup.sh must exist").toBe(true)
    expect(existsSync(cleanupHook), "script/agent/cleanup-hook.sh must exist").toBe(true)
    if (process.platform !== "win32") {
      expect((statSync(cleanup).mode & 0o111) !== 0, "cleanup.sh must be executable").toBe(true)
      expect((statSync(cleanupHook).mode & 0o111) !== 0, "cleanup-hook.sh must be executable").toBe(true)
    }
    expect(read(cleanup).startsWith("#!/usr/bin/env bash")).toBe(true)
    expect(read(cleanup)).toContain("set -euo pipefail")
    expect(read(cleanup)).toContain("--deep")
    expect(read(cleanupHook).startsWith("#!/usr/bin/env bash")).toBe(true)
  })

  posixBashTest("#given the SessionEnd launcher #when sync mode runs #then it executes cleanup and logs successfully", () => {
    const fixture = createFixture(`#!/usr/bin/env bash
printf 'worker-ran\\n' > "$CLAUDE_PROJECT_DIR/worker.marker"
printf 'worker-log\\n'
`)
    const env = { ...process.env, CLAUDE_PROJECT_DIR: fixture.repo, OMO_AGENT_CLEANUP_SYNC: "1", TMPDIR: fixture.logDir } as HookEnv
    try {
      const logFile = resolveLogFile(fixture.agentDir, env)
      expect(logFile).toBe(join(realpathSync(fixture.logDir), "oh-my-openagent-cleanup.log"))
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
        env,
      })
      expect(result.exitCode).toBe(0)
      expect(read(join(fixture.repo, "worker.marker"))).toBe("worker-ran\n")
      expect(read(logFile)).toContain("worker-log")
    } finally {
      removeFixture(fixture)
    }
  })

  posixBashTest("#given the SessionEnd launcher #when async mode runs #then it returns before cleanup finishes", async () => {
    const fixture = createFixture(`#!/usr/bin/env bash
exec 3> "$CLAUDE_PROJECT_DIR/worker.completion"
printf 'worker-started\\n' > "$CLAUDE_PROJECT_DIR/worker.started.tmp"
mv "$CLAUDE_PROJECT_DIR/worker.started.tmp" "$CLAUDE_PROJECT_DIR/worker.started"
printf 'started\\n' >&3
IFS= read -r _ < "$CLAUDE_PROJECT_DIR/worker.release"
printf 'worker-' > "$CLAUDE_PROJECT_DIR/worker.finished.tmp"
printf 'worker-publishing\\n' > "$CLAUDE_PROJECT_DIR/worker.publishing.tmp"
mv "$CLAUDE_PROJECT_DIR/worker.publishing.tmp" "$CLAUDE_PROJECT_DIR/worker.publishing"
printf 'publishing\\n' >&3
IFS= read -r _ < "$CLAUDE_PROJECT_DIR/worker.release"
printf 'finished\\n' >> "$CLAUDE_PROJECT_DIR/worker.finished.tmp"
mv "$CLAUDE_PROJECT_DIR/worker.finished.tmp" "$CLAUDE_PROJECT_DIR/worker.finished"
printf 'finished\\n' >&3
`)
    const releasePath = join(fixture.repo, "worker.release")
    const completionPath = join(fixture.repo, "worker.completion")
    const startedPath = join(fixture.repo, "worker.started")
    const publishingPath = join(fixture.repo, "worker.publishing")
    const finishedPath = join(fixture.repo, "worker.finished")
    expect(Bun.spawnSync(["mkfifo", releasePath, completionPath]).exitCode).toBe(0)
    const releaseFd = openSync(releasePath, constants.O_RDWR | constants.O_NONBLOCK)
    const [workerStarted, workerPublishing, workerFinished] = subscribeToExactLines(completionPath, ["started", "publishing", "finished"])
    const env = { ...process.env, CLAUDE_PROJECT_DIR: fixture.repo, TMPDIR: fixture.logDir } as HookEnv
    try {
      const logFile = resolveLogFile(fixture.agentDir, env)
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe", timeout: 30_000,
        env,
      })
      expect(result.exitCode).toBe(0)
      await workerStarted
      expect(read(startedPath)).toBe("worker-started\n")
      expect(existsSync(finishedPath)).toBe(false)

      writeSync(releaseFd, "release\n")
      await workerPublishing
      expect(read(publishingPath)).toBe("worker-publishing\n")
      expect(existsSync(finishedPath)).toBe(false)

      writeSync(releaseFd, "publish\n")
      await workerFinished
      expect(read(finishedPath)).toBe("worker-finished\n")
      expect(read(logFile)).toBe("")
    } finally {
      closeSync(releaseFd)
      removeFixture(fixture)
    }
    // Above both 30s ceilings on purpose: without it the runner's own limit (20s under CI, 5s
    // for a bare `bun test <file>`) fires first and the ceilings never apply, so a slow but live
    // worker failed instead of passing and a real hang never reported the named error.
  }, 45_000)

  posixBashTest("#given a hostile cleanup log override #when the launcher runs #then it keeps logs in temp", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const hostileLog = join(fixture.repo, "host-config.toml")
    writeFileSync(hostileLog, "preserve-me\n")
    const env = { ...process.env, CLAUDE_PROJECT_DIR: fixture.repo, OMO_AGENT_CLEANUP_LOG: hostileLog, OMO_AGENT_CLEANUP_SYNC: "1", TMPDIR: fixture.logDir } as HookEnv
    try {
      const logFile = resolveLogFile(fixture.agentDir, env)
      expect(logFile).toBe(join(realpathSync(fixture.logDir), "oh-my-openagent-cleanup.log"))
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
        env,
      })
      expect(result.exitCode).toBe(0)
      expect(read(hostileLog)).toBe("preserve-me\n")
      expect(read(logFile)).toContain("safe-log")
    } finally {
      removeFixture(fixture)
    }
  })

  posixBashTest("#given a TMPDIR inside the project #when the launcher resolves its log #then it falls back to temp and reports the fallback", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const insideProject = join(fixture.repo, "tmp")
    mkdirSync(insideProject, { recursive: true })
    try {
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, CLAUDE_PROJECT_DIR: fixture.repo, TMPDIR: insideProject } as HookEnv,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString().trim()).toBe(FALLBACK_LOG_FILE)
      expect(result.stderr.toString()).toContain("[cleanup-hook] TMPDIR is inside the project directory")
      // Comparing path strings was bypassable; the cases below cover each bypass of that class.
    } finally {
      removeFixture(fixture)
    }
  })

  // A string prefix test accepted each of these, putting the log inside the project tree.
  const containmentBypasses: readonly { readonly name: string; readonly build: (repo: string, scratch: string) => { readonly projectDir: string; readonly tmpdir: string } }[] = [
    // A case-variant name: the project's own directory spelled differently, which a case-insensitive
    // filesystem resolves to the same directory while the two strings differ.
    { name: "a case-variant TMPDIR on a case-insensitive filesystem", build: (repo: string) => { const inside = join(repo, "tmp"); mkdirSync(inside, { recursive: true }); const variant = join(dirname(repo), basename(repo).toUpperCase(), "tmp"); return existsSync(variant) ? { projectDir: repo, tmpdir: variant } : { projectDir: repo, tmpdir: inside } } },
    { name: "a TMPDIR symlinked into the project", build: (repo: string, scratch: string) => { const inside = join(repo, "tmp"); mkdirSync(inside, { recursive: true }); const link = join(scratch, "link-into-project"); symlinkSync(inside, link); return { projectDir: repo, tmpdir: link } } },
    { name: "a symlinked project path", build: (repo: string, scratch: string) => { const inside = join(repo, "tmp"); mkdirSync(inside, { recursive: true }); const projectLink = join(scratch, "project-link"); symlinkSync(repo, projectLink); return { projectDir: projectLink, tmpdir: inside } } },
    // The doubled and dot segments sit BEFORE the project's own directory name, which is where a
    // string prefix test stops matching: `<parent>//<repo>/tmp` is not prefixed by `<parent>/<repo>/`.
    { name: "a TMPDIR written with '//'", build: (repo: string) => { mkdirSync(join(repo, "tmp"), { recursive: true }); return { projectDir: repo, tmpdir: `${dirname(repo)}//${basename(repo)}/tmp` } } },
    { name: "a TMPDIR written with '/./'", build: (repo: string) => { mkdirSync(join(repo, "tmp"), { recursive: true }); return { projectDir: repo, tmpdir: `${dirname(repo)}/./${basename(repo)}/tmp` } } },
  ]

  for (const bypass of containmentBypasses) {
    posixBashTest(`#given ${bypass.name} #when the launcher resolves its log #then it still refuses to log inside the project`, () => {
      const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
      try {
        const { projectDir, tmpdir: hostileTmpdir } = bypass.build(fixture.repo, fixture.logDir)
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, TMPDIR: hostileTmpdir } as HookEnv,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe(FALLBACK_LOG_FILE)
        expect(result.stderr.toString()).toContain("[cleanup-hook] TMPDIR is inside the project directory")
      } finally {
        removeFixture(fixture)
      }
    })
  }

  posixBashTest("#given the project is the temp directory itself #when the launcher falls back #then the fallback is still outside the project", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const tempRoot = realpathSync("/tmp")
    try {
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tempRoot, TMPDIR: tempRoot } as HookEnv,
      })
      expect(result.exitCode).toBe(0)
      const resolved = result.stdout.toString().trim()
      expect(result.stderr.toString()).toContain("[cleanup-hook] TMPDIR is inside the project directory")
      // Either a real directory outside the project, or /dev/null when no such directory exists.
      expect(resolved === "/dev/null" || !resolved.startsWith(`${tempRoot}/`)).toBe(true)
      expect(resolved).not.toBe("")
    } finally {
      removeFixture(fixture)
    }
  })

  // Every way `stat` can fail to produce an identity: the hook must fail CLOSED, never silently
  // treat the project as unrelated to TMPDIR (GNU coreutils on PATH under macOS is the real case).
  const brokenStats: readonly { readonly name: string; readonly body: string }[] = [
    { name: "a stat that exits non-zero", body: "exit 1" },
    { name: "a stat that prints a filesystem report and exits non-zero", body: `printf '  File: "/" ID: 1 Namelen: 255\\n'\nexit 1` },
    { name: "a stat that prints something that is not an identity", body: `printf 'not-an-identity\\n'` },
    { name: "a stat that prints nothing", body: "exit 0" },
  ]

  for (const brokenStat of brokenStats) {
    posixBashTest(`#given ${brokenStat.name} #when the launcher resolves its log #then it refuses to guess and stops logging`, () => {
      const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
      const binDir = join(fixture.logDir, "bin")
      mkdirSync(binDir, { recursive: true })
      writeFileSync(join(binDir, "stat"), `#!/usr/bin/env bash\n${brokenStat.body}\n`)
      chmodSync(join(binDir, "stat"), 0o755)
      const insideProject = join(fixture.repo, "tmp")
      mkdirSync(insideProject, { recursive: true })
      try {
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
          env: { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, CLAUDE_PROJECT_DIR: fixture.repo, TMPDIR: insideProject } as HookEnv,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe("/dev/null")
        expect(result.stderr.toString()).toContain("[cleanup-hook] the project directory cannot be identified")
      } finally {
        removeFixture(fixture)
      }
    })
  }

  posixBashTest("#given repeated runs with a rejected TMPDIR #when the launcher falls back #then it creates no temp directories", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const insideProject = join(fixture.repo, "tmp")
    mkdirSync(insideProject, { recursive: true })
    // Observe what the HOOK does, never the shared /tmp: counting entries there is decided by
    // whatever else runs on the machine. Wrapping the two directory-creating tools records every
    // call the hook makes, so the assertion is about the hook alone and cannot flake.
    const binDir = join(fixture.logDir, "bin")
    const callLog = join(fixture.logDir, "creation-calls.log")
    mkdirSync(binDir, { recursive: true })
    for (const [tool, real] of [["mktemp", "/usr/bin/mktemp"], ["mkdir", "/bin/mkdir"]]) {
      writeFileSync(join(binDir, tool as string), `#!/usr/bin/env bash\nprintf '%s %s\\n' ${tool} "$*" >> ${JSON.stringify(callLog)}\nexec ${real} "$@"\n`)
      chmodSync(join(binDir, tool as string), 0o755)
    }
    try {
      for (let run = 0; run < 5; run++) {
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
          env: { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, CLAUDE_PROJECT_DIR: fixture.repo, TMPDIR: insideProject } as HookEnv,
        })
        expect(result.exitCode).toBe(0)
      }
      const creationCalls = existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n").filter((line) => line.length > 0) : []
      expect(creationCalls, `the hook must create no directories, it called: ${creationCalls.join(" | ")}`).toEqual([])
      expect(readdirSync(fixture.repo).filter((entry) => entry.startsWith("tmp."))).toEqual([])
      expect(readdirSync(insideProject)).toEqual([])
    } finally {
      removeFixture(fixture)
    }
  })

  test("#given the launcher script #when read #then it never calls mktemp, mkdir or rm by absolute path", () => {
    // The PATH wrappers below can only observe tools resolved through PATH. An absolute call such
    // as /bin/mkdir would bypass them entirely, so the script itself must not contain one.
    const offenders = read(cleanupHook)
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => !line.startsWith("#"))
      .filter(({ line }) => /(^|[\s="'`(|&;$])\/(usr\/)?(bin|sbin)\/(mktemp|mkdir|rm)\b/.test(line))
      .map(({ line, number }) => `${number}: ${line}`)
    expect(offenders, `cleanup-hook.sh must not call mktemp, mkdir or rm by absolute path: ${offenders.join(" | ")}`).toEqual([])
  })

  posixBashTest("#given repeated launches with a rejected TMPDIR #when the launcher actually runs cleanup #then every directory it creates is outside the project", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const insideProject = join(fixture.repo, "tmp")
    mkdirSync(insideProject, { recursive: true })
    const binDir = join(fixture.logDir, "bin")
    const callLog = join(fixture.logDir, "launch-calls.log")
    mkdirSync(binDir, { recursive: true })
    for (const [tool, real] of [["mktemp", "/usr/bin/mktemp"], ["mkdir", "/bin/mkdir"]]) {
      writeFileSync(join(binDir, tool as string), `#!/usr/bin/env bash\nprintf '%s %s\\n' ${tool} "$*" >> ${JSON.stringify(callLog)}\nexec ${real} "$@"\n`)
      chmodSync(join(binDir, tool as string), 0o755)
    }
    try {
      // Launch mode, not --print-log-file: this is the path that really creates the log directory.
      for (let run = 0; run < 3; run++) {
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe", timeout: 30_000,
          env: { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, CLAUDE_PROJECT_DIR: fixture.repo, OMO_AGENT_CLEANUP_SYNC: "1", TMPDIR: insideProject } as HookEnv,
        })
        expect(result.exitCode).toBe(0)
      }
      const calls = existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n").filter((line) => line.length > 0) : []
      const projectRoot = realpathSync(fixture.repo)
      const insideProjectCalls = calls.filter((call) => call.includes(projectRoot) || call.includes(fixture.repo))
      expect(insideProjectCalls, `no directory may be created inside the project, saw: ${insideProjectCalls.join(" | ")}`).toEqual([])
      expect(calls.filter((call) => call.startsWith("mktemp")), `the hook must never mint a temp directory: ${calls.join(" | ")}`).toEqual([])
      expect(readdirSync(insideProject)).toEqual([])
      expect(readdirSync(fixture.repo).filter((entry) => entry.startsWith("tmp."))).toEqual([])
    } finally {
      removeFixture(fixture)
    }
  }, 45_000)

  posixBashTest("#given a temp directory beside the project #when the launcher resolves its log #then it is accepted", () => {
    const fixture = createFixture("#!/usr/bin/env bash\nprintf 'safe-log\\n'\n")
    const sibling = `${fixture.repo}-sibling`
    mkdirSync(sibling, { recursive: true })
    try {
      const result = Bun.spawnSync({
        cmd: ["bash", "./cleanup-hook.sh", "--print-log-file"], cwd: fixture.agentDir, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, CLAUDE_PROJECT_DIR: fixture.repo, TMPDIR: sibling } as HookEnv,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString().trim()).toBe(join(realpathSync(sibling), "oh-my-openagent-cleanup.log"))
      expect(result.stderr.toString()).toBe("")
    } finally {
      rmSync(sibling, { recursive: true, force: true })
      removeFixture(fixture)
    }
  })

  test("#given cleanup.sh #when inspected for safety #then it guards repo root and never nukes source or host", () => {
    const body = read(cleanup)
    expect(body).toContain("oh-my-openagent")
    for (const pattern of ["rm -rf /", "rm -rf ~", "rm -rf $HOME", "rm -rf src", "rm -rf packages"]) {
      expect(body, `cleanup must never contain '${pattern}'`).not.toContain(pattern)
    }
  })

  posixBashTest("#given transient files in source and skipped trees #when cleanup runs #then it prunes skipped trees", () => {
    const repo = mkdtempSync(join(tmpdir(), "omo-cleanup-test-"))
    const agentDir = join(repo, "script", "agent")
    mkdirSync(join(repo, "src"), { recursive: true })
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true })
    mkdirSync(join(repo, ".git", "objects"), { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    copyFileSync(cleanup, join(agentDir, "cleanup.sh"))
    writeFileSync(join(repo, "package.json"), '{ "name": "oh-my-openagent" }\n')
    for (const [path, content] of [
      [join(repo, "src", "app.tsbuildinfo"), "source transient"], [join(repo, "src", ".DS_Store"), "source os transient"],
      [join(repo, "node_modules", "pkg", "cache.tsbuildinfo"), "dependency cache"], [join(repo, ".git", "objects", "cache.tsbuildinfo"), "git cache"],
    ]) writeFileSync(path, content)
    try {
      expect(Bun.spawnSync({ cmd: ["bash", "./cleanup.sh"], cwd: agentDir, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0)
      expect(existsSync(join(repo, "src", "app.tsbuildinfo"))).toBe(false)
      expect(existsSync(join(repo, "src", ".DS_Store"))).toBe(false)
      expect(existsSync(join(repo, "node_modules", "pkg", "cache.tsbuildinfo"))).toBe(true)
      expect(existsSync(join(repo, ".git", "objects", "cache.tsbuildinfo"))).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
