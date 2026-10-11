import { expect, test } from "bun:test"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const AGENT_DIR = join(import.meta.dir, "agent")
const posixBashTest = test.skipIf(process.platform === "win32")

function toBashPath(path: string): string {
  if (process.platform !== "win32") {
    return path
  }

  const normalized = path.replaceAll("\\", "/")
  const drivePath = normalized.match(/^([A-Za-z]):(\/.*)$/)
  if (drivePath === null) {
    return normalized
  }

  const drive = drivePath[1]
  const rest = drivePath[2]
  if (drive === undefined || rest === undefined) {
    return normalized
  }
  return `/${drive.toLowerCase()}${rest}`
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

type SetupFixture = { readonly repo: string; readonly fakeBin: string; readonly bunLog: string }

function createSetupFixture(options: { readonly built?: boolean; readonly withNode?: boolean } = {}): SetupFixture {
  const repo = mkdtempSync(join(tmpdir(), "omo-setup-test-"))
  const agentDir = join(repo, "script", "agent")
  const fakeBin = join(repo, "fake-bin")
  const bunLog = join(repo, "bun-calls.log")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  copyFileSync(join(AGENT_DIR, "setup.sh"), join(agentDir, "setup.sh"))
  if (options.built ?? true) {
    mkdirSync(join(repo, "dist"), { recursive: true })
    writeFileSync(join(repo, "dist", "index.js"), "built\n")
  }
  chmodSync(join(agentDir, "setup.sh"), 0o755)
  // The fake bun records every non-version invocation so the test sees what setup.sh actually ran.
  writeExecutable(join(fakeBin, "bun"), `#!/usr/bin/env bash\n[ "$1" = "--version" ] && { printf '1.3.12\\n'; exit 0; }\nprintf '%s\\n' "$*" >> '${toBashPath(bunLog)}'\n[ "$1" = "install" ] && { printf 'fake bun install\\n'; exit 0; }\n[ "$1 $2" = "run build" ] && { printf 'fake bun build\\n'; exit 0; }\nprintf 'unexpected bun command: %s\\n' "$*" >&2\nexit 64\n`)
  if (options.withNode ?? true) {
    writeExecutable(join(fakeBin, "node"), "#!/usr/bin/env bash\n[ \"$1\" = \"--version\" ] && { printf 'v24.0.0\\n'; exit 0; }\nprintf 'fake materialize failure\\n' >&2\nexit 42\n")
  }
  writeExecutable(join(fakeBin, "git"), "#!/usr/bin/env bash\n[ \"$1\" = \"--version\" ] && { printf 'git version 2.50.0\\n'; exit 0; }\n[ \"$1\" = \"submodule\" ] && { printf 'fake submodule failure\\n' >&2; exit 43; }\nprintf 'unexpected git command: %s\\n' \"$*\" >&2\nexit 64\n")
  return { repo, fakeBin, bunLog }
}

// PATH holding only the fakes plus bash (the fakes' interpreter) and the two external tools setup.sh
// itself needs, so a missing fake cannot be satisfied by the machine's real bun, node or git.
function isolatedPath(fixture: SetupFixture): string {
  const tools = join(fixture.repo, "tools-bin")
  mkdirSync(tools, { recursive: true })
  for (const tool of ["bash", "dirname", "sed"]) {
    const real = Bun.which(tool)
    if (real === null) throw new Error(`${tool} not found`)
    symlinkSync(real, join(tools, tool))
  }
  return `${toBashPath(fixture.fakeBin)}:${toBashPath(tools)}`
}

function runSetup(fixture: SetupFixture, path: string): { readonly exitCode: number; readonly stdout: string } {
  const bash = Bun.which("bash")
  if (bash === null) throw new Error("bash not found")
  const result = Bun.spawnSync({
    cmd: [bash, "script/agent/setup.sh"],
    cwd: fixture.repo,
    env: { ...process.env, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout.toString() }
}

function bunCalls(fixture: SetupFixture): readonly string[] {
  return existsSync(fixture.bunLog) ? readFileSync(fixture.bunLog, "utf8").trim().split("\n") : []
}

posixBashTest("#given submodule and materialize failures #when setup runs #then it warns and continues", () => {
  // given
  const fixture = createSetupFixture()

  try {
    // when
    const result = runSetup(fixture, `${toBashPath(fixture.fakeBin)}:${process.env.PATH ?? ""}`)

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("WARN: submodule init skipped")
    expect(result.stdout).toContain("WARN: frontend refs not materialized")
    expect(result.stdout).toContain("dist/index.js present - skipping build")
    // --ignore-scripts keeps the root prepare hook from running an unguarded build.
    expect(bunCalls(fixture)).toEqual(["install --ignore-scripts"])
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true })
  }
})

posixBashTest("#given dist/index.js is missing #when setup runs #then it installs and builds", () => {
  // given
  const fixture = createSetupFixture({ built: false })

  try {
    // when
    const result = runSetup(fixture, isolatedPath(fixture))

    // then
    expect(result.exitCode).toBe(0)
    expect(bunCalls(fixture)).toEqual(["install --ignore-scripts", "run build"])
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true })
  }
})

posixBashTest("#given a required tool is missing #when setup runs #then it exits 1 before installing", () => {
  // given
  const fixture = createSetupFixture({ withNode: false })

  try {
    // when
    const result = runSetup(fixture, isolatedPath(fixture))

    // then
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("required tool 'node' not found")
    expect(bunCalls(fixture)).toEqual([])
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true })
  }
})
