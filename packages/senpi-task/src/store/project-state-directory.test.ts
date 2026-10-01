import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import { projectStateKey, resolveProjectStateDirectory } from "./project-state-directory"

const HOME = "/home/tester"
const nothingExists = () => false

describe("resolveProjectStateDirectory", () => {
  describe("#given a project with no omo state inside it", () => {
    test("#then task state lands in the default agent dir, outside the project", () => {
      const directory = resolveProjectStateDirectory("/work/app", "senpi-task", { env: { HOME }, exists: nothingExists })

      expect(directory).toBe(join(HOME, ".omo", "agent", "projects", projectStateKey("/work/app"), "senpi-task"))
      expect(relative(resolve("/work/app"), directory).startsWith("..")).toBe(true)
    })

    test("#then an explicit agent dir wins, so an isolated agent dir keeps its own task state", () => {
      const env = { HOME, SENPI_CODING_AGENT_DIR: "/sandbox/senpi", OMO_CODING_AGENT_DIR: "/sandbox/omo" }

      expect(resolveProjectStateDirectory("/work/app", "senpi-task", { env, exists: nothingExists })).toBe(
        join(resolve("/sandbox/omo"), "projects", projectStateKey("/work/app"), "senpi-task"),
      )
    })

    test("#then the thread tools' mailbox shares the same per-project folder", () => {
      const tasks = resolveProjectStateDirectory("/work/app", "senpi-task", { env: { HOME }, exists: nothingExists })
      const threads = resolveProjectStateDirectory("/work/app", "thread-tools", { env: { HOME }, exists: nothingExists })

      expect(join(threads, "..")).toBe(join(tasks, ".."))
      expect(threads.endsWith("thread-tools")).toBe(true)
    })
  })

  describe("#given a project that already holds a state directory from an earlier release", () => {
    test("#then that in-project directory keeps being used so recorded tasks stay reachable", () => {
      const project = mkdtempSync(join(tmpdir(), "omo-project-state-"))
      try {
        mkdirSync(join(project, ".omo", "senpi-task", "tasks"), { recursive: true })
        writeFileSync(join(project, ".omo", "senpi-task", "tasks", "st_x.json"), "{}")

        expect(resolveProjectStateDirectory(project, "senpi-task", { env: { HOME } })).toBe(join(project, ".omo", "senpi-task"))
        expect(resolveProjectStateDirectory(project, "thread-tools", { env: { HOME } })).toBe(
          join(HOME, ".omo", "agent", "projects", projectStateKey(project), "thread-tools"),
        )
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    })
  })

  describe("#given a project holding only empty state directories created this session", () => {
    test("#then task state still lands in the agent dir instead of being pulled into the project", () => {
      const project = mkdtempSync(join(tmpdir(), "omo-project-state-"))
      try {
        mkdirSync(join(project, ".omo", "senpi-task", "tasks"), { recursive: true })
        mkdirSync(join(project, ".omo", "thread-tools"), { recursive: true })

        expect(resolveProjectStateDirectory(project, "senpi-task", { env: { HOME } })).toBe(
          join(HOME, ".omo", "agent", "projects", projectStateKey(project), "senpi-task"),
        )
        expect(resolveProjectStateDirectory(project, "thread-tools", { env: { HOME } })).toBe(
          join(HOME, ".omo", "agent", "projects", projectStateKey(project), "thread-tools"),
        )
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    })
  })

  describe("#given a legacy state directory whose records sit behind a symlink", () => {
    test("#then the legacy directory is kept instead of being treated as empty", () => {
      const project = mkdtempSync(join(import.meta.dir, ".omo-project-state-"))
      try {
        const elsewhere = join(project, "elsewhere")
        mkdirSync(elsewhere, { recursive: true })
        writeFileSync(join(elsewhere, "task.json"), "{}")
        mkdirSync(join(project, ".omo", "senpi-task"), { recursive: true })
        symlinkSync(elsewhere, join(project, ".omo", "senpi-task", "tasks"))

        expect(resolveProjectStateDirectory(project, "senpi-task", { env: { HOME } })).toBe(
          join(resolve(project), ".omo", "senpi-task"),
        )
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    })
  })

  describe("#given no explicit environment", () => {
    test("#then the process environment decides, so the hermetic test HOME is honored", () => {
      const directory = resolveProjectStateDirectory("/work/app", "senpi-task", { exists: nothingExists })

      expect(directory.startsWith(join(resolve(process.env.HOME ?? ""), ".omo", "agent", "projects"))).toBe(true)
    })
  })
})

describe("projectStateKey", () => {
  test("#given two projects with the same folder name #then their keys differ", () => {
    expect(projectStateKey("/a/app")).not.toBe(projectStateKey("/b/app"))
    expect(projectStateKey("/a/app").startsWith("app-")).toBe(true)
  })

  test("#given the same project spelled two ways #then the key is stable", () => {
    expect(projectStateKey("/work/app/")).toBe(projectStateKey("/work/./app"))
  })

  test("#given a project reached through a symlink #then it shares the key of its real path", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-project-key-"))
    try {
      mkdirSync(join(root, "real", "app"), { recursive: true })
      symlinkSync(join(root, "real"), join(root, "link"))

      expect(projectStateKey(join(root, "link", "app"))).toBe(projectStateKey(join(root, "real", "app")))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a folder name with path-hostile characters #then the key keeps only safe characters", () => {
    expect(projectStateKey("/work/my app:v2")).toMatch(/^my_app_v2-[0-9a-f]{12}$/)
  })
})
