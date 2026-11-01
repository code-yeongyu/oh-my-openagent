import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { buildSandboxTransform } from "./sandbox"
import { probeBwrapUsability } from "./sandbox-bwrap-probe"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import type { ReflectionSpawnArgs } from "./worker/spawn"

const bwrap = process.platform === "linux" ? Bun.which("bwrap") : null
const bwrapUsable = bwrap !== null && (await probeBwrapUsability(bwrap)).usable
const probe = join(import.meta.dir, "__fixtures__", "engine-trust-probe.ts")

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test.skipIf(!bwrapUsable)("#given the real Linux reflection sandbox #when the child prepares its engine trust directory #then it gets a private directory instead of an unsafe-ancestor crash", async () => {
  // given
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-sandbox-trust-")))
  roots.push(root)
  const worktree = join(root, "parent", "runtime", "worktree")
  const gitCommonDir = join(root, "parent", ".git")
  const payload = join(root, "payload", "transcript.json")
  const hostTmp = join(root, "host-tmp")
  for (const dir of [worktree, gitCommonDir, join(root, "payload"), hostTmp]) mkdirSync(dir, { recursive: true })
  writeFileSync(payload, "payload")
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: hostTmp }
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
    args: [probe],
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

  // when
  const sandboxed = await transform(original)
  const child = Bun.spawn([sandboxed.command, ...sandboxed.args], {
    cwd: worktree, env: sandboxed.env, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  const outcome = JSON.parse(stdout) as { ok: boolean; directory?: string; message?: string }
  expect(outcome).toMatchObject({ ok: true })
  expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
}, 60_000)
