#!/usr/bin/env bun
/**
 * Design 9.7 (omo#10762): every mutation is a source patch applied to a disposable copy of
 * packages/omo-native, and the named test must turn red there while the unpatched copy stays green.
 * No mutation switch ships in production code, and the real tree is never written.
 *
 * Only rows whose production code and test both live in packages/omo-native run here. The senpi, desktop
 * and macOS/Windows adapter rows run in their owners' pipelines (see the PR body table).
 *
 *   bun script/omo-native-trust-mutations.ts [--only <id>[,<id>...]]
 */
import { existsSync } from "node:fs"
import { cp, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

type Edit = { readonly find: string; readonly replace: string }
export type Mutation = Edit & {
  readonly id: string
  /** The 9.7 row, quoted from the design so a reader can audit the mapping. */
  readonly designRow: string
  /** Paths are relative to the package directory. */
  readonly file: string
  readonly test: string
  /** Passed to `bun test -t`; a `(fail)` line must match it for the row to count as killed. */
  readonly testNamePattern: string
  /** A second site, for a rule the code enforces at two points; one site alone cannot remove it. */
  readonly also?: Edit
  /** An oracle self-check mutates the test's oracle, not production code; it is reported separately. */
  readonly oracle?: true
}
/** `crashed`: the mutant failed only by a thrown runtime error or a load crash, which proves nothing about the assertions. */
type MutationVerdict = "killed" | "survived" | "crashed" | "control-failed"
type MutationResult = { readonly id: string; readonly verdict: MutationVerdict; readonly failing: number; readonly ms: number }

export class MutationPatchError extends Error {
  override readonly name = "MutationPatchError"
}

/** `find` must occur exactly once, so a refactor cannot silently turn a mutation into a no-op. */
export function applyEdit(source: string, edit: Edit, label: string): string {
  const count = source.split(edit.find).length - 1
  if (count !== 1) throw new MutationPatchError(`${label}: find matches ${count} times, expected exactly 1`)
  return source.replace(edit.find, () => edit.replace)
}

// The OpenSSL subject hash of a one-CN name (lower-cased, whitespace-folded UTF8String), enough for the hash-dir fixtures.
const SUBJECT_HASH = "((certificate) => { const value = Buffer.from(certificate.subject.replace(/^CN=/, \"\").trim().replace(/\\s+/g, \" \").toLowerCase()); "
  + "const attribute = Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03, 0x0c, value.length]), value]); "
  + "const rdn = Buffer.concat([Buffer.from([0x30, attribute.length]), attribute]); "
  + "return new Bun.CryptoHasher(\"sha1\").update(Buffer.concat([Buffer.from([0x31, rdn.length]), rdn])).digest().readUInt32LE(0).toString(16).padStart(8, \"0\") })"

const POLICY = "engine-trust-policy.ts"
const POLICY_TEST = "test/engine-trust-policy.test.ts"
const STAGE = "trust-stage.ts"
const STAGE_TEST = "test/trust-stage.test.ts"
const GENERATION = "trust-generation.ts"
const HASH_DIR = "openssl-hash-dir.ts"
const HASH_DIR_TEST = "test/openssl-hash-dir.test.ts"
const DEFAULT_FILE = "openssl-default-file.ts"
const DEFAULT_FILE_TEST = "test/openssl-default-file.test.ts"
const DENY = "case \"Deny\":\n                denied.add(cert.sha256)"
const HOP = "if (arrival.hop) return refuse("
const PINNED = "if (pinned.has(digest) || digest === options.current) {"
const NOT_INDEXABLE = "    if (!isIndexable(der)) return drop(\"ordinary-block-not-indexable\", index)\n"

const MUTATIONS: readonly Mutation[] = [
  {
    id: "disallowed-merge", designRow: "Drop the `Disallowed`, CTL or Deny merge", file: POLICY,
    find: "      for (const entry of facts.disallowed) denied.add(entry.sha256)\n", replace: "",
    test: POLICY_TEST, testNamePattern: "#given Disallowed LOCAL_MACHINE #when",
  },
  {
    id: "ctl-merge", designRow: "Drop the `Disallowed`, CTL or Deny merge", file: POLICY,
    find: "      for (const thumbprint of facts.ctlSha1) thumbprints.add(thumbprint)\n", replace: "",
    test: POLICY_TEST, testNamePattern: "#given CTL denied root #when",
  },
  {
    id: "deny-merge", designRow: "Drop the `Disallowed`, CTL or Deny merge", file: POLICY,
    find: DENY, replace: "case \"Deny\":",
    test: POLICY_TEST, testNamePattern: "#given global Deny diagnostic #when",
  },
  {
    id: "macos-path-eku", designRow: "Skip the macOS intermediate EKU rule (revision 12)", file: POLICY,
    find: "facts.os !== \"macos\" || path.every(", replace: "true || path.every(",
    test: POLICY_TEST, testNamePattern: "macOS path member clientAuth-only EKU",
  },
  {
    id: "empty-eku", designRow: "Treat an empty EKU as unrestricted", file: POLICY,
    find: "case \"oids\": return eku.oids.includes(", replace: "case \"oids\": return eku.oids.length === 0 || eku.oids.includes(",
    test: POLICY_TEST, testNamePattern: "empty OID usage is excluded",
  },
  {
    id: "lower-priority-grant", designRow: "Let a lower-priority grant beat a user Deny", file: POLICY,
    find: DENY,
    replace: "case \"Deny\":\n                if (!domains.some((other) => other !== domain && cert.settings[other]?.some((entry) => entry.result !== \"Deny\"))) denied.add(cert.sha256)",
    test: POLICY_TEST, testNamePattern: "#given Deny user \\{\\} #when",
  },
  {
    id: "scoped-deny", designRow: "Apply a scoped Deny only within its scope", file: POLICY,
    find: DENY, replace: "case \"Deny\":\n                if (!scoped(setting)) denied.add(cert.sha256)",
    test: POLICY_TEST, testNamePattern: "client Deny diagnostic",
  },
  {
    id: "denied-path", designRow: "Include a denied intermediate, or skip the path check", file: POLICY,
    find: " && !chain.path.some(isDenied)", replace: "",
    test: POLICY_TEST, testNamePattern: "(Windows|macOS) denied path #when",
  },
  {
    id: "unknown-role-grants", designRow: "Let `role: unknown` grant", file: POLICY,
    find: "diagnostics.add(\"macos-policy-unreadable\")\n                      continue",
    replace: "diagnostics.add(\"macos-policy-unreadable\")\n                      S.add(cert.sha256)\n                      continue",
    test: POLICY_TEST, testNamePattern: "projected grant .*\"role\":\"unknown\"",
  },
  {
    id: "default-dir-deny", designRow: "Subtract `D` before selection only, or not at all", file: POLICY,
    find: "if (blocked.has(cert.sha256)) continue\n        switch (cert.source) {",
    replace: "if (blocked.has(cert.sha256) && !cert.source.startsWith(\"openssl-\")) continue\n        switch (cert.source) {",
    also: {
      find: "if (cert.ca && cert.selfSigned && eligible(cert)) S.add(cert.sha256)",
      replace: "if (cert.ca && cert.selfSigned && serverAuth(cert.eku)) S.add(cert.sha256)",
    },
    test: POLICY_TEST, testNamePattern: "openssl-default-dir denied copy",
  },
  {
    id: "omit-suse", designRow: "Omit the SUSE bundle", file: "linux-trust-bundle.ts",
    find: "    case \"suse\":\n    case \"opensuse\":\n    case \"sles\":\n      return \"suse\"\n", replace: "",
    test: "test/linux-trust-bundle.test.ts", testNamePattern: "#given ID opensuse #when selecting",
  },
  {
    id: "reparse-user-file", designRow: "Re-parse the user's extra file", file: GENERATION,
    find: "    if (knownGeneration) throw new TrustStorageError(\"trust-user-extras-unrecoverable\")\n    return { certificates: [...loaded()], recognized: false }",
    replace: "    if (knownGeneration) throw new TrustStorageError(\"trust-user-extras-unrecoverable\")\n    return { certificates: generationCertificates(await fs.readFile(incoming, \"utf8\")).certificates, recognized: false }",
    // Bun leaves a boolean `%s` unformatted, so both cases share this name; the malformed one turns red.
    test: STAGE_TEST, testNamePattern: "U is Bun's actual native parse, malformed sibling",
  },
  {
    id: "generation-as-u", designRow: "Treat the whole incoming generation as `U`", file: GENERATION,
    find: "  const user = GENERATION_HEADER.exec(prefix)?.[1]\n",
    replace: "  if (incoming) return { certificates: generationCertificates(await fs.readFile(incoming, \"utf8\")).certificates, recognized: true }\n  const user = GENERATION_HEADER.exec(prefix)?.[1]\n",
    test: STAGE_TEST, testNamePattern: "failed addressed handoff preserves recorded originals and recovers only U",
  },
  {
    id: "evict-by-recency", designRow: "Evict by recency alone, ignoring leases", file: "trust-retention.ts",
    find: PINNED, replace: "if (digest === options.current) {",
    test: "test/trust-retention.test.ts", testNamePattern: "keeps a generation outside the 16 when a live lease names it",
  },
  {
    id: "evict-by-recency-ensure", designRow: "Evict by recency alone, ignoring leases", file: "trust-retention.ts",
    find: PINNED, replace: "if (digest === options.current) {",
    test: "test/trust-ensure.test.ts", testNamePattern: "pins its generation past 16 newer ones",
  },
  {
    id: "leak-generation", designRow: "Leak the generation file into the agent shell", file: STAGE,
    find: "    applyEngineTrustRestore(env, addressed.restore, platform)\n", replace: "",
    test: STAGE_TEST, testNamePattern: "a compiled child adopts native extras, scrubs plumbing, restores old desktop values, and adds no NODE_USE_SYSTEM_CA",
  },
  {
    id: "refuse-foreign-marker", designRow: "Refuse a foreign marker without a hop (revision 2's rule)", file: STAGE,
    find: HOP, replace: "if (arrival.hop || arrival.marker.kind === \"foreign\") return refuse(",
    test: STAGE_TEST, testNamePattern: "foreign marker has no authority without a hop",
  },
  {
    id: "arrival-restore", designRow: "Keep the arrival environment as `restore` after a failed addressed hand-off", file: STAGE,
    find: "const restore = addressed?.restore ?? restoreArrival(env, owner, platform)",
    replace: "const restore = restoreArrival(env, owner, platform)",
    test: STAGE_TEST, testNamePattern: "failed addressed handoff preserves recorded originals",
  },
  {
    id: "drop-exec-bound", designRow: "Drop the exec bound (ignore the hop)", file: STAGE,
    find: HOP, replace: "if (false) return refuse(",
    test: STAGE_TEST, testNamePattern: "exec bound: ",
  },
  {
    id: "skip-record-write", designRow: "Skip the diagnostics record write", file: STAGE,
    find: "try { await appendTrustDiagnostic(directory, { ...input, codes: unique }) } catch {}", replace: "void unique",
    test: STAGE_TEST, testNamePattern: "foreign marker has no authority without a hop",
  },
  {
    id: "closure-on-success-only", designRow: "Set the closure only when the import succeeded", file: STAGE,
    find: "    if (closure) {\n", replace: "    if (closure && imported.fallbackReason === null) {\n",
    test: STAGE_TEST, testNamePattern: "keeps fallback closure",
  },
  {
    id: "scan-hash-shaped-names", designRow: "Scan every hash-shaped file name (revision 5's selector)", file: HASH_DIR,
    find: "  for (const hash of hashes) {\n    for (let suffix = 0; suffix <= MAX_SUFFIXES; suffix++) {\n      const path = `${hash}.${suffix}`\n",
    replace: "  const listed = [...(await directory.entries())].filter((entry) => /^[a-fA-F0-9]{8}\\.[0-9]+$/.test(entry)).sort()\n"
      + "  for (const hash of hashes) {\n    for (const [suffix, path] of listed.filter((entry) => entry.toLowerCase().startsWith(`${hash}.`)).entries()) {\n",
    also: { find: "      if (!parsed.loaded) break\n", replace: "      if (!parsed.loaded) continue\n" },
    test: HASH_DIR_TEST, testNamePattern: "selects the reachable envelope when directory is (c1|c2|c5|c5b)$",
  },
  {
    id: "walk-past-failed-load", designRow: "Continue the walk past a failed load", file: HASH_DIR,
    find: "      if (!parsed.loaded) break\n", replace: "      if (!parsed.loaded) continue\n",
    test: HASH_DIR_TEST, testNamePattern: "selects the reachable envelope when directory is c5b?$",
  },
  {
    id: "listed-name-spelling", designRow: "Open listed names instead of constructed names", file: HASH_DIR,
    find: "return hash === undefined ? [] : [hash.toLowerCase()]", replace: "return hash === undefined ? [] : [hash]",
    test: HASH_DIR_TEST, testNamePattern: "uses constructed lower-case paths when names are uppercase",
  },
  {
    id: "trusted-plain-copy", designRow: "Import the plain copy of a `TRUSTED CERTIFICATE` block's certificate", file: HASH_DIR,
    find: "candidates: [...candidates.values()].filter((certificate) => !excluded.has(certificate.fingerprint256)),",
    replace: "candidates: [...candidates.values()],",
    test: HASH_DIR_TEST, testNamePattern: "records the literal narrowing list when a hash file is malformed or auxiliary",
  },
  {
    id: "fresh-first-request", designRow: "Select only what a fresh process accepts on its first request (modelling the cache)", file: HASH_DIR,
    find: "      for (const certificate of parsed.certificates) candidates.set(certificate.fingerprint256, certificate)\n",
    replace: `      for (const certificate of parsed.certificates) if (${SUBJECT_HASH}(certificate) === hash) candidates.set(certificate.fingerprint256, certificate)\n`,
    test: HASH_DIR_TEST, testNamePattern: "selects the reachable envelope when directory is c[48]$",
  },
  {
    id: "one-history", designRow: "Select one history's final set, for example by simulating lookups in sorted subject order (revision 8)", file: HASH_DIR,
    find: "  for (const hash of hashes) {\n    for (let suffix",
    replace: `  for (const hash of hashes) {\n    if ([...candidates.values()].some((certificate) => ${SUBJECT_HASH}(certificate) === hash)) continue\n    for (let suffix`,
    test: HASH_DIR_TEST, testNamePattern: "selects the reachable envelope when directory is c10$",
  },
  {
    id: "oracle-fresh-processes", oracle: true, designRow: "Run the c4 oracle in fresh processes per root", file: HASH_DIR_TEST,
    find: "async function oracle(fixture: string, history: readonly string[]): Promise<string[]> {\n",
    replace: "async function oracle(fixture: string, history: readonly string[]): Promise<string[]> {\n"
      + "  if (history.length > 1) return (await Promise.all(history.map((id) => oracle(fixture, [id])))).flat()\n",
    test: HASH_DIR_TEST, testNamePattern: "matches real Bun when c4 runs history",
  },
  {
    id: "oracle-convergence", oracle: true, file: HASH_DIR_TEST,
    designRow: "Require every lookup order to end in the same accepted set (revision 7's convergence claim, revision 8)",
    find: "      history.forEach((id, index) => { if (outcomes[index] === \"OK\") accepted.add(id) })\n",
    replace: "      const final = history.filter((id, index) => history.lastIndexOf(id) === index && outcomes[index] === \"OK\").sort()\n"
      + "      if (accepted.size > 0) expect(final).toEqual([...accepted].sort())\n"
      + "      history.forEach((id, index) => { if (outcomes[index] === \"OK\") accepted.add(id) })\n",
    test: HASH_DIR_TEST, testNamePattern: "matches the union of accepted histories",
  },
  {
    id: "salvage-default-file", file: DEFAULT_FILE,
    designRow: "Salvage the valid roots from a failing default file: skip the non-indexable ordinary block and keep the others (revision 8's rule, revision 9)",
    find: `  for (const { der, index } of certificates) {\n${NOT_INDEXABLE}  }\n`,
    replace: "  for (const candidate of [...certificates]) {\n    if (!isIndexable(candidate.der)) certificates.splice(certificates.indexOf(candidate), 1)\n  }\n",
    test: DEFAULT_FILE_TEST, testNamePattern: "transaction when given (c1|c1b|c2|c3)$",
  },
  {
    id: "shallow-index-mirror", file: DEFAULT_FILE,
    designRow: "Stop the indexability mirror after the subject's outer SEQUENCE: no trailing-byte check, no canonicalization check (revision 9)",
    find: "    if (input.remaining !== 0) throw new DerReadError()\n", replace: "",
    also: { find: "    const subject = tbs.element(0x30).bytes\n    checkName(subject)\n", replace: "    tbs.element(0x30) // subject\n" },
    test: DEFAULT_FILE_TEST, testNamePattern: "transaction when given c[23]$",
  },
  {
    id: "default-file-good-prefix", file: DEFAULT_FILE,
    designRow: "Treat the default file like a hash file and keep its good prefix (T4's rule, revision 9)",
    find: NOT_INDEXABLE,
    replace: "    if (!isIndexable(der)) return { kind: \"kept\", certificates: certificates.filter((candidate) => candidate.index < index) }\n",
    test: DEFAULT_FILE_TEST, testNamePattern: "transaction when given c1b?$",
  },
  {
    id: "skip-unparseable-block", file: DEFAULT_FILE,
    designRow: "Skip only an indexable but unparseable block and keep its siblings (revision 9's rule, revision 10)",
    find: "      return drop(\"ordinary-block-unparseable\", index)\n",
    replace: "      return { kind: \"kept\", certificates: certificates.filter((candidate) => candidate.index !== index) }\n",
    test: DEFAULT_FILE_TEST, testNamePattern: "never imports R beyond real Bun's accepted set",
  },
]

/**
 * Only the package is copied and patched. Everything its tests reach outside it (sibling packages, test-support, the
 * installed modules, including the package's own links that pin its senpi version) is linked to the real tree, which
 * the run only reads; the mutated files are all package-internal, so no link leads back to an unpatched copy of them.
 */
async function disposableCopy(repoRoot: string, packageDir: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-trust-mutation-"))
  const parent = dirname(packageDir)
  await cp(join(repoRoot, packageDir), join(root, packageDir), {
    recursive: true,
    filter: (source) => source !== join(repoRoot, packageDir, "node_modules"),
  })
  const links = [
    ...(await readdir(repoRoot)).filter((entry) => entry !== ".git" && entry !== parent),
    ...(await readdir(join(repoRoot, parent))).filter((entry) => entry !== basename(packageDir)).map((entry) => join(parent, entry)),
    join(packageDir, "node_modules"),
  ]
  for (const link of links) {
    if (existsSync(join(repoRoot, link))) await symlink(join(repoRoot, link), join(root, link))
  }
  return root
}

/**
 * `(fail) a > b [1.2ms]` names the test `a b`, the form `bun test -t` matches against. Bun prints a test's error above its
 * `(fail)` line; an assertion is `error: expect(received)...` or a failed `expect.assertions(n)` / `expect.hasAssertions()`
 * (`AssertionError: expected 1 assertion, but test ended with 0 assertions` / `AssertionError: received 0 assertions, but
 * expected at least one assertion to be called`); anything else (a thrown TypeError, ...) is a runtime error.
 */
const ASSERTION_BANNER = /^(?:error: expect\(|AssertionError: (?:expected \d+ assertions?, but test ended with \d+ assertions?|received \d+ assertions?, but expected at least one assertion to be called)$)/
function failingTests(output: string, pattern: RegExp): { readonly assertion: number; readonly runtime: number } {
  let assertion = 0
  let runtime = 0
  let block: string[] = []
  for (const line of output.split("\n")) {
    const result = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?\s*$/.exec(line.trim())
    if (!result) { block.push(line); continue }
    if (result[1] === "fail" && pattern.test((result[2] ?? "").replaceAll(" > ", " "))) {
      if (block.some((text) => ASSERTION_BANNER.test(text.trim()))) assertion++
      else runtime++
    }
    block = []
  }
  return { assertion, runtime }
}

async function bunTest(cwd: string, mutation: Mutation, timeoutMs: number): Promise<{ code: number; output: string }> {
  const child = Bun.spawn([process.execPath, "test", `./${mutation.test}`, "-t", mutation.testNamePattern, "--timeout", "240000"], {
    cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, output: `${stdout}\n${stderr}` }
}

interface RunOptions {
  readonly repoRoot: string
  readonly packageDir: string
  readonly timeoutMs?: number
  readonly log?: (line: string) => void
}

/** Control first on the unpatched copy, then the mutant in the same copy; the copy is removed either way. */
export async function runMutation(mutation: Mutation, options: RunOptions): Promise<MutationResult> {
  const started = performance.now()
  const root = await disposableCopy(options.repoRoot, options.packageDir)
  try {
    const cwd = join(root, options.packageDir)
    const target = join(cwd, mutation.file)
    const original = await readFile(target, "utf8")
    let patched = applyEdit(original, mutation, `${mutation.id} ${mutation.file}`)
    if (mutation.also) patched = applyEdit(patched, mutation.also, `${mutation.id} ${mutation.file} (second site)`)
    const pattern = new RegExp(mutation.testNamePattern)
    const timeoutMs = options.timeoutMs ?? 600_000
    const control = await bunTest(cwd, mutation, timeoutMs)
    const controlFailing = failingTests(control.output, pattern)
    if (control.code !== 0 || controlFailing.assertion + controlFailing.runtime > 0 || !/^\s*[1-9]\d* pass$/m.test(control.output)) {
      options.log?.(control.output)
      return { id: mutation.id, verdict: "control-failed", failing: 0, ms: performance.now() - started }
    }
    await writeFile(target, patched)
    const mutant = await bunTest(cwd, mutation, timeoutMs)
    const { assertion, runtime } = failingTests(mutant.output, pattern)
    // Only an assertion kills. A runtime error or a crash outside any test (bun's "Unhandled error between tests") is
    // its own verdict, so a mutant that merely breaks loading never counts as caught by the named test.
    const crashed = runtime > 0 || /^# Unhandled error between tests$/m.test(mutant.output)
    const verdict: MutationVerdict = mutant.code !== 0 && assertion > 0 ? "killed" : crashed ? "crashed" : "survived"
    if (verdict !== "killed") options.log?.(mutant.output)
    return { id: mutation.id, verdict, failing: assertion, ms: performance.now() - started }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function runMutations(mutations: readonly Mutation[], options: RunOptions & { readonly print: (line: string) => void }) {
  // Every table entry must patch before any test runs, so a stale `find` fails the job in seconds.
  for (const mutation of mutations) {
    const source = await readFile(join(options.repoRoot, options.packageDir, mutation.file), "utf8")
    const patched = applyEdit(source, mutation, `${mutation.id} ${mutation.file}`)
    if (mutation.also) applyEdit(patched, mutation.also, `${mutation.id} ${mutation.file} (second site)`)
  }
  const results: MutationResult[] = []
  for (const mutation of mutations) {
    const result = await runMutation(mutation, options)
    results.push(result)
    const kind = mutation.oracle ? "oracle" : "source"
    options.print(`${result.verdict.padEnd(14)} ${kind.padEnd(6)} ${mutation.id.padEnd(26)} ${String(result.failing).padStart(2)} failing  control green: ${result.verdict !== "control-failed"}  ${(result.ms / 1000).toFixed(1)}s  ${mutation.test} -t ${JSON.stringify(mutation.testNamePattern)}`)
  }
  return results
}

if (import.meta.main) {
  const only = process.argv.indexOf("--only")
  const ids = only === -1 ? null : new Set((process.argv[only + 1] ?? "").split(","))
  const selected = ids === null ? MUTATIONS : MUTATIONS.filter((mutation) => ids.has(mutation.id))
  if (ids !== null && selected.length !== ids.size) throw new Error(`unknown mutation id in ${[...ids].join(",")}`)
  const started = performance.now()
  const results = await runMutations(selected, {
    repoRoot: resolve(import.meta.dir, ".."), packageDir: "packages/omo-native",
    print: (line) => console.log(line), log: (output) => console.error(output),
  })
  const source = results.filter((result) => !selected.find((mutation) => mutation.id === result.id)?.oracle)
  const killed = (list: readonly MutationResult[]) => list.filter((result) => result.verdict === "killed").length
  console.log(`source mutations killed ${killed(source)}/${source.length}; oracle self-checks killed ${killed(results) - killed(source)}/${results.length - source.length}; wall ${((performance.now() - started) / 1000).toFixed(1)}s`)
  if (results.some((result) => result.verdict !== "killed")) process.exit(1)
}
