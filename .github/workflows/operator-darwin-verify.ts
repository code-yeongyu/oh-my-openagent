// Verifies operator-built darwin release artifacts on Linux before publish-platform consumes them (#13921).
// Lives under .github/workflows/ so a release source-state branch can take it as a workflow-only commit.
//
//   bun .github/workflows/operator-darwin-verify.ts --dir <downloaded assets> --tag operator-darwin-<sha12>
//     --manifest-sha256 <64-hex> --prepared-sha <40-hex> --version <x.y.z> --repo <git dir>
//     --actor <login> --triggering-actor <login> --repository <owner/name> --summary <markdown file>
//
// Every refusal exits 1 with one `::error::operator_darwin_artifacts refused: ...` line on stdout. On success it
// writes the markdown summary rows (asset, sha256, cdhashes) to --summary and prints nothing else.
// The signature checks are done here (operator-darwin-macho.ts, operator-darwin-cms.ts), not by an external tool.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type TrustAnchors, verifyDeveloperIdSigner } from "./operator-darwin-cms.ts"
import { Refusal, readBuildMeta, readSignatures, refuse } from "./operator-darwin-macho.ts"
import { roleLookup, ticketLookup } from "./operator-darwin-services.ts"

export const TEAM_ID = "523JNR86LZ"
export const MANIFEST = "operator-darwin-manifest.json"
// The keychain helper's exact designated requirement, as the hosted job pins it (script/keychain-helper-release.ts):
//   identifier "com.mengmota.omo-keychain-helper" and anchor apple generic and
//   certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and
//   certificate leaf[subject.OU] = "523JNR86LZ"
// This is the sha256 of its compiled requirements blob, read from three independently built helpers (#13943).
const KEYCHAIN_REQUIREMENT_SHA256 = "6a3393d33529133e6c5a6c83886fc44e68297bc89170375aeca6ef7695fb98c1"
// [cputype, cpusubtype]: x86_64 (CPU_SUBTYPE_X86_ALL) and arm64 (CPU_SUBTYPE_ARM64_ALL), what lipo -archs reports
// as "x86_64 arm64" on the hosted path. arm64e (subtype 2) is a different architecture and is refused.
const X86_64: Architecture = [0x01000007, 3]
const ARM64: Architecture = [0x0100000c, 0]
type Architecture = readonly [cpuType: number, cpuSubtype: number]

function parseJson(text: string, refusal: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return refuse(refusal)
  }
}

type Artifact = {
  readonly identifier: string
  readonly notarized: boolean
  readonly engine?: { readonly host: string; readonly rustTarget: string }
  readonly contains?: readonly string[]
  /** Exact requirements blob, slice architectures and no entitlements, as the hosted keychain-helper job checks. */
  readonly keychain?: { readonly requirementsSha256: string; readonly architectures: readonly Architecture[] }
}

// The hosted darwin legs this replaces: desktop-engine (engine + trust helper per host), keychain-helper, and the
// darwin build legs. The omo binaries embed their host's engine and trust helper, which binds them to the engine's
// signed source stamp.
export const ARTIFACTS: Readonly<Record<string, Artifact>> = {
  "senpi-desktop-engine-darwin-arm64": {
    identifier: "ai.sisyphuslabs.senpi-desktop-engine",
    notarized: true,
    engine: { host: "darwin-arm64", rustTarget: "aarch64-apple-darwin" },
  },
  "senpi-desktop-engine-darwin-x64": {
    identifier: "ai.sisyphuslabs.senpi-desktop-engine",
    notarized: true,
    engine: { host: "darwin-x64", rustTarget: "x86_64-apple-darwin" },
  },
  "omo-engine-trust-helper-darwin-arm64": { identifier: "ai.sisyphuslabs.omo-engine-trust-helper", notarized: false },
  "omo-engine-trust-helper-darwin-x64": { identifier: "ai.sisyphuslabs.omo-engine-trust-helper", notarized: false },
  "omo-keychain-darwin-universal": {
    identifier: "com.mengmota.omo-keychain-helper",
    notarized: true,
    keychain: { requirementsSha256: KEYCHAIN_REQUIREMENT_SHA256, architectures: [X86_64, ARM64] },
  },
  "omo-darwin-arm64": {
    identifier: "ai.sisyphuslabs.omo",
    notarized: true,
    contains: [
      "senpi-desktop-engine-darwin-arm64",
      "omo-engine-trust-helper-darwin-arm64",
      "omo-keychain-darwin-universal",
    ],
  },
  "omo-darwin-x64": {
    identifier: "ai.sisyphuslabs.omo",
    notarized: true,
    contains: [
      "senpi-desktop-engine-darwin-x64",
      "omo-engine-trust-helper-darwin-x64",
      "omo-keychain-darwin-universal",
    ],
  },
  "omo-darwin-x64-baseline": {
    identifier: "ai.sisyphuslabs.omo",
    notarized: true,
    contains: [
      "senpi-desktop-engine-darwin-x64",
      "omo-engine-trust-helper-darwin-x64",
      "omo-keychain-darwin-universal",
    ],
  },
}

