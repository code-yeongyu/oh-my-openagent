// `omo gateway connect --adapter-module <this file>` factory for a Slack surface. Credentials come
// from the custody-checked location the connector resolved:
// - credentials_dir: an agent-messenger store; `slack-credentials.json` -> workspaces[account_id]
// - credentials_file / credentials_env: JSON `{ "token", "cookie"? , "app_token"? }` (or the same
//   agent-messenger store shape)
// An optional `api_base` next to the token points the adapter at another Web API root (a local fake
// Slack server in QA). `token_kind` defaults to `user`. Secrets never reach a log line or an error message.
import { join } from "node:path"
import { readFile } from "@oh-my-opencode/memory-core/fs"
import type { AdapterFactoryInput } from "../../connector/cli"
import { SlackAdapter } from "./adapter"
import { isJson, type Json } from "./wire"

export type SlackSecrets = { token: string; cookie?: string; app_token?: string; api_base?: string }

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

function secretsFrom(document: unknown, account_id: string, where: string): SlackSecrets {
  if (!isJson(document)) throw new Error(`slack credentials in ${where} are not a JSON object`)
  const workspaces = isJson(document.workspaces) ? document.workspaces : null
  const entry: Json | null = workspaces === null ? document : isJson(workspaces[account_id]) ? workspaces[account_id] : null
  if (entry === null) throw new Error(`slack credentials in ${where} have no workspace ${account_id}`)
  const token = text(entry.token) ?? text(entry.bot_token)
  if (token === undefined) throw new Error(`slack credentials in ${where} carry no token`)
  const cookie = text(entry.cookie)
  const app_token = text(entry.app_token)
  const api_base = text(entry.api_base)
  return {
    token,
    ...(cookie === undefined ? {} : { cookie }),
    ...(app_token === undefined ? {} : { app_token }),
    ...(api_base === undefined ? {} : { api_base }),
  }
}

function parse(raw: string, where: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`slack credentials in ${where} are not valid JSON`)
  }
}

export async function loadSlackSecrets(input: AdapterFactoryInput): Promise<SlackSecrets> {
  const account_id = input.surface.account_id ?? ""
  const { credentials } = input
  switch (credentials.kind) {
    case "dir":
      return secretsFrom(parse(await readFile(join(credentials.path, "slack-credentials.json"), "utf8"), "the credentials directory"), account_id, "the credentials directory")
    case "file":
      return secretsFrom(parse(await readFile(credentials.path, "utf8"), "the credentials file"), account_id, "the credentials file")
    case "env":
      return secretsFrom(parse(credentials.value, `env ${credentials.name}`), account_id, `env ${credentials.name}`)
    case "none":
      throw new Error("a slack surface needs credentials_dir, credentials_file or credentials_env")
  }
}

export async function createAdapter(input: AdapterFactoryInput): Promise<SlackAdapter> {
  const { api_base, ...secrets } = await loadSlackSecrets(input)
  const account_id = input.surface.account_id
  if (account_id === undefined) throw new Error("a slack surface needs an account_id (the workspace id)")
  const chats = input.surface.listen?.owned_chats
  return new SlackAdapter({
    account_id,
    token_kind: input.surface.token_kind ?? "user",
    ...secrets,
    log: input.log,
    ...(api_base === undefined ? {} : { apiBase: api_base }),
    ...(chats === undefined ? {} : { chats }),
  })
}
