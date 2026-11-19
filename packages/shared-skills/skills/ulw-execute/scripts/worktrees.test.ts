import { describe, expect, onTestFinished, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// #14391: `git worktree add` leaves gitignored local config (.env) behind, and a --ship run left every
// worktree it created on disk. The helper provisions that config and tears down exactly what the run made.
const CLI = fileURLToPath(new URL("./worktrees.mjs", import.meta.url))

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "qa",
      GIT_AUTHOR_EMAIL: "qa@example.com",
      GIT_COMMITTER_NAME: "qa",
      GIT_COMMITTER_EMAIL: "qa@example.com",
    },
  }).trim()
}

function fixtureRepo(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ulw-worktrees-")))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, "repo")
  mkdirSync(repo)
  git(repo, "init", "-q", "-b", "main")
  writeFileSync(join(repo, ".gitignore"), ".env\n.env.*\n.omo/\nsecrets/\n")
  writeFileSync(join(repo, "app.txt"), "app\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true })
    writeFileSync(join(repo, path), body)
  }
  return repo
}

function run(repo: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--repo", repo], { encoding: "utf8" })
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? ""
  return {
    status: result.status,
    json: lastLine.startsWith("{") ? JSON.parse(lastLine) : undefined,
    stderr: result.stderr,
  }
}

describe("ulw-execute worktrees helper", () => {
  test("#given a gitignored .env and no include file #when a worktree is added #then .env and .env.* are copied and recorded", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".env.local": "LOCAL=1\n" })
    const wt = join(repo, "..", "wt-a")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/a")

    expect(result.status).toBe(0)
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("TOKEN=dummy\n")
    expect(readFileSync(join(wt, ".env.local"), "utf8")).toBe("LOCAL=1\n")
    expect(result.json.provisioned.sort()).toEqual([".env", ".env.local"])
    const manifest = JSON.parse(readFileSync(join(repo, ".omo", "ulw-execute", "worktrees.json"), "utf8"))
    expect(manifest.created).toEqual([expect.objectContaining({ path: wt, branch: "ulw/a" })])
  })

  test("#given a .worktreeinclude #when provisioning #then listed files copy, a missing listed path fails as required, escapes and symlinks are refused", () => {
    const repo = fixtureRepo({
      "secrets/api.key": "k\n",
      ".worktreeinclude": "# local config\nsecrets/api.key\nconfig/local.json\n../outside\n/etc/passwd\nlinked.env\n",
    })
    symlinkSync("/etc/hostname", join(repo, "linked.env"))
    const wt = join(repo, "..", "wt-b")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/b")

    expect(result.status).toBe(3)
    expect(readFileSync(join(wt, "secrets", "api.key"), "utf8")).toBe("k\n")
    expect(existsSync(join(wt, "linked.env"))).toBe(false)
    expect(result.json.missingRequired).toEqual(["config/local.json"])
    expect(result.json.refused.sort()).toEqual(["../outside", "/etc/passwd", "linked.env"])
  })

  test("#given an empty .worktreeinclude #when a worktree is added #then nothing is copied", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".worktreeinclude": "" })
    const wt = join(repo, "..", "wt-c")

    expect(run(repo, "add", "--path", wt, "--branch", "ulw/c").status).toBe(0)
    expect(existsSync(join(wt, ".env"))).toBe(false)
  })

  test("#given a file already in the worktree #when provisioning again #then it is never overwritten", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=main\n" })
    const wt = join(repo, "..", "wt-d")
    run(repo, "add", "--path", wt, "--branch", "ulw/d")
    writeFileSync(join(wt, ".env"), "TOKEN=edited\n")

    const result = run(repo, "provision", "--path", wt)

    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("TOKEN=edited\n")
    expect(result.json.skipped).toEqual([".env"])
  })

  test("#given worktrees the run created and one it did not #when torn down after the merge #then only the recorded ones go, an unmerged branch is kept", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n" })
    const merged = join(repo, "..", "wt-merged")
    const unmerged = join(repo, "..", "wt-unmerged")
    const foreign = join(repo, "..", "wt-foreign")
    run(repo, "add", "--path", merged, "--branch", "ulw/merged")
    run(repo, "add", "--path", unmerged, "--branch", "ulw/unmerged")
    git(repo, "worktree", "add", "-q", "-b", "someone/else", foreign)
    writeFileSync(join(merged, "feature.txt"), "f\n")
    git(merged, "add", "feature.txt")
    git(merged, "commit", "-qm", "feature")
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "ulw/merged")
    writeFileSync(join(unmerged, "wip.txt"), "w\n")
    git(unmerged, "add", "wip.txt")
    git(unmerged, "commit", "-qm", "wip")

    const result = run(repo, "teardown")

    expect(result.json.removed).toEqual([{ path: merged, branch: "ulw/merged" }])
    expect(result.json.kept).toEqual([expect.objectContaining({ path: unmerged, branch: "ulw/unmerged" })])
    expect(existsSync(merged)).toBe(false)
    expect(existsSync(foreign)).toBe(true)
    expect(git(repo, "branch", "--list", "ulw/merged")).toBe("")
    expect(git(repo, "branch", "--list", "someone/else")).not.toBe("")
    const manifest = JSON.parse(readFileSync(join(repo, ".omo", "ulw-execute", "worktrees.json"), "utf8"))
    expect(manifest.created.map((entry: { branch: string }) => entry.branch)).toEqual(["ulw/unmerged"])
  })
})
