import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { loadProvenanceWorkspaces } from "./provenance-config"
import { resolveProvenance, type ExecGit, type GitRun, type ProvenanceRuntime } from "./provenance-resolver"
import { settled } from "./testing/settled"

const cwd = join(tmpdir(), "example-project")
const runtime: ProvenanceRuntime = {
  cwd, env: {},
  gitRemote: async () => "git@example.invalid:example-owner/remote-project.git",
  workspaces: [
    { name: "Path workspace", paths: [tmpdir()] },
    { name: "Owner workspace", git_owners: ["example-owner"] },
  ],
}
let root: string | undefined
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); root = undefined })

test("#given explicit workspace project and lane #when resolving #then environment wins without probing git", async () => {
  expect(await resolveProvenance({ ...runtime,
    env: { OMO_PROVENANCE_WORKSPACE: "Explicit", OMO_PROVENANCE_PROJECT: "explicit-project", OMO_PROVENANCE_LANE: "review" },
    gitRemote: async () => { throw new Error("git must not be read") },
  })).toEqual({ workspace: "Explicit", project: "explicit-project", lane: "review" })
})

test("#given matching git owner and path #when resolving #then git owner wins and project comes from the remote", async () => {
  expect(await resolveProvenance(runtime)).toEqual({ workspace: "Owner workspace", project: "remote-project" })
})

test.each([
  "git@fixture-machine.local:EXAMPLE-OWNER/remote-project.git",
  "https://user:password@192.0.2.7/EXAMPLE-OWNER/remote-project.git",
  "ssh://git@fixture-machine.local:2222/EXAMPLE-OWNER/remote-project.git",
])("#given remote %s #when resolving #then credentials and network identity never become labels", async (remote) => {
  expect(await resolveProvenance({ ...runtime, gitRemote: async () => remote }))
    .toEqual({ workspace: "Owner workspace", project: "remote-project" })
})

test("#given blank overrides #when resolving #then git and configured workspace still supply required labels", async () => {
  expect(await resolveProvenance({ ...runtime, env: { OMO_PROVENANCE_WORKSPACE: " ", OMO_PROVENANCE_PROJECT: "\t", OMO_PROVENANCE_LANE: "" } }))
    .toEqual({ workspace: "Owner workspace", project: "remote-project" })
})

test("#given a nonmatching remote owner #when resolving #then path wins while project still comes from git", async () => {
  expect(await resolveProvenance({ ...runtime, gitRemote: async () => "https://example.invalid/other/remote-project.git" }))
    .toEqual({ workspace: "Path workspace", project: "remote-project" })
})

test("#given no repository or matching workspace #when resolving #then delivery remains unclassified with the cwd basename", async () => {
  expect(await resolveProvenance({ ...runtime, workspaces: [], gitRemote: async () => undefined }))
    .toEqual({ workspace: "unclassified", project: "example-project" })
})

test("#given tilde prefixes and a sibling with the same start #when resolving #then only directory descendants match", async () => {
  const home = join(tmpdir(), "example-home")
  const options = { env: { HOME: home }, workspaces: [{ name: "Path workspace", paths: ["~/work"] }], gitRemote: async () => undefined }
  expect((await resolveProvenance({ ...options, cwd: join(home, "work", "repo") })).workspace).toBe("Path workspace")
  expect((await resolveProvenance({ ...options, cwd: join(home, "work-other") })).workspace).toBe("unclassified")
})

test("#given individual environment overrides #when resolving #then unset fields still derive from sender git and config", async () => {
  expect(await resolveProvenance({ ...runtime, env: { OMO_PROVENANCE_WORKSPACE: "Explicit" } })).toEqual({ workspace: "Explicit", project: "remote-project" })
  expect(await resolveProvenance({ ...runtime, env: { OMO_PROVENANCE_PROJECT: "explicit-project" } })).toEqual({ workspace: "Owner workspace", project: "explicit-project" })
})

test("#given local remotes #when resolving #then their repository name is used without treating a local directory as an owner", async () => {
  for (const remote of ["/example-owner/local-project.git", "file:///example-owner/local-project.git", "C:\\example-owner\\local-project.git"]) {
    expect(await resolveProvenance({ ...runtime, gitRemote: async () => remote })).toEqual({ workspace: "Path workspace", project: "local-project" })
  }
})

test("#given a configured native profile #when the runtime loads its own config #then its workspace table is used", async () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-runtime-"))
  const project = join(root, "project")
  mkdirSync(join(root, ".omo"), { recursive: true })
  mkdirSync(project)
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({
    profiles: { review: { "[native]": { provenance: { workspaces: [{ name: "Configured workspace", git_owners: ["example-owner"] }] } } } },
  }))
  expect(await resolveProvenance({ cwd: project, env: { HOME: root, OMO_PROFILE: "review" }, gitRemote: runtime.gitRemote, loadWorkspaces: loadProvenanceWorkspaces }))
    .toEqual({ workspace: "Configured workspace", project: "remote-project" })
})

