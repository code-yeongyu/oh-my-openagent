import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { X509Certificate } from "node:crypto"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"
import { issueCertificates } from "./trust-certificate-fixtures"

// Design 9.4 (omo#10762): a container per distribution runs the COMPILED engine's `trust ensure`, then
// TLS with the generation it wrote, and reports the system bundle the engine opened. Opt-in only:
// OMO_LINUX_TRUST_CONTAINERS=1 (every distribution) or a comma list of keys below, plus docker.
const DISTROS = {
  debian: { image: "debian:bookworm-slim", family: "debian", libc: "glibc", osId: "debian", bundle: "/etc/ssl/certs/ca-certificates.crt" },
  fedora: { image: "fedora:42", family: "fedora", libc: "glibc", osId: "fedora", bundle: "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem" },
  alpine: { image: "alpine:3.21", family: "alpine", libc: "musl", osId: "alpine", bundle: "/etc/ssl/certs/ca-certificates.crt" },
  "opensuse-leap": { image: "opensuse/leap:15.6", family: "suse", libc: "glibc", osId: "opensuse-leap", bundle: "/etc/ssl/ca-bundle.pem" },
  "opensuse-tumbleweed": { image: "opensuse/tumbleweed:latest", family: "suse", libc: "glibc", osId: "opensuse-tumbleweed", bundle: "/etc/ssl/ca-bundle.pem" },
} as const
type Distro = keyof typeof DISTROS

const flag = process.env.OMO_LINUX_TRUST_CONTAINERS ?? ""
const selected = (flag === "1" ? Object.keys(DISTROS) : flag.split(",").filter(Boolean)) as Distro[]
const unknown = selected.filter((key) => !(key in DISTROS))
if (unknown.length > 0) throw new Error(`OMO_LINUX_TRUST_CONTAINERS names unknown distributions: ${unknown.join(", ")}`)
const enabled = process.platform === "linux" && selected.length > 0 && spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0

const fixture = join(import.meta.dir, "fixtures", "linux-trust-containers")
const entry = join(import.meta.dir, "..", "compile-entry.ts")
// A TLS verification failure, never a connection or probe failure dressed up as a rejection.
const VERIFY_FAILURE = /^(UNABLE_TO_GET_ISSUER_CERT(_LOCALLY)?|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_UNTRUSTED)$/

interface Report {
  readonly osId: string | null
  readonly control: readonly string[]
  readonly ensure: { automatic: string; fallbackReason: string | null; file: string } | null
  readonly opened: readonly string[]
  readonly tls: Readonly<Record<string, string>>
}

function parse(stdout: string): Report {
  let osId: string | null = null
  let ensure: Report["ensure"] = null
  const control: string[] = []
  const opened: string[] = []
  const tls: Record<string, string> = {}
  for (const line of stdout.split("\n")) {
    const [tag, ...rest] = line.split(" ")
    if (tag === "OSID") osId = rest.join(" ")
    else if (tag === "CONTROL") control.push(rest.join(" "))
    else if (tag === "ENSURE") ensure = JSON.parse(rest.join(" "))
    else if (tag === "OPENED") opened.push(rest.join(" "))
    else if (tag === "TLS" && rest[0] !== undefined) tls[rest[0]] = rest.slice(1).join(" ")
  }
  return { osId, control, ensure, opened, tls }
}

describe.skipIf(!enabled)("linux trust containers (design 9.4)", () => {
  let root = ""
  const containers: string[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "omo-linux-trust-ctr-"))
    const certs = join(root, "certs")
    const ca = "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign"
    const leaf = "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1"
    const issued = await issueCertificates(certs, [
      { name: "root", subject: "/CN=omo-trust-matrix-installed-root", days: 2, extensions: ca },
      { name: "leaf", subject: "/CN=127.0.0.1", issuer: "root", days: 2, extensions: leaf },
      { name: "dirroot", subject: "/CN=omo-trust-matrix-openssl-dir-root", days: 2, extensions: ca },
      { name: "dirleaf", subject: "/CN=127.0.0.1", issuer: "dirroot", days: 2, extensions: leaf },
    ])
    const mount = join(root, "mount")
    await mkdir(mount)
    for (const [name, der] of issued) {
      await writeFile(join(mount, `${name}.pem`), new X509Certificate(der).toString(), { mode: 0o644 })
      await writeFile(join(mount, `${name}.key`), await Bun.file(join(certs, `${name}.key`)).text(), { mode: 0o644 })
    }
    // The release entry with an embedded runtime manifest, so the binary takes the release launch path.
    const stage = join(root, "stage", "omo-runtime")
    await mkdir(stage, { recursive: true })
    for (const libc of new Set(selected.map((key) => DISTROS[key].libc))) {
      const target = `bun-linux-${process.arch}${libc === "musl" ? "-musl" : ""}`
      await writeFile(join(stage, "runtime-manifest.json"), `${JSON.stringify({
        marker: "OMO_RUNTIME_MANIFEST_V1", omoAiVersion: "0.0.0-trust-matrix", enginePin: "trust-matrix",
        manifestSha: "0".repeat(64), entries: [], releaseTarget: target.slice("bun-".length),
      })}\n`)
      const build = Bun.spawn([process.execPath, "build", "--compile", `--target=${target}`, "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig", `--asset=${stage}`, entry, "--outfile", join(mount, `omo-${libc}`)], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
      if (code !== 0) throw new Error(`bun build --compile ${target} failed:\n${stdout}\n${stderr}`)
    }
  }, 600_000)

  afterAll(async () => {
    // `--rm` removes a finished container; this only reaches one this file started and a timeout left running.
    for (const name of containers) spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" })
    if (root) await removeTree(root)
  })

  async function runContainer(key: Distro): Promise<Report> {
    const distro = DISTROS[key]
    const name = `omo-10762-trust-${key}-${process.pid}`
    containers.push(name)
    const child = Bun.spawn(["docker", "run", "--rm", "--name", name, "-v", `${join(root, "mount")}:/omo:ro`, "-v", `${fixture}:/omo-fixture:ro`,
      distro.image, "sh", "/omo-fixture/run.sh", distro.family, `omo-${distro.libc}`], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(`${key} container exited ${code}:\n${stdout}\n${stderr.slice(-4000)}`)
    return parse(stdout)
  }

  test.each(selected)("%s: a root installed with the distribution tool is accepted through the selected bundle", async (key) => {
    const distro = DISTROS[key]
    const report = await runContainer(key)
    expect(report.osId).toBe(distro.osId)
    expect(report.ensure).toMatchObject({ automatic: "os", fallbackReason: null })
    // Selection by os-release, asserted by the identity of the one bundle the engine opened.
    expect(report.opened).toEqual([distro.bundle])
    expect(report.tls.installed).toBe("ok 200")
    // The same closure without the generation rejects the root: acceptance came from the import, not
    // from an OpenSSL default path the runtime would otherwise read.
    expect(report.tls["closure-only"]).toMatch(VERIFY_FAILURE)
    if (distro.family === "suse") {
      expect(report.control).toEqual(["openssl-dir-verifies"])
      expect(report.tls["openssl-dir-only"]).toMatch(VERIFY_FAILURE)
    }
  }, 900_000)
})
