export declare const TELEMETRY_OPT_OUT_NAMES: readonly string[]
export declare const TELEMETRY_OPT_OUT_ENV: Readonly<{ DO_NOT_TRACK: "1"; OMO_DISABLE_TELEMETRY: "1" }>
export declare function withTelemetryOptOut<T extends Record<string, string | undefined>>(
  env: T,
): T & { DO_NOT_TRACK: "1"; OMO_DISABLE_TELEMETRY: "1" }
export declare function telemetryLocalSinkEnv(sinkUrl: string): Record<string, string>
