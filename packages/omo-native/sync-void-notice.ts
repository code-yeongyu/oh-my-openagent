import { acknowledgePhraseVoid, type PhraseVoidNotice } from "../memory-core/src/sync/account/phrase-notice.ts"
import type { SyncCommandDependencies } from "./sync-cli"
import type { SyncContext } from "./sync-context"
import { openControllingTerminal } from "./sync-phrase-tty"

const PHRASE_VOID = "The recovery phrase you saw was not saved to your account. Do not keep it."

/**
 * Delivers a void notice (A1.1-M4): under a refusal it is printed to stderr (it holds no secret) and NEVER
 * acknowledged; otherwise it is written to the opened terminal, and only after the person presses Enter there
 * is it acknowledged. Returns whether it was acknowledged.
 */
export async function deliverVoidNotice(
  dependencies: SyncCommandDependencies,
  context: SyncContext,
  notice: PhraseVoidNotice,
  refused: boolean,
): Promise<boolean> {
  // Enable only ever yields a genesis notice and the CLI has no rotate verb (contract 11.5), so one wording serves.
  const text = PHRASE_VOID
  if (refused) {
    dependencies.error(text)
    return false
  }
  const terminal = (dependencies.terminal ?? openControllingTerminal)()
  if (terminal === null) {
    dependencies.error(text)
    return false
  }
  try {
    terminal.write(`${text}\r\nPress Enter once you have read this.\r\n`)
    if ((await terminal.readLine(false)) === null) {
      // Review LOW (#13337): a cancelled notice says why nothing happened instead of exiting silently.
      dependencies.error("The notice was not confirmed, so nothing changed. Run the command again to read it.")
      return false
    }
  } finally {
    terminal.close()
  }
  await acknowledgePhraseVoid({ ...context, purpose: notice.purpose })
  return true
}
