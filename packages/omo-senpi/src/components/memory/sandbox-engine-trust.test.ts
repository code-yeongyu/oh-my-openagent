import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { prepareTrustDirectory, writeTrustGeneration } from "../../../../omo-native/trust-generation"
import { readUsernsView, USERNS_ROOTS_ENV } from "../../../../omo-native/trust-userns"
import { buildSandboxTransform } from "./sandbox"
import { probeBwrapUsability } from "./sandbox-bwrap-probe"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import type { ReflectionSpawnArgs } from "./worker/spawn"

const bwrap = process.platform === "linux" ? Bun.which("bwrap") : null
const bwrapUsable = bwrap !== null && (await probeBwrapUsability(bwrap)).usable
const trustGeneration = join(import.meta.dir, "..", "..", "..", "..", "omo-native", "trust-generation.ts")
const probeSource = `import { prepareTrustDirectory, trustDirectory, TrustStorageError, verifyTrustGeneration } from ${JSON.stringify(trustGeneration)}
try {
  if (process.argv[2] === "unattested") delete process.env.${USERNS_ROOTS_ENV}
  const result = process.argv[2] === "adopt"
    ? { verified: (await verifyTrustGeneration(JSON.parse(process.env.SENPI_ENGINE_TRUST ?? "null"))).malformed === false }
    : await prepareTrustDirectory(trustDirectory(process.env, "linux"), "linux")
  process.stdout.write(JSON.stringify({ ok: true, ...result }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error instanceof TrustStorageError ? error.code : null, message: String(error) }))
}
`

type Outcome = { ok: boolean; directory?: string; codes?: { code: string }[]; verified?: boolean; code?: string | null; message?: string }

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-sandbox-trust-")))
  roots.push(root)
  const worktree = join(root, "parent", "runtime", "worktree")
  const gitCommonDir = join(root, "parent", ".git")
  const payload = join(root, "payload", "transcript.json")
  // A host TMPDIR outside every writable bind is read-only inside the sandbox (EROFS), and one under /tmp is hidden by its tmpfs.
  const hostTmp = join(root, "host-tmp")
  for (const dir of [worktree, gitCommonDir, join(root, "payload"), hostTmp]) mkdirSync(dir, { recursive: true })
  writeFileSync(payload, "payload")
  return { root, worktree, gitCommonDir, payload, hostTmp }
}

function spawnArgs(setup: ReturnType<typeof fixture>, env: NodeJS.ProcessEnv, args: string[]): ReflectionSpawnArgs {
  return {
    attempt: 1,
    hardDeadlineAt: Date.now() + 30_000,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    command: process.execPath,
    args,
    cwd: setup.worktree,
    env,
    detached: true,
    paths: {
      sessionDir: dirname(setup.worktree),
      worktree: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      transcript: setup.payload,
      persona: join(dirname(setup.worktree), "persona.md"),
      prompt: join(dirname(setup.worktree), "prompt.md"),
    },
  }
}

async function runInSandbox(mode: "prepare" | "adopt" | "unattested", options: {
  readonly extraEnv?: (worktree: string) => Promise<Record<string, string>>
  readonly home?: string
  readonly extraMounts?: (root: string) => string[]
} = {}) {
  const setup = fixture()
  const probe = join(setup.worktree, "engine-trust-probe.ts")
  writeFileSync(probe, probeSource)
  const env = {
    PATH: process.env.PATH, HOME: options.home ?? process.env.HOME, TMPDIR: setup.hostTmp,
    ...await (options.extraEnv ?? (async () => ({})))(setup.worktree),
  }
  const transform = buildSandboxTransform({
    policy: "required",
    worktreeDir: setup.worktree,
    gitCommonDir: setup.gitCommonDir,
    payloadPaths: [setup.payload],
    command: process.execPath,
    env,
    platform: "linux",
  })
  const sandboxed = await transform(spawnArgs(setup, env, [probe, mode]))
  const separator = sandboxed.args.indexOf("--")
  const args = [...sandboxed.args.slice(0, separator), ...(options.extraMounts?.(setup.root) ?? []), ...sandboxed.args.slice(separator)]
  const child = Bun.spawn([sandboxed.command, ...args], {
    cwd: setup.worktree, env: sandboxed.env, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stderr, outcome: JSON.parse(stdout) as Outcome }
}

test.skipIf(!bwrapUsable)("#given the real Linux reflection sandbox #when the child prepares its engine trust directory #then it gets a private directory instead of an unsafe-ancestor crash", async () => {
  // given / when
  const home = process.env.HOME ?? "/"
  const { code, stderr, outcome } = await runInSandbox("prepare")

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: true })
  // A HOME under /tmp lives on the sandbox's own writable tmpfs, so its trust directory is used as is;
  // any other HOME is read-only inside the sandbox and falls back to mkdtemp under /tmp.
  if (home.startsWith("/tmp/")) expect(outcome).toMatchObject({ directory: join(home, ".omo", "engine-trust"), codes: [] })
  else expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
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
  const { code, stderr, outcome } = await runInSandbox("adopt", { extraEnv: marker })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toEqual({ ok: true, verified: true })
}, 60_000)

