import { describe, expect, test } from "bun:test"
import { transformPlanCommitFields } from "./tool-execute-before"

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
