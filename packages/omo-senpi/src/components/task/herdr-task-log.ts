import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { oneLine } from "./herdr-command-protocol"

export type HerdrTaskLog = {
  readonly path: string
  readonly viewerPath: string
  append(line: string): Promise<void>
  remove(): Promise<void>
}

export type HerdrTaskLogStore = {
  create(taskId: string): Promise<HerdrTaskLog>
}

export function createHerdrTaskLogStore(
  normalizeLine: (line: string) => string = oneLine,
): HerdrTaskLogStore {
  return {
    async create(taskId) {
      const directory = await mkdtemp(join(tmpdir(), "omo-herdr-native-"))
      await chmod(directory, 0o700)
      const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_")
      const path = join(directory, `${safeTaskId}-${randomUUID()}.log`)
      const handle = await open(path, "wx", 0o600)
      const viewerPath = join(directory, "viewer.mjs")
      const viewerHandle = await open(viewerPath, "wx", 0o600)
      await viewerHandle.write(HERDR_TASK_VIEWER_SOURCE)
      await viewerHandle.close()
      let closed = false
      let directoryRemoved = false
      return {
        path,
        viewerPath,
        async append(line) {
          if (closed) throw new Error("Herdr task log is closed")
          await handle.write(`${normalizeLine(line)}\n`)
        },
        async remove() {
          if (directoryRemoved) return
          if (!closed) {
            await handle.close()
            closed = true
          }
          await rm(directory, { force: true, recursive: true })
          directoryRemoved = true
        },
      }
    },
  }
}

const HERDR_TASK_VIEWER_SOURCE = `import { open, watch } from "node:fs/promises"
import { basename, dirname } from "node:path"
const path = process.env.OMO_HERDR_TASK_LOG
if (path === undefined) throw new Error("OMO_HERDR_TASK_LOG is required")
const filename = basename(path)
let offset = 0
async function drain() {
  const handle = await open(path, "r")
  try {
    const size = (await handle.stat()).size
    if (size <= offset) return
    const buffer = Buffer.alloc(size - offset)
    await handle.read(buffer, 0, buffer.length, offset)
    offset = size
    process.stdout.write(buffer)
  } finally {
    await handle.close()
  }
}
const changes = watch(dirname(path))[Symbol.asyncIterator]()
let nextChange = changes.next()
await drain()
while (true) {
  const next = await nextChange
  if (next.done) break
  nextChange = changes.next()
  if (next.value.filename === null || next.value.filename === filename) await drain()
}
`
