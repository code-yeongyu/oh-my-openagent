import { describe, expect, it, spyOn, beforeEach, afterEach } from "bun:test"
import type { DelegateTaskArgs } from "./types"
import { compressDelegateTaskArgs } from "./types"
import * as toonCompression from "../../shared/toon-compression"

function createLargeDelegateTaskArgs(): DelegateTaskArgs {
  return {
    description: "Test task description",
    prompt: "a".repeat(5000),
    category: "quick",
    subagent_type: "explore",
    run_in_background: true,
    load_skills: ["skill1", "skill2", "skill3"],
  }
}

describe("delegate-task/types", () => {
  describe("#given compressDelegateTaskArgs", () => {
    let safeCompressSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      safeCompressSpy = spyOn(toonCompression, "safeCompress")
    })

    afterEach(() => {
      safeCompressSpy.mockRestore()
    })

    it("#then returns JSON string when compression is disabled", () => {
      const args = createLargeDelegateTaskArgs()
      const result = compressDelegateTaskArgs(args)

      expect(result).toBe(JSON.stringify(args))
    })

    it("#then uses safeCompress when compression is enabled", () => {
      const args = createLargeDelegateTaskArgs()
      compressDelegateTaskArgs(args)

      expect(safeCompressSpy).toHaveBeenCalledWith(args, "delegate-types")
    })

    it("#then preserves minimal args without optional fields", () => {
      const minimalArgs: DelegateTaskArgs = {
        description: "minimal",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      }

      const result = compressDelegateTaskArgs(minimalArgs)

      expect(result).toBe(JSON.stringify(minimalArgs))
    })

    it("#then handles args with execute field", () => {
      const argsWithExecute: DelegateTaskArgs = {
        description: "execute task",
        prompt: "run this",
        run_in_background: false,
        load_skills: [],
        execute: {
          task_id: "task-123",
          task_dir: "/tmp/tasks",
        },
      }

      const result = compressDelegateTaskArgs(argsWithExecute)

      expect(result).toBe(JSON.stringify(argsWithExecute))
    })

    it("#then handles args with session_id for continuation", () => {
      const argsWithSession: DelegateTaskArgs = {
        description: "continue task",
        prompt: "resume work",
        run_in_background: false,
        load_skills: [],
        session_id: "ses_abc123",
      }

      const result = compressDelegateTaskArgs(argsWithSession)

      expect(result).toBe(JSON.stringify(argsWithSession))
    })

    it("#then returns compressed output from safeCompress", () => {
      const args = createLargeDelegateTaskArgs()
      const mockCompressed = "compressed:toon:output"
      safeCompressSpy.mockReturnValue(mockCompressed)

      const result = compressDelegateTaskArgs(args)

      expect(result).toBe(mockCompressed)
    })
  })
})
