/// <reference types="bun-types" />

type CiTestPlan = {
  isolatedTestTargets: string[]
  isolatedModuleMockFiles: string[]
  sharedTestFiles: string[]
}

type CiTestPhase = "all" | "isolated" | "shared"

type CiTestRunOptions = {
  phase: CiTestPhase
  shardCount: number
  shardIndex: number
}

type CiTestTargetSelection = {
  isolatedTestTargets: string[]
  sharedTestFiles: string[]
}

const TEST_ROOTS = ["bin", "script", "src"] as const
const MODULE_MOCK_PATTERN = "mock.module("
const ALWAYS_ISOLATED_TEST_FILES = [
  "src/features/team-mode/team-mailbox/ack.test.ts",
  "src/features/team-mode/team-mailbox/send.test.ts",
  "src/features/team-mode/team-runtime/shutdown.test.ts",
  "src/features/team-mode/team-runtime/status.test.ts",
  "src/features/team-mode/team-state-store/resume.test.ts",
  "src/features/team-mode/team-state-store/store.test.ts",
  "src/features/boulder-state/storage.test.ts",
  "src/hooks/anthropic-context-window-limit-recovery/aggressive-truncation-strategy.test.ts",
  "src/hooks/session-notification-input-needed.test.ts",
  "src/hooks/session-notification-sender.test.ts",
  "src/hooks/session-notification.test.ts",
  "src/openclaw/__tests__/reply-listener-discord.test.ts",
  "src/tools/background-task/create-background-output.blocking.test.ts",
  "src/tools/background-task/tools.test.ts",
  "src/tools/interactive-bash/tmux-path-resolver.test.ts",
  "src/tools/task/task-list.test.ts",
] as const

async function collectTestFiles(rootDirectory: string): Promise<string[]> {
  const testFiles: string[] = []

  for (const testRoot of TEST_ROOTS) {
    const glob = new Bun.Glob("**/*.test.ts")

    for await (const testFile of glob.scan({ cwd: `${rootDirectory}/${testRoot}` })) {
      testFiles.push(`${testRoot}/${testFile}`)
    }
  }

  return testFiles.sort((left, right) => left.localeCompare(right))
}

async function usesModuleMock(rootDirectory: string, testFile: string): Promise<boolean> {
  const testContents = await Bun.file(`${rootDirectory}/${testFile}`).text()
  return testContents.includes(MODULE_MOCK_PATTERN)
}

function toIsolatedTarget(testFile: string): string {
  return testFile
}

function isCoveredByTarget(testFile: string, isolatedTarget: string): boolean {
  return testFile === isolatedTarget || testFile.startsWith(`${isolatedTarget}/`)
}

function collapseNestedTargets(isolatedTargets: string[]): string[] {
  return isolatedTargets.filter((isolatedTarget) => {
    return !isolatedTargets.some((otherTarget) => {
      return otherTarget !== isolatedTarget && isolatedTarget.startsWith(`${otherTarget}/`)
    })
  })
}

function readFlagValue(args: string[], flagName: string): string | null {
  const prefix = `${flagName}=`
  const flag = args.find((arg) => arg.startsWith(prefix))

  return flag?.slice(prefix.length) ?? null
}

function parsePhase(rawPhase: string | null): CiTestPhase {
  if (rawPhase === null) {
    return "all"
  }

  if (rawPhase === "all" || rawPhase === "isolated" || rawPhase === "shared") {
    return rawPhase
  }

  throw new Error(`Invalid --phase value: ${rawPhase}. Expected all, isolated, or shared.`)
}

function parsePositiveIntegerFlag(args: string[], flagName: string, defaultValue: number): number {
  const rawValue = readFlagValue(args, flagName)
  if (rawValue === null) {
    return defaultValue
  }

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`Invalid ${flagName} value: ${rawValue}. Expected a positive integer.`)
  }

  return parsedValue
}

