import { describe, expect, test } from "bun:test"

import { TaskToolParams } from "./params"

describe("TaskToolParams", () => {
  test("#given the schema #when inspected #then it is a TypeBox object with the task tool fields", () => {
    expect(TaskToolParams.type).toBe("object")
    const properties = TaskToolParams.properties
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        "prompt",
        "description",
        "category",
        "subagent_type",
        "run_in_background",
        "name",
        "model",
        "load_skills",
      ]),
    )
  })

  test("#given the schema #when properties are inspected #then removed task params are absent", () => {
    const propertyKeys = Object.keys(TaskToolParams.properties)

    expect(propertyKeys).toContain("prompt")
    expect(propertyKeys).not.toContain("execution_mode")
    expect(propertyKeys).not.toContain("task_id")
  })

  test("#given the schema #when required fields are read #then neither prompt nor tasks is schema-required (the prompt-XOR-tasks rule is enforced by validateBatchShape)", () => {
    expect(TaskToolParams.required).toBeUndefined()
  })
})
