/// <reference types="bun-types" />
import type { PluginInput } from "@opencode-ai/plugin"

export type SessionMessage = {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

export function createPluginInput(messages: SessionMessage[]): PluginInput {
	const pluginInput = {
		client: { session: {} } as PluginInput["client"],
		project: {} as PluginInput["project"],
		directory: "/tmp",
		worktree: "/tmp",
		serverUrl: new URL("http://localhost"),
		$: {} as PluginInput["$"],
	} as PluginInput

	pluginInput.client.session.messages =
		(async () => ({ data: messages })) as unknown as PluginInput["client"]["session"]["messages"]

	return pluginInput
}
