import { expect, test } from "bun:test"
import { IsolationUnavailableError } from "../backend"
import { copyBudget } from "./copy-tree"

test("copy budget enforces free space plus ten percent and default 2 GiB during traversal", async () => {
  const consume = await copyBudget("unused", undefined, async () => ({ bavail: 110, bsize: 1 }))
  consume(100)
  expect(() => consume(1)).toThrow(IsolationUnavailableError)
  const ceiling = await copyBudget("unused", undefined, async () => ({ bavail: 10 * 1024 ** 3, bsize: 1 }))
  expect(() => ceiling(2 * 1024 ** 3 + 1)).toThrow("maxCopyBytes")
})
