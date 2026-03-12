import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import { StartWorkConfigSchema } from "./start-work"

describe("StartWorkConfigSchema", () => {
  describe("worktree", () => {
    describe("#given worktree set to false", () => {
      test("#when parsed #then returns worktree: false", () => {
        const result = StartWorkConfigSchema.parse({ worktree: false })

        expect(result.worktree).toBe(false)
      })
    })

    describe("#given worktree not provided", () => {
      test("#when parsed #then defaults to true", () => {
        const result = StartWorkConfigSchema.parse({})

        expect(result.worktree).toBe(true)
      })
    })

    describe("#given auto_commit and worktree together", () => {
      test("#when parsed #then accepts both fields", () => {
        const result = StartWorkConfigSchema.parse({
          auto_commit: true,
          worktree: false,
        })

        expect(result.auto_commit).toBe(true)
        expect(result.worktree).toBe(false)
      })
    })

    describe("#given worktree is non-boolean", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          StartWorkConfigSchema.parse({ worktree: "true" })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("auto_commit", () => {
    describe("#given auto_commit set to false", () => {
      test("#when parsed #then returns auto_commit: false", () => {
        const result = StartWorkConfigSchema.parse({ auto_commit: false })

        expect(result.auto_commit).toBe(false)
      })
    })

    describe("#given auto_commit not provided", () => {
      test("#when parsed #then defaults to true", () => {
        const result = StartWorkConfigSchema.parse({})

        expect(result.auto_commit).toBe(true)
      })
    })
  })
})
