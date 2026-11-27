import { afterAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { enumerateProcesses } from "@oh-my-opencode/utils/process-sweep"

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

// A process whose command line carries `marker` and is still alive; the read-back of a driver's teardown. The process
// table comes from `ps` on POSIX and from Win32_Process on Windows, where there is no pgrep.
const alive = async (marker: string): Promise<boolean> =>
  (await enumerateProcesses()).some(({ command, pid }) => pid !== process.pid && command.includes(marker))

const abortSoon = (): AbortSignal => AbortSignal.timeout(100)

describe("the CLI driver, stalled or answering nonsense", () => {
  test("#given omo that never exits #when the step deadline aborts the call #then the process is gone and the cell is red", async () => {
    // given
    const marker = `x1a-stall-${randomUUID()}`
    const driver = createCliDriver({
      launcher: [process.execPath, "-e", `/* ${marker} */ setInterval(() => {}, 1000)`],
      env: process.env,
      cwd: dir,
    })

    // when
    const answer = await driver.run(OPEN, abortSoon())

    // then
    expect(cellOf(answer, undefined).cell).toBe("fail")
    expect(await alive(marker)).toBe(false)
  })

  test("#given omo printing text that is not a thread result #when the open runs #then the cell is red", async () => {
    const driver = createCliDriver({
      launcher: [process.execPath, "-e", 'console.log("done")'],
      env: process.env,
      cwd: dir,
    })
    expect(cellOf(await driver.run(OPEN), undefined).cell).toBe("fail")
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

  test("#given a tool answering text that is not a thread result #when the open runs #then the cell is red", async () => {
    const driver = createToolsDriver({ prompt: async () => "the tool printed something else" })
    expect(cellOf(await driver.run(OPEN), undefined).cell).toBe("fail")
  })

  test("#given a tool call that never answers #when the step deadline aborts it #then the call ends and its cell is red", async () => {
    // given
    const driver = createToolsDriver({
      prompt: (_text, _tool, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        ),
    })

    // when
    const settled = await driver.run(OPEN, abortSoon()).then(
      (answer) => cellOf(answer, undefined).cell,
      () => "rejected",
    )

    // then
    expect(settled).toBe("rejected")
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

  test("#given an SDK entry without the operation #when the open runs #then the cell is red", async () => {
    const path = join(dir, `entry-${randomUUID()}.mjs`)
    writeFileSync(path, "export const createThreadSdk = () => ({ dispose: async () => {} })\n")
    const driver = startSdkDriver({ entry: path, env: { PATH: process.env["PATH"] ?? "" }, cwd: dir })
    try {
      expect(cellOf(await driver.run(OPEN), undefined).cell).toBe("fail")
    } finally {
      await driver.close()
    }
  })

  test("#given an SDK call that never settles #when the step deadline aborts it #then the script is gone and the cell is red", async () => {
    // given
    const path = join(dir, `entry-stall-${randomUUID()}.mjs`)
    writeFileSync(
      path,
      "export const createThreadSdk = () => ({ create: () => new Promise(() => {}), dispose: async () => {} })\n",
    )
    const driver = startSdkDriver({ entry: path, env: { PATH: process.env["PATH"] ?? "" }, cwd: dir })

    // when
    const answer = await driver.run(OPEN, abortSoon())
    await driver.close()

    // then
    expect(cellOf(answer, undefined).cell).toBe("fail")
    expect(await alive(path)).toBe(false)
  })

  test("#given an SDK entry answering the thread #when the open runs #then the cell is green", async () => {
    const answer = await run(OK)
    expect([cellOf(answer, undefined).cell, answer.thread]).toEqual(["pass", "dev-b/t-1"])
  })
})
