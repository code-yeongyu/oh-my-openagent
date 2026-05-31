/// <reference types="bun-types" />

import { expect, test } from "bun:test"

import { createTask } from "./store"
import { createTaskInput, createTasklistFixture } from "./test-support"
import { getTask } from "./get"

test("getTask returns a persisted task", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const createdTask = await createTask(fixture.teamRunId, createTaskInput({ subject: "persisted task" }), fixture.config)

    // when
    const loadedTask = await getTask(fixture.teamRunId, createdTask.id, fixture.config)

    // then
    expect(loadedTask).toEqual(createdTask)
  } finally {
    await fixture.cleanup()
  }
})

test("getTask throws when the task file is missing", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    // when
    let thrownError: unknown = null

    try {
      await getTask(fixture.teamRunId, "999", fixture.config)
    } catch (error) {
      thrownError = error
    }

    // then
    expect(thrownError).toBeInstanceOf(Error)
  } finally {
    await fixture.cleanup()
  }
})
