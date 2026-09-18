/**
 * Injects OpenGateway into opencode's live config so its models appear without
 * the user hand-writing a provider block.
 *
 * opencode activates every `config.provider` entry regardless of credentials, so
 * the injection is gated on an actual credential: the API key env var, or an
 * `opengateway` entry in opencode's auth.json. Without one, the config is left
 * exactly as it came in.
 */
export declare const OPENGATEWAY_PROVIDER_ID = "opengateway";
export declare const OPENGATEWAY_BASE_URL = "https://apis.opengateway.ai/v1";
export declare const OPENGATEWAY_ENV_VAR = "OPENGATEWAY_API_KEY";
export declare function applyOpenGatewayProviderConfig(config: Record<string, unknown>): void;
