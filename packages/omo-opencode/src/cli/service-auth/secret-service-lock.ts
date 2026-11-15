import { spawn } from "node:child_process"

// "absent": no Secret Service exists (no session bus, or nothing owns org.freedesktop.secrets); the shared sign-in then
// lives in the private state file (#7185b). "unknown": the probe itself could not answer (no gdbus binary, a bus that
// did not reply in time, a Secret Service with no default collection). The store then falls back to asking libsecret
// directly, as it did before the probe existed.
export type SecretServiceLockState = "locked" | "unlocked" | "absent" | "unknown"
export type SecretServiceLockProbe = () => Promise<SecretServiceLockState>

const DEFAULT_COLLECTION = "/org/freedesktop/secrets/aliases/default"
// The first call can D-Bus-activate gnome-keyring-daemon, which is slow on a cold or loaded session.
const PROBE_TIMEOUT_MS = 10_000

// Bun.secrets.get answers null for a LOCKED libsecret collection, exactly as for a missing item, so on
// Linux a null read is only "signed out" once the default collection reports Locked=false over the same
// session bus. No reachable Secret Service is its own answer, never a sign-out.
export const parseLockedReply = (stdout: string): SecretServiceLockState | null => {
  const match = /<\s*(true|false)\s*>/.exec(stdout)
  if (match === null) return null
  return match[1] === "true" ? "locked" : "unlocked"
}

// gdbus prints "Error connecting:" when there is no session bus to reach, and these D-Bus errors when nothing owns
// (or can be activated as) the Secret Service name. Every other failure leaves the question open.
const NO_SECRET_SERVICE = /^Error connecting:|org\.freedesktop\.DBus\.Error\.(?:ServiceUnknown|NameHasNoOwner)\b/m

export const classifyProbeFailure = (stderr: string): SecretServiceLockState =>
  NO_SECRET_SERVICE.test(stderr) ? "absent" : "unknown"

export const probeSecretServiceLock: SecretServiceLockProbe = () =>
  new Promise((resolve) => {
    const child = spawn(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.secrets",
        "--object-path",
        DEFAULT_COLLECTION,
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.Secret.Collection",
        "Locked",
      ],
      // LC_ALL=C: gdbus translates its own "Error connecting:" prefix, which the classification reads.
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
    )
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill()
      resolve("unknown")
    }, PROBE_TIMEOUT_MS)
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    // A missing gdbus (minimal installs ship libglib without libglib2.0-bin) says nothing about the keyring.
    child.on("error", () => {
      clearTimeout(timer)
      resolve("unknown")
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? (parseLockedReply(stdout) ?? "unknown") : classifyProbeFailure(stderr))
    })
  })
