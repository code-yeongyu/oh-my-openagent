import { mock } from "bun:test"
import * as memoryFs from "@oh-my-opencode/memory-core/fs"
import { basename, dirname, join } from "node:path"

const original = { ...memoryFs }
let released = false

// Reproduces the Windows ordering of #11644 in this supervisor process, on any OS:
// - the directory sweep sees no lock files, as when the retained child exits only after this
//   acquisition's sweep pass, so the FIFO head itself proves the slot record dead;
// - at the head's fence read of `<slot>.recovery` (it re-read the dead-pid record and took the
//   recovery lock), the live supervisor that retained the slot releases it by removing the file.
mock.module("@oh-my-opencode/memory-core/fs", () => ({
  ...original,
  readdir: async (...args: Parameters<typeof memoryFs.readdir>) => {
    const entries = await original.readdir(...args)
    if (basename(String(args[0])) !== "locks") return entries
    return (entries as readonly unknown[]).filter((entry) => !(typeof entry === "string" && entry.endsWith(".lock")))
  },
  readFile: async (...args: Parameters<typeof memoryFs.readFile>) => {
    const content = await original.readFile(...args)
    const filePath = String(args[0])
    if (!released && filePath.endsWith(".slot-1.lock.recovery") && String(content).includes('"purpose":"reflection-run:recovery"')) {
      released = true
      await original.unlink(join(dirname(filePath), basename(filePath, ".recovery")))
    }
    return content
  },
}))
