import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync, rmSync, statSync } from "node:fs"
import { userInfo } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  loadOmoConfig,
  OmoConfigWriteError,
  type OmoConfigWriteFileSystem,
  resolveHomeDir,
  updateOmoConfig,
} from "@oh-my-opencode/omo-config-core"

import { log } from "@oh-my-opencode/utils"

import type { SenpiExtensionAPI } from "../../extension/types"
import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"

/**
 * Read and set a folder's `model_profile` (its `.omo/omo.jsonc`) over RPC (#13188), so a client that reaches a
 * machine only through its engine pins the same key a local desktop writes. Under omo the session's starting model
 * comes from `model_profile`; `settings.json` `defaultProvider`/`defaultModel` mean "last used" (see `./index.ts`).
 *
 * Only that one key is ever written, through omo-config-core's writer (atomic, comment-preserving, refuses symlinks
 * and unparsable files). A write needs the folder to be trusted, the same gate as the engine's `set_project_setting`
 * and `write_project_file`; both verbs reach the engine as `extension_request`, which the device service classes
 * `device_admin`.
 */
export const PROJECT_MODEL_PROFILE_GET = "omo.project.model_profile.get"
export const PROJECT_MODEL_PROFILE_SET = "omo.project.model_profile.set"

export interface ProjectModelProfileState {
  readonly path: string
  readonly exists: boolean
  readonly modelProfile: string | null
  readonly parseError: string | null
  /** Set only when a write landed but the writer's pre-write copy could not be removed. */
  readonly backupNotRemoved?: string
}

export type ProjectModelProfileRefusalCode =
  | "no_session"
  | "project_not_trusted"
  | "invalid_model_profile"
  | "project_config_parse_error"
  | "project_config_write_failed"
  | "home_folder"

export type ProjectModelProfileReply =
  | ({ readonly kind: "ok" } & ProjectModelProfileState)
  | { readonly kind: "refused"; readonly code: ProjectModelProfileRefusalCode; readonly message: string }

/**
 * Seams for tests: the writer's file system, the home of the account with a uid, where accounts' homes live, and how a
 * backup copy is removed.
 */
export interface ProjectModelProfileDeps {
  readonly fileSystem?: OmoConfigWriteFileSystem
  /** The home folder of the account with this uid, null when there is no such account, undefined when the lookup failed. */
  readonly homeOfUid?: (uid: number) => string | null | undefined
  /** The folder accounts' homes sit in, used only when the owner lookup failed; defaults to this account home's parent. */
  readonly accountsRoot?: string | null
  readonly removeFile?: (path: string) => void
}

export interface ProjectModelProfileSession {
  readonly cwd: string
  readonly isProjectTrusted: () => boolean
}

const MAX_PROFILE_LENGTH = 200

const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\p{M}]/u

// A home folder's `.omo` is a user layer (omo-config-core loader/paths.ts), never a project layer: this account's
// HOME and account home, and the home of the account that owns the folder. Only a folder another account owns is looked
// up, once per owner for the process, so an account known only through NSS/LDAP is covered. When that lookup fails
// (no lookup binary, a down user database, win32), any folder beside this account's home is refused instead.

/** The home field of one passwd entry: `getent passwd <uid>` (7 fields) or macOS `id -P <uid>` (10 fields). */
export function homeFromPasswdEntry(entry: string): string | null {
  const fields = entry.split("\n")[0]?.split(":") ?? []
  if (fields.length < 7) return null
  const home = fields[fields.length - 2]
  return home !== undefined && home.startsWith("/") ? home : null
}

