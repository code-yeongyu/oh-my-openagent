import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PROCESS_COUNT = 16
const DAY_UTC = "2026-05-25"
const MODULE_PATH = join(import.meta.dir, "index.ts")

function writeProbe(probeDir: string, stateDir: string): string {
  const probePath = join(probeDir, "probe.ts")
  writeFileSync(
    probePath,
    [
      `import { getDailyActiveCaptureState } from ${JSON.stringify(MODULE_PATH)}`,
      `const result = getDailyActiveCaptureState({`,
      `  stateDir: ${JSON.stringify(stateDir)},`,
      `  now: new Date(${JSON.stringify(`${DAY_UTC}T00:00:00.000Z`)}),`,
      `})`,
      `process.stdout.write(result.captureDaily ? "1" : "0")`,
      ``,
    ].join("\n"),
  )
  return probePath
}

async function runProbe(probePath: string): Promise<string> {
  const probe = Bun.spawn([process.execPath, "run", probePath], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(probe.stdout).text(),
    new Response(probe.stderr).text(),
    probe.exited,
  ])
  if (exitCode !== 0) throw new Error(`probe exited ${exitCode}: ${stderr}`)
  return stdout
}

test(
  "#given many processes starting on the same fresh UTC day #when each evaluates once #then exactly one captures",
  async () => {
    // given
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-core-race-state-"))
    const probeDir = mkdtempSync(join(tmpdir(), "telemetry-core-race-probe-"))
    const probePath = writeProbe(probeDir, stateDir)

    try {
      // when
      const captures = await Promise.all(
        Array.from({ length: PROCESS_COUNT }, () => runProbe(probePath)),
      )

      // then
      expect(captures.filter((capture) => capture === "1")).toHaveLength(1)
      expect(captures).toHaveLength(PROCESS_COUNT)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
      rmSync(probeDir, { recursive: true, force: true })
    }
  },
  60_000,
)
