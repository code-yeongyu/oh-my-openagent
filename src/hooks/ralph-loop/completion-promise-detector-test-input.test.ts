/// <reference types="bun-types" />
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

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

	const messagesFunction = unsafeTestValue<PluginInput["client"]["session"]["messages"]>(async () => ({ data: messages }))
	pluginInput.client.session.messages = messagesFunction

	return pluginInput
}