function runPasswdLookup(uid: number): string {
  const [command, args] =
    process.platform === "darwin"
      ? (["/usr/bin/id", ["-P", String(uid)]] as const)
      : (["/usr/bin/getent", ["passwd", String(uid)]] as const)
  return execFileSync(command, [...args], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
}

const homeByUid = new Map<number, string | null | undefined>()

/**
 * The home of the account with this uid: null when there is no such account, undefined when the lookup failed. Every
 * answer, a failure included, is reused for the process, so a down user database blocks at most one call per owner.
 */
export function lookupHomeOfUid(
  uid: number,
  run: (uid: number) => string = runPasswdLookup,
): string | null | undefined {
  if (homeByUid.has(uid)) return homeByUid.get(uid)
  let home: string | null | undefined
  try {
    home = homeFromPasswdEntry(run(uid))
  } catch (error) {
    log("[model-profile] owner home lookup failed; folders beside this account's home are refused instead", {
      uid,
      error: error instanceof Error ? error.message : String(error),
    })
    home = undefined
  }
  homeByUid.set(uid, home)
  return home
}

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

// This account home's parent, unless the home is missing or sits at the file system root (`/root`, `/nonexistent`).
function defaultAccountsRoot(): string | null {
  const home = userInfo().homedir
  if (!existsSync(home)) return null
  const parent = dirname(realOrSelf(home))
  return parent === dirname(parent) ? null : parent
}

function sameDirectory(path: string, folder: { readonly dev: number; readonly ino: number }): boolean {
  try {
    const candidate = statSync(path)
    return candidate.dev === folder.dev && candidate.ino === folder.ino
  } catch {
    return false
  }
}

// Same directory by identity, not by spelling: a symlink, a bind mount or a case-insensitive volume names one folder
// several ways.
function isHomeFolder(cwd: string, deps: ProjectModelProfileDeps): boolean {
  let folder: { readonly dev: number; readonly ino: number; readonly uid: number }
  const ownHomes = [resolveHomeDir(), userInfo().homedir]
  try {
    folder = statSync(cwd)
  } catch {
    // A folder that is gone is compared by spelling, so a missing HOME is still refused before the writer's mkdir.
    return ownHomes.some((home) => realOrSelf(home) === realOrSelf(cwd))
  }
  if (ownHomes.some((home) => sameDirectory(home, folder))) return true
  if (folder.uid === process.getuid?.()) return false
  const ownerHome = (deps.homeOfUid ?? lookupHomeOfUid)(folder.uid)
  if (ownerHome !== undefined) return ownerHome !== null && sameDirectory(ownerHome, folder)
  const accountsRoot = deps.accountsRoot === undefined ? defaultAccountsRoot() : deps.accountsRoot
  return accountsRoot !== null && sameDirectory(accountsRoot, statSync(dirname(realOrSelf(cwd))))
}

// The writer's pre-write copy goes to a name only this write uses, so cleanup removes exactly that copy and never a
// backup another writer made in the meantime.
function plannedBackupPath(path: string): string {
  return `${path}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`
}

function removeBackup(path: string, deps: ProjectModelProfileDeps): void {
  ;(deps.removeFile ?? ((file: string) => rmSync(file, { force: true })))(path)
}

function projectConfigPath(cwd: string): string {
  const jsonc = join(cwd, ".omo", "omo.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(cwd, ".omo", "omo.json")
  return existsSync(json) ? json : jsonc
}

export function readProjectModelProfile(
  cwd: string,
): ProjectModelProfileState & { readonly profileIds: ReadonlySet<string> } {
  const path = projectConfigPath(cwd)
  const loaded = loadOmoConfig({ cwd })
  const layer = loaded.layers.find(
    (candidate) => candidate.source.scope === "project" && candidate.source.path === path,
  )
  const parseError =
    loaded.diagnostics.find((diagnostic) => diagnostic.path === path && diagnostic.kind === "parse")?.message ?? null
  const value = layer?.config["model_profile"]
  const userProfiles = loaded.config.model_profiles ?? {}
  return {
    path,
    exists: existsSync(path),
    modelProfile: typeof value === "string" ? value : null,
    parseError,
    profileIds: new Set([...Object.keys(BUILTIN_MODEL_PROFILES), ...Object.keys(userProfiles)]),
  }
}

function validProfile(value: string, profileIds: ReadonlySet<string>): boolean {
  if (value.length === 0 || value.length > MAX_PROFILE_LENGTH || value !== value.trim()) return false
  if (INVISIBLE_OR_CONTROL.test(value)) return false
  if (profileIds.has(value)) return true
  const slash = value.indexOf("/")
  return slash > 0 && slash < value.length - 1
}

const refused = (code: ProjectModelProfileRefusalCode, message: string): ProjectModelProfileReply => ({
  kind: "refused",
  code,
  message,
})

const stateReply = (cwd: string): ProjectModelProfileReply => {
  const { profileIds: _ids, ...state } = readProjectModelProfile(cwd)
  return { kind: "ok", ...state }
}

export function getProjectModelProfile(
  session: ProjectModelProfileSession | undefined,
  deps: ProjectModelProfileDeps = {},
): ProjectModelProfileReply {
  if (session === undefined) return refused("no_session", "No session is bound to answer for a folder.")
  if (isHomeFolder(session.cwd, deps))
    return refused("home_folder", "The home folder has no project config; its .omo is the user layer.")
  return stateReply(session.cwd)
}

export function setProjectModelProfile(
  session: ProjectModelProfileSession | undefined,
  data: unknown,
  deps: ProjectModelProfileDeps = {},
): ProjectModelProfileReply {
  if (session === undefined) return refused("no_session", "No session is bound to answer for a folder.")
  const value = typeof data === "object" && data !== null ? Reflect.get(data, "modelProfile") : undefined
  if (value !== null && typeof value !== "string")
    return refused("invalid_model_profile", "modelProfile must be a string or null.")
  if (isHomeFolder(session.cwd, deps))
    return refused("home_folder", "The home folder has no project config; its .omo is the user layer.")
  if (!session.isProjectTrusted())
    return refused("project_not_trusted", "The folder is not trusted; its omo config is not changed.")
  const current = readProjectModelProfile(session.cwd)
  if (current.parseError !== null)
    return refused("project_config_parse_error", `${current.path} does not parse: ${current.parseError}`)
  if (value !== null && !validProfile(value, current.profileIds))
    return refused("invalid_model_profile", `${JSON.stringify(value)} is not a profile id or a provider/model pin.`)
  const backupPath = plannedBackupPath(current.path)
  let written: { readonly backupPath?: string }
  try {
    written = updateOmoConfig({
      scope: "project",
      projectDir: session.cwd,
      edits: [{ path: ["model_profile"], value: value ?? undefined }],
      backupPath,
      ...(deps.fileSystem === undefined ? {} : { fileSystem: deps.fileSystem }),
    })
  } catch (error) {
    if (existsSync(backupPath)) removeBackup(backupPath, deps)
    if (error instanceof OmoConfigWriteError && error.operation === "parse")
      return refused("project_config_parse_error", error.message)
    return refused("project_config_write_failed", error instanceof Error ? error.message : String(error))
  }
  // The write is an atomic rename, so the pre-write copy has served its purpose. The write already landed, so a
  // copy that cannot be removed is reported with the read-back, never as a failed write.
  let leftover: string | null = null
  try {
    if (written.backupPath !== undefined) removeBackup(written.backupPath, deps)
  } catch (error) {
    leftover = error instanceof Error ? error.message : String(error)
  }
  const reply = stateReply(session.cwd)
  return leftover === null || reply.kind !== "ok" ? reply : { ...reply, backupNotRemoved: leftover }
}

export function registerProjectModelProfileRpc(
  pi: SenpiExtensionAPI,
  session: () => ProjectModelProfileSession | undefined,
): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return
  handle(PROJECT_MODEL_PROFILE_GET, () => getProjectModelProfile(session()))
  handle(PROJECT_MODEL_PROFILE_SET, (data) => setProjectModelProfile(session(), data))
}
