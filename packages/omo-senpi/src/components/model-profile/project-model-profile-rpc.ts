import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"

import {
  loadOmoConfig,
  OmoConfigWriteError,
  type OmoConfigWriteFileSystem,
  resolveHomeDir,
  updateOmoConfig,
} from "@oh-my-opencode/omo-config-core"

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

/** Seams for tests: the writer's file system, the machine's account home folders, and how a backup copy is removed. */
export interface ProjectModelProfileDeps {
  readonly fileSystem?: OmoConfigWriteFileSystem
  readonly accountHomes?: () => readonly string[]
  readonly removeFile?: (path: string) => void
}

export interface ProjectModelProfileSession {
  readonly cwd: string
  readonly isProjectTrusted: () => boolean
}

const MAX_PROFILE_LENGTH = 200

const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\p{M}]/u

// A home folder's `.omo` is a user layer (omo-config-core loader/paths.ts), never a project layer: this account's
// HOME and account home, and the home of every account in the machine's user database.

/** Home folders listed in an `/etc/passwd`-format text (field 6). */
export function homesFromPasswd(text: string): string[] {
  const homes: string[] = []
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue
    const fields = line.split(":")
    if (fields.length >= 7 && fields[5] !== undefined && fields[5].startsWith("/")) homes.push(fields[5])
  }
  return homes
}

/** Home folders listed by `dscl . -list /Users NFSHomeDirectory` (record name, then the path). */
export function homesFromDscl(text: string): string[] {
  const homes: string[] = []
  for (const line of text.split("\n")) {
    const match = /^\S+\s+(\/.*?)\s*$/u.exec(line)
    if (match?.[1] !== undefined) homes.push(match[1])
  }
  return homes
}

let systemAccountHomes: readonly string[] | undefined

// Read once per process: local accounts from /etc/passwd and, on macOS, Directory Services (where /etc/passwd lists only
// system accounts). An account that comes and goes only through another name service is not listed.
function accountHomesFromUserDatabase(): readonly string[] {
  if (systemAccountHomes !== undefined) return systemAccountHomes
  const homes = new Set<string>()
  try {
    for (const home of homesFromPasswd(readFileSync("/etc/passwd", "utf8"))) homes.add(home)
  } catch {}
  if (process.platform === "darwin") {
    try {
      const listing = execFileSync("/usr/bin/dscl", [".", "-list", "/Users", "NFSHomeDirectory"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      for (const home of homesFromDscl(listing)) homes.add(home)
    } catch {}
  }
  systemAccountHomes = [...homes]
  return systemAccountHomes
}

// Same directory by identity, not by spelling: a symlink, a bind mount or a case-insensitive volume names one folder
// several ways.
function isHomeFolder(cwd: string, deps: ProjectModelProfileDeps): boolean {
  let folder: { readonly dev: number; readonly ino: number }
  try {
    folder = statSync(cwd)
  } catch {
    return false
  }
  const homes = [resolveHomeDir(), userInfo().homedir, ...(deps.accountHomes ?? accountHomesFromUserDatabase)()]
  return homes.some((home) => {
    try {
      const candidate = statSync(home)
      return candidate.dev === folder.dev && candidate.ino === folder.ino
    } catch {
      return false
    }
  })
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

export function readProjectModelProfile(cwd: string): ProjectModelProfileState & { readonly profileIds: ReadonlySet<string> } {
  const path = projectConfigPath(cwd)
  const loaded = loadOmoConfig({ cwd })
  const layer = loaded.layers.find((candidate) => candidate.source.scope === "project" && candidate.source.path === path)
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
