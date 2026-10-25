import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

export type KeyStore = {
  readonly read: () => Promise<string | null>
  readonly write: (value: string) => Promise<void>
}

export type SecretCommandResult = { code: number; stdout: string; stderr: string }

/**
 * Runs a secret-handling CLI. Secret material is passed only on the child's
 * stdin (`input`), never on argv. `argv` must never carry secret bytes; the
 * keystore implementations below place every secret on stdin exclusively.
 * Pass `undefined` as the fourth `createOsKeyStore` argument to auto-select
 * `Bun.secrets`, or supply `run`/`null` to force the CLI backend.
 */
export type RunSecretCommand = (argv: readonly string[], input?: string) => Promise<SecretCommandResult>

export type SecretApi = {
  readonly get: (key: { service: string; name: string }) => Promise<string | null>
  readonly set: (key: { service: string; name: string; value: string }) => Promise<void>
}

const DEFAULT_SERVICE = "omo-cli"

function defaultRun(argv: readonly string[], input?: string): Promise<SecretCommandResult> {
  const [file, ...args] = argv
  return new Promise((resolve, reject) => {
    const child = execFile(file ?? "", args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === "number") {
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
        return
      }
      if (error) {
        reject(error)
        return
      }
      resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
    })
    child.stdin?.end(input ?? "")
  })
}

/**
 * The OS keystore backends the CLI device keyring accepts. Anything that can
 * only persist in plaintext (a dotfile, an unencrypted sqlite row, a world-
 * readable registry value) is never a fallback: callers refuse instead.
 */
export function createOsKeyStore(
  name: string,
  platform: NodeJS.Platform = process.platform,
  run: RunSecretCommand = defaultRun,
  secrets?: SecretApi | null,
): KeyStore {
  const resolved = secrets === undefined ? (run === defaultRun && typeof Bun !== "undefined" ? Bun.secrets : null) : secrets
  switch (platform) {
    case "darwin":
      return resolved !== null ? createBunSecretsKeyStore(name, resolved) : createMacOsKeychainKeyStore(name, run)
    case "linux":
      return resolved !== null ? createBunSecretsKeyStore(name, resolved) : createLibsecretKeyStore(name, run)
    case "win32":
      return resolved !== null ? createBunSecretsKeyStore(name, resolved) : createDpapiKeyStore(name, run)
    default:
      return unsupported(platform)
  }
}

function unsupported(platform: NodeJS.Platform): never {
  throw new Error(
    `omo account keys: no supported encrypted OS keystore on ${platform}. ` +
      "Device keys are only ever stored in the macOS Keychain, the Linux Secret Service (libsecret), or Windows DPAPI (a per-user encrypted blob). " +
      "Refusing to store private keys in plaintext.",
  )
}

/**
 * Runs one backend command and folds every failure shape (nonzero exit,
 * spawn error, backend stderr echoing fragments) into one sanitized error
 * that names the platform action and never carries backend output.
 */
async function guarded(
  run: RunSecretCommand,
  fail: () => Error,
  argv: readonly string[],
  input?: string,
): Promise<SecretCommandResult> {
  try {
    return await run(argv, input)
  } catch {
    throw fail()
  }
}

function createBunSecretsKeyStore(name: string, secrets: SecretApi): KeyStore {
  const key = { service: DEFAULT_SERVICE, name }
  const unavailable = () =>
    new Error(
      "omo account keys: cannot access the OS credential store. Unlock the login keychain (macOS), the Secret Service keyring (Linux), or DPAPI (Windows), then try again. " +
        "Private keys are only ever stored through the OS credential facility.",
    )
  return {
    async read() {
      try {
        return await secrets.get(key)
      } catch {
        throw unavailable()
      }
    },
    async write(value) {
      try {
        await secrets.set({ ...key, value })
      } catch {
        throw unavailable()
      }
    },
  }
}

