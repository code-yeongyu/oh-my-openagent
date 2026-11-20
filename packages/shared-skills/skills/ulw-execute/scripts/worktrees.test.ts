import { describe, expect, onTestFinished, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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
  return runFrom(repo, ...args, "--repo", repo)
}

// The CLI as a run invokes it: from some directory, with no --repo.
function runFrom(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" })
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? ""
  return {
    status: result.status,
    json: lastLine.startsWith("{") ? JSON.parse(lastLine) : undefined,
    stderr: result.stderr,
  }
}

describe("ulw-execute worktrees helper", () => {
  test("#given gitignored .env files and no include file #when a worktree is added #then nothing is copied and the unlisted files stop the run", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".env.local": "LOCAL=1\n" })
    const wt = join(repo, "..", "wt-a")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/a")

    expect(result.status).toBe(3)
    expect(existsSync(join(wt, ".env"))).toBe(false)
    expect(existsSync(join(wt, ".env.local"))).toBe(false)
    expect(result.json.provisioned).toEqual([])
    expect(result.json.unlisted.sort()).toEqual([".env", ".env.local"])
    const manifest = JSON.parse(readFileSync(join(repo, ".omo", "ulw-execute", "worktrees.json"), "utf8"))
    expect(manifest.created).toEqual([expect.objectContaining({ path: wt, branch: "ulw/a" })])
  })

  test("#given a .worktreeinclude #when provisioning #then listed files copy, a missing listed path fails as required, escapes and symlinks are refused", () => {
    const repo = fixtureRepo({
      "secrets/api.key": "k\n",
      ".worktreeinclude":
        "# local config\nsecrets/api.key\nconfig/local.json\n../outside\n/etc/passwd\nlinked.env\n.env.*\n",
    })
    symlinkSync("/etc/hostname", join(repo, "linked.env"))
    symlinkSync(join(repo, "nowhere"), join(repo, ".env.dangling"))
    const wt = join(repo, "..", "wt-b")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/b")

    expect(result.status).toBe(3)
    expect(readFileSync(join(wt, "secrets", "api.key"), "utf8")).toBe("k\n")
    expect(existsSync(join(wt, "linked.env"))).toBe(false)
    expect(result.json.missingRequired).toEqual(["config/local.json"])
    expect(result.json.refused.sort()).toEqual(["../outside", ".env.dangling", "/etc/passwd", "linked.env"])
  })

  test("#given an include entry git does not ignore #when provisioning #then it is refused so a copied secret can never be staged, and the copy keeps the source mode", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", "notes.txt": "n\n", ".worktreeinclude": ".env\nnotes.txt\n" })
    chmodSync(join(repo, ".env"), 0o600)
    const wt = join(repo, "..", "wt-e")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/e")

    expect(result.json.refused).toEqual(["notes.txt"])
    expect(existsSync(join(wt, "notes.txt"))).toBe(false)
    expect(statSync(join(wt, ".env")).mode & 0o777).toBe(0o600)
    expect(git(wt, "status", "--porcelain")).toBe("")
  })

  test("#given an entry under a symlinked directory #when provisioning #then the escape is refused on both the source and the worktree side", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "ulw-outside-")))
    onTestFinished(() => rmSync(outside, { recursive: true, force: true }))
    writeFileSync(join(outside, "secret.txt"), "outside\n")
    const repo = fixtureRepo({
      ".worktreeinclude": "secrets/secret.txt\nconfig/local.json\n",
      "config/local.json": "{}\n",
    })
    symlinkSync(outside, join(repo, "secrets"))
    const wt = join(repo, "..", "wt-f")
    git(repo, "worktree", "add", "-q", "-b", "ulw/f", wt)
    rmSync(join(wt, "config"), { recursive: true, force: true })
    symlinkSync(outside, join(wt, "config"))
    writeFileSync(join(repo, ".gitignore"), ".env\n.env.*\n.omo/\nsecrets\nsecrets/\nconfig/local.json\n")

    const result = run(repo, "provision", "--path", wt)

    expect(result.json.refused.sort()).toEqual(["config/local.json", "secrets/secret.txt"])
    expect(existsSync(join(wt, "secrets"))).toBe(false)
    expect(existsSync(join(outside, "local.json"))).toBe(false)
  })

  test("#given .env listed in .worktreeinclude #when a worktree is added #then exactly the listed file is copied", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".env.local": "LOCAL=1\n", ".worktreeinclude": ".env\n" })
    const wt = join(repo, "..", "wt-g")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/g")

    expect(result.status).toBe(0)
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("TOKEN=dummy\n")
    expect(existsSync(join(wt, ".env.local"))).toBe(false)
    expect(result.json.provisioned).toEqual([".env"])
  })

  test("#given the checkout ignores .env only through an uncommitted rule #when provisioning #then .env is refused because the worktree would not ignore it", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".worktreeinclude": ".env\n" })
    writeFileSync(join(repo, ".gitignore"), ".omo/\n")
    git(repo, "commit", "-qam", "stop ignoring .env in history")
    writeFileSync(join(repo, ".gitignore"), ".omo/\n.env\n")
    const wt = join(repo, "..", "wt-h")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/h")

    expect(result.json.refused).toEqual([".env"])
    expect(existsSync(join(wt, ".env"))).toBe(false)
    git(wt, "add", "-A")
    expect(git(wt, "status", "--porcelain")).toBe("")
  })

  test("#given the base tracks a dangling symlink at a listed path #when provisioning #then the secret is never written through it", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "ulw-outside-")))
    onTestFinished(() => rmSync(outside, { recursive: true, force: true }))
    const repo = fixtureRepo({ ".worktreeinclude": ".env.local\n" })
    git(repo, "checkout", "-q", "-b", "evilbase")
    symlinkSync(join(outside, "stolen"), join(repo, ".env.local"))
    git(repo, "add", "-f", ".env.local")
    git(repo, "commit", "-qm", "track a dangling symlink")
    git(repo, "checkout", "-q", "main")
    writeFileSync(join(repo, ".env.local"), "SECRET=1\n")
    const wt = join(repo, "..", "wt-i")

    const result = run(repo, "add", "--path", wt, "--branch", "ulw/i", "--base", "evilbase")

    expect(existsSync(join(outside, "stolen"))).toBe(false)
    expect(result.json.provisioned).toEqual([])
    expect([...result.json.skipped, ...result.json.refused]).toEqual([".env.local"])
  })

  test("#given an empty .worktreeinclude #when a worktree is added #then nothing is copied", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".worktreeinclude": "" })
    const wt = join(repo, "..", "wt-c")

    expect(run(repo, "add", "--path", wt, "--branch", "ulw/c").status).toBe(0)
    expect(existsSync(join(wt, ".env"))).toBe(false)
  })

  test("#given a file already in the worktree #when provisioning again #then it is never overwritten", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=main\n", ".worktreeinclude": ".env\n" })
    const wt = join(repo, "..", "wt-d")
    run(repo, "add", "--path", wt, "--branch", "ulw/d")
    writeFileSync(join(wt, ".env"), "TOKEN=edited\n")

    const result = run(repo, "provision", "--path", wt)

    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("TOKEN=edited\n")
    expect(result.json.skipped).toEqual([".env"])
  })

  test("#given worktrees the run created and one it did not #when torn down after the merge #then only the recorded ones go, an unmerged branch is kept", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".worktreeinclude": ".env\n" })
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

  test("#given the CLI runs from inside a run worktree #when it provisions and adds the next wave #then it reads and records against the main checkout, so teardown from there removes every wave", () => {
    const repo = fixtureRepo({ ".env": "TOKEN=dummy\n", ".worktreeinclude": ".env\n" })
    const wave1 = join(repo, "..", "wt-w1")
    const wave2 = join(repo, "..", "wt-w2")
    runFrom(repo, "add", "--path", wave1, "--branch", "ulw/w1")
    rmSync(join(wave1, ".env"))

    const provisioned = runFrom(wave1, "provision", "--path", wave1)
    expect(provisioned.status).toBe(0)
    expect(readFileSync(join(wave1, ".env"), "utf8")).toBe("TOKEN=dummy\n")

    const added = runFrom(wave1, "add", "--path", wave2, "--branch", "ulw/w2")
    expect(added.json.provisioned).toEqual([".env"])

    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "ulw/w2")
    const torn = runFrom(repo, "teardown")

    expect(torn.json.removed.map((entry: { branch: string }) => entry.branch).sort()).toEqual(["ulw/w1", "ulw/w2"])
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain("wt-w")
  })

  test("#given a branch landed by squash merge #when torn down #then it counts as merged and is removed, while a branch with unlanded work is kept", () => {
    const repo = fixtureRepo()
    const squashed = join(repo, "..", "wt-squash")
    const pending = join(repo, "..", "wt-pending")
    run(repo, "add", "--path", squashed, "--branch", "ulw/squash")
    run(repo, "add", "--path", pending, "--branch", "ulw/pending")
    for (const name of ["one.txt", "two.txt"]) {
      writeFileSync(join(squashed, name), `${name}\n`)
      git(squashed, "add", name)
      git(squashed, "commit", "-qm", name)
    }
    git(repo, "merge", "-q", "--squash", "ulw/squash")
    git(repo, "commit", "-qm", "squash")
    writeFileSync(join(repo, "later.txt"), "later\n")
    git(repo, "add", "later.txt")
    git(repo, "commit", "-qm", "later")
    writeFileSync(join(pending, "wip.txt"), "w\n")
    git(pending, "add", "wip.txt")
    git(pending, "commit", "-qm", "wip")

    const result = run(repo, "teardown")

    expect(result.json.removed).toEqual([{ path: squashed, branch: "ulw/squash" }])
    expect(result.json.kept.map((entry: { branch: string }) => entry.branch)).toEqual(["ulw/pending"])
  })

  test("#given a recorded worktree whose folder is already gone #when torn down once #then its merged branch is removed in that same run", () => {
    const repo = fixtureRepo()
    const wt = join(repo, "..", "wt-gone")
    run(repo, "add", "--path", wt, "--branch", "ulw/gone")
    rmSync(wt, { recursive: true, force: true })

    const result = run(repo, "teardown")

    expect(result.json.kept).toEqual([])
    expect(git(repo, "branch", "--list", "ulw/gone")).toBe("")
  })

  test("#given parallel lanes adding worktrees at once #when every add finishes #then the manifest records all of them", async () => {
    const repo = fixtureRepo()
    const lanes = Array.from({ length: 6 }, (_, i) => i)
    await Promise.all(
      lanes.map(
        (i) =>
          Bun.spawn(
            [
              process.execPath,
              CLI,
              "add",
              "--path",
              join(repo, "..", `wt-lane${i}`),
              "--branch",
              `ulw/lane${i}`,
              "--repo",
              repo,
            ],
            {
              stdout: "ignore",
              stderr: "ignore",
            },
          ).exited,
      ),
    )

    const manifest = JSON.parse(readFileSync(join(repo, ".omo", "ulw-execute", "worktrees.json"), "utf8"))
    expect(manifest.created.map((entry: { branch: string }) => entry.branch).sort()).toEqual(
      lanes.map((i) => `ulw/lane${i}`),
    )
  })

  test("#given a bare repository with worktrees #when the CLI runs #then it stops with an error instead of using the bare directory as the checkout", () => {
    const repo = fixtureRepo()
    const bare = join(repo, "..", "bare.git")
    git(repo, "clone", "-q", "--bare", repo, bare)
    const linked = join(repo, "..", "linked")
    git(bare, "worktree", "add", "-q", linked, "main")

    const result = runFrom(linked, "provision", "--path", linked)

    expect(result.status).toBe(1)
    expect(result.json).toBeUndefined()
  })

  test("#given a branch merged into the --into ref but not into the checkout's HEAD #when torn down #then the worktree and its branch are both removed", () => {
    const repo = fixtureRepo()
    const wt = join(repo, "..", "wt-into")
    run(repo, "add", "--path", wt, "--branch", "ulw/into")
    writeFileSync(join(wt, "feature.txt"), "f\n")
    git(wt, "add", "feature.txt")
    git(wt, "commit", "-qm", "feature")
    git(repo, "branch", "landed", "ulw/into")

    const result = run(repo, "teardown", "--into", "landed")

    expect(result.json.kept).toEqual([])
    expect(result.json.removed).toEqual([{ path: wt, branch: "ulw/into" }])
    expect(git(repo, "branch", "--list", "ulw/into")).toBe("")
  })
})
