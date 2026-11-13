import { Command } from "commander"

import { fixture } from "../../../memory-core/src/sync/account/testing/genesis-enable.test-support"
import { configureSyncCommands, PHRASE_GENESIS_FLAG } from "../../sync-cli"

// Runs `omo sync enable` against an in-process chain server with the REAL controlling terminal. The driver gives
// this process a pty as its terminal and redirects stdout and stderr to files; words may only reach the pty.
const f = await fixture()
const { genesis: _genesis, method: _method, rpId: _rp, userName: _user, roaming: _roaming, ...base } = f.input
const program = new Command("omo").exitOverride()
configureSyncCommands(program, {
  context: async () => ({ ...base, authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() } }),
  clock: { now: () => 0, sleep: async () => undefined },
  output: (line) => console.log(line),
  error: (line) => console.error(line),
  confirm: async () => false,
  interactive: true,
  env: { [PHRASE_GENESIS_FLAG]: "1" },
  phraseFloor: async () => "on",
})
try {
  await program.parseAsync(["sync", "enable"], { from: "user" })
} finally {
  await f.close()
}
process.exit(process.exitCode ?? 0)