function createMacOsKeychainKeyStore(name: string, run: RunSecretCommand): KeyStore {
  const account = `omo-device-keys-${name}`
  const fail = () =>
    new Error(
      "omo account keys: macOS Keychain is unavailable. Unlock the login keychain (open Keychain Access) and try again. " +
        "Private keys are only ever stored through the OS credential facility.",
    )
  return {
    async read() {
      const result = await guarded(run, fail, ["security", "find-generic-password", "-s", DEFAULT_SERVICE, "-a", account, "-w"])
      if (result.code !== 0) {
        // Exit 44 is errSecItemNotFound (no record yet); anything else is a locked or broken keychain.
        if (result.code === 44) return null
        throw fail()
      }
      return result.stdout.replace(/\n$/, "")
    },
    async write(value) {
      // `add-generic-password -w <value>` would put the secret on argv, where any process
      // can read it from the process list. `-w` with no value makes security prompt on the
      // TTY (twice), which breaks non-interactive use. `security -i` reads commands from
      // stdin instead, so the whole add line, secret included, travels on stdin only.
      // The -i parser splits on whitespace, so the value goes in a double-quoted argument
      // with `\` and `"` escaped; this round-trips arbitrary JSON bytes verbatim.
      const quoted = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      const script = `add-generic-password -U -s ${DEFAULT_SERVICE} -a ${account} -w ${quoted}\n`
      const result = await guarded(run, fail, ["security", "-i"], script)
      if (result.code !== 0) throw fail()
    },
  }
}

function createLibsecretKeyStore(name: string, run: RunSecretCommand): KeyStore {
  const attributes = ["service", DEFAULT_SERVICE, "account", `omo-device-keys-${name}`]
  const fail = () =>
    new Error(
      "omo account keys: the Linux Secret Service is unavailable. Install libsecret (secret-tool) and unlock your login keyring, then try again. " +
        "Private keys are only ever stored through the OS credential facility.",
    )
  return {
    async read() {
      const result = await guarded(run, fail, ["secret-tool", "lookup", ...attributes])
      if (result.code !== 0) {
        // A missing record exits 1 with empty stderr; any other failure carries a backend message.
        if (result.code === 1 && result.stderr === "") return null
        throw fail()
      }
      return result.stdout === "" ? null : result.stdout.replace(/\n$/, "")
    },
    async write(value) {
      const result = await guarded(run, fail, ["secret-tool", "store", "--label=omo device keys", ...attributes], value)
      if (result.code !== 0) throw fail()
    },
  }
}

/**
 * Windows DPAPI backend: PowerShell's ProtectedData API (CurrentUser scope)
 * encrypts to a per-user blob only this account can decrypt. The secret
 * travels on stdin; the blob path is not secret and may sit on argv. Paths
 * are embedded as PowerShell single-quoted literals with `'` doubled, so a
 * profile path containing a quote cannot break out of the string.
 */
function createDpapiKeyStore(name: string, run: RunSecretCommand): KeyStore {
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "-")
  const directory = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "omo")
  const file = join(directory, `device-keys-${safeName}.bin`)
  const ps = (literal: string) => `'${literal.replace(/'/g, "''")}'`
  const prelude = "Add-Type -AssemblyName System.Security; "
  const fail = () =>
    new Error(
      "omo account keys: Windows DPAPI is unavailable. Sign in with your Windows account (DPAPI needs the account credential) and try again. " +
        "Private keys are only ever stored through DPAPI (a per-user encrypted blob).",
    )
  return {
    async read() {
      const script =
        prelude +
        `if (-not [IO.File]::Exists(${ps(file)})) { exit 3 } ` +
        `$e = [IO.File]::ReadAllBytes(${ps(file)}); ` +
        "$b = [Security.Cryptography.ProtectedData]::Unprotect($e, $null, 'CurrentUser'); " +
        "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"
      const result = await guarded(run, fail, ["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
      if (result.code !== 0) {
        if (result.code === 3) return null
        throw fail()
      }
      return result.stdout === "" ? null : result.stdout
    },
    async write(value) {
      const script =
        prelude +
        `[IO.Directory]::CreateDirectory(${ps(directory)}) | Out-Null; ` +
        "$s = [Console]::In.ReadToEnd(); " +
        "$b = [Text.Encoding]::UTF8.GetBytes($s); " +
        "$e = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'); " +
        `[IO.File]::WriteAllBytes(${ps(file)}, $e)`
      const result = await guarded(run, fail, ["powershell", "-NoProfile", "-NonInteractive", "-Command", script], value)
      if (result.code !== 0) throw fail()
    },
  }
}
