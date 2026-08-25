import { spawn } from "node:child_process"

export interface TestFastGroup {
  readonly name: string
  readonly args: readonly string[]
}

export type SpawnTestGroup = (group: TestFastGroup) => Promise<number>

export function testFastGroups(): TestFastGroup[] {
  return [
    {
      name: "opencode-memory",
      args: ["test", "packages/omo-opencode", "packages/memory-core"],
    },
    { name: "root-rest", args: ["--config=bunfig.win2.toml", "test"] },
    { name: "senpi", args: ["test", "packages/omo-senpi"] },
  ]
}

const spawnInheritingStdio: SpawnTestGroup = (group) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, group.args, { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => {
      console.log(`[test-fast] ${group.name}: exit ${code ?? 1}`)
      resolve(code ?? 1)
    })
  })

export async function runTestFast(
  spawnGroup: SpawnTestGroup = spawnInheritingStdio,
): Promise<number> {
  const groups = testFastGroups()
  console.log(
    `[test-fast] running ${groups.length} groups in parallel: ${groups
      .map((group) => group.name)
      .join(", ")}`,
  )
  const exits = await Promise.all(groups.map(spawnGroup))
  return exits.every((exit) => exit === 0) ? 0 : 1
}

if (import.meta.main) {
  process.exitCode = await runTestFast()
}
