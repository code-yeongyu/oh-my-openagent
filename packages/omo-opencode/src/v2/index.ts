/**
 * OpenCode V2 entry — scaffold slice (upstream PR 1).
 *
 * Exports the V2 plugin definition (`setup`) alongside the untouched V1
 * plugin module (`server`, re-exported from ../index). V2 hosts resolve
 * `setup`; V1 hosts resolve `server` — the additive dual-host shape agreed
 * in code-yeongyu/oh-my-openagent#9389.
 *
 * Subsystem registration (tools/hooks, agents, orchestration, MCP, skills,
 * config, TUI) lands in follow-up PRs; each turns its rows of the runtime
 * parity matrix green.
 */
import { Plugin } from "@opencode/plugin"
import { z } from "zod"

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
  },
})

export default omoV2Plugin
