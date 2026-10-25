import { mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { nodeSessionHistoryFs } from "./session-history-fs"
import {
  claudeSessionLine,
  codexRolloutLine,
  createTempDirectories,
  runScan,
  writeTranscript,
} from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

describe("session-history scanProjects (parity with desktop AgentSessionScanner.scan)", () => {
  it("#given Claude transcripts #when scanned #then reads project cwds newest first", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const olderWorkspace = await temp.make("workspace-older-")
    const newerWorkspace = await temp.make("workspace-newer-")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug-older", "a.jsonl"), contents: claudeSessionLine(olderWorkspace), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug-older", "b.jsonl"), contents: claudeSessionLine(olderWorkspace), mtimeMs: Date.parse("2026-01-02T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug-newer", "c.jsonl"), contents: claudeSessionLine(newerWorkspace), mtimeMs: Date.parse("2026-03-01T00:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath })

    // then
    expect(result.candidates).toEqual([
      { path: newerWorkspace, title: basename(newerWorkspace), sources: ["claudeAgent"], threadCount: 1, lastActiveAt: "2026-03-01T00:00:00.000Z", alreadyImported: false, git: null },
      { path: olderWorkspace, title: basename(olderWorkspace), sources: ["claudeAgent"], threadCount: 2, lastActiveAt: "2026-01-02T00:00:00.000Z", alreadyImported: false, git: null },
    ])
  })

  it("#given Codex rollouts in date directories #when scanned #then groups them by cwd", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const otherWorkspace = await temp.make("workspace-other-")
    const rollout = (year: string, month: string, day: string, name: string) => join(codexHomePath, "sessions", year, month, day, name)
    await writeTranscript({ filePath: rollout("2026", "01", "05", "rollout-2026-01-05T10-00-00-aaa.jsonl"), contents: codexRolloutLine(workspace), mtimeMs: Date.parse("2026-01-05T10:00:00.000Z") })
    await writeTranscript({ filePath: rollout("2026", "02", "09", "rollout-2026-02-09T10-00-00-bbb.jsonl"), contents: codexRolloutLine(workspace), mtimeMs: Date.parse("2026-02-09T10:00:00.000Z") })
    await writeTranscript({ filePath: rollout("2026", "02", "09", "rollout-2026-02-09T11-00-00-ccc.jsonl"), contents: codexRolloutLine(otherWorkspace), mtimeMs: Date.parse("2026-02-09T11:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath })

    // then
    expect(result.candidates).toEqual([
      { path: otherWorkspace, title: basename(otherWorkspace), sources: ["codex"], threadCount: 1, lastActiveAt: "2026-02-09T11:00:00.000Z", alreadyImported: false, git: null },
      { path: workspace, title: basename(workspace), sources: ["codex"], threadCount: 2, lastActiveAt: "2026-02-09T10:00:00.000Z", alreadyImported: false, git: null },
    ])
  })

  for (const source of ["claudeAgent", "codex"] as const) {
    it(`#given a non-file ${source} transcript #when scanned #then never opens it`, async () => {
      // given
      const claudeHomePath = await temp.make("claude-home-")
      const codexHomePath = await temp.make("codex-home-")
      const transcriptPath = source === "claudeAgent"
        ? join(claudeHomePath, "projects", "-slug", "session.jsonl")
        : join(codexHomePath, "sessions", "2026", "08", "24", "rollout-session.jsonl")
      await mkdir(transcriptPath, { recursive: true })
      let transcriptOpenCount = 0
      const fs = { ...nodeSessionHistoryFs, open: (filePath: string) => {
        if (filePath === transcriptPath) transcriptOpenCount += 1
        return nodeSessionHistoryFs.open(filePath)
      } }

      // when
      const result = await runScan({ claudeHomePath, codexHomePath, fs })

      // then
      expect(result.candidates).toEqual([])
      expect(transcriptOpenCount).toBe(0)
    })
  }

  it("#given both agents saw one cwd that is already imported #when scanned #then merges and flags it", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(workspace), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    await writeTranscript({ filePath: join(codexHomePath, "sessions", "2026", "04", "01", "rollout-2026-04-01T09-00-00-aaa.jsonl"), contents: codexRolloutLine(workspace), mtimeMs: Date.parse("2026-04-01T09:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, importedProjects: [{ id: "project-1", workspaceRoot: workspace }] })

    // then
    expect(result.candidates).toEqual([
      { path: workspace, title: basename(workspace), projectId: "project-1", sources: ["claudeAgent", "codex"], threadCount: 2, lastActiveAt: "2026-04-01T09:00:00.000Z", alreadyImported: true, git: null },
    ])
  })

  it("#given a transcript cwd that is a symlink alias #when scanned #then returns the imported project id", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const workspaceAlias = join(await temp.make("links-"), "workspace-alias")
    await symlink(workspace, workspaceAlias)
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(workspaceAlias), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, importedProjects: [{ id: "project-1", workspaceRoot: workspace }] })

    // then
    expect(result.candidates[0]).toMatchObject({ path: workspace, projectId: "project-1", alreadyImported: true, git: null })
  })

  it("#given a persisted project alias #when the transcript names the realpath #then keeps the persisted path", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const workspaceAlias = join(await temp.make("links-"), "workspace-alias")
    await symlink(workspace, workspaceAlias)
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(workspace), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, importedProjects: [{ id: "project-1", workspaceRoot: workspaceAlias }] })

    // then
    expect(result.candidates[0]).toMatchObject({ path: workspaceAlias, projectId: "project-1", alreadyImported: true, git: null })
  })

  it("#given a case alias with the same identity #when scanned #then merges and keeps the persisted path", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const workspaceAlias = join(dirname(workspace), basename(workspace).toUpperCase())
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(workspaceAlias), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    await writeTranscript({ filePath: join(codexHomePath, "sessions", "2026", "01", "02", "rollout-b.jsonl"), contents: codexRolloutLine(workspace), mtimeMs: Date.parse("2026-01-02T00:00:00.000Z") })
    const fs = { ...nodeSessionHistoryFs, stat: (filePath: string) => nodeSessionHistoryFs.stat(filePath === workspaceAlias ? workspace : filePath) }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, fs, importedProjects: [{ id: "project-1", workspaceRoot: workspace }] })

    // then
    expect(result.candidates).toEqual([
      { path: workspace, title: basename(workspace), projectId: "project-1", sources: ["claudeAgent", "codex"], threadCount: 2, lastActiveAt: "2026-01-02T00:00:00.000Z", alreadyImported: true, git: null },
    ])
  })

  it("#given case variants with distinct identities #when scanned #then keeps both off Windows and folds them on Windows", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const backingUpper = await temp.make("backing-upper-")
    const backingLower = await temp.make("backing-lower-")
    const aliasParent = await temp.make("case-aliases-")
    const upperWorkspace = join(aliasParent, "Repo")
    const lowerWorkspace = join(aliasParent, "repo")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-upper", "a.jsonl"), contents: claudeSessionLine(upperWorkspace), mtimeMs: Date.parse("2026-01-02T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-lower", "b.jsonl"), contents: claudeSessionLine(lowerWorkspace), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    const fs = { ...nodeSessionHistoryFs, stat: (filePath: string) => nodeSessionHistoryFs.stat(filePath === upperWorkspace ? backingUpper : filePath === lowerWorkspace ? backingLower : filePath) }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, fs })

    // then
    // Windows paths are case-insensitive, so the comparison key folds case there and the variants are one project.
    expect(result.candidates.map((candidate) => candidate.path)).toEqual(process.platform === "win32" ? [upperWorkspace] : [upperWorkspace, lowerWorkspace])
  })

  it("#given two distinct Codex homes #when scanned #then scans each home once", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const otherCodexHome = await temp.make("codex-other-")
    const workspace = await temp.make("workspace-")
    const otherWorkspace = await temp.make("workspace-other-")
    for (const [home, cwd] of [[codexHomePath, workspace], [otherCodexHome, otherWorkspace]] as const) {
      await writeTranscript({ filePath: join(home, "sessions", "2026", "01", "01", "rollout-session.jsonl"), contents: codexRolloutLine(cwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, extraHomes: [{ source: "codex", homePath: otherCodexHome }, { source: "codex", homePath: codexHomePath }] })

    // then
    expect(result.candidates.map((candidate) => candidate.threadCount)).toEqual([1, 1])
    expect(result.candidates.map((candidate) => candidate.path).sort()).toEqual([workspace, otherWorkspace].sort())
  })

  it("#given a relative cwd #when scanned #then ignores it", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-relative-")
    const relativeCwd = join("relative", basename(workspace))
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-relative", "session.jsonl"), contents: claudeSessionLine(relativeCwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    // The relative cwd resolves to a real directory, so only the absolute-path guard can drop it (no cross-drive path on Windows).
    const fs = { ...nodeSessionHistoryFs, stat: (filePath: string) => nodeSessionHistoryFs.stat(filePath === relativeCwd || filePath === resolve(relativeCwd) ? workspace : filePath) }

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath, fs })).candidates).toEqual([])
  })

  it("#given a cwd that no longer exists #when scanned #then drops it", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(join(claudeHomePath, "does-not-exist")), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath })).candidates).toEqual([])
  })

  it("#given the home, temp root and app data directory #when scanned #then excludes them", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const homeDir = await temp.make("user-home-")
    const appDataDir = await temp.make("app-data-")
    const workspace = await temp.make("workspace-")
    for (const [index, cwd] of [homeDir, tmpdir(), appDataDir, workspace].entries()) {
      await writeTranscript({ filePath: join(claudeHomePath, "projects", `-slug-${index}`, "session.jsonl"), contents: claudeSessionLine(cwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") + index })
    }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, homeDir, excludedDirectories: [appDataDir] })

    // then
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([workspace])
  })

  for (const layout of [[".omo-app", "worktrees", "repo", "wt-1"], [".t3", "worktrees", "repo", "wt-1"]] as const) {
    it(`#given a sandbox under ${layout[0]}/worktrees #when scanned #then excludes it`, async () => {
      // given
      const claudeHomePath = await temp.make("claude-home-")
      const codexHomePath = await temp.make("codex-home-")
      const worktreeCwd = join(claudeHomePath, ...layout)
      await mkdir(worktreeCwd, { recursive: true })
      await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(worktreeCwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

      // when / then
      expect((await runScan({ claudeHomePath, codexHomePath })).candidates).toEqual([])
    })
  }

  it("#given Codex scratch directories and Downloads #when scanned #then excludes them", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const homeDir = await temp.make("user-home-")
    const scratch = join(homeDir, "Documents", "Codex", "2026-09-01", "some-conversation")
    const downloads = join(homeDir, "Downloads", "unpacked")
    const keep = await temp.make("workspace-keep-")
    await mkdir(scratch, { recursive: true })
    await mkdir(downloads, { recursive: true })
    for (const [index, cwd] of [scratch, downloads, keep].entries()) {
      await writeTranscript({ filePath: join(codexHomePath, "sessions", "2026", "09", "01", `rollout-${index}.jsonl`), contents: codexRolloutLine(cwd), mtimeMs: Date.parse("2026-09-01T00:00:00.000Z") })
    }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, homeDir })

    // then
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([keep])
  })

  it("#given git checkouts #when scanned #then skips linked worktrees and reports origins", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const repo = await temp.make("workspace-repo-")
    const worktree = await temp.make("workspace-worktree-")
    const plain = await temp.make("workspace-plain-")
    const noRemote = await temp.make("workspace-noremote-")
    const submodule = await temp.make("workspace-submodule-")
    await mkdir(join(repo, ".git"))
    await writeFile(join(repo, ".git", "config"), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:pingdotgg/t3code.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n')
    await writeFile(join(worktree, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`)
    await mkdir(join(noRemote, ".git"))
    await writeFile(join(noRemote, ".git", "config"), "[core]\n")
    const submoduleGitDir = join(repo, ".git", "modules", "vendor")
    await mkdir(submoduleGitDir, { recursive: true })
    await writeFile(join(submoduleGitDir, "config"), '[remote "origin"]\n\turl = ssh://github.com/pingdotgg/vendor.git\n')
    await writeFile(join(submodule, ".git"), `gitdir: ${submoduleGitDir}\n`)
    for (const [index, cwd] of [repo, worktree, plain, noRemote, submodule].entries()) {
      await writeTranscript({ filePath: join(claudeHomePath, "projects", `-slug-${index}`, "a.jsonl"), contents: claudeSessionLine(cwd), mtimeMs: Date.parse(`2026-01-0${index + 1}T00:00:00.000Z`) })
    }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath })

    // then
    expect(result.candidates.map((candidate) => ({ path: candidate.path, git: candidate.git }))).toEqual([
      { path: submodule, git: { remoteKey: "github.com/pingdotgg/vendor", repository: "pingdotgg/vendor" } },
      { path: noRemote, git: { remoteKey: null, repository: null } },
      { path: plain, git: null },
      { path: repo, git: { remoteKey: "github.com/pingdotgg/t3code", repository: "pingdotgg/t3code" } },
    ])
  })

  it("#given a sandbox under the configured worktrees directory #when scanned #then excludes it", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const worktreesDir = join(await temp.make("app-base-"), "worktrees")
    const worktreeCwd = join(worktreesDir, "repo", "wt-2")
    await mkdir(worktreeCwd, { recursive: true })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(worktreeCwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath, managedWorktreeDirectories: [worktreesDir] })).candidates).toEqual([])
  })

  it("#given a symlink into the worktrees directory #when scanned #then excludes it by realpath", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const worktreesDir = join(await temp.make("app-base-"), "worktrees")
    const worktreeCwd = join(worktreesDir, "repo", "wt-3")
    await mkdir(worktreeCwd, { recursive: true })
    const symlinkCwd = join(await temp.make("links-"), "innocent-project")
    await symlink(worktreeCwd, symlinkCwd)
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents: claudeSessionLine(symlinkCwd), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath, managedWorktreeDirectories: [worktreesDir] })).candidates).toEqual([])
  })

  it("#given malformed transcripts #when scanned #then skips them without failing", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-broken", "a.jsonl"), contents: "not json at all\n", mtimeMs: Date.parse("2026-05-01T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-no-cwd", "a.jsonl"), contents: `{"type":"summary"}\n`, mtimeMs: Date.parse("2026-05-02T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-good", "a.jsonl"), contents: claudeSessionLine(workspace), mtimeMs: Date.parse("2026-05-03T00:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath })

    // then
    expect(result.candidates).toEqual([
      { path: workspace, title: basename(workspace), sources: ["claudeAgent"], threadCount: 1, lastActiveAt: "2026-05-03T00:00:00.000Z", alreadyImported: false, git: null },
    ])
  })

  it("#given neither home exists #when scanned #then returns an empty result with a timestamp", async () => {
    // given
    const root = await temp.make("missing-homes-")

    // when
    const result = await runScan({ claudeHomePath: join(root, "no-claude"), codexHomePath: join(root, "no-codex") })

    // then
    expect(result.candidates).toEqual([])
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
