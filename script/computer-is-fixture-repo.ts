import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { RunOptions } from "./computer-is-git.ts"

// A temporary git repository owned by one test of the ideal-state gate checker. Its git calls see no inherited
// GIT_* variable and no system config; the global config stays the repository's hermetic test config (HOME and
// GIT_CONFIG_GLOBAL from the test preload), which turns off background maintenance that could outlive the fixture.

const isolatedEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        (!entry[0].startsWith("GIT_") || entry[0] === "GIT_CONFIG_GLOBAL") && entry[1] !== undefined,
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
}

export type FixtureRepo = {
  readonly options: RunOptions
  git(...args: string[]): string
  write(files: Readonly<Record<string, string>>): void
  commit(message: string): void
}

export function withFixtureRepo(body: (repo: FixtureRepo) => void): void {
  const root = mkdtempSync(join(tmpdir(), "cu-is-gates-"))
  const git = (...args: string[]): string => {
    const result = Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=gate-test",
        "-c",
        "user.email=gate-test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, env: isolatedEnv, stdout: "pipe", stderr: "pipe" },
    )
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
    return result.stdout.toString()
  }
  git("init", "-q", "-b", "dev")
  git("commit", "-q", "--allow-empty", "-m", "root")
  const repo: FixtureRepo = {
    options: { cwd: root, env: isolatedEnv },
    git,
    write: (files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
    },
    commit: (message) => {
      git("add", "-A")
      git("commit", "-q", "--allow-empty", "-m", message)
    },
  }
  try {
    body(repo)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
