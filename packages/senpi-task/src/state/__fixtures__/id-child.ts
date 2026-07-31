import { strict as assert } from "node:assert"

import { createTaskRecord } from "../record"
import { bumpTaskId, createTaskId, syncTaskIdFloor, TaskIdSpaceExhaustedError } from "../id"

const mode = process.argv[2]

try {
  switch (mode) {
    case "bump-exhaust":
      assert.throws(() => bumpTaskId("st_ffffffff"), TaskIdSpaceExhaustedError)
      break
    case "create-exhaust":
      syncTaskIdFloor("st_ffffffff")
      assert.throws(() => createTaskId(), TaskIdSpaceExhaustedError)
      break
    case "floor-raise":
      syncTaskIdFloor("st_00000100")
      assert.equal(createTaskId(0x10 * 0x10000), "st_00000101")
      break
    case "floor-never-lower":
      syncTaskIdFloor("st_00000200")
      syncTaskIdFloor("st_00000100")
      assert.equal(createTaskId(0x10 * 0x10000), "st_00000201")
      break
    case "nowms":
      assert.equal(
        createTaskRecord(
          {
            parent_session_id: "parent-session",
            root_session_id: "root-session",
            depth: 0,
            execution_mode: "in-process",
            model: "test/model",
          },
          0x123 * 0x10000,
        ).task_id,
        "st_00000123",
      )
      break
    default:
      throw new Error(`Unknown mode: ${mode ?? "undefined"}`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
