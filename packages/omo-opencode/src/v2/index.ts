/**
 * OpenCode V2 entry — scaffold slice (upstream PR 1).
 *
 * This module exports only the V2 plugin definition (`omoV2Plugin`, `setup`).
 * It is exposed as the package subpath `./v2` (see package.json exports), so
 * V2 hosts load this entry directly while V1 hosts keep loading the package
 * root (`../index`, the untouched V1 PluginModule) and never evaluate this
 * file. V1 behaviour is unchanged.
 * This slice (2/N) registers the tools and hooks subsystem: glob/grep
 * tools, execute/session/shell hooks, and the `omo.tools` RPC surface.
 * Remaining subsystems (agents, orchestration, MCP, skills, config, TUI)
 * land in follow-up PRs; each turns its rows of the runtime parity
 * matrix green.
 */
import { Plugin } from "@opencode/plugin"
import { z } from "zod"

import { registerToolsAndHooks } from "./tools"

const bootstrapRpc = {
  id: "omo",
  methods: {
    status: {
      input: z.object({}),
      output: z.object({ ok: z.boolean(), stage: z.string() }),
    },
  },
  events: {},
} as const

export const omoV2Plugin = Plugin.define({
  id: "oh-my-openagent",
  async setup(ctx) {
    ctx.rpc.register(bootstrapRpc, {
      status: async () => ({ ok: true, stage: "bootstrap" }),
    })
    const disposeTools = await registerToolsAndHooks(ctx)
    return async () => {
      await disposeTools()
    }
  },
})

export default omoV2Plugin
