import { expect, spyOn } from "bun:test"
import { readFileSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { dirname } from "node:path"
import * as fs from "../fs/resilient"

export async function observeWatermarkPublication(target: string, publish: () => Promise<unknown>): Promise<string> {
  const before = readFileSync(target, "utf8")
  const observed: string[] = []
  const temporaryPaths: string[] = []
  const write = fs.writeFile
  const intercepted = spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
    if (typeof path !== "string" || (path !== target && !path.startsWith(`${target}.tmp-`))) {
      return write(path, data, options)
    }
    if (typeof data !== "string") throw new Error("watermark writer must supply JSON text")
    temporaryPaths.push(path)
    // Keep the writer's real destination and flags; only expose its write boundaries.
    await write(path, "", options)
    observed.push(readFileSync(target, "utf8"))
    const middle = Math.floor(data.length / 2)
    await appendFile(path, data.slice(0, middle), "utf8")
    observed.push(readFileSync(target, "utf8"))
    await appendFile(path, data.slice(middle), "utf8")
    observed.push(readFileSync(target, "utf8"))
  })
  try {
    await publish()
  } finally {
    intercepted.mockRestore()
  }
  expect(observed).toEqual([before, before, before])
  expect(temporaryPaths).toHaveLength(1)
  const temporary = temporaryPaths[0]
  if (temporary === undefined) throw new Error("watermark writer was not intercepted")
  expect(dirname(temporary)).toBe(dirname(target))
  return temporary
}

export type WatermarkReadFault = "malformed" | "invalid-shape" | "missing" | "unreadable"

export async function withWatermarkReadFault(
  target: string,
  fault: WatermarkReadFault,
  consume: () => Promise<unknown>,
): Promise<void> {
  const read = fs.readFileSync
  let reads = 0
  const intercepted = spyOn(fs, "readFileSync").mockImplementation(new Proxy(read, {
    apply(original, receiver, args) {
      if (String(args[0]) === target && ++reads === 1) {
        if (fault === "malformed") return "{"
        if (fault === "invalid-shape") return '{"version":2}'
        throw Object.assign(new Error("injected watermark read failure"), {
          code: fault === "missing" ? "ENOENT" : "EACCES",
        })
      }
      return Reflect.apply(original, receiver, args)
    },
  }))
  try {
    await consume()
  } finally {
    intercepted.mockRestore()
  }
  expect(reads).toBeGreaterThanOrEqual(2)
}
