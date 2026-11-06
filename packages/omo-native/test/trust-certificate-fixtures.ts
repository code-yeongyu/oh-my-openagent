import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** One synthetic certificate. `extensions` is the body of an OpenSSL config section. */
type CertificateSpec = {
  readonly name: string
  readonly subject: string
  /** Name of an earlier spec; absent means self-signed. */
  readonly issuer?: string
  readonly extensions: string
  readonly days: number
}

async function openssl(cwd: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(["openssl", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited, new Response(child.stdout).text()])
  if (code !== 0) throw new Error(`openssl ${args[0]} exited ${code}: ${stderr}`)
}

/** Issues every spec in order with the OpenSSL CLI inside `directory`; returns DER by name. */
export async function issueCertificates(directory: string, specs: readonly CertificateSpec[]): Promise<ReadonlyMap<string, Buffer>> {
  await mkdir(directory, { recursive: true })
  const config = ["[req]", "distinguished_name=dn", "prompt=no", "[dn]", "CN=unused"]
  for (const spec of specs) config.push(`[ext_${spec.name}]`, spec.extensions)
  await writeFile(join(directory, "openssl.cnf"), `${config.join("\n")}\n`)
  const issued = new Map<string, Buffer>()
  let serial = 1
  for (const spec of specs) {
    const key = `${spec.name}.key`
    await openssl(directory, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", key])
    if (spec.issuer === undefined) {
      await openssl(directory, ["req", "-new", "-x509", "-key", key, "-config", "openssl.cnf", "-extensions", `ext_${spec.name}`,
        "-subj", spec.subject, "-days", String(spec.days), "-set_serial", String(serial++), "-outform", "DER", "-out", `${spec.name}.der`])
    } else {
      await openssl(directory, ["req", "-new", "-key", key, "-config", "openssl.cnf", "-subj", spec.subject, "-out", `${spec.name}.csr`])
      await openssl(directory, ["x509", "-req", "-in", `${spec.name}.csr`, "-CA", `${spec.issuer}.der`, "-CAform", "DER", "-CAkey", `${spec.issuer}.key`,
        "-set_serial", String(serial++), "-days", String(spec.days), "-extfile", "openssl.cnf", "-extensions", `ext_${spec.name}`,
        "-outform", "DER", "-out", `${spec.name}.der`])
    }
    issued.set(spec.name, await readFile(join(directory, `${spec.name}.der`)))
  }
  return issued
}
