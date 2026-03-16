function escapeSingleQuotedShellText(value: string): string {
	return value.replace(/'/g, "'\\''")
}

export function buildOpencodeAttachCommand(serverUrl: string, sessionId: string): string {
	return `zsh -c 'opencode attach ${escapeSingleQuotedShellText(serverUrl)} --session ${escapeSingleQuotedShellText(sessionId)}'`
}

export function buildDetachedPanePlaceholderCommand(): string {
	return "zsh -c 'printf \"[oh-my-opencode] Subagent pane ready. Focus pane to activate attach.\\n\"; while true; do sleep 3600; done'"
}
