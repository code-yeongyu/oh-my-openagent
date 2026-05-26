import {
	type PostHogActivityReason,
	type PostHogClient,
	createPluginPostHog,
	getPostHogDistinctId,
} from "./posthog.js";

export type CodexSessionStartInput = {
	session_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "SessionStart";
	model: string;
	permission_mode: string;
	source: "startup" | "resume" | "clear";
};

export type CodexTelemetryHookOptions = {
	createClient?: () => PostHogClient;
	getDistinctId?: () => string;
};

const SESSION_START_REASON: PostHogActivityReason = "session_start";

export async function runSessionStartHook(
	_input: CodexSessionStartInput,
	options: CodexTelemetryHookOptions = {},
): Promise<string> {
	const createClient = options.createClient ?? createPluginPostHog;
	const getDistinctId = options.getDistinctId ?? getPostHogDistinctId;

	const client = createClient();
	try {
		client.trackActive(getDistinctId(), SESSION_START_REASON);
	} catch {
		await safeShutdown(client);
		return "";
	}
	await safeShutdown(client);
	return "";
}

async function safeShutdown(client: PostHogClient): Promise<void> {
	try {
		await client.shutdown();
	} catch {
		return;
	}
}
