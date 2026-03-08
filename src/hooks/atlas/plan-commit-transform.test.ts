import { describe, expect, test } from "bun:test"
import { isPlanPath, transformPlanCommitFields } from "./plan-commit-transform"

describe("isPlanPath", () => {
  describe("#given a valid plan path", () => {
    test("#when path is .sisyphus/plans/test.md #then returns true", () => {
      expect(isPlanPath(".sisyphus/plans/test.md")).toBe(true)
    })

    test("#when path has full path /project/.sisyphus/plans/test.md #then returns true", () => {
      expect(isPlanPath("/project/.sisyphus/plans/test.md")).toBe(true)
    })

    test("#when path uses backslashes #then returns true", () => {
      expect(isPlanPath("C:\\project\\.sisyphus\\plans\\test.md")).toBe(true)
    })
  })

  describe("#given a path with .sisyphus as substring (false-positive prevention)", () => {
    test("#when path is foo.sisyphus-backup/plans/test.md #then returns false", () => {
      expect(isPlanPath("foo.sisyphus-backup/plans/test.md")).toBe(false)
    })

    test("#when path is my.sisyphus/plans/test.md #then returns false", () => {
      expect(isPlanPath("my.sisyphus/plans/test.md")).toBe(false)
    })
  })

  describe("#given undefined or empty path", () => {
    test("#when path is undefined #then returns false", () => {
      expect(isPlanPath(undefined)).toBe(false)
    })
  })
})

describe("transformPlanCommitFields", () => {
  describe("#given content with Commit: YES", () => {
    test("#when transformed #then becomes Commit: NO (user disabled auto-commits)", () => {
      const content = "Commit: YES"
      const result = transformPlanCommitFields(content)
      expect(result).toBe("Commit: NO (user disabled auto-commits)")
    })
  })

  describe("#given content with Commit: NO", () => {
    test("#when transformed #then becomes Commit: NO (user disabled auto-commits)", () => {
      const content = "Commit: NO"
      const result = transformPlanCommitFields(content)
      expect(result).toBe("Commit: NO (user disabled auto-commits)")
    })
  })

  describe("#given content with Commit fields with extra whitespace", () => {
    test("#when transformed #then handles whitespace variations", () => {
      const content = "Commit:   YES"
      const result = transformPlanCommitFields(content)
      expect(result).toBe("Commit: NO (user disabled auto-commits)")
    })
  })

  describe("#given content with multiple Commit fields", () => {
    test("#when transformed #then all Commit fields are transformed", () => {
      const content = `
## Task 1
Commit: YES

## Task 2
Commit: NO

## Task 3
Commit: YES
`
      const result = transformPlanCommitFields(content)
      expect(result).toBe(`
## Task 1
Commit: NO (user disabled auto-commits)

## Task 2
Commit: NO (user disabled auto-commits)

## Task 3
Commit: NO (user disabled auto-commits)
`)
    })
  })

  describe("#given content with ReCommit: YES (word boundary check)", () => {
    test("#when transformed #then ReCommit is NOT transformed", () => {
      const content = "ReCommit: YES"
      const result = transformPlanCommitFields(content)
      expect(result).toBe("ReCommit: YES")
    })
  })

  describe("#given content without Commit fields", () => {
    test("#when transformed #then content is unchanged", () => {
      const content = `
## Task
- [ ] Do something
- [ ] Do another thing
`
      const result = transformPlanCommitFields(content)
      expect(result).toBe(content)
    })
  })

  describe("#given already transformed content", () => {
    test("#when transformed again #then remains idempotent", () => {
      const originalContent = "Commit: YES"
      const firstTransform = transformPlanCommitFields(originalContent)
      const secondTransform = transformPlanCommitFields(firstTransform)
      expect(secondTransform).toBe(firstTransform)
      expect(secondTransform).toBe("Commit: NO (user disabled auto-commits)")
    })
  })

  describe("#given complex plan content with mixed fields", () => {
    test("#when transformed #then only Commit fields are changed", () => {
      const content = `
# Plan

## 1. TASK
Some task description

## 2. EXPECTED OUTCOME
- [ ] Files created
- [ ] Tests pass

## 3. REQUIRED TOOLS
- Write
- Bash

## 4. Commit: YES
This should be committed after completion.
`
      const result = transformPlanCommitFields(content)
      expect(result).toBe(`
# Plan

## 1. TASK
Some task description

## 2. EXPECTED OUTCOME
- [ ] Files created
- [ ] Tests pass

## 3. REQUIRED TOOLS
- Write
- Bash

## 4. Commit: NO (user disabled auto-commits)
This should be committed after completion.
`)
    })
  })
})