test("#given a real sender repository #when reading its origin from a nested cwd #then only its owner and repository become labels", async () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-git-"))
  const nested = join(root, "nested")
  mkdirSync(nested)
  const env = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: join(root, "no-config"), GIT_CONFIG_NOSYSTEM: "1", GIT_MASTER: "1" }
  execFileSync("git", ["init", "-q", root], { env, windowsHide: true })
  execFileSync("git", ["remote", "add", "origin", "ssh://git@example.invalid/example-owner/remote-project.git"], { cwd: root, env, windowsHide: true })
  expect(await resolveProvenance({ cwd: nested, env, workspaces: runtime.workspaces }))
    .toEqual({ workspace: "Owner workspace", project: "remote-project" })
})

test("#given a sender git URL rewrite #when resolving its origin #then the sender environment supplies the git configuration", async () => {
  const cwd = (root = mkdtempSync(join(tmpdir(), "omo-provenance-git-env-")))
  const config = join(cwd, "gitconfig")
  const env = { ...process.env, HOME: cwd, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_MASTER: "1" }
  execFileSync("git", ["init", "-q", cwd], { env, windowsHide: true })
  execFileSync("git", ["remote", "add", "origin", "sender-alias:remote-project.git"], { cwd, env, windowsHide: true })
  writeFileSync(config, '[url "https://example.invalid/example-owner/"]\n\tinsteadOf = sender-alias:\n')
  expect(await resolveProvenance({ cwd, env, workspaces: runtime.workspaces }))
    .toEqual({ workspace: "Owner workspace", project: "remote-project" })
})

// Contract: "no repository" is decided structurally (no .git above the cwd, or git's exit code 2 for a missing remote), never from
// git's message text, which a translated git prints in the sender's own language.
test("#given a cwd outside any repository and a git that answers in another language #when resolving #then delivery stays possible as unclassified", async () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-no-repo-"))
  const bin = join(root, "bin")
  const outside = join(root, "outside")
  mkdirSync(bin)
  mkdirSync(outside)
  writeFileSync(join(bin, "git"), "#!/bin/sh\necho \"fatal: ce n'est pas un depot git\" >&2\nexit 128\n", { mode: 0o755 })
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: root, LANG: "fr_FR.UTF-8", LC_ALL: "fr_FR.UTF-8", GIT_DIR: undefined, GIT_WORK_TREE: undefined }
  expect(await resolveProvenance({ cwd: outside, env, workspaces: [] })).toEqual({ workspace: "unclassified", project: "outside" })
})

test("#given a sender repository without an origin #when resolving #then git's exit code, not its message, marks it unclassified", async () => {
  const cwd = (root = mkdtempSync(join(tmpdir(), "omo-provenance-no-origin-")))
  const env = { ...process.env, HOME: cwd, GIT_CONFIG_GLOBAL: join(cwd, "no-config"), GIT_CONFIG_NOSYSTEM: "1", GIT_MASTER: "1", LANG: "fr_FR.UTF-8", LC_ALL: "fr_FR.UTF-8" }
  execFileSync("git", ["init", "-q", cwd], { env, windowsHide: true })
  expect(await resolveProvenance({ cwd, env, workspaces: [] })).toEqual({ workspace: "unclassified", project: basename(cwd) })
})

test("#given a cwd left behind by a pruned worktree #when resolving #then its dangling .git file means no repository, not a refused send", async () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-pruned-"))
  const leftover = join(root, "leftover")
  mkdirSync(leftover)
  writeFileSync(join(leftover, ".git"), `gitdir: ${join(root, "gone", "worktrees", "leftover")}\n`)
  const env = { ...process.env, HOME: root, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_CEILING_DIRECTORIES: root }
  expect(await resolveProvenance({ cwd: leftover, env, workspaces: [] })).toEqual({ workspace: "unclassified", project: "leftover" })
})

test("#given a repository above the sender's git ceiling #when resolving below that ceiling #then git's discovery boundary is honored", async () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-ceiling-"))
  const env = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: join(root, "no-config"), GIT_CONFIG_NOSYSTEM: "1", GIT_MASTER: "1" }
  execFileSync("git", ["init", "-q", root], { env, windowsHide: true })
  const below = join(root, "ceiling", "below")
  mkdirSync(below, { recursive: true })
  expect(await resolveProvenance({ cwd: below, env: { ...env, GIT_CEILING_DIRECTORIES: join(root, "ceiling") }, workspaces: [] }))
    .toEqual({ workspace: "unclassified", project: "below" })
})

