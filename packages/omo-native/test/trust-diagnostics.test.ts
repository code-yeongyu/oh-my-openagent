import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { selectEngineTrust } from "../engine-trust-policy"
import { readLinuxBundle } from "../linux-trust-bundle"
import { readDefaultFileCandidates } from "../openssl-default-file"
import { selectOpenSslHashDirectory } from "../openssl-hash-dir"
import {
  appendTrustDiagnostic,
  TRUST_DIAGNOSTICS_MAX_BYTES,
  TrustDiagnosticRecordError,
} from "../trust-diagnostics"
import type { TrustDiagnosticInput, TrustDiagnosticsFs } from "../trust-diagnostics"

const posix = process.platform !== "win32"
const generation = "a".repeat(64)
const clock = { now: () => new Date(Date.UTC(2026, 9, 27, 12, 0, 0)), pid: 4242 }

let directory = ""
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "trust-diagnostics-"))
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

const file = (): string => join(directory, "diagnostics.jsonl")
const rotated = (): string => join(directory, "diagnostics.1.jsonl")
async function lines(path: string): Promise<unknown[]> {
  const text = await fs.readFile(path, "utf8")
  expect(text.endsWith("\n")).toBe(true)
  return text.slice(0, -1).split("\n").map((line) => JSON.parse(line))
}
async function exists(path: string): Promise<boolean> {
  return fs.lstat(path).then(() => true, () => false)
}

/** Real node:fs underneath; counts what the module asks of it. */
function countingFs() {
  const opens: number[] = []
  const writes: number[] = []
  const io: TrustDiagnosticsFs = {
    async open(path, flags, mode) {
      opens.push(flags)
      const handle = await fs.open(path, flags, mode)
      return {
        stat: () => handle.stat(),
        chmod: (next) => handle.chmod(next),
        async write(buffer, offset, length) {
          writes.push(length)
          return handle.write(buffer, offset, length)
        },
        close: () => handle.close(),
      }
    },
    rename: (from, to) => fs.rename(from, to),
  }
  return { io, opens, writes }
}

describe("appendTrustDiagnostic", () => {
  test("#given an import-exec record #when appending #then writes one parsed object with the design's fields", async () => {
    await appendTrustDiagnostic(directory, {
      kind: "long-lived", action: "import-exec", generation,
      codes: [{ code: "trust-generation-recognized" }, { code: "helper-timeout" }],
    }, clock)
    expect(await lines(file())).toEqual([{
      v: 1, at: "2026-10-27T12:00:00.000Z", pid: 4242, kind: "long-lived", action: "import-exec", generation,
      codes: [{ code: "trust-generation-recognized" }, { code: "helper-timeout" }],
    }])
  })

  test("#given an existing record #when appending twice more #then keeps every earlier line in order", async () => {
    await fs.writeFile(file(), `${JSON.stringify({ v: 1, marker: "earlier" })}\n`, { mode: 0o600 })
    await appendTrustDiagnostic(directory, { kind: "static", action: "adopt", generation: null, codes: [] }, clock)
    await appendTrustDiagnostic(directory, { kind: "one-shot-network", action: "ensure", generation, codes: [] }, clock)
    const parsed = await lines(file()) as { action?: string; marker?: string }[]
    expect(parsed.map((line) => line.marker ?? line.action)).toEqual(["earlier", "adopt", "ensure"])
  })

  test("#given one call #when appending #then opens in append mode and issues exactly one write", async () => {
    const counting = countingFs()
    await appendTrustDiagnostic(directory, { kind: "short-host-cli", action: "adopt", generation, codes: [] }, clock, counting.io)
    expect(counting.opens).toHaveLength(1)
    const flags = counting.opens[0] ?? 0
    expect(flags & fs.constants.O_APPEND).toBe(fs.constants.O_APPEND)
    expect(flags & fs.constants.O_CREAT).toBe(fs.constants.O_CREAT)
    expect(counting.writes).toHaveLength(1)
    expect(counting.writes[0]).toBe((await fs.stat(file())).size)
  })

  test("#given parallel appends #when all settle #then every line is one intact record", async () => {
    const count = 64
    await Promise.all(Array.from({ length: count }, (_, index) => appendTrustDiagnostic(directory, {
      kind: "long-lived", action: "adopt", generation, codes: [],
    }, { now: clock.now, pid: index + 1 })))
    const pids = (await lines(file()) as { pid: number }[]).map((line) => line.pid).sort((a, b) => a - b)
    expect(pids).toEqual(Array.from({ length: count }, (_, index) => index + 1))
  })

  test.skipIf(!posix)("#given no file #when appending #then creates it with mode 0600", async () => {
    await appendTrustDiagnostic(directory, { kind: "static", action: "adopt", generation: null, codes: [] }, clock)
    expect((await fs.stat(file())).mode & 0o777).toBe(0o600)
  })

  test.skipIf(!posix)("#given a group-readable file #when appending #then narrows it to 0600", async () => {
    await fs.writeFile(file(), "")
    await fs.chmod(file(), 0o644)
    await appendTrustDiagnostic(directory, { kind: "static", action: "adopt", generation: null, codes: [] }, clock)
    expect((await fs.stat(file())).mode & 0o777).toBe(0o600)
  })

  test.skipIf(!posix)("#given diagnostics.jsonl is a symlink #when appending #then refuses and leaves the target untouched", async () => {
    const target = join(directory, "elsewhere")
    await fs.writeFile(target, "")
    await fs.symlink(target, file())
    await expect(appendTrustDiagnostic(directory, { kind: "static", action: "adopt", generation: null, codes: [] }, clock))
      .rejects.toThrow()
    expect((await fs.stat(target)).size).toBe(0)
  })

  test("#given a missing directory #when appending #then fails without creating it", async () => {
    const missing = join(directory, "absent")
    await expect(appendTrustDiagnostic(missing, { kind: "static", action: "adopt", generation: null, codes: [] }, clock))
      .rejects.toThrow()
    expect(await exists(missing)).toBe(false)
  })
})

