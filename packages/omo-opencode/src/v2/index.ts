import * as Plugin from "@opencode/plugin/promise/plugin"
import type { Rpc } from "@opencode/plugin"
import { z } from "zod"

export const PLUGIN_ID = "oh-my-openagent"
export const BOOTSTRAP_STAGE = "bootstrap"

export const statusOutputSchema = z.object({
  ok: z.boolean(),
  stage: z.string(),
  plugin: z.string(),
})

export type StatusOutput = z.infer<typeof statusOutputSchema>

export const statusRpc = {
  id: "omo",
  methods: {
    status: {
      input: z.object({}),
      output: statusOutputSchema,
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export async function statusHandler(): Promise<StatusOutput> {
  return {
    ok: true,
    stage: BOOTSTRAP_STAGE,
    plugin: PLUGIN_ID,
  }
}

type Cleanup = () => Promise<void> | void

export const omoV2Plugin = Plugin.define({
  id: PLUGIN_ID,
  async setup(context): Promise<Cleanup> {
    const registrations = [await context.rpc.register(statusRpc, { status: statusHandler })]

    return async (): Promise<void> => {
      for (const registration of registrations.reverse()) {
        try {
          await registration.dispose()
        } catch (error) {
          console.error("[oh-my-openagent/v2] cleanup failed", error)
        }
      }
    }
  },
})

export default omoV2Plugin