test.skipIf(!bwrapUsable)("#given a user namespace without the launcher's attestation #when the child prepares its trust directory #then it gets the named unattested refusal, not a crash", async () => {
  // given / when
  const { code, stderr, outcome } = await runInSandbox("unattested")

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: false, code: "trust-userns-unattested" })
}, 60_000)

test.skipIf(!bwrapUsable)("#given a user namespace whose overflow uid cannot be read #when the child prepares its trust directory #then it gets the named unattested refusal, not a crash", async () => {
  // given / when
  const { code, stderr, outcome } = await runInSandbox("prepare", {
    extraMounts: () => ["--ro-bind", "/dev/null", "/proc/sys/kernel/overflowuid"],
  })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome).toMatchObject({ ok: false, code: "trust-userns-unattested" })
}, 60_000)

test.skipIf(!bwrapUsable)("#given an existing private trust directory on a read-only mount #when the sandboxed child prepares it #then it falls back to a private temp directory with trust-dir-readonly", async () => {
  // given
  const readOnlyHome = (root: string) => {
    const home = join(root, "ro-home")
    mkdirSync(join(home, ".omo", "engine-trust"), { recursive: true })
    for (const dir of [home, join(home, ".omo"), join(home, ".omo", "engine-trust")]) chmodSync(dir, 0o700)
    return ["--ro-bind", home, "/tmp/ro-home"]
  }

  // when
  const { code, stderr, outcome } = await runInSandbox("prepare", { home: "/tmp/ro-home", extraMounts: readOnlyHome })

  // then
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(outcome.ok).toBe(true)
  expect(outcome.directory).toStartWith("/tmp/omo-engine-trust-")
  expect(outcome.codes).toEqual([{ code: "trust-dir-readonly" }])
}, 60_000)

test("#given a stale inherited attestation #when the Linux transform wraps the child #then TMPDIR is the sandbox tmpfs and the attestation is the launcher's own", async () => {
  // given
  const setup = fixture()
  const env = { PATH: process.env.PATH, HOME: setup.root, [USERNS_ROOTS_ENV]: "stale" }
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: setup.worktree, gitCommonDir: setup.gitCommonDir, payloadPaths: [setup.payload],
    command: "/bin/sh", env, platform: "linux", which: () => "/usr/bin/bwrap", probe: () => ({ usable: true }),
  })

  // when
  const result = await transform({ ...spawnArgs(setup, env, ["-c", "exit 0"]), command: "/bin/sh" })

  // then
  expect(result.env.TMPDIR).toBe("/tmp")
  const attested = result.env[USERNS_ROOTS_ENV]
  expect(attested).not.toBe("stale")
  // On an initial-namespace Linux host "/" is always attested (the launcher
  // walks to the root), so a transform that drops the variable must fail here
  // instead of passing through the undefined guard (#12120, #12119). Inside a
  // user namespace the launcher writes nothing and undefined stays acceptable.
  const paths = attested === undefined ? undefined : (JSON.parse(attested) as [string, string][]).map(([path]) => path)
  const inInitialNamespace = process.platform === "linux" && !readUsernsView(process.env).namespaced
  if (inInitialNamespace) {
    expect(paths).toContain("/")
  } else if (paths !== undefined) {
    expect(paths).toContain("/")
  }
})

test("#given the macOS sandbox #when it wraps the child #then it never writes the Linux attestation", async () => {
  // given
  const setup = fixture()
  const env = { PATH: process.env.PATH, HOME: setup.root, [USERNS_ROOTS_ENV]: "inherited" }
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: setup.worktree, gitCommonDir: setup.gitCommonDir, payloadPaths: [setup.payload],
    command: "/bin/sh", env, platform: "darwin", which: () => "/usr/bin/sandbox-exec",
  })

  // when
  const result = await transform({ ...spawnArgs(setup, env, ["-c", "exit 0"]), command: "/bin/sh" })

  // then
  expect(result.env[USERNS_ROOTS_ENV]).toBe("inherited")
})
