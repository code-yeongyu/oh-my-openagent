// `omo remote` usage: the full text and each verb's own entry, the answer to `omo remote --help` and `<verb> --help`.

const USAGE_HEAD = "usage: omo remote <command> [--json]"

// One entry per verb (enable and disable share theirs): the full usage is every entry, and `<verb> --help` prints its own.
const USAGE_ENTRIES: readonly { readonly verbs: readonly string[]; readonly text: string }[] = [
  {
    verbs: ["status"],
    text: "  status                                   the device service's connection state",
  },
  {
    verbs: ["devices"],
    text: "  devices                                  the devices on this account",
  },
  {
    verbs: ["sessions"],
    text: `  sessions [--device D] [--project P] [--state running|idle|ended]
                                           sessions across the account's devices`,
  },
  {
    verbs: ["enable", "disable"],
    text: "  enable | disable                         turn remote sessions on or off for this device",
  },
  {
    verbs: ["control"],
    text: `  control [on|off]                         whether your other signed-in devices can view and command this
                                           device's sessions (on unless you turn it off)`,
  },
  {
    verbs: ["bootstrap"],
    text: "  bootstrap                                set up this device's service for your sign-in (every omo start runs it)",
  },
  {
    verbs: ["attach"],
    text: "  attach <device>/<session>                open a session on another device in the terminal UI, to watch and type",
  },
  {
    verbs: ["open"],
    text: `  open <device> [--project P] [--model M] [--permission-preset MODE]
                                           start a session on another device; prints <device>/<session>; it runs
                                           in MODE (default: this device's own setting, else full-access)`,
  },
  {
    verbs: ["send"],
    text: `  send <device>/<session> <text> [--steer|--follow-up] [--no-wait]
                                           send a message and print the answer as it arrives (--steer: into the
                                           running turn; --no-wait: return once the session took it)`,
  },
  {
    verbs: ["model"],
    text: "  model <device>/<session> <provider/id>   switch the session's model",
  },
  {
    verbs: ["interrupt"],
    text: "  interrupt <device>/<session>             stop the session's running turn",
  },
  {
    verbs: ["close"],
    text: "  close <device>/<session>                 end the session on its device",
  },
]

export const REMOTE_USAGE = [USAGE_HEAD, ...USAGE_ENTRIES.map((entry) => entry.text)].join("\n")

export const isHelpFlag = (arg: string | undefined): boolean => arg === "--help" || arg === "-h"

/** The usage of one verb: the head line and that verb's entry, flags included. */
export function verbUsage(verb: string): string {
  const entry = USAGE_ENTRIES.find((candidate) => candidate.verbs.includes(verb))
  return entry === undefined ? REMOTE_USAGE : `${USAGE_HEAD}\n${entry.text}`
}