describe("size bound", () => {
  const filler = (size: number): string => `${"x".repeat(size - 1)}\n`

  test("#given a file one byte under 256 KiB #when appending #then appends without renaming", async () => {
    await fs.writeFile(file(), filler(TRUST_DIAGNOSTICS_MAX_BYTES - 1), { mode: 0o600 })
    await appendTrustDiagnostic(directory, { kind: "static", action: "adopt", generation: null, codes: [] }, clock)
    expect(await exists(rotated())).toBe(false)
    expect((await fs.stat(file())).size).toBeGreaterThan(TRUST_DIAGNOSTICS_MAX_BYTES - 1)
  })

  test("#given a file at 256 KiB and an older rotation #when appending #then renames it over diagnostics.1.jsonl and starts fresh", async () => {
    expect(TRUST_DIAGNOSTICS_MAX_BYTES).toBe(256 * 1024)
    const full = filler(TRUST_DIAGNOSTICS_MAX_BYTES)
    await fs.writeFile(file(), full, { mode: 0o600 })
    await fs.writeFile(rotated(), "older\n", { mode: 0o600 })
    await appendTrustDiagnostic(directory, { kind: "static", action: "refuse", generation, codes: [{ code: "trust-exec-loop" }], check: null }, clock)
    expect(await fs.readFile(rotated(), "utf8")).toBe(full)
    const fresh = await lines(file()) as { action: string }[]
    expect(fresh.map((line) => line.action)).toEqual(["refuse"])
  })
})

