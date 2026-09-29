// Credential custody for a connector surface. A connector refuses to start on credentials other
// users can read: a credentials file must be 0600 (no group/other bits), a credentials directory
// 0700 with every file in it 0600, and a credentials env var must be set. The refusal names the
// path (home shown as ~) and its mode, never the secret.

import type { Stats } from "node:fs"
import { join } from "node:path"
import { readdir, stat } from "@oh-my-opencode/memory-core/fs"
import type { Platform } from "../adapter/contract"

/** The config surface fields the connector reads (the `gateway.scopes[].surfaces[]` schema). */
export type ConnectorSurface = {
  platform: Platform
  account_id?: string
  credentials_dir?: string
  credentials_file?: string
  credentials_env?: string
  token_kind?: "user" | "bot"
  domain?: "feishu" | "lark"
  listen?: { dm?: boolean; mention?: boolean; bound_threads?: boolean; owned_chats?: string[] }
}

export type Credentials =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "env"; name: string; value: string }
  | { kind: "none" }

export class CredentialsRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CredentialsRefused"
  }
}

export function expandHome(path: string, home: string): string {
  if (path === "~") return home
  return path.startsWith("~/") ? join(home, path.slice(2)) : path
}

function shown(path: string, home: string): string {
  return home !== "" && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

const octal = (mode: number): string => `0${(mode & 0o777).toString(8).padStart(3, "0")}`
const othersCanAccess = (mode: number): boolean => (mode & 0o077) !== 0

async function statOrRefuse(path: string, home: string, what: string): Promise<Stats> {
  try {
    return await stat(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CredentialsRefused(`credentials ${what} not found: ${shown(path, home)}`)
    }
    throw error
  }
}

async function checkFile(path: string, home: string): Promise<void> {
  const info = await statOrRefuse(path, home, "file")
  if (!info.isFile()) throw new CredentialsRefused(`credentials file is not a regular file: ${shown(path, home)}`)
  if (othersCanAccess(info.mode)) {
    throw new CredentialsRefused(`credentials must be 0600: ${shown(path, home)} is ${octal(info.mode)}`)
  }
}

async function checkDir(path: string, home: string): Promise<void> {
  const info = await statOrRefuse(path, home, "directory")
  if (!info.isDirectory()) throw new CredentialsRefused(`credentials directory is not a directory: ${shown(path, home)}`)
  if (othersCanAccess(info.mode)) {
    throw new CredentialsRefused(`credentials directory must be 0700: ${shown(path, home)} is ${octal(info.mode)}`)
  }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isFile()) await checkFile(join(path, entry.name), home)
  }
}

/** Resolve and custody-check the surface's credentials; throws CredentialsRefused on any violation. */
export async function resolveCredentials(
  surface: ConnectorSurface,
  context: { env: Readonly<Record<string, string | undefined>>; home: string },
): Promise<Credentials> {
  if (surface.credentials_file !== undefined) {
    const path = expandHome(surface.credentials_file, context.home)
    await checkFile(path, context.home)
    return { kind: "file", path }
  }
  if (surface.credentials_dir !== undefined) {
    const path = expandHome(surface.credentials_dir, context.home)
    await checkDir(path, context.home)
    return { kind: "dir", path }
  }
  if (surface.credentials_env !== undefined) {
    const value = context.env[surface.credentials_env]
    if (value === undefined || value === "") throw new CredentialsRefused(`credentials env ${surface.credentials_env} is not set`)
    return { kind: "env", name: surface.credentials_env, value }
  }
  return { kind: "none" }
}
