import { describe, test, expect } from "bun:test"
import { join, resolve } from "path"

import { containsPath, isWithinProject } from "./contains-path"

describe("contains-path", () => {
  describe("#given containsPath", () => {
    describe("#when candidate is directly inside root", () => {
      test("#then returns true", () => {
        const root = resolve("/tmp/project")
        const candidate = join(root, "src/index.ts")
        expect(containsPath(root, candidate)).toBe(true)
      })
    })

    describe("#when candidate is the root itself", () => {
      test("#then returns true", () => {
        const root = resolve("/tmp/project")
        expect(containsPath(root, root)).toBe(true)
      })
    })

    describe("#when candidate is outside root", () => {
      test("#then returns false", () => {
        const root = resolve("/tmp/project")
        const candidate = resolve("/tmp/other-project/file.ts")
        expect(containsPath(root, candidate)).toBe(false)
      })
    })

    describe("#when candidate uses .. to escape root", () => {
      test("#then returns false", () => {
        const root = resolve("/tmp/project")
        const candidate = join(root, "../other/file.ts")
        expect(containsPath(root, candidate)).toBe(false)
      })
    })

    describe("#when candidate is deeply nested inside root", () => {
      test("#then returns true", () => {
        const root = resolve("/tmp/project")
        const candidate = join(root, "src/shared/utils/deep/file.ts")
        expect(containsPath(root, candidate)).toBe(true)
      })
    })
  })

  describe("#given isWithinProject", () => {
    describe("#when candidate is inside project root", () => {
      test("#then returns true", () => {
        const projectRoot = resolve("/tmp/my-project")
        const candidate = join(projectRoot, "src/app.ts")
        expect(isWithinProject(candidate, projectRoot)).toBe(true)
      })
    })

    describe("#when candidate is outside project root", () => {
      test("#then returns false", () => {
        const projectRoot = resolve("/tmp/my-project")
        const candidate = resolve("/tmp/elsewhere/file.ts")
        expect(isWithinProject(candidate, projectRoot)).toBe(false)
      })
    })
  })
})
