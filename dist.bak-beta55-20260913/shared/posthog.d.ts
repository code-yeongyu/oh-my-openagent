import type { TelemetryEnv, TelemetryOsProvider, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core";
import { getPostHogActivityCaptureState } from "./posthog-activity-state";
/** @internal test-only */
export declare function __setActivityStateProviderForTesting(provider: typeof getPostHogActivityCaptureState): void;
/** @internal test-only */
export declare function __resetActivityStateProviderForTesting(): void;
/** @internal test-only */
export declare function __setOsProviderForTesting(provider: TelemetryOsProvider): void;
/** @internal test-only */
export declare function __resetOsProviderForTesting(): void;
export declare function __setTransportFactoryForTesting(provider: TelemetryTransportFactory): void;
export declare function __resetTransportFactoryForTesting(): void;
export type PostHogSource = "cli" | "plugin";
export type PostHogActivityReason = "run_started" | "plugin_loaded";
export type PostHogClient = {
    readonly trackActive: (distinctId: string, reason: PostHogActivityReason) => void;
    readonly shutdown: () => Promise<void>;
};
type CreatePostHogOptions = {
    readonly configEnabled?: boolean;
};
type RecordPluginTelemetryInput = {
    readonly configEnabled?: boolean;
};
export declare function shouldDisablePostHog(env: TelemetryEnv, configEnabled: boolean | undefined): boolean;
export declare function getPostHogDistinctId(): string;
export declare function createCliPostHog(options?: CreatePostHogOptions): PostHogClient;
export declare function createPluginPostHog(options?: CreatePostHogOptions): PostHogClient;
export declare function recordPluginTelemetry(input: RecordPluginTelemetryInput): void;
export {};
