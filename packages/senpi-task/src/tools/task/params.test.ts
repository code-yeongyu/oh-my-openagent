import { describe, expect, test } from "bun:test"

import { TaskToolParams } from "./params"

describe("TaskToolParams", () => {
  test("#given the schema #when inspected #then it is a TypeBox object with the task tool fields", () => {
    // then
    expect(TaskToolParams.type).toBe("object")
    const properties = TaskToolParams.properties
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        "prompt",
        "description",
        "category",
        "subagent_type",
        "run_in_background",
        "task_id",
        "name",
        "execution_mode",
        "model",
        "load_skills",
      ]),
    )
  })

  test("#given the schema #when required fields are read #then only prompt is required", () => {
    // then
    expect(TaskToolParams.required).toEqual(["prompt"])
  })
})