describe("closed code set", () => {
  const reject = async (input: unknown): Promise<void> => {
    await expect(appendTrustDiagnostic(directory, input as TrustDiagnosticInput, clock)).rejects.toBeInstanceOf(TrustDiagnosticRecordError)
    expect(await exists(file())).toBe(false)
  }

  test("#given an unknown code #when appending #then rejects at runtime and writes nothing", async () => {
    await reject({ kind: "static", action: "adopt", generation: null, codes: [{ code: "shim-path-refused" }] })
  })

  test("#given an unknown code #when type-checking #then the compiler rejects it", () => {
    const input: TrustDiagnosticInput = {
      kind: "static", action: "adopt", generation: null,
      // @ts-expect-error not in the design's closed code set
      codes: [{ code: "made-up-code" }],
    }
    expect(input.action).toBe("adopt")
  })

  test.each([
    ["a path on a code", { code: "trust-dir-unsafe", path: "/home/someone/.omo/engine-trust" }],
    ["a subject on a code", { code: "macos-policy-unreadable", subject: "CN=Example Root" }],
    ["output text as a pattern", { code: "tls-verify-text-in-output", heuristic: true, pattern: "curl: (60) host.example" }],
    ["a hint without heuristic", { code: "tls-verify-text-in-output", pattern: "CERT_UNTRUSTED" }],
    ["an action that is not the reason's", { code: "trust-import-degraded", reason: "helper-missing", action: "check-store-access" }],
    ["an unknown reason", { code: "trust-tls-failed-under-fallback", reason: "network-down", action: "reinstall-omo" }],
    ["a status without its action", { code: "trust-import-degraded", reason: "helper-timeout" }],
  ])("#given %s #when appending #then rejects", async (_label, entry) => {
    await reject({ kind: "long-lived", action: "adopt", generation, codes: [entry] })
  })

  test.each([
    ["an unknown kind", { kind: "daemon", action: "adopt", generation, codes: [] }],
    ["an unknown action", { kind: "static", action: "exec", generation, codes: [] }],
    ["a generation that is not a SHA-256", { kind: "static", action: "adopt", generation: "/tmp/gen.pem", codes: [] }],
    ["an extra top-level field", { kind: "static", action: "adopt", generation, codes: [], user: "someone" }],
    ["a refusal without a refusal code", { kind: "static", action: "refuse", generation, codes: [{ code: "trust-dir-unsafe" }], check: null }],
    ["two refusal codes", { kind: "static", action: "refuse", generation, codes: [{ code: "trust-exec-loop" }, { code: "trust-path-unrepresentable" }], check: null }],
    ["a load mismatch without its check", { kind: "static", action: "refuse", generation, codes: [{ code: "trust-load-mismatch" }], check: null }],
    ["a check on another refusal", { kind: "static", action: "refuse", generation, codes: [{ code: "trust-exec-loop" }], check: "file" }],
    ["a check outside a refusal", { kind: "static", action: "adopt", generation, codes: [], check: "file" }],
    ["a refusal code outside a refusal", { kind: "static", action: "import-exec", generation, codes: [{ code: "trust-load-mismatch" }] }],
  ])("#given %s #when appending #then rejects", async (_label, input) => {
    await reject(input)
  })

  test("#given one code emitted by each merged importer module #when appending #then reads each back", async () => {
    const policy = selectEngineTrust({ os: "linux", complete: false, certificates: [] }).diagnostics[0]
    const bundlePath = join(directory, "bundle.pem")
    await fs.writeFile(bundlePath, "")
    await fs.truncate(bundlePath, 8 * 1024 * 1024 + 1)
    const bundle = await readLinuxBundle(bundlePath, { stat: (path) => fs.stat(path), open: (path, flags) => fs.open(path, flags) })
    const defaultFile = readDefaultFileCandidates(new Uint8Array([0xff, 0x0a]), () => false)
    const hashDir = (await selectOpenSslHashDirectory({
      entries: async () => ["0123abcd.0"],
      open: async () => ({
        stat: async () => ({ size: 0, isFile: () => false }),
        readFile: async () => new Uint8Array(),
        close: async () => {},
      }),
    })).diagnostics[0]
    if (policy === undefined || bundle.kind === "success" || defaultFile.kind !== "dropped" || hashDir === undefined) {
      throw new Error("a merged module did not emit the fixture's code")
    }
    const codes: TrustDiagnosticInput["codes"] = [
      { code: policy }, { code: bundle.kind }, { code: defaultFile.cause }, { code: hashDir.code },
    ]
    await appendTrustDiagnostic(directory, { kind: "long-lived", action: "import-exec", generation, codes }, clock)
    const [record] = await lines(file()) as { codes: unknown }[]
    expect(record?.codes).toEqual([
      { code: "negative-sources-incomplete" }, { code: "linux-bundle-too-large" },
      { code: "pem-noncanonical" }, { code: "openssl-default-dir-not-regular" },
    ])
  })

  test("#given every field-carrying code #when appending #then writes exactly the catalog fields", async () => {
    await appendTrustDiagnostic(directory, {
      kind: "one-shot-network", action: "refuse", generation, check: "loaded-set",
      codes: [
        { code: "trust-load-mismatch" },
        { code: "trust-tls-failed-under-fallback", reason: "linux-bundle-malformed", action: "regenerate-system-bundle" },
        { code: "trust-import-degraded", reason: "helper-crash", action: "report-helper-failure" },
        { code: "tls-verify-text-in-output", heuristic: true, pattern: "unable to verify the first certificate" },
      ],
    }, clock)
    const [record] = await lines(file()) as Record<string, unknown>[]
    expect(Object.keys(record ?? {}).sort()).toEqual(["action", "at", "check", "codes", "generation", "kind", "pid", "v"])
    expect(record?.check).toBe("loaded-set")
    expect(record?.codes).toEqual([
      { code: "trust-load-mismatch" },
      { code: "trust-tls-failed-under-fallback", reason: "linux-bundle-malformed", action: "regenerate-system-bundle" },
      { code: "trust-import-degraded", reason: "helper-crash", action: "report-helper-failure" },
      { code: "tls-verify-text-in-output", heuristic: true, pattern: "unable to verify the first certificate" },
    ])
  })
})
