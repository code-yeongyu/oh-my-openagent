import { existsSync, realpathSync, unlinkSync } from "node:fs"
import { userInfo } from "node:os"
import { join, resolve } from "node:path"

import { loadOmoConfig, OmoConfigWriteError, resolveHomeDir, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

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

export interface ProjectModelProfileSession {
  readonly cwd: string
  readonly isProjectTrusted: () => boolean
}

const MAX_PROFILE_LENGTH = 200

const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

// A home folder's `.omo` is the user layer (omo-config-core loader/paths.ts), never a project layer.
function isHomeFolder(cwd: string): boolean {
  const folder = realOrSelf(cwd)
  return [resolveHomeDir(), userInfo().homedir].some((home) => realOrSelf(home) === folder)
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

export function getProjectModelProfile(session: ProjectModelProfileSession | undefined): ProjectModelProfileReply {
  if (session === undefined) return refused("no_session", "No session is bound to answer for a folder.")
  if (isHomeFolder(session.cwd))
    return refused("home_folder", "The home folder has no project config; its .omo is the user layer.")
  return stateReply(session.cwd)
}

export function setProjectModelProfile(
  session: ProjectModelProfileSession | undefined,
  data: unknown,
): ProjectModelProfileReply {
  if (session === undefined) return refused("no_session", "No session is bound to answer for a folder.")
  const value = typeof data === "object" && data !== null ? Reflect.get(data, "modelProfile") : undefined
  if (value !== null && typeof value !== "string")
    return refused("invalid_model_profile", "modelProfile must be a string or null.")
  if (isHomeFolder(session.cwd))
    return refused("home_folder", "The home folder has no project config; its .omo is the user layer.")
  if (!session.isProjectTrusted())
    return refused("project_not_trusted", "The folder is not trusted; its omo config is not changed.")
  const current = readProjectModelProfile(session.cwd)
  if (current.parseError !== null)
    return refused("project_config_parse_error", `${current.path} does not parse: ${current.parseError}`)
  if (value !== null && !validProfile(value, current.profileIds))
    return refused("invalid_model_profile", `${JSON.stringify(value)} is not a profile id or a provider/model pin.`)
  try {
    const written = updateOmoConfig({
      scope: "project",
      projectDir: session.cwd,
      edits: [{ path: ["model_profile"], value: value ?? undefined }],
    })
    // The write is an atomic rename, so the writer's pre-write copy has served its purpose.
    if (written.backupPath !== undefined) unlinkSync(written.backupPath)
  } catch (error) {
    if (error instanceof OmoConfigWriteError && error.operation === "parse")
      return refused("project_config_parse_error", error.message)
    return refused("project_config_write_failed", error instanceof Error ? error.message : String(error))
  }
  return stateReply(session.cwd)
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
