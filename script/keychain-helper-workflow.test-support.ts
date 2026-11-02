import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"
import { z } from "zod"

export const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
export const SUBPROCESS_SPAWN_TIMEOUT_MS = 20_000
export const MATERIAL = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const
export const HELPER_BYTES = "synthetic universal keychain helper\n"

export const readWorkflow = (name: string): string =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
export const platformWorkflow = readWorkflow("publish-platform.yml")
export const publishWorkflow = readWorkflow("publish.yml")

const stepSchema = z.object({
  name: z.string().optional(),
  if: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
})
export type Step = z.infer<typeof stepSchema>
export const workflowSchema = z.object({
  jobs: z.record(z.string(), z.object({
    needs: z.union([z.string(), z.array(z.string())]).optional(),
    "runs-on": z.string().optional(),
    if: z.string().optional(),
    steps: z.array(stepSchema).optional(),
  })),
})

export function jobSteps(source: string, job: string): Step[] {
  const steps = workflowSchema.parse(load(source)).jobs[job]?.steps
  if (steps === undefined) throw new Error(`job ${job} has no steps`)
  return steps
}

export function stepAt(steps: readonly Step[], name: string): { readonly index: number; readonly value: Step } {
  const index = steps.findIndex((candidate) => candidate.name === name)
  const value = steps[index]
  if (value === undefined) throw new Error(`missing workflow step: ${name}`)
  return { index, value }
}

export function bash(script: string, cwd: string, env: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync("bash", ["-e", "-c", `umask 077\n${script}`], {
    cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: SUBPROCESS_SPAWN_TIMEOUT_MS,
  })
}

export function helperTarball(root: string): string {
  const source = join(root, "signed")
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, "omo-keychain"), HELPER_BYTES)
  chmodSync(join(source, "omo-keychain"), 0o755)
  mkdirSync(join(root, ".omo", "keychain-helper"), { recursive: true })
  const tar = spawnSync("tar", ["-czf", join(root, ".omo", "keychain-helper", "omo-keychain.tar.gz"), "-C", source, "omo-keychain"], { timeout: SUBPROCESS_SPAWN_TIMEOUT_MS })
  if (tar.status !== 0) throw new Error("tar failed")
  return root
}

export function withRoot(prefix: string, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export const mode = (path: string): number => statSync(path).mode & 0o777
