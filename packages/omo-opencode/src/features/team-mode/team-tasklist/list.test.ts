/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"

import { getTasksDir, resolveBaseDir } from "../team-registry"
import { createTask } from "./store"
import { createTaskInput, createTasklistFixture } from "./test-support"
import { updateTaskStatus } from "./update"
import { listTasks } from "./list"

test("listTasks returns tasks sorted ascending and honors filters", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const firstTask = await createTask(
      fixture.teamRunId,
      createTaskInput({ subject: "one", status: "claimed", owner: "member-a", claimedAt: Date.now() }),
      fixture.config,
    )
    await createTask(fixture.teamRunId, createTaskInput({ subject: "two" }), fixture.config)
    const thirdTask = await createTask(
      fixture.teamRunId,
      createTaskInput({ subject: "three", status: "claimed", owner: "member-a", claimedAt: Date.now() }),
      fixture.config,
    )
    await updateTaskStatus(fixture.teamRunId, thirdTask.id, "in_progress", "member-a", fixture.config)

    // when
    const allTasks = await listTasks(fixture.teamRunId, fixture.config)
    const claimedTasks = await listTasks(fixture.teamRunId, fixture.config, { status: "claimed", owner: "member-a" })

    // then
    expect(allTasks.map((task) => task.id)).toEqual([firstTask.id, "2", thirdTask.id])
    expect(claimedTasks).toHaveLength(1)
    expect(claimedTasks[0]?.id).toBe(firstTask.id)
  } finally {
    await fixture.cleanup()
  }
})

test("listTasks skips malformed task files", async () => {
  // given
  const fixture = await createTasklistFixture()

  try {
    const validTask = await createTask(fixture.teamRunId, createTaskInput(), fixture.config)
    const tasksDirectory = getTasksDir(resolveBaseDir(fixture.config), fixture.teamRunId)
    await writeFile(path.join(tasksDirectory, "bad.json"), "{not-json")
    await writeFile(path.join(tasksDirectory, ".highwatermark"), "1")

    // when
    const listedTasks = await listTasks(fixture.teamRunId, fixture.config)

    // then
    expect(listedTasks).toHaveLength(1)
    expect(listedTasks[0]?.id).toBe(validTask.id)
  } finally {
    await fixture.cleanup()
  }
})
