import { mock } from "bun:test"
import * as actualFs from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const scenario = process.argv[2]
if (scenario !== "cleanup-succeeds" && scenario !== "cleanup-fails" && scenario !== "chmod-cleanup-fails") {
  throw new Error("expected cleanup-succeeds, cleanup-fails, or chmod-cleanup-fails")
}

const publicationError = new Error("injected publication failure")
const chmodError = new Error("injected chmod failure")
const cleanupError = new Error("injected cleanup failure")
const realChmodSync = actualFs.chmodSync
const realRmSync = actualFs.rmSync

mock.module("node:fs", () => ({
  ...actualFs,
  chmodSync: (...args: Parameters<typeof actualFs.chmodSync>) => {
    if (scenario === "chmod-cleanup-fails") throw chmodError
    return realChmodSync(...args)
  },
  renameSync: (..._args: Parameters<typeof actualFs.renameSync>) => {
    throw publicationError
  },
  rmSync: (...args: Parameters<typeof actualFs.rmSync>) => {
    if (scenario === "cleanup-fails" || scenario === "chmod-cleanup-fails") throw cleanupError
    return realRmSync(...args)
  },
}))

const { FileHookStateStorage } = await import(
  "../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"
)
const root = actualFs.mkdtempSync(join(tmpdir(), "omo-hooks-errors-"))
const cwd = join(root, "project")
const agentDir = join(root, "agent")
const statePath = join(cwd, ".senpi", "hooks-state.json")
actualFs.mkdirSync(dirname(statePath), { recursive: true })

let thrown: unknown
try {
  new FileHookStateStorage({ cwd, agentDir }).update("project", (current) => current)
} catch (error) {
  thrown = error
}

const result = {
  isPublicationError: thrown === publicationError,
  isAggregateError: thrown instanceof AggregateError,
  errors: thrown instanceof AggregateError
    ? thrown.errors.map((error) => error === publicationError ? "publication" : error === chmodError ? "chmod" : error === cleanupError ? "cleanup" : "unknown")
    : [],
  message: thrown instanceof Error ? thrown.message : undefined,
  temporarySnapshots: actualFs.readdirSync(dirname(statePath)).filter((name) => name.endsWith(".tmp")).length,
}

realRmSync(root, { recursive: true, force: true })
process.stdout.write(`${JSON.stringify(result)}\n`)
