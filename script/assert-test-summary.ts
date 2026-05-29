/// <reference types="bun-types" />

export const bunTestSummaryPattern = /^Ran [1-9][0-9]* tests across [1-9][0-9]* files?\./m

export function hasBunTestSummary(output: string): boolean {
  return bunTestSummaryPattern.test(output)
}

async function assertTestSummaryFromLog(logPath: string): Promise<void> {
  const output = await Bun.file(logPath).text()

  if (!hasBunTestSummary(output)) {
    throw new Error(`Missing bun test completion summary in ${logPath}`)
  }
}

if (import.meta.main) {
  const [logPath] = process.argv.slice(2)

  if (!logPath) {
    throw new Error("Usage: bun run script/assert-test-summary.ts <bun-test-log-path>")
  }

  await assertTestSummaryFromLog(logPath)
}
