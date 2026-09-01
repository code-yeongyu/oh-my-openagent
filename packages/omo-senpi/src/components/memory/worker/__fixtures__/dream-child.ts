import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

interface DreamPolicy {
  readonly version: 1
  readonly people: {
    readonly enabled: boolean
    readonly max_entries: number
    readonly max_entry_chars: number
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", [...args], { cwd })
}

const memoryDir = required("MEMORY_DIR")
const transcriptPath = required("TRANSCRIPT_PATH")
const skillsUsagePath = required("SKILLS_USAGE_PATH")
const dreamStatePath = required("DREAM_STATE_PATH")
const dreamPolicyPath = required("DREAM_POLICY_PATH")
const policy = await json(dreamPolicyPath) as DreamPolicy
const transcript = await json(transcriptPath) as { request?: { trigger?: string; origin?: string } }

if (process.env.SENPI_MEMORY_REFLECTION !== "1") throw new Error("reflection sentinel is required")
if (transcript.request?.trigger !== "dream" || transcript.request.origin !== "manual") {
  throw new Error("dream request payload is required")
}
const emptyLedgers = process.env.DREAM_FIXTURE_EMPTY_LEDGERS === "1"
const expectedSkills = emptyLedgers ? {} : { review: { count: 2, lastUsedAt: "2026-08-01T00:00:00.000Z" } }
const expectedState = emptyLedgers ? {} : { last_dream_at: "2026-07-01T00:00:00.000Z", lastRunId: "prior-run" }
if (JSON.stringify(await json(skillsUsagePath)) !== JSON.stringify(expectedSkills)) {
  throw new Error("skills usage payload mismatch")
}
if (JSON.stringify(await json(dreamStatePath)) !== JSON.stringify(expectedState)) {
  throw new Error("dream state payload mismatch")
}

const targetPath = process.env.DREAM_TARGET_PATH
if (targetPath !== undefined) {
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, "---\ndescription: Style\n---\nMaintained by dream.\n")
} else {
  await mkdir(join(memoryDir, "system"), { recursive: true })
  await writeFile(join(memoryDir, "system", "dream-dispatch.json"), `${JSON.stringify(policy, null, 2)}\n`)
  if (policy.people.enabled) {
    const entries = Array.from({ length: policy.people.max_entries }, (_, index) =>
      `ATTRIBUTE: ${String(index + 1).padStart(2, "0")} ${"x".repeat(policy.people.max_entry_chars)}`.slice(0, policy.people.max_entry_chars),
    )
    await mkdir(join(memoryDir, "people", "fixture"), { recursive: true })
    await writeFile(join(memoryDir, "people", "fixture", "card.md"), `${entries.join("\n")}\n`)
  }
}
await git(memoryDir, ["add", "-A"])
await git(memoryDir, ["commit", "-m", "chore(dream): verify dispatch fixture"])
