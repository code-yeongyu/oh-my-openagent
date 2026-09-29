// The built-in `omo gateway connect` factory for a Discord surface. The credential document is
// `{ "token", "guild_id"?, "api_base"?, "gateway_url"? }` (or a bare bot token in an env var);
// `api_base` / `gateway_url` point the adapter at another endpoint, such as a local fake server.
// `listen.owned_chats` are the channels catch-up reads.
import type { AdapterFactoryInput } from "../../connector/cli"
import { readCredentialDocument, stringField } from "../../connector/credential-document"
import { DiscordAdapter } from "./adapter"

export async function createAdapter(input: AdapterFactoryInput): Promise<DiscordAdapter> {
  const account_id = input.surface.account_id
  if (account_id === undefined) throw new Error("a discord surface needs an account_id (the bot user id)")
  const document = await readCredentialDocument(input.credentials, "discord-credentials.json", "discord")
  const token = stringField(document, "token")
  if (token === undefined) throw new Error(`discord credentials in ${document.where} carry no token`)
  const guild_id = stringField(document, "guild_id")
  const apiBase = stringField(document, "api_base")
  const gatewayUrl = stringField(document, "gateway_url")
  const chats = input.surface.listen?.owned_chats
  return new DiscordAdapter({
    account_id,
    token,
    log: input.log,
    ...(chats === undefined ? {} : { chats }),
    ...(guild_id === undefined ? {} : { guild_id }),
    ...(apiBase === undefined ? {} : { apiBase }),
    ...(gatewayUrl === undefined ? {} : { gatewayUrl }),
  })
}
