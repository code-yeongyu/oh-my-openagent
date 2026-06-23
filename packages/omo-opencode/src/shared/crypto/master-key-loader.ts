import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const KEY_BYTES = 32
const HEX_LEN = KEY_BYTES * 2
const HEX_RE = /^[0-9a-fA-F]+$/
const DEV_DERIVATION_PREFIX = "idm-account-fleet-dev-fallback:"
const DEFAULT_CONFIG_SUBPATH = ".config/idm"
const warnedDbPaths = new Set<string>()

export type LoadMasterKeyOptions = {
  dbPath?: string
  allowDevFallback?: boolean
  configDir?: string
}

export class MasterKeyInsecureModeError extends Error {
  readonly code = "INSECURE_MODE"
  readonly path: string
  constructor(filePath: string, mode: number) {
    const octal = mode.toString(8).padStart(3, "0")
    super(
      `master_key_insecure_mode: ${filePath} has mode 0${octal}; run chmod 600 ${filePath} to fix`,
    )
    this.name = "MasterKeyInsecureModeError"
    this.path = filePath
  }
}

function parseHexKey(value: string, source: string): Buffer {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length !== HEX_LEN || !HEX_RE.test(trimmed)) {
    throw new Error(`master_key_invalid: ${source} is set but not a valid 64-char hex string`)
  }
  return Buffer.from(trimmed, "hex")
}

function defaultConfigDir(): string {
  return join(homedir(), DEFAULT_CONFIG_SUBPATH)
}

function tryLoadFromFile(keyId: string, configDir: string): Buffer | undefined {
  const filePath = join(configDir, `master-key-${keyId}`)
  if (!existsSync(filePath)) return undefined
  // SECURITY: mask 0o077 isolates group+other permission bits, which must all be zero
  // so the key file is unreadable by anyone but the owner.
  const stat = statSync(filePath)
  if ((stat.mode & 0o077) !== 0) {
    throw new MasterKeyInsecureModeError(filePath, stat.mode & 0o777)
  }
  const content = readFileSync(filePath, "utf8")
  return parseHexKey(content, `file ${filePath}`)
}

export function loadMasterKey(keyId: string, options?: LoadMasterKeyOptions): Buffer {
  const envName = `IDM_ACCOUNT_FLEET_MASTER_KEY_${keyId.toUpperCase()}`
  const rawEnv = process.env[envName]
  if (rawEnv !== undefined) {
    return parseHexKey(rawEnv, `env ${envName}`)
  }
  const configDir = options?.configDir ?? defaultConfigDir()
  const fromFile = tryLoadFromFile(keyId, configDir)
  if (fromFile) return fromFile
  const dbPath = options?.dbPath
  const allowDev = options?.allowDevFallback === true
  if (allowDev && dbPath) {
    if (!warnedDbPaths.has(dbPath)) {
      warnedDbPaths.add(dbPath)
      console.warn(
        "[idm] account-fleet using INSECURE dev fallback master key derived from db path. "
          + `Set ${envName} or create ${join(configDir, `master-key-${keyId}`)} (mode 0600) for production.`,
      )
    }
    return createHash("sha256").update(DEV_DERIVATION_PREFIX + dbPath).digest()
  }
  throw new Error(
    `master_key_unavailable: env ${envName} not set and no file at ${join(configDir, `master-key-${keyId}`)}; create the file (mode 0600) or pass options.allowDevFallback + options.dbPath to opt into the dev fallback`,
  )
}

export function _resetDevFallbackWarningsForTests(): void {
  warnedDbPaths.clear()
}
