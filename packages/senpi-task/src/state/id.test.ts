import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { bumpTaskId, createTaskId, createTaskIdFactory } from "./id"

const idChildFixturePath = resolve(import.meta.dir, "__fixtures__", "id-child.ts")

async function expectChildModeToSucceed(mode: string): Promise<void> {
  const child = Bun.spawn([process.execPath, idChildFixturePath, mode], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
}

describe("task id primitives", () => {
  test("#given a task id ending in ffff #when bumped #then it carries into the next hexadecimal group", () => {
    // given
    const taskId = "st_0000ffff"

    // when
    const bumped = bumpTaskId(taskId)

    // then
    expect(bumped).toBe("st_00010000")
  })

  test("#given a task id #when bumped #then the hexadecimal value increments", () => {
    // given
    const taskId = "st_00000010"

    // when
    const bumped = bumpTaskId(taskId)

    // then
    expect(bumped).toBe("st_00000011")
  })

  test.each(["bump-exhaust", "create-exhaust", "floor-raise", "floor-never-lower", "nowms"])(
    "#given an isolated module process #when %s executes #then it succeeds",
    async (mode) => {
      await expectChildModeToSucceed(mode)
    },
  )
})

describe("createTaskId", () => {
  test("#given a deterministic clock #when ids are created #then ids are canonical and sortable", () => {
    // given
    const nowMs = 0x12345678

    // when
    const ids = [createTaskId(nowMs), createTaskId(nowMs), createTaskId(nowMs + 1)]

    // then
    expect(ids.every((id) => /^st_[0-9a-f]{8}$/.test(id))).toBe(true)
    expect(ids).toEqual(ids.toSorted())
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("#given a same-millisecond burst #when more than one byte of ids are created #then every id is unique", () => {
    // given
    const nowMs = 0x22334455

    // when
    const ids = Array.from({ length: 300 }, () => createTaskId(nowMs))

    // then
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ids.toSorted())
  })

  test("#given an isolated deterministic clock #when ids are created #then the clock seam is repeatable", () => {
    // given
    const nowMs = 0x1234_5678
    const firstFactory = createTaskIdFactory(() => nowMs)
    const secondFactory = createTaskIdFactory(() => nowMs)

    // when
    const firstIds = [firstFactory(), firstFactory(), firstFactory()]
    const secondIds = [secondFactory(), secondFactory(), secondFactory()]

    // then
    expect(firstIds).toEqual(secondIds)
    expect(firstIds.every((id) => /^st_[0-9a-f]{8}$/.test(id))).toBe(true)
    expect(firstIds).toEqual(firstIds.toSorted())
  })

  test("#given wrap pressure near the id ceiling #when ids are created #then ids never wrap or repeat", () => {
    // given
    const nextId = createTaskIdFactory(() => 0x00ff_ffff)

    // when
    const ids = Array.from({ length: 300 }, () => nextId())

    // then
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ids.toSorted())
    expect(ids).not.toContain("st_00000000")
  })
})
