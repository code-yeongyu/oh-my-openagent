import {
	type TelemetryDiagnosticErrorKind,
	type TelemetryDiagnosticEvent,
} from "@oh-my-opencode/telemetry-core";
import {
	createPluginPostHog,
	getPostHogDistinctId,
	type PostHogActivityReason,
	type PostHogClient,
} from "./posthog.js";
import { writeComponentTelemetryDiagnostic } from "./product-identity.js";

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
	createClient?: () => PostHogClient | Promise<PostHogClient>;
	getDistinctId?: () => string;
};

const SESSION_START_REASON: PostHogActivityReason = "session_start";

function writeHookDiagnostic(
	event: TelemetryDiagnosticEvent,
	error: unknown,
	errorKind: TelemetryDiagnosticErrorKind,
): void {
	writeComponentTelemetryDiagnostic({
		event,
		source: "plugin",
		error,
		errorKind,
	});
}

export async function runSessionStartHook(
	_input: CodexSessionStartInput,
	options: CodexTelemetryHookOptions = {},
): Promise<string> {
	const createClient = options.createClient ?? createPluginPostHog;
	const getDistinctId = options.getDistinctId ?? getPostHogDistinctId;

	let client: PostHogClient;
	try {
		client = await createClient();
	} catch (error) {
		writeHookDiagnostic("telemetry_posthog_init_failed", error, error instanceof Error ? "error" : "non_error");
		return "";
	}

	try {
		client.trackActive(getDistinctId(), SESSION_START_REASON);
	} catch (error) {
		writeHookDiagnostic("telemetry_capture_failed", error, error instanceof Error ? "error" : "non_error");
		await safeShutdown(client);
		return "";
	}
	await safeShutdown(client);
	return "";
}

async function safeShutdown(client: PostHogClient): Promise<void> {
	try {
		await client.shutdown();
	} catch (error) {
		writeHookDiagnostic("telemetry_shutdown_failed", error, error instanceof Error ? "error" : "non_error");
		return;
	}
}
