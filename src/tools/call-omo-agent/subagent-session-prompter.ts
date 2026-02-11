import type { PluginInput } from "@opencode-ai/plugin"
import { log, getAgentToolRestrictions } from "../../shared"

export async function promptSubagentSession(
	ctx: PluginInput,
	options: { sessionID: string; agent: string; prompt: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		await ctx.client.session.promptAsync({
			path: { id: options.sessionID },
			body: {
				agent: options.agent,
				tools: {
					...getAgentToolRestrictions(options.agent),
					task: false,
					question: false,
				},
				parts: [{ type: "text", text: options.prompt }],
			},
		})
		return { ok: true }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		log("[call_omo_agent] Prompt error", { error: errorMessage })
		return { ok: false, error: errorMessage }
	}
}
