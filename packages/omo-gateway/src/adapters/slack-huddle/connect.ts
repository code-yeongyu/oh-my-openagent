// `omo gateway connect --adapter-module <this file>` factory for the huddle voice surface.
//
// Credentials come from the same custody-checked location as the text Slack surface, so a huddle
// never introduces a second place where a member session can live.

import type { AdapterFactoryInput } from "../../connector/cli"
import { loadSlackSecrets } from "../slack/connect"
import { SlackHuddleAdapter } from "./adapter"
import { HuddleDriver } from "./driver"

export type HuddleFactoryOptions = { readonly profilesRoot: string; readonly maxCallMinutes?: number | null }

export async function createVoiceAdapter(input: AdapterFactoryInput, options: HuddleFactoryOptions): Promise<SlackHuddleAdapter> {
  const account_id = input.surface.account_id
  if (account_id === undefined) throw new Error("a huddle surface needs an account_id (the workspace id)")
  const secrets = await loadSlackSecrets(input)
  if (secrets.cookie === undefined) throw new Error("a huddle needs a member session (token and cookie); an app token cannot join a call")
  const driver = new HuddleDriver({ account_id, session: { token: secrets.token, cookie: secrets.cookie }, profilesRoot: options.profilesRoot })
  return new SlackHuddleAdapter(driver, { maxCallMinutes: options.maxCallMinutes ?? null })
}
