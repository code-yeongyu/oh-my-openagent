// Verifies operator-built darwin release artifacts on Linux before publish-platform consumes them (#13921).
// Lives under .github/workflows/ so a release source-state branch can take it as a workflow-only commit.
//
//   bun .github/workflows/operator-darwin-verify.ts --dir <downloaded assets> --tag operator-darwin-<sha12>
//     --prepared-sha <40-hex> --version <x.y.z> --repo <git dir> --rcodesign <path>
//
// Every refusal exits 1 with one `::error::operator_darwin_artifacts refused: ...` line. On success it prints the
// markdown summary rows (asset, sha256, cdhash) and writes nothing else.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseSlices, readBuildMeta, record } from "./operator-darwin-signature.ts"

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
    contains: ["senpi-desktop-engine-darwin-arm64", "omo-engine-trust-helper-darwin-arm64"],
  },
  "omo-darwin-x64": {
    identifier: "ai.sisyphuslabs.omo",
    notarized: true,
    contains: ["senpi-desktop-engine-darwin-x64", "omo-engine-trust-helper-darwin-x64"],
  },
  "omo-darwin-x64-baseline": {
    identifier: "ai.sisyphuslabs.omo",
    notarized: true,
    contains: ["senpi-desktop-engine-darwin-x64", "omo-engine-trust-helper-darwin-x64"],
  },
}

export class Refusal extends Error {}
function refuse(reason: string): never {
  throw new Refusal(reason)
}

export type Tools = {
  /** `rcodesign verify <file>` exit status. */
  readonly verify: (file: string) => number
  /** `rcodesign print-signature-info <file>` stdout. */
  readonly signatureInfo: (file: string) => string
  /** True when Apple serves a notarization ticket for the 20-byte cdhash (hex). */
  readonly ticket: (cdhash: string) => Promise<boolean>
  readonly git: (args: readonly string[]) => { readonly status: number; readonly stdout: string }
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

export type Input = {
  readonly dir: string
  readonly tag: string
  readonly preparedSha: string
  readonly version: string
}

export async function verifyOperatorDarwin(input: Input, tools: Tools): Promise<string[]> {
  if (!/^operator-darwin-[0-9a-f]{12}$/.test(input.tag)) refuse(`tag ${input.tag} is not operator-darwin-<12 hex>`)
  if (!/^[0-9a-f]{40}$/.test(input.preparedSha)) refuse("prepared_release_sha must be a full 40-character hex SHA")

  const expected = [MANIFEST, ...Object.keys(ARTIFACTS).flatMap((name) => [name, `${name}.sha256`])].sort()
  const present = readdirSync(input.dir).sort()
  if (JSON.stringify(present) !== JSON.stringify(expected))
    refuse(`asset set differs from the expected ${expected.length}: got ${present.join(", ")}`)

  const manifest = record(JSON.parse(readFileSync(join(input.dir, MANIFEST), "utf8")))
  const sourceSha = String(manifest.source_sha ?? "")
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) refuse("manifest source_sha is not a 40-hex SHA")
  if (input.tag !== `operator-darwin-${sourceSha.slice(0, 12)}`) refuse(`tag ${input.tag} does not name source ${sourceSha}`)
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
  const rows: string[] = []
  for (const [name, artifact] of Object.entries(ARTIFACTS)) {
    const file = join(input.dir, name)
    const content = new Uint8Array(readFileSync(file))
    bytes.set(name, content)
    const digest = sha256(content)
    const line = readFileSync(`${file}.sha256`, "utf8")
    if (line.trim() !== `${digest}  ${name}`) refuse(`${name}: sha256 ${digest} does not match ${name}.sha256`)
    if (hashes[name] !== digest) refuse(`${name}: sha256 ${digest} does not match the manifest`)

    if (tools.verify(file) !== 0) refuse(`${name}: rcodesign verify failed`)
    const slices = parseSlices(tools.signatureInfo(file))
    if (slices.length === 0) refuse(`${name}: no code signature`)
    const cdhashes: string[] = []
    for (const slice of slices) {
      if (slice.identifier !== artifact.identifier) refuse(`${name}: identifier ${slice.identifier}, expected ${artifact.identifier}`)
      if (slice.team !== TEAM_ID) refuse(`${name}: TeamIdentifier ${slice.team}, expected ${TEAM_ID}`)
      if (slice.leafTeam !== TEAM_ID || slice.leafProfile !== "developer-id-application" || !slice.chainsToApple)
        refuse(`${name}: signer is not a Developer ID Application certificate of team ${TEAM_ID} chaining to Apple`)
      if (!slice.runtime) refuse(`${name}: hardened runtime flag missing`)
      if (!/^[0-9a-f]{64}$/.test(slice.cdSha256) || slice.signerDigest !== slice.cdSha256)
        refuse(`${name}: CMS signature does not sign the code directory`)
      const cdhash = slice.cdSha256.slice(0, 40)
      if (artifact.notarized && !(await tools.ticket(cdhash))) refuse(`${name}: no notarization ticket for cdhash ${cdhash}`)
      cdhashes.push(cdhash)
    }

    if (artifact.engine) {
      const raw = readBuildMeta(content)
      if (raw === null) refuse(`${name}: no __OMO_META,__build section`)
      const meta = record(JSON.parse(raw))
      if (meta.source_sha !== sourceSha) refuse(`${name}: embedded source_sha ${String(meta.source_sha)} is not ${sourceSha}`)
      if (meta.host !== artifact.engine.host || meta.rust_target !== artifact.engine.rustTarget)
        refuse(`${name}: embedded target ${String(meta.host)}/${String(meta.rust_target)} is not ${artifact.engine.host}`)
      if (meta.version !== input.version) refuse(`${name}: embedded version ${String(meta.version)} is not ${input.version}`)
    }
    rows.push(`| \`${name}\` | \`${digest}\` | \`${cdhashes.join(", ")}\` |`)
  }
  for (const [name, artifact] of Object.entries(ARTIFACTS)) {
    for (const part of artifact.contains ?? []) {
      if (Buffer.from(bytes.get(name) ?? []).indexOf(Buffer.from(bytes.get(part) ?? [])) < 0)
        refuse(`${name}: does not embed the verified ${part}`)
    }
  }
  return [`Operator: \`${String(manifest.operator ?? "")}\`; source \`${sourceSha}\``, "", "| asset | sha256 | cdhash |", "| --- | --- | --- |", ...rows]
}

async function main(argv: readonly string[]): Promise<number> {
  const arg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? (argv[index + 1] ?? "") : ""
  }
  const rcodesign = arg("--rcodesign")
  const repo = arg("--repo")
  const run = (cmd: readonly string[]) => {
    const result = Bun.spawnSync([...cmd], { stdout: "pipe", stderr: "pipe" })
    return { status: result.exitCode ?? 1, stdout: result.stdout.toString() }
  }
  const tools: Tools = {
    verify: (file) => run([rcodesign, "verify", file]).status,
    signatureInfo: (file) => run([rcodesign, "print-signature-info", file]).stdout,
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
  }
  try {
    const rows = await verifyOperatorDarwin(
      { dir: arg("--dir"), tag: arg("--tag"), preparedSha: arg("--prepared-sha"), version: arg("--version") },
      tools,
    )
    console.log(rows.join("\n"))
    return 0
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.log(`::error::operator_darwin_artifacts refused: ${error.message}`)
    return 1
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)))
