import { createHash } from "node:crypto";
import os from "node:os";

import { PostHog } from "posthog-node";

import { getPostHogApiKey, getPostHogHost, hasPostHogApiKey, shouldDisablePostHog } from "./env-flags.js";
import { getPostHogActivityCaptureState } from "./posthog-activity-state.js";
import {
	DEFAULT_POSTHOG_API_KEY,
	DEFAULT_POSTHOG_HOST,
	EVENT_NAME,
	PACKAGE_NAME,
	PRODUCT_NAME,
	getComponentVersion,
} from "./product-identity.js";

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST };

export type PostHogActivityReason = "session_start";

export type PostHogClient = {
	trackActive: (distinctId: string, reason: PostHogActivityReason) => void;
	shutdown: () => Promise<void>;
};

type OsProvider = Pick<typeof os, "arch" | "cpus" | "hostname" | "platform" | "release" | "totalmem" | "type">;
type ActivityStateProvider = typeof getPostHogActivityCaptureState;

let osProviderOverride: OsProvider | null = null;
let activityStateProviderOverride: ActivityStateProvider | null = null;

const NO_OP_POSTHOG: PostHogClient = {
	trackActive: () => undefined,
	shutdown: async () => undefined,
};

type PostHogCaptureEvent = Parameters<PostHog["capture"]>[0];

function resolveOsProvider(): OsProvider {
	return osProviderOverride ?? os;
}

function resolveActivityStateProvider(): ActivityStateProvider {
	return activityStateProviderOverride ?? getPostHogActivityCaptureState;
}

function getSafeCpuInfo(): { readonly count: number; readonly model: string | undefined } {
	try {
		const cpuInfo = resolveOsProvider().cpus();
		return {
			count: cpuInfo.length,
			model: cpuInfo[0]?.model,
		};
	} catch {
		return {
			count: 0,
			model: undefined,
		};
	}
}

function getSharedProperties(): NonNullable<PostHogCaptureEvent["properties"]> {
	const osProvider = resolveOsProvider();
	const cpuInfo = getSafeCpuInfo();

	return {
		platform: "omo-codex",
		product_name: PRODUCT_NAME,
		package_name: PACKAGE_NAME,
		package_version: getComponentVersion(),
		runtime: "node",
		runtime_version: process.version,
		source: "plugin",
		$os: osProvider.platform(),
		$os_version: osProvider.release(),
		os_arch: osProvider.arch(),
		os_type: osProvider.type(),
		cpu_count: cpuInfo.count,
		cpu_model: cpuInfo.model,
		total_memory_gb: Math.round(osProvider.totalmem() / 1024 / 1024 / 1024),
		locale: Intl.DateTimeFormat().resolvedOptions().locale,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		shell: process.env["SHELL"],
		ci: Boolean(process.env["CI"]),
		terminal: process.env["TERM_PROGRAM"],
	};
}

export function createPluginPostHog(): PostHogClient {
	if (shouldDisablePostHog() || !hasPostHogApiKey()) {
		return NO_OP_POSTHOG;
	}

	let client: PostHog;
	try {
		client = new PostHog(getPostHogApiKey(), {
			enableExceptionAutocapture: false,
			enableLocalEvaluation: false,
			strictLocalEvaluation: true,
			disableRemoteConfig: true,
			flushAt: 1,
			flushInterval: 0,
			host: getPostHogHost(),
			disableGeoip: false,
		});
	} catch {
		return NO_OP_POSTHOG;
	}

	const sharedProperties = getSharedProperties();

	return {
		trackActive: (distinctId, reason) => {
			const activityState = resolveActivityStateProvider()();
			if (!activityState.captureDaily) {
				return;
			}

			client.capture({
				distinctId,
				event: EVENT_NAME,
				properties: {
					...sharedProperties,
					$process_person_profile: false,
					day_utc: activityState.dayUTC,
					reason,
				},
			});
		},
		shutdown: async () => client.shutdown(),
	};
}

export function getPostHogDistinctId(): string {
	return createHash("sha256").update(`omo-codex:${resolveOsProvider().hostname()}`).digest("hex");
}

/** @internal test-only */
export function __setOsProviderForTesting(provider: OsProvider): void {
	osProviderOverride = provider;
}

/** @internal test-only */
export function __resetOsProviderForTesting(): void {
	osProviderOverride = null;
}

/** @internal test-only */
export function __setActivityStateProviderForTesting(provider: ActivityStateProvider): void {
	activityStateProviderOverride = provider;
}

/** @internal test-only */
export function __resetActivityStateProviderForTesting(): void {
	activityStateProviderOverride = null;
}