// Contract: provenance is metadata on the message. Every git failure class degrades the classification and is logged;
// none of them may reject the send.
function repoFixture(gitEntry: "directory" | "file"): { readonly cwd: string; readonly env: Record<string, string | undefined> } {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-git-failure-"))
  const cwd = join(root, "repo")
  mkdirSync(cwd)
  if (gitEntry === "directory") mkdirSync(join(cwd, ".git"))
  else writeFileSync(join(cwd, ".git"), "gitdir: elsewhere\n")
  return { cwd, env: { HOME: root, PATH: join(root, "no-git-here"), GIT_DIR: undefined, GIT_CEILING_DIRECTORIES: root } }
}

async function expectDegraded(runtime: Omit<ProvenanceRuntime, "onWarning" | "workspaces">, diagnostic: string): Promise<void> {
  const warnings: string[] = []
  const result = await settled(resolveProvenance({ ...runtime, workspaces: [], onWarning: (message) => warnings.push(message) }))
  expect(result.error).toBeUndefined()
  expect(result.value).toEqual({ workspace: "unclassified", project: "repo" })
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain(diagnostic)
}

test("#given git is not installed #when resolving #then the send is classified without git and the failure is logged", async () => {
  await expectDegraded(repoFixture("directory"), "not installed")
})

const failedRun = (failure: Partial<Extract<GitRun, { ok: false }>>): ExecGit => async () => ({ ok: false, code: null, killed: false, stderr: "", message: "git failed", ...failure })

test.each([
  ["git refuses the repository (exit 128)", failedRun({ code: 128, stderr: "fatal: detected dubious ownership in repository\n" }), "dubious ownership"],
  ["git outlives the timeout", failedRun({ killed: true, message: "Command failed: git remote get-url origin" }), "did not answer within"],
  ["git crashes with a signal and no output", failedRun({ code: null, message: "Command failed with SIGSEGV" }), "SIGSEGV"],
])("#given %s #when resolving #then the send is classified without git and the failure is logged", async (_name, execGit, diagnostic) => {
  await expectDegraded({ ...repoFixture("directory"), execGit }, diagnostic)
})

test("#given git answers that the remote does not exist (exit 2) #when resolving #then nothing is logged, because that is an answer, not a failure", async () => {
  const warnings: string[] = []
  expect(await resolveProvenance({ ...repoFixture("directory"), workspaces: [], execGit: failedRun({ code: 2 }), onWarning: (message) => warnings.push(message) }))
    .toEqual({ workspace: "unclassified", project: "repo" })
  expect(warnings).toEqual([])
})

test("#given a worktree .git file the sender cannot read #when resolving #then the send is classified without git and the failure is logged", async () => {
  const readGitFile = (): string => { throw Object.assign(new Error("EACCES: permission denied, open '.git'"), { code: "EACCES" }) }
  await expectDegraded({ ...repoFixture("file"), readGitFile }, "finding the sender's repository failed")
})

test("#given a broken sender git configuration #when resolving #then the send goes on unclassified and git's error is logged", async () => {
  const cwd = (root = mkdtempSync(join(tmpdir(), "omo-provenance-git-error-")))
  const config = join(cwd, "gitconfig")
  const env = { ...process.env, HOME: cwd, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_MASTER: "1" }
  execFileSync("git", ["init", "-q", cwd], { env, windowsHide: true })
  writeFileSync(config, "[invalid\n")
  const warnings: string[] = []
  const result = await settled(resolveProvenance({ cwd, env, workspaces: [], onWarning: (message) => warnings.push(message) }))
  expect(result.value).toEqual({ workspace: "unclassified", project: basename(cwd) })
  expect(warnings.join("\n")).toContain("bad config line")
})

test("#given a provenance.workspaces table that cannot be read #when resolving #then the send goes on unclassified and the failure is logged", async () => {
  const warnings: string[] = []
  const result = await settled(resolveProvenance({ cwd, env: {}, gitRemote: runtime.gitRemote, loadWorkspaces: () => { throw new Error("omo.json is unreadable") }, onWarning: (message) => warnings.push(message) }))
  expect(result.value).toEqual({ workspace: "unclassified", project: "remote-project" })
  expect(warnings.join("\n")).toContain("omo.json is unreadable")
})

test("#given a remote nested under subgroups #when resolving #then any parent group can name the workspace", async () => {
  expect(await resolveProvenance({ cwd, env: {}, gitRemote: async () => "https://example.invalid/group/sub/remote-project.git", workspaces: [{ name: "Group workspace", git_owners: ["group"] }] }))
    .toEqual({ workspace: "Group workspace", project: "remote-project" })
})