export { Refusal }

/** What one Mach-O slice of an artifact proves after its signature was verified. */
export type SliceFacts = {
  readonly identifier: string
  /** Team in the CodeDirectory, and team of the certificate that verifiably signed it. */
  readonly team: string
  readonly signerTeam: string
  readonly runtime: boolean
  readonly cpuType: number
  readonly cpuSubtype: number
  readonly requirementsSha256: string
  readonly entitlements: boolean
  readonly cdhash: string
  /** File range [start, hashedEnd) covered by the CodeDirectory's page hashes. */
  readonly start: number
  readonly hashedEnd: number
}

export type Tools = {
  /** Verifies every slice's signature and reports it; throws a Refusal on any invalid signature. */
  readonly inspect: (bytes: Uint8Array) => SliceFacts[]
  /** True when Apple serves a notarization ticket for the 20-byte cdhash (hex). */
  readonly ticket: (cdhash: string) => Promise<boolean>
  readonly git: (args: readonly string[]) => { readonly status: number; readonly stdout: string }
  /** The repository role_name of a login, or null when it cannot be read. */
  readonly role: (login: string) => Promise<string | null>
}

/** `anchors` exists for tests that need a CA-valid signer; the CLI always uses Apple's pinned CAs. */
export function inspectSignatures(bytes: Uint8Array, anchors?: TrustAnchors): SliceFacts[] {
  return readSignatures(bytes).map((slice) => ({
    identifier: slice.identifier,
    team: slice.team,
    signerTeam: verifyDeveloperIdSigner(slice.codeDirectory, slice.cms, anchors).team,
    runtime: slice.runtime,
    cpuType: slice.cpuType,
    cpuSubtype: slice.cpuSubtype,
    requirementsSha256: slice.requirementsSha256,
    entitlements: slice.entitlements,
    cdhash: slice.cdhash,
    start: slice.start,
    hashedEnd: slice.hashedEnd,
  }))
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

/** True when `part` occurs inside bytes some slice's CodeDirectory hashes (not in unhashed signature padding). */
function embedsHashed(container: Uint8Array, slices: readonly SliceFacts[], part: Uint8Array): boolean {
  const haystack = Buffer.from(container.buffer, container.byteOffset, container.byteLength)
  for (let at = haystack.indexOf(part); at >= 0; at = haystack.indexOf(part, at + 1))
    if (slices.some((slice) => at >= slice.start && at + part.byteLength <= slice.hashedEnd)) return true
  return false
}
export type Input = {
  readonly dir: string
  readonly tag: string
  /** sha256 of operator-darwin-manifest.json, pinned by the maintainer in the dispatch inputs. */
  readonly manifestSha256: string
  readonly actors: readonly string[]
  readonly preparedSha: string
  readonly version: string
}

export async function verifyOperatorDarwin(input: Input, tools: Tools): Promise<string[]> {
  if (!/^operator-darwin-[0-9a-f]{12}$/.test(input.tag)) refuse(`tag ${input.tag} is not operator-darwin-<12 hex>`)
  if (!/^[0-9a-f]{40}$/.test(input.preparedSha)) refuse("prepared_release_sha must be a full 40-character hex SHA")
  if (!/^[0-9a-f]{64}$/.test(input.manifestSha256)) refuse("operator_darwin_manifest_sha256 must be a 64-hex sha256")

  const expected = [MANIFEST, ...Object.keys(ARTIFACTS).flatMap((name) => [name, `${name}.sha256`])].sort()
  const present = readdirSync(input.dir).sort()
  if (JSON.stringify(present) !== JSON.stringify(expected))
    refuse(`asset set differs from the expected ${expected.length}: got ${present.join(", ")}`)

  // Every operator-supplied file is trusted only through this manifest, whose hash the maintainer pinned at dispatch.
  const manifestBytes = readFileSync(join(input.dir, MANIFEST))
  if (sha256(manifestBytes) !== input.manifestSha256)
    refuse(
      `${MANIFEST} sha256 ${sha256(manifestBytes)} is not the pinned operator_darwin_manifest_sha256 ${input.manifestSha256}`,
    )
  if (input.actors.length === 0) refuse("no dispatching actor")
  for (const login of input.actors) {
    const role = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) ? await tools.role(login) : "not a user login"
    if (role !== "admin" && role !== "maintain")
      refuse(
        `${login} has repository role '${role ?? "unreadable"}'; only admin or maintain may use operator darwin artifacts`,
      )
  }
  const manifest = record(parseJson(manifestBytes.toString("utf8"), `${MANIFEST} is not valid JSON`))
  const sourceSha = String(manifest.source_sha ?? "")
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) refuse("manifest source_sha is not a 40-hex SHA")
  if (input.tag !== `operator-darwin-${sourceSha.slice(0, 12)}`)
    refuse(`tag ${input.tag} does not name source ${sourceSha}`)
  if (manifest.version !== input.version) refuse(`manifest version ${String(manifest.version)} is not ${input.version}`)
  const hashes = record(manifest.sha256)

  // The source may trail the prepared head only by workflow commits, the rule #13886 applies to its CI basis.
  if (tools.git(["merge-base", "--is-ancestor", sourceSha, input.preparedSha]).status !== 0)
    refuse(`source ${sourceSha} is not an ancestor of prepared_release_sha ${input.preparedSha}`)
  const delta = tools.git(["diff", "--no-renames", "--name-only", sourceSha, input.preparedSha])
  if (delta.status !== 0) refuse("could not diff source against prepared_release_sha")
  const foreign = delta.stdout.split("\n").filter((path) => path !== "" && !path.startsWith(".github/workflows/"))
  if (foreign.length > 0) refuse(`source differs from prepared_release_sha outside .github/workflows/: ${foreign[0]}`)

  const bytes = new Map<string, Uint8Array>()
  const facts = new Map<string, SliceFacts[]>()
  const rows: string[] = []
  for (const [name, artifact] of Object.entries(ARTIFACTS)) {
    const file = join(input.dir, name)
    const content = new Uint8Array(readFileSync(file))
    bytes.set(name, content)
    const digest = sha256(content)
    const line = readFileSync(`${file}.sha256`, "utf8")
    if (line.trim() !== `${digest}  ${name}`) refuse(`${name}: sha256 ${digest} does not match ${name}.sha256`)
    if (hashes[name] !== digest) refuse(`${name}: sha256 ${digest} does not match the manifest`)

    let slices: SliceFacts[]
    try {
      slices = tools.inspect(content)
    } catch (error) {
      if (error instanceof Refusal) refuse(`${name}: ${error.message}`)
      throw error
    }
    facts.set(name, slices)
    if (slices.length === 0) refuse(`${name}: no code signature`)
    for (const slice of slices) {
      if (slice.identifier !== artifact.identifier)
        refuse(`${name}: identifier ${slice.identifier}, expected ${artifact.identifier}`)
      if (slice.team !== TEAM_ID) refuse(`${name}: TeamIdentifier ${slice.team}, expected ${TEAM_ID}`)
      if (slice.signerTeam !== TEAM_ID) refuse(`${name}: signed by team ${slice.signerTeam}, expected ${TEAM_ID}`)
      if (!slice.runtime) refuse(`${name}: hardened runtime flag missing`)
      if (artifact.notarized && !(await tools.ticket(slice.cdhash)))
        refuse(`${name}: no notarization ticket for cdhash ${slice.cdhash}`)
    }
    const cdhashes = slices.map((slice) => slice.cdhash)
    if (artifact.keychain) {
      const { requirementsSha256, architectures: expected } = artifact.keychain
      if (slices.some((slice) => slice.requirementsSha256 !== requirementsSha256))
        refuse(`${name}: designated requirement differs from the keychain helper contract`)
      if (slices.some((slice) => slice.entitlements))
        refuse(`${name}: carries entitlements; the keychain helper contract has none`)
      const key = ([cpuType, cpuSubtype]: Architecture) => `${cpuType}/${cpuSubtype}`
      const actual = slices.map((slice) => key([slice.cpuType, slice.cpuSubtype])).sort()
      if (JSON.stringify(actual) !== JSON.stringify(expected.map(key).sort()))
        refuse(`${name}: slices are not exactly x86_64 + arm64`)
    }

    if (artifact.engine) {
      const stamp = readBuildMeta(content)
      if (stamp === null) refuse(`${name}: no __OMO_META,__build section`)
      if (!slices.some((slice) => stamp.end <= slice.hashedEnd))
        refuse(`${name}: __OMO_META,__build lies outside the signed bytes`)
      const meta = record(parseJson(stamp.text, `${name}: __OMO_META,__build is not valid JSON`))
      if (meta.source_sha !== sourceSha)
        refuse(`${name}: embedded source_sha ${String(meta.source_sha)} is not ${sourceSha}`)
      if (meta.host !== artifact.engine.host || meta.rust_target !== artifact.engine.rustTarget)
        refuse(
          `${name}: embedded target ${String(meta.host)}/${String(meta.rust_target)} is not ${artifact.engine.host}`,
        )
      if (meta.version !== input.version)
        refuse(`${name}: embedded version ${String(meta.version)} is not ${input.version}`)
    }
    rows.push(`| \`${name}\` | \`${digest}\` | \`${cdhashes.join(", ")}\` |`)
  }
  for (const [name, artifact] of Object.entries(ARTIFACTS)) {
    for (const part of artifact.contains ?? []) {
      if (
        !embedsHashed(
          bytes.get(name) ?? new Uint8Array(),
          facts.get(name) ?? [],
          bytes.get(part) ?? new Uint8Array([0]),
        )
      )
        refuse(`${name}: does not embed the verified ${part}`)
    }
  }
  return [
    `Operator: \`${String(manifest.operator ?? "")}\`; source \`${sourceSha}\``,
    "",
    "| asset | sha256 | cdhash |",
    "| --- | --- | --- |",
    ...rows,
  ]
}

