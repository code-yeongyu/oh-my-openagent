import { describe, expect, test } from "bun:test"

import { TASK_SUMMARY_MAX_LENGTH } from "../../task-summary"
import { MAX_TASK_BATCH_ITEMS, TaskToolParams } from "./params"

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

  test("#given batch task parameters #when schema is inspected #then a finite maximum is enforced", () => {
    expect(TaskToolParams.properties.tasks).toMatchObject({ maxItems: MAX_TASK_BATCH_ITEMS })
  })

  test("#given the schema #when task_summary is inspected #then it sits right after prompt with the schema length limit", () => {
    const keys = Object.keys(TaskToolParams.properties)
    expect(keys.indexOf("task_summary")).toBe(keys.indexOf("prompt") + 1)
    expect(TaskToolParams.properties.task_summary).toMatchObject({ maxLength: TASK_SUMMARY_MAX_LENGTH })
  })

  test("#given a batch item schema #when task_summary is inspected #then it sits right after the item prompt with the schema length limit", () => {
    const itemSchema = TaskToolParams.properties.tasks.items
    const keys = Object.keys(itemSchema.properties)
    expect(keys.indexOf("task_summary")).toBe(keys.indexOf("prompt") + 1)
    expect(itemSchema.properties.task_summary).toMatchObject({ maxLength: TASK_SUMMARY_MAX_LENGTH })
  })
})
