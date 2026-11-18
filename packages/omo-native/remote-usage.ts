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
    verbs: ["wake"],
    text: `  wake [on|off|default]                    whether sessions on this device that are not running may be started
                                           by a message from your other signed-in devices; on unless turned off`,
  },
  {
    verbs: ["bootstrap"],
    text: "  bootstrap                                set up this device's service for your sign-in (every omo start runs it)",
  },
  {
    verbs: ["attach"],
    text: "  attach <session>                         open a session in the terminal UI; also takes <device>/<session>",
  },
  {
    verbs: ["open"],
    text: `  open <device> [--project P] [--model provider/id] [--thinking LEVEL] [--permission-preset MODE]
       [--worktree [--branch B] [--base REF]] [--prompt TEXT [--steer|--follow-up]]
                                           start a session on another device; prints <device>/<session>; it runs
                                           in MODE (default: this device's own setting, else full-access), on the
                                           model and thinking level given (a model it cannot run opens nothing),
                                           in a new git worktree of P with --worktree, and is handed TEXT first`,
  },
  {
    verbs: ["send"],
    text: `  send <session> <text> [--steer|--follow-up] [--no-wait]
                                           send a message and print the answer as it arrives (--steer: into the
                                           running turn; --no-wait: return once the session took it).
                                           Use the thread value from open --json, or <device>/<session>.`,
  },
  {
    verbs: ["model"],
    text: "  model <session> <provider/id>            switch the model; also takes <device>/<session>",
  },
  {
    verbs: ["interrupt"],
    text: "  interrupt <session>                      stop the running turn; also takes <device>/<session>",
  },
  {
    verbs: ["close"],
    text: "  close <session>                          end the session; also takes <device>/<session>",
  },
]

export const REMOTE_USAGE = [USAGE_HEAD, ...USAGE_ENTRIES.map((entry) => entry.text)].join("\n")

export const isHelpFlag = (arg: string | undefined): boolean => arg === "--help" || arg === "-h"

/** The usage of one verb: the head line and that verb's entry, flags included. */
export function verbUsage(verb: string): string {
  const entry = USAGE_ENTRIES.find((candidate) => candidate.verbs.includes(verb))
  return entry === undefined ? REMOTE_USAGE : `${USAGE_HEAD}\n${entry.text}`
}
