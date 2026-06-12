import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shouldLoadPluginForCwd } from "./scope-filter"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

describe("shouldLoadPluginForCwd", () => {
  afterEach(() => {
    mock.restore()

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  describe("#given a user-scoped plugin", () => {
    it("#when called with any cwd #then it loads", () => {
      //#given
      const installation = { scope: "user" as const }

      //#when
      const result = shouldLoadPluginForCwd(installation, "/tmp/anywhere")

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given a managed-scoped plugin", () => {
    it("#when called with any cwd #then it loads", () => {
      //#given
      const installation = { scope: "managed" as const }

      //#when
      const result = shouldLoadPluginForCwd(installation, "/tmp/anywhere")

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given a project-scoped plugin without projectPath", () => {
    it("#when called with any cwd #then it is skipped", () => {
      //#given
      const installation = { scope: "project" as const }

      //#when
      const result = shouldLoadPluginForCwd(installation, "/tmp/anywhere")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given a local-scoped plugin without projectPath", () => {
    it("#when called with any cwd #then it is skipped", () => {
      //#given
      const installation = { scope: "local" as const }

      //#when
      const result = shouldLoadPluginForCwd(installation, "/tmp/anywhere")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given a project-scoped plugin with matching projectPath", () => {
    it("#when cwd exactly matches projectPath #then it loads", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const installation = {
        scope: "project" as const,
        projectPath: projectDirectory,
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, projectDirectory)

      //#then
      expect(result).toBe(true)
    })

    it("#when cwd is a subdirectory of projectPath #then it loads", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const installation = {
        scope: "project" as const,
        projectPath: projectDirectory,
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, join(projectDirectory, "packages", "app"))

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given a project-scoped plugin with non-matching projectPath", () => {
    it("#when cwd is unrelated #then it is skipped", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const otherDirectory = createTemporaryDirectory("omo-other-")
      const installation = {
        scope: "project" as const,
        projectPath: projectDirectory,
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, otherDirectory)

      //#then
      expect(result).toBe(false)
    })

    it("#when cwd is the parent of projectPath #then it is skipped", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const installation = {
        scope: "project" as const,
        projectPath: join(projectDirectory, "nested"),
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, projectDirectory)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given a local-scoped plugin with matching projectPath", () => {
    it("#when cwd matches projectPath #then it loads", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const installation = {
        scope: "local" as const,
        projectPath: projectDirectory,
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, projectDirectory)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given a local-scoped plugin with non-matching projectPath", () => {
    it("#when cwd is unrelated #then it is skipped", () => {
      //#given
      const projectDirectory = createTemporaryDirectory("omo-scope-")
      const otherDirectory = createTemporaryDirectory("omo-other-")
      const installation = {
        scope: "local" as const,
        projectPath: projectDirectory,
      }

      //#when
      const result = shouldLoadPluginForCwd(installation, otherDirectory)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given a project-scoped plugin with a tilde-prefixed projectPath", () => {
    let fakeHome: string

    beforeEach(() => {
      fakeHome = createTemporaryDirectory("omo-home-")
      mock.module("node:os", () => ({
        homedir: () => fakeHome,
        tmpdir,
      }))
      mock.module("os", () => ({
        homedir: () => fakeHome,
        tmpdir,
      }))
    })

    it("#when the expanded home matches cwd #then it loads", async () => {
      //#given
      const { shouldLoadPluginForCwd: freshShouldLoad } = await import(
        `./scope-filter?t=${Date.now()}-tilde-match`
      )
      const installation = {
        scope: "project" as const,
        projectPath: "~/workspace/proj-a",
      }
      const cwd = join(fakeHome, "workspace", "proj-a")

      //#when
      const result = freshShouldLoad(installation, cwd)

      //#then
      expect(result).toBe(true)
    })

    it("#when the expanded home does not match cwd #then it is skipped", async () => {
      //#given
      const { shouldLoadPluginForCwd: freshShouldLoad } = await import(
        `./scope-filter?t=${Date.now()}-tilde-mismatch`
      )
      const installation = {
        scope: "project" as const,
        projectPath: "~/workspace/proj-a",
      }
      const cwd = join(fakeHome, "workspace", "proj-b")

      //#when
      const result = freshShouldLoad(installation, cwd)

      //#then
      expect(result).toBe(false)
    })

    it("#when projectPath is exactly ~ and cwd equals fake home #then it loads", async () => {
      //#given
      const { shouldLoadPluginForCwd: freshShouldLoad } = await import(
        `./scope-filter?t=${Date.now()}-tilde-root`
      )
      const installation = {
        scope: "project" as const,
        projectPath: "~",
      }

      //#when
      const result = freshShouldLoad(installation, fakeHome)

      //#then
      expect(result).toBe(true)
    })
  })
})
