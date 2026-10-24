/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { getTasksDir, resolveBaseDir } from "../team-registry"
import { createTask } from "./store"
import { createTaskInput, createTasklistFixture } from "./test-support"

test("createTask assigns distinct ids during concurrent creation", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    // when
    const [firstTask, secondTask] = await Promise.all([
      createTask(fixture.teamRunId, createTaskInput({ subject: "first task" }), fixture.config),
      createTask(fixture.teamRunId, createTaskInput({ subject: "second task" }), fixture.config),
    ])

    const tasksDirectory = getTasksDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    const watermarkContent = await readFile(path.join(tasksDirectory, ".highwatermark"), "utf8")
    const sortedIds = [firstTask.id, secondTask.id].sort((leftId, rightId) => Number(leftId) - Number(rightId))

    // then
    expect(sortedIds).toEqual(["1", "2"])
    expect(watermarkContent.trim()).toBe("2")
  } finally {
    await fixture.cleanup()
  }
}, 30_000)

test("createTask recovers next id from task files when high watermark is corrupt", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const firstTask = await createTask(fixture.teamRunId, createTaskInput({ subject: "first task" }), fixture.config)
    await createTask(fixture.teamRunId, createTaskInput({ subject: "second task" }), fixture.config)
    const tasksDirectory = getTasksDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await writeFile(path.join(tasksDirectory, ".highwatermark"), "not-a-number")

    // when
    const recoveredTask = await createTask(
      fixture.teamRunId,
      createTaskInput({ subject: "recovered task" }),
      fixture.config,
    )

    // then
    const firstTaskContent = await readFile(path.join(tasksDirectory, `${firstTask.id}.json`), "utf8")
    expect(recoveredTask.id).toBe("3")
    expect(JSON.parse(firstTaskContent).subject).toBe("first task")
    await expect(readFile(path.join(tasksDirectory, "3.json"), "utf8")).resolves.toContain("recovered task")
  } finally {
    await fixture.cleanup()
  }
})

test("#given traversal team run id #when creating a task #then no task directory escapes the team base", async () => {
  // given
  const fixture = await createTasklistFixture()
  const escapedDirectory = path.resolve(fixture.rootDirectory, "..", "escape")

  try {
    // when
    const createdTask = createTask("../../escape", createTaskInput(), fixture.config)

    // then
    await expect(createdTask).rejects.toThrow("team path escapes base directory")
    await expect(stat(escapedDirectory)).rejects.toBeInstanceOf(Error)
  } finally {
    await fixture.cleanup()
  }
})
