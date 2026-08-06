import { expect, test } from "bun:test"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

function createSetupFixture(): { readonly repo: string; readonly fakeBin: string } {
  const repo = mkdtempSync(join(tmpdir(), "omo-setup-test-"))
  const agentDir = join(repo, "script", "agent")
  const fakeBin = join(repo, "fake-bin")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(join(repo, "dist"), { recursive: true })
  copyFileSync(join(AGENT_DIR, "setup.sh"), join(agentDir, "setup.sh"))
  writeFileSync(join(repo, "dist", "index.js"), "built\n")
  chmodSync(join(agentDir, "setup.sh"), 0o755)
  writeExecutable(join(fakeBin, "bun"), "#!/usr/bin/env bash\n[ \"$1\" = \"--version\" ] && { printf '1.3.12\\n'; exit 0; }\n[ \"$1\" = \"install\" ] && { printf 'fake bun install\\n'; exit 0; }\nprintf 'unexpected bun command: %s\\n' \"$*\" >&2\nexit 64\n")
  writeExecutable(join(fakeBin, "node"), "#!/usr/bin/env bash\n[ \"$1\" = \"--version\" ] && { printf 'v24.0.0\\n'; exit 0; }\nprintf 'fake materialize failure\\n' >&2\nexit 42\n")
  writeExecutable(join(fakeBin, "git"), "#!/usr/bin/env bash\n[ \"$1\" = \"--version\" ] && { printf 'git version 2.50.0\\n'; exit 0; }\n[ \"$1\" = \"submodule\" ] && { printf 'fake submodule failure\\n' >&2; exit 43; }\nprintf 'unexpected git command: %s\\n' \"$*\" >&2\nexit 64\n")
  return { repo, fakeBin }
}

posixBashTest("#given submodule and materialize failures #when setup runs #then it warns and continues", () => {
  // given
  const fixture = createSetupFixture()

  try {
    // when
    const result = Bun.spawnSync({
      cmd: ["bash", "script/agent/setup.sh"],
      cwd: fixture.repo,
      env: {
        ...process.env,
        PATH: `${toBashPath(fixture.fakeBin)}:${process.env.PATH ?? ""}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = result.stdout.toString()

    // then
    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("WARN: submodule init skipped")
    expect(stdout).toContain("WARN: frontend refs not materialized")
    expect(stdout).toContain("dist/index.js present - skipping build")
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true })
  }
})
