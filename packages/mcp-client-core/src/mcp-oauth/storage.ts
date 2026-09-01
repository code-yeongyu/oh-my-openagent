import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { getOpenCodeCliConfigDir } from "../config-dir"
import { deleteTokenIndexEntry, readTokenIndex, saveTokenIndexEntry } from "./storage-index"

export interface OAuthTokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  clientInfo?: {
    clientId: string
    clientSecret?: string
  }
}

type TokenStore = Record<string, OAuthTokenData>

const STORAGE_DIR_NAME = "mcp-oauth"
const LEGACY_STORAGE_FILE_NAME = "mcp-oauth.json"

export function getMcpOauthStorageDir(): string {
  return join(getOpenCodeCliConfigDir(), STORAGE_DIR_NAME)
}

export function getMcpOauthServerHash(serverHost: string, resource: string): string {
  return createHash("sha256").update(buildKey(serverHost, resource)).digest("hex").slice(0, 32)
}

export function getMcpOauthStoragePath(serverHost: string, resource: string): string {
  return join(getMcpOauthStorageDir(), `${getMcpOauthServerHash(serverHost, resource)}.json`)
}

function getLegacyStoragePath(): string {
  return join(getOpenCodeCliConfigDir(), LEGACY_STORAGE_FILE_NAME)
}

function normalizeHost(serverHost: string): string {
  let host = serverHost.trim()
  if (!host) return host

  if (host.includes("://")) {
    try {
      host = new URL(host).hostname
    } catch (urlError) {
      if (!(urlError instanceof Error)) throw urlError
      host = host.split("/")[0] ?? ""
    }
  } else {
    host = host.split("/")[0] ?? ""
  }

  if (host.startsWith("[")) {
    const closing = host.indexOf("]")
    if (closing !== -1) {
      host = host.slice(0, closing + 1)
    }
    return host
  }

  if (host.includes(":")) {
    host = host.split(":")[0] ?? ""
  }

  return host
}

function normalizeResource(resource: string): string {
  return resource.replace(/^\/+/, "")
}

function buildKey(serverHost: string, resource: string): string {
  const host = normalizeHost(serverHost)
  const normalizedResource = normalizeResource(resource)
  return `${host}/${normalizedResource}`
}

function isOAuthTokenData(value: unknown): value is OAuthTokenData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record["accessToken"] !== "string") return false

  const refreshToken = record["refreshToken"]
  if (refreshToken !== undefined && typeof refreshToken !== "string") return false

  const expiresAt = record["expiresAt"]
  if (expiresAt !== undefined && typeof expiresAt !== "number") return false

  const clientInfo = record["clientInfo"]
  if (clientInfo === undefined) return true
  if (typeof clientInfo !== "object" || clientInfo === null || Array.isArray(clientInfo)) return false
  const clientRecord = clientInfo as Record<string, unknown>
  if (typeof clientRecord["clientId"] !== "string") return false
  const clientSecret = clientRecord["clientSecret"]
  return clientSecret === undefined || typeof clientSecret === "string"
}

function readTokenFile(filePath: string): OAuthTokenData | null {
  if (!existsSync(filePath)) return null

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"))
    return isOAuthTokenData(parsed) ? parsed : null
  } catch (readError) {
    if (!(readError instanceof Error)) throw readError
    return null
  }
}

function readLegacyStore(): TokenStore | null {
  const filePath = getLegacyStoragePath()
  if (!existsSync(filePath)) return null

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const result: TokenStore = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isOAuthTokenData(value)) result[key] = value
    }
    return result
  } catch (readError) {
    if (!(readError instanceof Error)) throw readError
    return null
  }
}

function writeTokenFile(filePath: string, token: OAuthTokenData): boolean {
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const tempPath = `${filePath}.tmp.${Date.now()}`
    writeFileSync(tempPath, JSON.stringify(token, null, 2), { encoding: "utf-8", mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, filePath)
    return true
  } catch (writeError) {
    if (!(writeError instanceof Error)) throw writeError
    return false
  }
}

export function loadToken(serverHost: string, resource: string): OAuthTokenData | null {
  return readTokenFile(getMcpOauthStoragePath(serverHost, resource)) ?? readLegacyStore()?.[buildKey(serverHost, resource)] ?? null
}

export function saveToken(serverHost: string, resource: string, token: OAuthTokenData): boolean {
  const key = buildKey(serverHost, resource)
  const hash = getMcpOauthServerHash(serverHost, resource)
  return writeTokenFile(getMcpOauthStoragePath(serverHost, resource), token) &&
    saveTokenIndexEntry(getMcpOauthStorageDir(), hash, key)
}

export function deleteToken(serverHost: string, resource: string): boolean {
  const filePath = getMcpOauthStoragePath(serverHost, resource)
  if (!existsSync(filePath)) return deleteLegacyToken(serverHost, resource)

  try {
    unlinkSync(filePath)
    return deleteTokenIndexEntry(getMcpOauthStorageDir(), getMcpOauthServerHash(serverHost, resource))
  } catch (deleteError) {
    if (!(deleteError instanceof Error)) throw deleteError
    return false
  }
}

function deleteLegacyToken(serverHost: string, resource: string): boolean {
  const store = readLegacyStore()
  if (!store) return true

  const key = buildKey(serverHost, resource)
  if (!(key in store)) return true
  delete store[key]

  if (Object.keys(store).length === 0) {
    try {
      const filePath = getLegacyStoragePath()
      if (existsSync(filePath)) unlinkSync(filePath)
      return true
    } catch (deleteError) {
      if (!(deleteError instanceof Error)) throw deleteError
      return false
    }
  }

  return writeLegacyStore(store)
}

function writeLegacyStore(store: TokenStore): boolean {
  try {
    const filePath = getLegacyStoragePath()
    writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 })
    chmodSync(filePath, 0o600)
    return true
  } catch (writeError) {
    if (!(writeError instanceof Error)) throw writeError
    return false
  }
}

export function listTokensByHost(serverHost: string): TokenStore {
  const key = buildKey(serverHost, serverHost)
  const token = loadToken(serverHost, serverHost)
  const legacy = readLegacyStore() ?? {}
  const host = normalizeHost(serverHost)
  const prefix = `${host}/`
  const result: TokenStore = token ? { [key]: token } : {}
  const index = readTokenIndex(getMcpOauthStorageDir())

  for (const [legacyKey, value] of Object.entries(legacy)) {
    if (legacyKey.startsWith(prefix)) result[legacyKey] = value
  }
  for (const [hash, indexedKey] of Object.entries(index)) {
    if (!indexedKey.startsWith(prefix)) continue
    const indexedToken = readTokenFile(join(getMcpOauthStorageDir(), `${hash}.json`))
    if (indexedToken) result[indexedKey] = indexedToken
  }

  return result
}

export function listAllTokens(): TokenStore {
  const result: TokenStore = { ...(readLegacyStore() ?? {}) }
  const dir = getMcpOauthStorageDir()
  if (!existsSync(dir)) return result
  const index = readTokenIndex(dir)

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "index.json") continue
    const token = readTokenFile(join(dir, entry.name))
    const hash = basename(entry.name, ".json")
    if (token) result[index[hash] ?? hash] = token
  }

  return result
}
