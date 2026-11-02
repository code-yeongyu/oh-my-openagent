import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { createNodeGitExec } from "./exec"
import {
  ParkServer,
  environmentWith,
  forwardSlashes,
  gitOpEntries,
  identityRepo,
  jobHelperPath,
  requireJobHelperWhenDemanded,
  runsJobHelperRows,
  writeHook,
} from "./job-helper-fixtures.test-support"
import {
  closeHandle,
  isProcessInJob,
  jobActiveProcesses,
  jobProcessIds,
  openJobForQuery,
  parentPids,
  processImage,
} from "./windows-job-observer.test-support"

requireJobHelperWhenDemanded()

const roots: string[] = []
const parks: ParkServer[] = []
afterEach(async () => {
  for (const park of parks.splice(0)) await park.close()
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe.skipIf(!runsJobHelperRows)("T1: every process of one memory git command is a member of its floor job (design v4.2)", () => {
  test("#given a commit whose commit-msg hook starts a background child and a Bun grandchild and parks #when the testkit inspects F by the entry's job name #then the launcher, git, sh, the background child and the Bun grandchild are all members", async () => {
    // #given
    const { root, paths, hooks } = await identityRepo("job-helper-t1-", "t1-chain")
    roots.push(root)
    const park = await ParkServer.start()
    parks.push(park)
    await writeHook(hooks, "commit-msg", [
      `( "$OMO_TEST_BUN" "$OMO_TEST_PARK" grandchild; : ) </dev/null >/dev/null 2>&1 &`,
      `"$OMO_TEST_BUN" "$OMO_TEST_PARK" hook`,
    ].join("\n"))
    const exec = createNodeGitExec({ jobHelper: { path: jobHelperPath(), lingerMs: 10_000 } })

    // #when
    const commit = exec.run(["-c", `core.hooksPath=${forwardSlashes(hooks)}`, "commit", "--allow-empty", "-m", "t1"], {
      cwd: paths.repo,
      timeoutMs: 120_000,
      env: environmentWith(park.hookEnvironment()),
    })
    const hook = await park.waitFor("hook", 60_000)
    const grandchild = await park.waitFor("grandchild", 60_000)
    const [entryName] = await gitOpEntries(paths.locks)
    expect(entryName).toBeDefined()
    const entry = JSON.parse(await readFile(join(paths.locks, "git-ops", entryName ?? ""), "utf8")) as { job: string; helper: { pid: number } }
    const job = openJobForQuery(entry.job)
    expect(job).not.toBeNull()
    let receipt = ""
    try {
      const members = jobProcessIds(job ?? 0n)
      const active = jobActiveProcesses(job ?? 0n)
      const parents = parentPids()
      const images = new Map(members.map((pid) => [pid, processImage(pid) ?? "?"]))
      const launcher = members.find((pid) => parents.get(pid) === entry.helper.pid)
      // Git for Windows ships the real git under one MSYS2 toolchain dir (mingw64 or ucrt64 on x64 -
      // windows-latest measured ucrt64 - and clangarm64 on arm64). PATH may resolve the launcher to the Git\cmd shim or straight to that real git.
      const realGitImage = /\\(mingw64|ucrt64|clangarm64)\\bin\\git\.exe$/i
      const realGit = members.find((pid) => realGitImage.test(images.get(pid) ?? ""))
      const chain = { launcher, realGit, hookShell: hook.ppid, backgroundChild: grandchild.ppid, hookBun: hook.pid, bunGrandchild: grandchild.pid }
      receipt = JSON.stringify({ job: entry.job, helper: entry.helper.pid, active, members: [...images], chain })
      console.log(`[T1] ${receipt}`)

      // #then
      expect(active, receipt).toBe(members.length)
      expect(launcher, receipt).toBeDefined()
      expect(basename(images.get(launcher ?? 0) ?? "").toLowerCase(), receipt).toBe("git.exe")
      expect(realGit, receipt).toBeDefined()
      if (realGit !== launcher) expect(images.get(launcher ?? 0), receipt).toMatch(/\\cmd\\git\.exe$/i)
      expect(processImage(hook.ppid) ?? "", receipt).toMatch(/\\(sh|bash)\.exe$/i)
      expect(processImage(grandchild.ppid) ?? "", receipt).toMatch(/\\(sh|bash)\.exe$/i)
      expect(processImage(grandchild.pid) ?? "", receipt).toMatch(/\\bun\.exe$/i)
      for (const [name, pid] of Object.entries(chain)) {
        expect({ name, inJob: isProcessInJob(pid ?? 0, job ?? 0n), listed: members.includes(pid ?? 0) }, receipt).toEqual({ name, inJob: true, listed: true })
      }
    } finally {
      closeHandle(job ?? 0n)
      park.release("grandchild")
      park.release("hook")
    }
    expect((await commit).code, receipt).toBe(0)
  }, 180_000)
})
