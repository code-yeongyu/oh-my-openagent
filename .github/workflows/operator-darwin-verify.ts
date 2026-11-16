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
import { verifyDeveloperIdSigner } from "./operator-darwin-cms.ts"
import { Refusal, readBuildMeta, readSignatures, refuse } from "./operator-darwin-macho.ts"

export const TEAM_ID = "523JNR86LZ"
export const MANIFEST = "operator-darwin-manifest.json"
const TICKET_URL =
  "https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup"

type Artifact = {
  readonly identifier: string
  readonly notarized: boolean
  readonly engine?: { readonly host: string; readonly rustTarget: string }
  readonly contains?: readonly string[]
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
  "omo-keychain-darwin-universal": { identifier: "com.mengmota.omo-keychain-helper", notarized: true },
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

export function inspectSignatures(bytes: Uint8Array): SliceFacts[] {
  return readSignatures(bytes).map((slice) => ({
    identifier: slice.identifier,
    team: slice.team,
    signerTeam: verifyDeveloperIdSigner(slice.codeDirectory, slice.cms).team,
    runtime: slice.runtime,
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
  if (input.actors.length === 0) refuse("no dispatching actor")
  for (const login of input.actors) {
    const role = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) ? await tools.role(login) : "not a user login"
    if (role !== "admin" && role !== "maintain")
      refuse(
        `${login} has repository role '${role ?? "unreadable"}'; only admin or maintain may use operator darwin artifacts`,
      )
  }

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
  const manifest = record(JSON.parse(manifestBytes.toString("utf8")))
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

    if (artifact.engine) {
      const stamp = readBuildMeta(content)
      if (stamp === null) refuse(`${name}: no __OMO_META,__build section`)
      if (!slices.some((slice) => stamp.end <= slice.hashedEnd))
        refuse(`${name}: __OMO_META,__build lies outside the signed bytes`)
      const meta = record(JSON.parse(stamp.text))
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
    ticket: async (cdhash) => {
      const response = await fetch(TICKET_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: [{ recordName: `2/2/${cdhash}` }] }),
      })
      const body = record(await response.json())
      const first = record(Array.isArray(body.records) ? body.records[0] : undefined)
      return response.ok && typeof record(record(first.fields).signedTicket).value === "string"
    },
    git: (args) => run(["git", "-C", repo, ...args]),
    role: async (login) => {
      const response = await fetch(
        `https://api.github.com/repos/${arg("--repository")}/collaborators/${login}/permission`,
        {
          headers: { authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`, accept: "application/vnd.github+json" },
        },
      )
      const role = response.ok ? record(await response.json()).role_name : undefined
      return typeof role === "string" ? role : null
    },
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
    if (!(error instanceof Refusal)) throw error
    console.log(`::error::operator_darwin_artifacts refused: ${error.message}`)
    return 1
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
