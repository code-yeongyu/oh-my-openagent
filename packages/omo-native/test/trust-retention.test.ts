import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as nodeFs from "node:fs/promises"
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pidAnswersSignalZero, RETAINED_GENERATIONS, sweepTrustRetention, type TrustRetentionFs } from "../trust-retention"

const BOOT = 1_700_000_000_000
const BASE_SECONDS = 1_750_000_000
const digest = (label: string) => createHash("sha256").update(label).digest("hex")

// Symlink fixtures and POSIX lease semantics; the Windows reparse-point path is covered when wired.
describe.skipIf(process.platform === "win32")("trust generation retention sweep", () => {
  let directory = ""
  let outside = ""
  const live = new Set<number>()
  const isPidAlive = (pid: number) => live.has(pid)

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "omo-trust-retention-"))
    outside = await mkdtemp(join(tmpdir(), "omo-trust-retention-outside-"))
    await mkdir(join(directory, "leases"), { mode: 0o700 })
    live.clear()
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  /** Generation `index` gets mtime BASE+index, so a higher index is more recently used. */
  const generation = async (index: number, user: string | null = null): Promise<string> => {
    const name = digest(`generation ${index}`)
    const path = join(directory, `${name}.pem`)
    await writeFile(path, `# omo-engine-trust-generation v1 user=${user ?? "none"}\nsynthetic body ${index}\n`, { mode: 0o600 })
    await utimes(path, BASE_SECONDS + index, BASE_SECONDS + index)
    return name
  }
  const userExtras = async (label: string): Promise<string> => {
    const name = digest(`user ${label}`)
    await writeFile(join(directory, `u-${name}.pem`), "# omo-engine-trust-user v1\n", { mode: 0o600 })
    return name
  }
  const lease = async (name: string, pid: number, body: unknown = { v: 1, pid, bootAtMs: BOOT }): Promise<string> => {
    const entry = `${name}.${pid}`
    await writeFile(join(directory, "leases", entry), typeof body === "string" ? body : JSON.stringify(body), { mode: 0o600 })
    return entry
  }
  const generations = async (count: number, user: string | null = null) =>
    Promise.all(Array.from({ length: count }, (_, index) => generation(index, user)))
  const exists = async (path: string) => lstat(path).then(() => true, () => false)
  const listing = async () => (await readdir(directory)).sort()
  const sweep = (options: { current?: string; fs?: TrustRetentionFs; bootAtMs?: number } = {}) =>
    sweepTrustRetention({ directory, bootAtMs: options.bootAtMs ?? BOOT, isPidAlive, ...options })
  /** Node's fs, except that `call` on the path `denied` fails with EACCES. */
  const denying = (call: "open" | "lstat", denied: string): TrustRetentionFs => {
    const refuse = () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
    return {
      ...nodeFs,
      open: (path, flags) => call === "open" && path === denied ? refuse() : nodeFs.open(path, flags),
      lstat: (path) => call === "lstat" && path === denied ? refuse() : nodeFs.lstat(path),
    }
  }

  test("keeps the 16 most recently used generations and removes the older ones", async () => {
    // Given 20 generations with distinct mtimes and no leases.
    const names = await generations(20)
    // When the sweep runs.
    const outcome = await sweep()
    // Then exactly the 4 oldest by mtime are removed.
    expect(RETAINED_GENERATIONS).toBe(16)
    expect(outcome).toEqual({ kind: "swept", removed: { generations: names.slice(0, 4).sort(), leases: [], userExtras: [] }, failures: [] })
    expect(await listing()).toEqual([...names.slice(4).map((name) => `${name}.pem`), "leases"].sort())
  })

  test("ranks by mtime, not by name or creation order", async () => {
    // Given 17 generations where the first-written one was used most recently.
    const names = await generations(17)
    const first = names[0]
    if (first === undefined) throw new Error("fixture")
    await utimes(join(directory, `${first}.pem`), BASE_SECONDS + 100, BASE_SECONDS + 100)
    // When the sweep runs; then the least recently used one goes instead.
    const outcome = await sweep()
    expect(outcome.kind === "swept" && outcome.removed.generations).toEqual([names[1]])
  })

  test("keeps a generation outside the 16 when a live lease names it", async () => {
    // Given a leased oldest generation and 16 newer ones (design 9.6 Leases).
    const names = await generations(18)
    const [oldest, second] = names
    if (oldest === undefined || second === undefined) throw new Error("fixture")
    live.add(4242)
    const entry = await lease(oldest, 4242)
    // When the sweep runs.
    const outcome = await sweep()
    // Then the leased one and its lease survive, and only the unleased one is evicted.
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [second], leases: [], userExtras: [] }, failures: [] })
    expect(await exists(join(directory, `${oldest}.pem`))).toBe(true)
    expect(await exists(join(directory, "leases", entry))).toBe(true)
  })

  test.each([
    ["its pid is gone", 5151, BOOT],
    ["its boot instant belongs to another boot", 4242, BOOT - 3_600_000],
  ] as const)("removes a lease when %s and evicts its generation", async (_, pid, bootAtMs) => {
    // Given an old generation whose only lease is dead.
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    live.add(4242)
    const entry = await lease(oldest, pid, { v: 1, pid, bootAtMs })
    // When the sweep runs; then the dead lease goes in the same sweep and no longer pins.
    const outcome = await sweep()
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [oldest], leases: [entry], userExtras: [] }, failures: [] })
  })

  test.each([
    ["one second off", 1_000, true],
    ["exactly at senpi's rounding tolerance", 120_000, true],
    ["one millisecond past senpi's rounding tolerance", 120_001, false],
    ["exactly at senpi's rounding tolerance, earlier", -120_000, true],
    ["one millisecond past senpi's rounding tolerance, earlier", -120_001, false],
  ] as const)("judges a lease whose boot instant is %s from this boot's", async (_, offset, pins) => {
    // Given a live pid whose lease's boot instant was computed off this process's (whole-second uptime).
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    live.add(4242)
    const entry = await lease(oldest, 4242, { v: 1, pid: 4242, bootAtMs: BOOT + offset })
    // When the sweep runs; then within the tolerance the lease is this boot's and pins, and past it the lease is dead.
    const outcome = await sweep()
    const removed = pins ? { generations: [], leases: [], userExtras: [] } : { generations: [oldest], leases: [entry], userExtras: [] }
    expect(outcome).toEqual({ kind: "swept", removed, failures: [] })
  })

  test("removes a dead lease even when its generation is within the 16", async () => {
    // Given a recent generation with a dead lease.
    const [only] = await generations(1)
    if (only === undefined) throw new Error("fixture")
    const entry = await lease(only, 6161)
    // When the sweep runs; then the lease goes and the generation stays.
    const outcome = await sweep()
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [], leases: [entry], userExtras: [] }, failures: [] })
    expect(await exists(join(directory, `${only}.pem`))).toBe(true)
  })

  test.each([
    ["not JSON", "{"],
    ["an older version", { v: 0, pid: 4242, bootAtMs: BOOT }],
    ["a non-integer version", { v: 1.5, pid: 4242, bootAtMs: BOOT }],
    ["a pid that differs from its name", { v: 1, pid: 4343, bootAtMs: BOOT }],
    ["no boot instant", { v: 1, pid: 4242 }],
  ] as const)("treats a lease holding %s as dead", async (_, body) => {
    // Given an old generation whose lease content cannot satisfy the liveness rule.
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    live.add(4242).add(4343)
    const entry = await lease(oldest, 4242, body)
    // When the sweep runs; then the lease is removed and does not pin.
    const outcome = await sweep()
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [oldest], leases: [entry], userExtras: [] }, failures: [] })
  })

  test("keeps a lease written by a newer schema version and its generation", async () => {
    // Given an old generation whose only lease is v2, with fields a v1 reader would call dead.
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    const entry = await lease(oldest, 9191, { v: 2, pid: 9191, bootAtMs: BOOT - 3_600_000 })
    // When the sweep runs.
    const outcome = await sweep()
    // Then a lease this engine cannot interpret pins, is never deleted (keep-when-unsure), and is reported.
    expect(outcome).toEqual({
      kind: "swept",
      removed: { generations: [], leases: [], userExtras: [] },
      failures: [{ entry: `leases/${entry}`, step: "read-lease", code: "LEASE_NEWER_SCHEMA" }],
    })
    expect(await exists(join(directory, `${oldest}.pem`))).toBe(true)
    expect(await exists(join(directory, "leases", entry))).toBe(true)
  })

  test("keeps a lease and its generation when the liveness probe fails", async () => {
    // Given a probe that throws for the lease's pid.
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    const entry = await lease(oldest, 7171)
    // When the sweep runs.
    const outcome = await sweepTrustRetention({
      directory, bootAtMs: BOOT, isPidAlive: () => { throw Object.assign(new Error("probe"), { code: "EINVAL" }) },
    })
    // Then the uncertain lease pins, and the failure is reported, not thrown.
    expect(outcome).toEqual({
      kind: "swept", removed: { generations: [], leases: [], userExtras: [] },
      failures: [{ entry: `leases/${entry}`, step: "probe-lease", code: "EINVAL" }],
    })
  })

  test.each(["open", "lstat"] as const)("keeps a lease and its generation when the lease's %s fails", async (call) => {
    // Given an old generation whose only lease names a gone pid and cannot be read.
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    const entry = await lease(oldest, 8181)
    // When the sweep runs.
    const outcome = await sweep({ fs: denying(call, join(directory, "leases", entry)) })
    // Then an unreadable lease counts as live: it pins, stays, and the failure is reported.
    expect(outcome).toEqual({
      kind: "swept", removed: { generations: [], leases: [], userExtras: [] },
      failures: [{ entry: `leases/${entry}`, step: "read-lease", code: "EACCES" }],
    })
    expect(await exists(join(directory, `${oldest}.pem`))).toBe(true)
    expect(await exists(join(directory, "leases", entry))).toBe(true)
  })

  test("keeps the generation the caller just wrote even when its mtime ranks it out", async () => {
    // Given a just-written generation whose mtime is older than 16 others (clock step backwards).
    const names = await generations(17)
    const oldest = names[0]
    if (oldest === undefined) throw new Error("fixture")
    // When the sweep runs with it as current; then it is retained.
    const outcome = await sweep({ current: oldest })
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [], leases: [], userExtras: [] }, failures: [] })
  })

  test("removes a user-extras file only when no remaining generation's header names it", async () => {
    // Given extras A named by an evicted generation, B by a leased old one, C by a recent one, D by none.
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map(userExtras))
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error("fixture")
    const evicted = await generation(0, a)
    const leased = await generation(1, b)
    await generation(2, c)
    for (let index = 3; index < 18; index++) await generation(index)
    live.add(4242)
    await lease(leased, 4242)
    // When the sweep runs.
    const outcome = await sweep()
    // Then only extras no remaining header names are removed; a lease pins its generation's extras too.
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [evicted], leases: [], userExtras: [a, d].sort() }, failures: [] })
    for (const kept of [b, c]) expect(await exists(join(directory, `u-${kept}.pem`))).toBe(true)
  })

  test("never sweeps the owned default-input closure or files it does not own", async () => {
    // Given the closure, the diagnostics record, a temp file, and unrelated names next to 17 generations.
    const names = await generations(17)
    await mkdir(join(directory, "defaults", "empty.d"), { recursive: true, mode: 0o700 })
    await writeFile(join(directory, "defaults", "empty.pem"), "", { mode: 0o600 })
    const others = ["diagnostics.jsonl", "diagnostics.1.jsonl", `.${digest("tmp")}.pem.tmp`, "notes.pem", `${digest("upper").toUpperCase()}.pem`]
    for (const other of others) await writeFile(join(directory, other), "x")
    await writeFile(join(directory, "leases", `.${digest("lease tmp")}.4242.tmp`), "{")
    // When the sweep runs.
    const outcome = await sweep()
    // Then only the evicted generation leaves.
    expect(outcome.kind === "swept" && outcome.removed).toEqual({ generations: [names[0]], leases: [], userExtras: [] })
    expect(await listing()).toEqual([...names.slice(1).map((name) => `${name}.pem`), ...others, "defaults", "leases"].sort())
    expect((await readdir(join(directory, "defaults"))).sort()).toEqual(["empty.d", "empty.pem"])
    expect(await readdir(join(directory, "leases"))).toEqual([`.${digest("lease tmp")}.4242.tmp`])
  })

  test("never follows a symlink named like a generation, a user-extras file or a lease", async () => {
    // Given 16 real generations and symlinks to outside files under owned names.
    const names = await generations(16)
    const target = join(outside, "target.pem")
    await writeFile(target, `# omo-engine-trust-generation v1 user=none\n`)
    await utimes(target, BASE_SECONDS - 10, BASE_SECONDS - 10)
    const linked = digest("linked")
    await symlink(target, join(directory, `${linked}.pem`))
    await symlink(target, join(directory, `u-${digest("linked user")}.pem`))
    await symlink(target, join(directory, "leases", `${names[0]}.4242`))
    // When the sweep runs.
    const outcome = await sweep()
    // Then nothing is removed, read through, or counted: the links and their target stay.
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [], leases: [], userExtras: [] }, failures: [] })
    expect(await exists(target)).toBe(true)
    expect((await lstat(join(directory, `${linked}.pem`))).isSymbolicLink()).toBe(true)
  })

  test("does not read a header through a generation that a symlink replaced", async () => {
    // Given extras named only by a target that a symlink under a generation name points at.
    const extras = await userExtras("through link")
    const target = join(outside, "target.pem")
    await writeFile(target, `# omo-engine-trust-generation v1 user=${extras}\n`)
    await symlink(target, join(directory, `${digest("linked")}.pem`))
    // When the sweep runs; then the link is no remaining generation, so the extras are unnamed.
    const outcome = await sweep()
    expect(outcome.kind === "swept" && outcome.removed.userExtras).toEqual([extras])
  })

  test.each(["directory", "leases"] as const)("skips the sweep when the %s path is a symlink", async (which) => {
    // Given 17 generations and a symlinked trust directory or leases directory.
    const names = await generations(17)
    let swept = directory
    if (which === "directory") {
      swept = join(outside, "link")
      await symlink(directory, swept)
    } else {
      await rm(join(directory, "leases"), { recursive: true })
      await mkdir(join(outside, "leases"))
      await symlink(join(outside, "leases"), join(directory, "leases"))
    }
    // When the sweep runs.
    const outcome = await sweepTrustRetention({ directory: swept, bootAtMs: BOOT, isPidAlive })
    // Then nothing is removed, and the outcome says why.
    expect(outcome).toEqual({ kind: "skipped", reason: which === "directory" ? "directory-unsafe" : "leases-unsafe", failures: [] })
    expect(await exists(join(directory, `${names[0]}.pem`))).toBe(true)
  })

  test("skips the sweep when the trust directory grants group or other access", async () => {
    // Given 17 generations in a directory that fails the 5.3 mode rule.
    const names = await generations(17)
    await chmod(directory, 0o755)
    // When the sweep runs; then nothing is removed.
    expect(await sweep()).toEqual({ kind: "skipped", reason: "directory-unsafe", failures: [] })
    expect(await exists(join(directory, `${names[0]}.pem`))).toBe(true)
  })

  test("sweeps generations when the leases directory does not exist yet", async () => {
    // Given 17 generations and no leases directory.
    const names = await generations(17)
    await rm(join(directory, "leases"), { recursive: true })
    // When the sweep runs; then the unleased oldest is evicted.
    const outcome = await sweep()
    expect(outcome).toEqual({ kind: "swept", removed: { generations: [names[0]], leases: [], userExtras: [] }, failures: [] })
  })

  test("reports a removal failure without throwing, and keeps the extras that generation names", async () => {
    // Given an evicted generation whose removal fails, naming extras E.
    const extras = await userExtras("held")
    const held = await generation(0, extras)
    for (let index = 1; index < 17; index++) await generation(index)
    const fs: TrustRetentionFs = {
      ...nodeFs,
      unlink: async (path) => {
        if (path.endsWith(`${held}.pem`)) throw Object.assign(new Error("busy"), { code: "EBUSY" })
        return nodeFs.unlink(path)
      },
    }
    // When the sweep runs.
    const outcome = await sweep({ fs })
    // Then the failure is reported, and the still-present generation keeps E.
    expect(outcome).toEqual({
      kind: "swept", removed: { generations: [], leases: [], userExtras: [] },
      failures: [{ entry: `${held}.pem`, step: "remove-generation", code: "EBUSY" }],
    })
    expect(await exists(join(directory, `u-${extras}.pem`))).toBe(true)
  })

  test.each([
    ["its header cannot be read", "open", "read-header"],
    ["it cannot be inspected", "lstat", "inspect-generation"],
  ] as const)("keeps every user-extras file when a generation is unknown because %s", async (_, call, step) => {
    // Given extras N named only by one generation, extras O named by nobody, and that generation's open or lstat failing.
    const named = await userExtras("named")
    const orphan = await userExtras("orphan")
    const unknown = await generation(0, named)
    // When the sweep runs.
    const outcome = await sweep({ fs: denying(call, join(directory, `${unknown}.pem`)) })
    // Then every extras file survives, because a header this sweep cannot see might name it.
    expect(outcome).toEqual({
      kind: "swept", removed: { generations: [], leases: [], userExtras: [] },
      failures: [{ entry: `${unknown}.pem`, step, code: "EACCES" }],
    })
    for (const kept of [named, orphan]) expect(await exists(join(directory, `u-${kept}.pem`))).toBe(true)
  })

  test("reports an unexpected failure as a skipped outcome instead of throwing", async () => {
    // Given a trust directory whose listing fails.
    await generations(17)
    const fs: TrustRetentionFs = { ...nodeFs, readdir: async () => { throw Object.assign(new Error("io"), { code: "EIO" }) } }
    // When the sweep runs; then the caller's launch gets an outcome, not an exception.
    expect(await sweep({ fs })).toEqual({ kind: "skipped", reason: "sweep-error", failures: [{ entry: ".", step: "list", code: "EIO" }] })
  })
})

test("the default liveness probe answers for this process", () => {
  // Given this process's own pid; when probed with kill(pid, 0); then it answers.
  expect(pidAnswersSignalZero(process.pid)).toBe(true)
})
