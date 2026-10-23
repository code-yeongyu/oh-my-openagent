import { describe, expect, test } from "bun:test"
import { win32 } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryIdentityContext } from "./context"
import { grantProjectMemoryRead, isGrantedProjectMemoryRead } from "./project-memory-grants"

const shortRepo = String.raw`C:\Users\RUNNER~1\memory\agents\project-a\repo`

function context() {
  return createMemoryIdentityContext({
    identity: "own",
    identityPaths: buildIdentityPaths("/memory", "own"),
    binding: { identity: "own", repoPathHash: "hash", boundAt: 1 },
  })
}

// Windows' legacy sync lookup can preserve 8.3 names; promises.realpath and
// realpathSync.native use the native lookup that expands them.
function native(path: string): string {
  if (win32.basename(path) === "missing.md") throw Object.assign(new Error("missing"), { code: "ENOENT" })
  return win32.normalize(path).replace(/\\RUNNER~1\\/i, "\\runneradmin\\")
}
const windows = { realpath: native, platform: "win32" as const }

describe("project memory grant Windows canonical paths", () => {
  for (const target of [
    win32.join(shortRepo, "reference", "deploy.md"),
    "c:/users/RUNNER~1/memory/agents/PROJECT-A/repo/reference/deploy.md",
    "c:/USERS/runneradmin/memory/agents/PROJECT-A/repo\\reference/deploy.md",
    win32.join(shortRepo, "reference", "missing.md"),
  ]) {
    test(`#given a native canonical grant #when reading ${target} #then the note is granted`, async () => {
      const own = context()
      await grantProjectMemoryRead(own, shortRepo, { realPath: async (path) => native(path) })

      const granted = isGrantedProjectMemoryRead(own, target, windows)

      expect(granted).toBe(true)
    })
  }

  for (const target of [
    win32.join(shortRepo, "..", "..", "project-b", "repo", "reference", "deploy.md"),
    `${shortRepo}-other\\reference\\deploy.md`,
    shortRepo,
    win32.join(shortRepo, ".GIT", "config"),
    win32.join(shortRepo, "System", "persona.md"),
    String.raw`D:\Users\runneradmin\memory\agents\project-a\repo\reference\deploy.md`,
  ]) {
    test(`#given a project A grant #when reading ${target} #then access is not granted`, async () => {
      const own = context()
      await grantProjectMemoryRead(own, shortRepo, { realPath: async (path) => native(path) })

      const granted = isGrantedProjectMemoryRead(own, target, windows)

      expect(granted).toBe(false)
    })
  }

  test("#given a POSIX grant #when path case differs #then it remains distinct", async () => {
    const own = context()
    await grantProjectMemoryRead(own, "/memory/project-a/repo", { realPath: async (path) => path })

    const granted = isGrantedProjectMemoryRead(own, "/memory/PROJECT-A/repo/reference/deploy.md", {
      realpath: (path) => path, platform: "linux",
    })

    expect(granted).toBe(false)
  })
})
