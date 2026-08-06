export declare const DEFAULT_POSTHOG_HOST: "https://us.i.posthog.com";
export declare const DEFAULT_POSTHOG_API_KEY: "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74";

export type TelemetryCaptureProperties = Record<string, unknown>;
export type TelemetryCaptureMessage = {
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: TelemetryCaptureProperties;
};

export type TelemetryDiagnosticEvent =
  | "telemetry_activity_state_read_failed"
  | "telemetry_activity_state_write_failed"
  | "telemetry_capture_failed"
  | "telemetry_cpu_info_unavailable"
  | "telemetry_posthog_import_failed"
  | "telemetry_posthog_init_failed"
  | "telemetry_shutdown_failed";

export type TelemetryDiagnosticErrorKind = "error" | "non_error";

export type TelemetryDiagnosticInput = {
  readonly event: TelemetryDiagnosticEvent;
  readonly source: string;
  readonly error?: unknown;
  readonly errorKind?: TelemetryDiagnosticErrorKind;
};

export type TelemetryProductConfig = {
  readonly cacheDirName: string;
  readonly defaultApiKey: string;
  readonly defaultHost: string;
  readonly eventName: string;
  readonly machineIdPrefix: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly platform: string;
  readonly productEnvPrefix: string;
  readonly productName: string;
  readonly additionalProperties?: TelemetryCaptureProperties;
};

export type TelemetryOsProvider = {
  readonly arch: () => string;
  readonly cpus: () => readonly { readonly model: string }[];
  readonly hostname: () => string;
  readonly platform: () => NodeJS.Platform;
  readonly release: () => string;
  readonly totalmem: () => number;
  readonly type: () => string;
};

export type TelemetryEnv = Readonly<Record<string, string | undefined>>;

export type TelemetryTransportOptions = {
  readonly host: string;
  readonly disableGeoip: boolean;
  readonly enableExceptionAutocapture: boolean;
  readonly enableLocalEvaluation: boolean;
  readonly strictLocalEvaluation: boolean;
  readonly disableRemoteConfig: boolean;
  readonly flushAt: number;
  readonly flushInterval: number;
};

export type TelemetryTransport = {
  readonly capture: (message: TelemetryCaptureMessage) => void;
  readonly flush?: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

export type TelemetryTransportFactory = (
  apiKey: string,
  options: TelemetryTransportOptions,
) => TelemetryTransport;

export type TelemetryClient = {
  readonly enabled: boolean;
  readonly trackActive: (input: {
    readonly dayUTC: string;
    readonly distinctId: string;
    readonly reason: string;
  }) => void;
  readonly flush: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

export type PostHogActivityState = {
  readonly lastActiveDayUTC?: string;
};

export type PostHogActivityCaptureState = {
  readonly dayUTC: string;
  readonly captureDaily: boolean;
};

export type DailyActiveCaptureStateInput = {
  readonly stateDir: string;
  readonly now?: Date;
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void;
};

export type ResolveTelemetryStateDirOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly osProvider?: {
    readonly homedir: () => string;
    readonly tmpdir: () => string;
  };
};

export type WriteTelemetryDiagnosticOptions = {
  readonly diagnosticsDir: string;
  readonly now?: Date;
};

export type RecordDailyActiveInput = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void;
  readonly env?: TelemetryEnv;
  readonly now?: Date;
  readonly osProvider?: TelemetryOsProvider;
  readonly product: TelemetryProductConfig;
  readonly reason: string;
  readonly source: string;
  readonly stateDir: string;
  readonly transportFactory?: TelemetryTransportFactory;
};

export type TelemetryClientEnabledInput = {
  readonly env?: TelemetryEnv;
  readonly product: Pick<TelemetryProductConfig, "defaultApiKey" | "productEnvPrefix">;
};

export declare function createDefaultPostHogTransport(
  apiKey: string,
  options: TelemetryTransportOptions,
): TelemetryTransport;
export declare function isTelemetryClientEnabled(input: TelemetryClientEnabledInput): boolean;
export declare function createTelemetryClient(input: {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void;
  readonly env?: TelemetryEnv;
  readonly osProvider?: TelemetryOsProvider;
  readonly product: TelemetryProductConfig;
  readonly source: string;
  readonly transportFactory?: TelemetryTransportFactory;
}): TelemetryClient;
export declare function shouldDisableTelemetry(input: {
  readonly env?: TelemetryEnv;
  readonly globalEnvPrefix?: string;
  readonly productEnvPrefix: string;
}): boolean;
export declare function getTelemetryApiKey(env?: TelemetryEnv, defaultApiKey?: string): string;
export declare function hasTelemetryApiKey(env?: TelemetryEnv, defaultApiKey?: string): boolean;
export declare function getTelemetryHost(env?: TelemetryEnv, defaultHost?: string): string;
export declare function getDefaultTelemetryOsProvider(): TelemetryOsProvider;
export declare function getTelemetryDistinctId(
  machineIdPrefix: string,
  osProvider?: TelemetryOsProvider,
): string;
export declare function resolveTelemetryStateDir(
  product: Pick<TelemetryProductConfig, "cacheDirName">,
  options?: ResolveTelemetryStateDirOptions,
): string;
export declare function getTelemetryActivityStateFilePath(stateDir: string): string;
export declare function getDailyActiveCaptureState(
  input: DailyActiveCaptureStateInput,
): PostHogActivityCaptureState;
export declare function getTelemetryDiagnosticsFilePath(diagnosticsDir: string): string;
export declare function writeTelemetryDiagnostic(
  input: TelemetryDiagnosticInput,
  options: WriteTelemetryDiagnosticOptions,
): void;
export declare function cleanupTelemetryDiagnostics(options: WriteTelemetryDiagnosticOptions): void;
export declare function recordDailyActive(input: RecordDailyActiveInput): Promise<void>;
