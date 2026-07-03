export const BASH_DEFAULT_TIMEOUT_SECONDS = 120;
export const BASH_MAX_TIMEOUT_SECONDS = 600;

export interface BashTimeoutDefaults {
	defaultSeconds: number;
	maxSeconds: number;
}

type EnvLike = Record<string, string | undefined>;

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

export function resolveBashTimeoutDefaults(env: EnvLike): BashTimeoutDefaults {
	const defaultSeconds = parsePositiveInt(env.PI_BASH_DEFAULT_TIMEOUT_SECONDS) ?? BASH_DEFAULT_TIMEOUT_SECONDS;
	const rawMax = parsePositiveInt(env.PI_BASH_MAX_TIMEOUT_SECONDS) ?? BASH_MAX_TIMEOUT_SECONDS;
	const maxSeconds = Math.max(rawMax, defaultSeconds);
	return { defaultSeconds, maxSeconds };
}

export interface BashToolInputLike {
	command: string;
	timeout?: number;
	[key: string]: unknown;
}

export function applyBashTimeout<TInput extends BashToolInputLike>(
	input: TInput,
	defaults: BashTimeoutDefaults,
): TInput {
	const current = input.timeout;
	if (current === undefined || current <= 0) {
		return { ...input, timeout: defaults.defaultSeconds };
	}
	return input;
}

export function buildBashTimeoutPrompt(defaults: BashTimeoutDefaults): string {
	const minutes = (seconds: number): string => (seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`);
	return `\n## Bash Tool Timeout Policy\n\nThe \`bash\` tool enforces timeouts even when you omit the \`timeout\` parameter:\n\n- Default timeout: ${defaults.defaultSeconds}s (${minutes(defaults.defaultSeconds)}). Applied automatically when you do not set \`timeout\`.\n- Recommended maximum timeout: ${defaults.maxSeconds}s (${minutes(defaults.maxSeconds)}). Explicit \`timeout\` values are preserved because different hosts may use different timeout units.\n- For long-running commands (builds, installs, test suites), set an explicit \`timeout\` that fits the workload. Do not assume commands run forever.\n- For commands that legitimately need to run beyond the recommended maximum, run them in the background via tmux or a similar mechanism instead of relying on bash timeout.\n`;
}
