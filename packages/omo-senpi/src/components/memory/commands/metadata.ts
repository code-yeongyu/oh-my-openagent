// Names, descriptions and argument hints of the memory slash commands whose handlers ship in the
// `#omo-memory-commands-runtime` sidecar. The entry bundle registers these commands from this table
// (register.ts) and each command module uses the same entry, so a command reads the same before and
// after its handler is loaded.

import type { SenpiExtensionAPI } from "../../../extension/types"

export type MemoryCommandPort = Pick<SenpiExtensionAPI, "registerCommand" | "sendUserMessage">

export const MEMORY_REPOSITORY_SUBCOMMANDS = ["set", "unset", "status", "push"] as const

export const LAZY_MEMORY_COMMANDS = {
  memory: {
    description: "View committed memory: HEAD, system bodies, external names, and uncommitted changes; unlock re-checks and removes a stranded git lock.",
    argumentHint: "[unlock <lock path> [--force]]",
  },
  remember: {
    description: "Persist text to long-term memory via a memory-tool turn.",
    argumentHint: "<text>",
  },
  init: {
    description: "Initialize the memory repository and instruct the agent to create initial memory.",
    argumentHint: "",
  },
  recompile: {
    description: "Recompile the memory block into the system prompt on the next agent run.",
    argumentHint: "",
  },
  "memory-repository": {
    description: "Configure the push-only mirror remote for the memory repository.",
    argumentHint: `<${MEMORY_REPOSITORY_SUBCOMMANDS.join("|")}> [url]`,
  },
  sleeptime: {
    description: "Show the resolved sleeptime memory settings for this identity.",
    argumentHint: "",
  },
  reflect: {
    description: "Request a memory reflection run now, optionally scoped and focused.",
    argumentHint: "[--recent N | --conversation <ids>] [focus]",
  },
  dream: {
    description: "Request a manual multi-conversation memory dream run.",
    argumentHint: "[--auto | --recent N | --conversation <ids> | --from transcript:<path>] [--to <doc>] [focus]",
  },
  search: {
    description: "Search past session transcripts and show scored, numbered results.",
    argumentHint: "<query> [--include-hidden]",
  },
  facts: {
    description: "Show facts-extraction queue/backoff state, or manually retry parked batches.",
    argumentHint: "[retry [--conversation <id>]]",
  },
  agreements: {
    description: "List, add, acknowledge, or drop your standing agreements with the agent.",
    argumentHint: "[list] | add [--project] <text> | ack <id> | drop <id>",
  },
} as const satisfies Record<string, { readonly description: string; readonly argumentHint: string }>

export type LazyMemoryCommandName = keyof typeof LAZY_MEMORY_COMMANDS
