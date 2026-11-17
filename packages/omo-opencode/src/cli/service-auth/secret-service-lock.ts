import { spawn } from "node:child_process"

// "unknown": the probe itself could not answer (no gdbus binary, or the bus did not reply in time). The
// store then falls back to asking libsecret directly, as it did before the probe existed.
export type SecretServiceLockState = "locked" | "unlocked" | "absent" | "unknown"
export type SecretServiceLockProbe = () => Promise<SecretServiceLockState>

const DEFAULT_COLLECTION = "/org/freedesktop/secrets/aliases/default"
// The first call can D-Bus-activate gnome-keyring-daemon, which is slow on a cold or loaded session.
const PROBE_TIMEOUT_MS = 10_000
// The Unlock request goes to a service that has just answered, so it needs no activation time.
const UNLOCK_TIMEOUT_MS = 5_000

// Bun.secrets.get answers null for a LOCKED libsecret collection, exactly as for a missing item, so on
// Linux a null read is only "signed out" once the default collection reports Locked=false over the same
// session bus. No reachable Secret Service is its own answer, never a sign-out.
export const parseLockedReply = (stdout: string): SecretServiceLockState | null => {
  const match = /<\s*(true|false)\s*>/.exec(stdout)
  if (match === null) return null
  return match[1] === "true" ? "locked" : "unlocked"
}

// Service.Unlock answers (unlocked objects, prompt). Prompt "/" means the request finished with no one asked (a keyring
// with an empty password, #14039). The object list is not compared: a service may answer the alias with the real
// collection path, or list nothing because another client unlocked it first, so Locked is read again instead.
const finishedWithoutPrompt = (stdout: string): boolean => /objectpath\s+'\/'\s*\)\s*$/.test(stdout)

type GdbusAnswer = { readonly kind: "reply"; readonly stdout: string } | { readonly kind: "failed" | "unknown" }

const gdbus = (args: readonly string[], timeoutMs: number): Promise<GdbusAnswer> =>
  new Promise((resolve) => {
    const child = spawn("gdbus", ["call", "--session", "--dest", "org.freedesktop.secrets", ...args], {
      stdio: ["ignore", "pipe", "ignore"],
    })
    let stdout = ""
    const timer = setTimeout(() => {
      child.kill()
      resolve({ kind: "unknown" })
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    // A missing gdbus (minimal installs ship libglib without libglib2.0-bin) says nothing about the keyring.
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ kind: "unknown" })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { kind: "reply", stdout } : { kind: "failed" })
    })
  })

const readLocked = async (timeoutMs: number): Promise<SecretServiceLockState> => {
  const answer = await gdbus(
    [
      "--object-path",
      DEFAULT_COLLECTION,
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      "org.freedesktop.Secret.Collection",
      "Locked",
    ],
    timeoutMs,
  )
  if (answer.kind === "unknown") return "unknown"
  return answer.kind === "reply" ? (parseLockedReply(answer.stdout) ?? "absent") : "absent"
}

// A locked default collection is first asked to unlock without a prompt; it stays "locked" when that needs a
// prompt, fails, or does not answer in time, so no dialog ever opens and nothing falls back to a file. A returned
// prompt object is deliberately neither run nor dismissed: the service drops it when this gdbus call disconnects.
export const probeSecretServiceLock: SecretServiceLockProbe = async () => {
  const state = await readLocked(PROBE_TIMEOUT_MS)
  if (state !== "locked") return state
  const unlock = await gdbus(
    [
      "--object-path",
      "/org/freedesktop/secrets",
      "--method",
      "org.freedesktop.Secret.Service.Unlock",
      `['${DEFAULT_COLLECTION}']`,
    ],
    UNLOCK_TIMEOUT_MS,
  )
  if (unlock.kind !== "reply" || !finishedWithoutPrompt(unlock.stdout)) return "locked"
  return (await readLocked(UNLOCK_TIMEOUT_MS)) === "unlocked" ? "unlocked" : "locked"
}