const describeUnexpected = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  const code = (error as NodeJS.ErrnoException).code
  if (code === undefined || error.message.includes(code)) return error.message
  return `${code}: ${error.message}`
}

async function main(argv: readonly string[]): Promise<number> {
  const arg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? (argv[index + 1] ?? "") : ""
  }
  const repo = arg("--repo")
  const run = (cmd: readonly string[]) => {
    const result = Bun.spawnSync([...cmd], { stdout: "pipe", stderr: "pipe" })
    return { status: result.exitCode ?? 1, stdout: result.stdout.toString() }
  }
  const tools: Tools = {
    inspect: inspectSignatures,
    ticket: ticketLookup(),
    git: (args) => run(["git", "-C", repo, ...args]),
    role: roleLookup(arg("--repository"), process.env.GH_TOKEN ?? ""),
  }
  try {
    const rows = await verifyOperatorDarwin(
      {
        dir: arg("--dir"),
        tag: arg("--tag"),
        manifestSha256: arg("--manifest-sha256"),
        actors: [arg("--actor"), arg("--triggering-actor")],
        preparedSha: arg("--prepared-sha"),
        version: arg("--version"),
      },
      tools,
    )
    await Bun.write(arg("--summary"), `${rows.join("\n")}\n`)
    return 0
  } catch (error) {
    // Anything the checks did not anticipate still ends as the one typed line, never a stack trace.
    const reason = error instanceof Refusal ? error.message : `unexpected verifier error: ${describeUnexpected(error)}`
    console.log(`::error::operator_darwin_artifacts refused: ${reason}`)
    return 1
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
