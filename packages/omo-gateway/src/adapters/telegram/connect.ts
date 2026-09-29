// The built-in `omo gateway connect` factory for a Telegram surface. The credential document is
// `{ "token", "api_base"? }` (or a bare bot token in an env var); `api_base` points the adapter at
// another Bot API server, such as a self-hosted one or a local fake. The getUpdates cursors live in
// `<agentDir>/gateway/connectors/<name>.telegram-state.json`. The adapter's own stop notices go to
// the connector log: the connector host writes the one notice for the scope owner.
import { join } from "node:path"
import type { AdapterFactoryInput } from "../../connector/cli"
import { readCredentialDocument, stringField } from "../../connector/credential-document"
import { connectorName, connectorsDir } from "../../connector/lock"
import { TelegramAdapter } from "./adapter"

export async function createAdapter(input: AdapterFactoryInput): Promise<TelegramAdapter> {
  const account_id = input.surface.account_id
  if (account_id === undefined) throw new Error("a telegram surface needs an account_id (the bot id)")
  const document = await readCredentialDocument(input.credentials, "telegram-credentials.json", "telegram")
  const token = stringField(document, "token")
  if (token === undefined) throw new Error(`telegram credentials in ${document.where} carry no token`)
  const apiBase = stringField(document, "api_base")
  return new TelegramAdapter({
    token,
    account_id,
    statePath: join(connectorsDir(input.agentDir), `${connectorName("telegram", account_id)}.telegram-state.json`),
    log: input.log,
    notice: input.log,
    ...(apiBase === undefined ? {} : { apiBase }),
  })
}
