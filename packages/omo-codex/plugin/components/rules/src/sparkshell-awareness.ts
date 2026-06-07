type RuntimeEnv = Readonly<Record<string, string | undefined>>;

const SPARKSHELL_AWARENESS_MARKER = "## Sparkshell Runtime";

export const SPARKSHELL_AWARENESS_DEDUP_KEY = "__omo_sparkshell_awareness__";

export function isCodexAppServerActive(env: RuntimeEnv = process.env): boolean {
	const originator = env["CODEX_INTERNAL_ORIGINATOR_OVERRIDE"]?.toLowerCase() ?? "";
	const bundleIdentifier = env["__CFBundleIdentifier"]?.toLowerCase() ?? "";
	const shellActive = isTruthy(env["CODEX_SHELL"]);

	return (
		shellActive &&
		(originator.includes("codex desktop") ||
			originator.includes("codex app") ||
			bundleIdentifier === "com.openai.codex")
	);
}

function isSparkShellAppServerConfigured(env: RuntimeEnv = process.env): boolean {
	const codexSocketPath = env["CODEX_APP_SERVER_SOCKET"]?.trim() ?? "";
	const omoSocketPath = env["OMO_SPARKSHELL_APP_SERVER_SOCKET"]?.trim() ?? "";
	return codexSocketPath.length > 0 || omoSocketPath.length > 0;
}

export function getSparkShellRuntimeAwareness(env: RuntimeEnv = process.env): string {
	const override = env["OMO_SPARKSHELL_AWARENESS"] ?? env["LAZYCODEX_SPARKSHELL_AWARENESS"];
	if (isFalsy(override)) {
		return "";
	}
	if (!isTruthy(override) && !isCodexAppServerActive(env) && !isSparkShellAppServerConfigured(env)) {
		return "";
	}

	return [
		SPARKSHELL_AWARENESS_MARKER,
		"",
		"- Prefer `omo sparkshell <command>` for repo inspection, CLI smoke tests, git/history checks, and bounded verification before falling back to raw shell commands.",
		"- Use `omo sparkshell --shell '<command>'` only when shell metacharacters are required.",
		"- Use `omo sparkshell --tmux-pane <pane-id> --tail-lines 400` to inspect an existing tmux pane. Tail lines must stay between 100 and 1000.",
		"- When no native sidecar or appserver is available, Sparkshell silently falls back to raw command execution. `OMO_SPARKSHELL_BIN` selects a native sidecar path.",
	].join("\n");
}

function isTruthy(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isFalsy(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
