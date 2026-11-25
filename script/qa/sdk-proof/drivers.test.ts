import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cellOf } from "./cell.ts"
import { createCliDriver } from "./drivers/cli.ts"
import { threadOf } from "./drivers/driver.ts"
import { createToolsDriver } from "./drivers/tools.ts"
import { startSdkDriver } from "./world/sdk-process.ts"

// Negative controls of each real driver: the driver of every surface, run against a stand-in for that surface which
// answers an error and then a success, makes the step's cell go red and then green. A driver that reported success for
// a surface that failed would make the X1a table lie; these fail when it does.

const ERROR = { kind: "error", error: { code: "host_unavailable", message: "x", next_action: "y" } }
const OK = { kind: "ok", thread: "dev-b/t-1" }
const OPEN = { op: "create", input: { device: "dev-b", prompt: "p" } } as const

const dir = mkdtempSync(join(tmpdir(), "x1a-drivers-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("the CLI driver", () => {
  const answering = (body: object, exit: number) =>
    createCliDriver({
      launcher: [process.execPath, "-e", `console.log(${JSON.stringify(JSON.stringify(body))}); process.exit(${exit})`],
      env: process.env,
      cwd: dir,
    })

  test("#given omo answering an error #when the open runs #then the cell is red", async () => {
    // given / when
    const answer = await answering(ERROR, 1).run(OPEN)

    // then
    expect(cellOf(answer, undefined)).toEqual({ cell: "fail", why: "the surface answered error host_unavailable" })
  })

  test("#given omo answering the thread #when the open runs #then the cell is green and the thread is taken back", async () => {
    // given / when
    const answer = await answering(OK, 0).run(OPEN)

    // then
    expect(cellOf(answer, undefined).cell).toBe("pass")
    expect(answer.thread).toBe("dev-b/t-1")
  })
})

describe("the tools driver", () => {
  const answering = (result: object) =>
    createToolsDriver({ prompt: async () => JSON.stringify({ details: { result } }) })

  test("#given a tool answering an error #when the open runs #then the cell is red", async () => {
    expect(cellOf(await answering(ERROR).run(OPEN), undefined).cell).toBe("fail")
  })

  test("#given a tool answering the thread #when the open runs #then the cell is green", async () => {
    const answer = await answering(OK).run(OPEN)
    expect([cellOf(answer, undefined).cell, threadOf(answer.raw)]).toEqual(["pass", "dev-b/t-1"])
  })

  test("#given the contract's refusal for a session principal #when the steer runs #then only that refusal is green", async () => {
    const refused = await answering({ kind: "error", error: { code: "invalid_arguments" } }).run(OPEN)
    expect([cellOf(refused, undefined, "invalid_arguments").cell, cellOf(refused, undefined).cell]).toEqual([
      "pass",
      "fail",
    ])
  })
})

describe("the SDK driver", () => {
  const entry = (result: object): string => {
    const path = join(dir, `entry-${Math.random().toString(36).slice(2)}.mjs`)
    const body = JSON.stringify(result)
    writeFileSync(
      path,
      `export const createThreadSdk = () => ({ create: async () => (${body}), dispose: async () => {} })\n`,
    )
    return path
  }
  const run = async (result: object) => {
    const driver = startSdkDriver({ entry: entry(result), env: { PATH: process.env["PATH"] ?? "" }, cwd: dir })
    try {
      return await driver.run(OPEN)
    } finally {
      await driver.close()
    }
  }

  test("#given an SDK entry answering an error #when the open runs #then the cell is red", async () => {
    expect(cellOf(await run(ERROR), undefined).cell).toBe("fail")
  })

  test("#given an SDK entry answering the thread #when the open runs #then the cell is green", async () => {
    const answer = await run(OK)
    expect([cellOf(answer, undefined).cell, answer.thread]).toEqual(["pass", "dev-b/t-1"])
  })
})
