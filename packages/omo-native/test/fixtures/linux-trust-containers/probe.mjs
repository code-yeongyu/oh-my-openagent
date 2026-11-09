// Runs under the compiled omo binary as Bun (BUN_BE_BUN=1) inside a matrix container (omo#10762, 9.4).
// `launch` starts the TLS check with exactly the trust variables the engine's own exec sets from the
// generation `trust ensure` wrote (`closure-only` keeps the closed OpenSSL defaults but drops the
// generation, so its outcome shows where acceptance comes from); `fetch` serves one leaf on loopback
// and fetches it after the listen callback, so there is no readiness wait.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:https"

const [mode, ...rest] = process.argv.slice(2)
if (mode === "launch") {
  const [ensureFile, label, cert, key] = rest
  const ensured = JSON.parse(readFileSync(ensureFile, "utf8"))
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, BUN_BE_BUN: "1" }
  Object.assign(env, { SSL_CERT_FILE: ensured.defaults.file, SSL_CERT_DIR: ensured.defaults.dir })
  if (label !== "closure-only") env.NODE_EXTRA_CA_CERTS = ensured.file
  const child = spawnSync(process.execPath, [process.argv[1], "fetch", label, cert, key], { env, encoding: "utf8", timeout: 60_000 })
  process.stdout.write(child.stdout ?? "")
  process.stderr.write(child.stderr ?? "")
  if (child.status !== 0) process.exit(child.status ?? 1)
} else if (mode === "fetch") {
  const [label, cert, key] = rest
  const server = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (_request, response) => response.end("ok"))
  server.listen(0, "127.0.0.1", async () => {
    let outcome
    try {
      const response = await fetch(`https://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(20_000) })
      await response.text()
      outcome = `ok ${response.status}`
    } catch (error) {
      outcome = error?.code ?? error?.name ?? "unknown"
    }
    console.log(`TLS ${label} ${outcome}`)
    server.close()
  })
} else {
  console.error(`unknown probe mode ${mode}`)
  process.exit(64)
}
