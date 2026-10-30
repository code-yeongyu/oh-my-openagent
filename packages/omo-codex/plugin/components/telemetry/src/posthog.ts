import {
	createTelemetryClient,
	getDailyActiveCaptureState,
	getDefaultTelemetryOsProvider,
	getTelemetryInstallDistinctId,
	type PostHogActivityCaptureState,
	type TelemetryOsProvider,
	type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core";

import {
	createComponentTelemetryProductConfig,
	getComponentTelemetryStateDir,
	getComponentVersion,
	writeComponentTelemetryDiagnostic,
} from "./product-identity.js";

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST } from "./product-identity.js";
export { getComponentVersion };

export type PostHogActivityReason = "session_start";

export type PostHogClient = {
	readonly trackActive: (reason: PostHogActivityReason) => void;
	readonly shutdown: () => Promise<void>;
};

type ActivityStateProvider = () => PostHogActivityCaptureState;

type CreatePluginPostHogOptions = {
	readonly activityStateProvider?: ActivityStateProvider;
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: Date;
	readonly osProvider?: TelemetryOsProvider;
	readonly stateDir?: string;
	readonly transportFactory?: TelemetryTransportFactory;
};

const NO_OP_POSTHOG: PostHogClient = {
	trackActive: () => undefined,
	shutdown: async () => undefined,
};

function resolveOsProvider(options: CreatePluginPostHogOptions): TelemetryOsProvider {
	return options.osProvider ?? getDefaultTelemetryOsProvider();
}

function resolveActivityStateProvider(options: CreatePluginPostHogOptions): ActivityStateProvider {
	if (options.activityStateProvider !== undefined) {
		return options.activityStateProvider;
	}

	if (options.stateDir === undefined) {
		return () =>
			getDailyActiveCaptureState(createDailyActiveCaptureStateInput(getComponentTelemetryStateDir(), options.now));
	}

	const stateDir = options.stateDir;
	return () => getDailyActiveCaptureState(createDailyActiveCaptureStateInput(stateDir, options.now));
}

function createDailyActiveCaptureStateInput(stateDir: string, now: Date | undefined) {
	if (now === undefined) {
		return {
			diagnostics: writeComponentTelemetryDiagnostic,
			stateDir,
		};
	}

	return {
		diagnostics: writeComponentTelemetryDiagnostic,
		now,
		stateDir,
	};
}

function createPluginPostHogClient(options: CreatePluginPostHogOptions = {}): PostHogClient {
	const clientInput = {
		diagnostics: writeComponentTelemetryDiagnostic,
		env: options.env ?? process.env,
		osProvider: resolveOsProvider(options),
		product: createComponentTelemetryProductConfig({
			runtime: "node",
			runtime_version: process.version,
		}),
		source: "plugin",
	};
	const client = createTelemetryClient(
		options.transportFactory === undefined
			? clientInput
			: {
					...clientInput,
					transportFactory: options.transportFactory,
				},
	);

	if (!client.enabled) {
		return NO_OP_POSTHOG;
	}

	const activityStateProvider = resolveActivityStateProvider(options);

	return {
		trackActive: (reason) => {
			const activityState = activityStateProvider();
			if (!activityState.captureDaily) {
				return;
			}

			client.trackActive({
				dayUTC: activityState.dayUTC,
				distinctId: getTelemetryInstallDistinctId(options.stateDir ?? getComponentTelemetryStateDir()),
				reason,
			});
		},
		shutdown: async () => {
			await client.shutdown();
		},
	};
}

export async function createPluginPostHog(): Promise<PostHogClient> {
	return createPluginPostHogClient();
}

export function __createPluginPostHogForTesting(options: CreatePluginPostHogOptions): PostHogClient {
	return createPluginPostHogClient(options);
}
