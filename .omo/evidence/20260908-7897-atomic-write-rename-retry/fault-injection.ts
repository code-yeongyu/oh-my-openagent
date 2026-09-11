import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { atomicWrite } from "../../../packages/team-core/src/team-state-store/locks"

type Scenario = {
  readonly name: string
  readonly platform: NodeJS.Platform
  readonly failuresBeforeSuccess: number
  readonly code: "EPERM" | "EBUSY"
}

function createWindowsRenameError(code: "EPERM" | "EBUSY", from: string, to: string): Error {
  const errno = code === "EPERM" ? -4048 : -4082
  return Object.assign(new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`), {
    code,
    errno,
    syscall: "rename",
    path: from,
    dest: to,
  })
}

async function listTempFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((entry) => entry.includes(".tmp."))
}

async function runScenario(scenario: Scenario): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), "omo-7897-"))
  const target = join(directory, "state.json")
  await writeFile(target, JSON.stringify({ version: 1, status: "old" }))
  let renameCalls = 0
  const startedAt = performance.now()
  let outcome = "resolved"
  let errorCode: string | null = null

  try {
    await atomicWrite(target, JSON.stringify({ version: 1, status: "new" }), {
      platform: scenario.platform,
      rename: async (from, to) => {
        renameCalls += 1
        if (renameCalls <= scenario.failuresBeforeSuccess) {
          throw createWindowsRenameError(scenario.code, String(from), String(to))
        }
        await rename(from, to)
      },
    })
  } catch (error) {
    outcome = "rejected"
    errorCode = error instanceof Error && "code" in error ? String(error.code) : String(error)
  }

  const elapsedMs = Math.round(performance.now() - startedAt)
  const finalContent = JSON.parse(await readFile(target, "utf8")) as { status: string }
  const leftoverTempFiles = await listTempFiles(directory)
  await rm(directory, { recursive: true, force: true })

  return {
    scenario: scenario.name,
    platform: scenario.platform,
    injectedCode: scenario.code,
    failuresBeforeSuccess: scenario.failuresBeforeSuccess,
    renameCalls,
    outcome,
    errorCode,
    elapsedMs,
    finalStatus: finalContent.status,
    leftoverTempFiles,
  }
}

async function runConcurrentBurst(): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), "omo-7897-burst-"))
  const target = join(directory, "state.json")
  await writeFile(target, JSON.stringify({ version: 1, writer: "initial" }))
  let renameCalls = 0
  let injectedFailures = 0
  const writers = 8
  const startedAt = performance.now()

  const results = await Promise.allSettled(
    Array.from({ length: writers }, (_, index) =>
      atomicWrite(target, JSON.stringify({ version: 1, writer: `hook-${index}` }), {
        platform: "win32",
        rename: async (from, to) => {
          renameCalls += 1
          if (renameCalls % 3 === 0) {
            injectedFailures += 1
            throw createWindowsRenameError("EPERM", String(from), String(to))
          }
          await rename(from, to)
        },
      }),
    ),
  )

  const elapsedMs = Math.round(performance.now() - startedAt)
  const finalContent = JSON.parse(await readFile(target, "utf8")) as { writer: string }
  const leftoverTempFiles = await listTempFiles(directory)
  await rm(directory, { recursive: true, force: true })

  return {
    scenario: "concurrent burst of 8 writers, every 3rd rename fails once with EPERM",
    platform: "win32",
    writers,
    renameCalls,
    injectedFailures,
    fulfilled: results.filter((result) => result.status === "fulfilled").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    elapsedMs,
    finalWriterIsValidJson: typeof finalContent.writer === "string",
    finalWriter: finalContent.writer,
    leftoverTempFiles,
  }
}

const scenarios: Scenario[] = [
  { name: "win32 EPERM twice then success", platform: "win32", failuresBeforeSuccess: 2, code: "EPERM" },
  { name: "win32 EBUSY four times then success", platform: "win32", failuresBeforeSuccess: 4, code: "EBUSY" },
  { name: "win32 EPERM persistent (never succeeds)", platform: "win32", failuresBeforeSuccess: 999, code: "EPERM" },
  { name: "linux EPERM once (must not retry)", platform: "linux", failuresBeforeSuccess: 1, code: "EPERM" },
]

const report: Record<string, unknown>[] = []
for (const scenario of scenarios) {
  report.push(await runScenario(scenario))
}
report.push(await runConcurrentBurst())

for (const row of report) {
  console.log(JSON.stringify(row))
}
