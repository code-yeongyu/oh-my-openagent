import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { prepareTrustDirectory, writeTrustGeneration } from "../../../../omo-native/trust-generation"
import { buildSandboxTransform } from "./sandbox"
import { probeBwrapUsability } from "./sandbox-bwrap-probe"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import type { ReflectionSpawnArgs } from "./worker/spawn"

const bwrap = process.platform === "linux" ? Bun.which("bwrap") : null
const bwrapUsable = bwrap !== null && (await probeBwrapUsability(bwrap)).usable
const trustGeneration = join(import.meta.dir, "..", "..", "..", "..", "omo-native", "trust-generation.ts")
const probeSource = `import { prepareTrustDirectory, trustDirectory, TrustStorageError, verifyTrustGeneration } from ${JSON.stringify(trustGeneration)}
try {
  const result = process.argv[2] === "adopt"
    ? { verified: (await verifyTrustGeneration(JSON.parse(process.env.SENPI_ENGINE_TRUST ?? "null"))).malformed === false }
    : await prepareTrustDirectory(trustDirectory(process.env, "linux"), "linux")
  process.stdout.write(JSON.stringify({ ok: true, ...result }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error instanceof TrustStorageError ? error.code : null, message: String(error) }))
}
`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function runInSandbox(mode: "prepare" | "adopt", extraEnv: (worktree: string) => Promise<Record<string, string>>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-sandbox-trust-")))
  roots.push(root)
  const worktree = join(root, "parent", "runtime", "worktree")
  const gitCommonDir = join(root, "parent", ".git")
  const payload = join(root, "payload", "transcript.json")
  // A host TMPDIR outside every writable bind is read-only inside the sandbox (EROFS), and one under /tmp is hidden by its tmpfs.
  const hostTmp = join(root, "host-tmp")
  for (const dir of [worktree, gitCommonDir, join(root, "payload"), hostTmp]) mkdirSync(dir, { recursive: true })
  writeFileSync(payload, "payload")
  const probe = join(worktree, "engine-trust-probe.ts")
  writeFileSync(probe, probeSource)
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: hostTmp, ...await extraEnv(worktree) }
  const transform = buildSandboxTransform({
    policy: "required",
    worktreeDir: worktree,
    gitCommonDir,
    payloadPaths: [payload],
    command: process.execPath,
    env,
    platform: "linux",
  })
  const original: ReflectionSpawnArgs = {
    attempt: 1,
    hardDeadlineAt: Date.now() + 30_000,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    command: process.execPath,
    args: [probe, mode],
    cwd: worktree,
    env,
    detached: true,
    paths: {
      sessionDir: dirname(worktree),
      worktree,
      gitCommonDir,
      transcript: payload,
      persona: join(dirname(worktree), "persona.md"),
      prompt: join(dirname(worktree), "prompt.md"),
    },
  }
  const sandboxed = await transform(original)
  const child = Bun.spawn([sandboxed.command, ...sandboxed.args], {
    cwd: worktree, env: sandboxed.env, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stderr, outcome: JSON.parse(stdout) as { ok: boolean; directory?: string; verified?: boolean; message?: string } }
}

test.skipIf(!bwrapUsable)("#given the real Linux reflection sandbox #when the child prepares its engine trust directory #then it gets a private directory instead of an unsafe-ancestor crash", async () => {
  // given / when
  const { code, stderr, outcome } = await runInSandbox("prepare", async () => ({}))

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: true })
  expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
}, 60_000)

test.skipIf(!bwrapUsable)("#given a parent trust generation outside the child's trust directory #when the sandboxed child adopts it #then the inherited marker's ancestors are attested and the generation verifies", async () => {
  // given
  const marker = async (worktree: string) => {
    const { directory } = await prepareTrustDirectory(join(worktree, "parent-trust"), "linux")
    roots.push(directory)
    const generation = await writeTrustGeneration(directory, [], [], [])
    return { SENPI_ENGINE_TRUST: JSON.stringify({ file: generation.file, sha256: generation.sha256, user: generation.user }) }
  }

  // when
  const { code, stderr, outcome } = await runInSandbox("adopt", marker)

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toEqual({ ok: true, verified: true })
}, 60_000)