function parseNonNegativeIntegerFlag(args: string[], flagName: string, defaultValue: number): number {
  const rawValue = readFlagValue(args, flagName)
  if (rawValue === null) {
    return defaultValue
  }

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid ${flagName} value: ${rawValue}. Expected a non-negative integer.`)
  }

  return parsedValue
}

function parseCiTestRunOptions(args: string[]): CiTestRunOptions {
  const phase = parsePhase(readFlagValue(args, "--phase"))
  const shardCount = parsePositiveIntegerFlag(args, "--shard-count", 1)
  const shardIndex = parseNonNegativeIntegerFlag(args, "--shard-index", 0)

  if (shardIndex >= shardCount) {
    throw new Error(`Invalid --shard-index value: ${shardIndex}. Expected a value less than --shard-count ${shardCount}.`)
  }

  if (shardCount > 1 && phase !== "isolated") {
    throw new Error("Test sharding is only supported with --phase=isolated.")
  }

  return { phase, shardCount, shardIndex }
}

function selectShard(testTargets: string[], shardCount: number, shardIndex: number): string[] {
  if (shardCount === 1) {
    return testTargets
  }

  return testTargets.filter((_, index) => index % shardCount === shardIndex)
}

export function selectCiTestTargets(ciTestPlan: CiTestPlan, options: CiTestRunOptions): CiTestTargetSelection {
  const isolatedTestTargets = options.phase === "shared"
    ? []
    : selectShard(ciTestPlan.isolatedTestTargets, options.shardCount, options.shardIndex)
  const sharedTestFiles = options.phase === "isolated" ? [] : ciTestPlan.sharedTestFiles

  return { isolatedTestTargets, sharedTestFiles }
}

export async function createCiTestPlan(rootDirectory: string = process.cwd()): Promise<CiTestPlan> {
  const allTestFiles = await collectTestFiles(rootDirectory)
  const isolatedModuleMockFiles: string[] = []

  for (const testFile of allTestFiles) {
    if (await usesModuleMock(rootDirectory, testFile)) {
      isolatedModuleMockFiles.push(testFile)
    }
  }

  const isolatedTestFiles = Array.from(
    new Set([...isolatedModuleMockFiles, ...ALWAYS_ISOLATED_TEST_FILES.filter((testFile) => allTestFiles.includes(testFile))]),
  )
  const isolatedTestTargets = collapseNestedTargets(
    isolatedTestFiles.map((testFile) => toIsolatedTarget(testFile)).sort((left, right) =>
      left.localeCompare(right),
    ),
  )
  const sharedTestFiles = allTestFiles.filter((testFile) => {
    return !isolatedTestTargets.some((isolatedTarget) => isCoveredByTarget(testFile, isolatedTarget))
  })

  return {
    isolatedTestTargets,
    isolatedModuleMockFiles,
    sharedTestFiles,
  }
}

async function runBunTest(testFiles: string[], label: string): Promise<void> {
  if (testFiles.length === 0) {
    return
  }

  console.log(`::group::${label}`)

  const args = testFiles.map((testFile) => {
    if (testFile.includes("/") && !testFile.endsWith(".test.ts")) {
      return [testFile, "!_auc-*/**/*.test.ts"]
    }

    return testFile
  }).flat()

  const command = ["bun", "test", ...args]
  const spawnedProcess = Bun.spawn(command, {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await spawnedProcess.exited
  console.log("::endgroup::")

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`)
  }
}

async function main(): Promise<void> {
  const options = parseCiTestRunOptions(process.argv.slice(2))
  const ciTestPlan = await createCiTestPlan()
  const selectedTargets = selectCiTestTargets(ciTestPlan, options)

  console.log(
    `Detected ${ciTestPlan.isolatedModuleMockFiles.length} mock.module() test files, ${ciTestPlan.isolatedTestTargets.length} isolated targets, and ${ciTestPlan.sharedTestFiles.length} shared test files.`,
  )

  if (options.phase === "isolated" && options.shardCount > 1) {
    console.log(
      `Running isolated test shard ${options.shardIndex + 1}/${options.shardCount} with ${selectedTargets.isolatedTestTargets.length} targets.`,
    )
  }

  for (const isolatedTestTarget of selectedTargets.isolatedTestTargets) {
    await runBunTest([isolatedTestTarget], `Isolated ${isolatedTestTarget}`)
  }

  await runBunTest(selectedTargets.sharedTestFiles, "Shared Bun test suite")
}

export const moduleMockPattern = MODULE_MOCK_PATTERN
export const testRoots = TEST_ROOTS

if (process.argv.includes("--print-plan")) {
  const ciTestPlan = await createCiTestPlan()
  console.log(JSON.stringify(ciTestPlan, null, 2))
} else if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}
