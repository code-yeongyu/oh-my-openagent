/**
 * OpenClaw Gateway Integration Types
 *
 * Defines types for the OpenClaw gateway waker system.
 * Each hook event can be mapped to a gateway with a pre-defined instruction.
 */

/** Hook events that can trigger OpenClaw gateway calls */
export type OpenClawHookEvent =
  | "session-start"
  | "session-end"
  | "session-idle"
  | "ask-user-question"
  | "stop";

/** HTTP gateway configuration (default when type is absent or "http") */
export interface OpenClawHttpGatewayConfig {
  /** Gateway type discriminator (optional for backward compat) */
  type?: "http";
  /** Gateway endpoint URL (HTTPS required, HTTP allowed for localhost) */
  url: string;
  /** Optional custom headers (e.g., Authorization) */
  headers?: Record<string, string>;
  /** HTTP method (default: POST) */
  method?: "POST" | "PUT";
  /** Per-request timeout in ms (default: 10000) */
  timeout?: number;
}

/** CLI command gateway configuration */
export interface OpenClawCommandGatewayConfig {
  /** Gateway type discriminator */
  type: "command";
  /** Command template with {{variable}} placeholders.
   *  Variables are shell-escaped automatically before interpolation. */
  command: string;
  /**
   * Per-command timeout in ms.
   * Precedence: gateway timeout > OMX_OPENCLAW_COMMAND_TIMEOUT_MS > default (5000ms).
   * Runtime clamps to safe bounds.
   */
  timeout?: number;
}

/** Gateway configuration — HTTP or CLI command */
export type OpenClawGatewayConfig =
  | OpenClawHttpGatewayConfig
  | OpenClawCommandGatewayConfig;

/** Per-hook-event mapping to a gateway + instruction */
export interface OpenClawHookMapping {
  /** Name of the gateway (key in gateways object) */
  gateway: string;
  /** Instruction template with {{variable}} placeholders */
  instruction: string;
  /** Whether this hook-event mapping is active */
  enabled: boolean;
}

/** Top-level config schema for notifications.openclaw key in .omx-config.json */
export interface OpenClawConfig {
  /** Global enable/disable */
  enabled: boolean;
  /** Named gateway endpoints */
  gateways: Record<string, OpenClawGatewayConfig>;
  /** Hook-event to gateway+instruction mappings */
  hooks?: Partial<Record<OpenClawHookEvent, OpenClawHookMapping>>;
}

/** Payload sent to an OpenClaw gateway */
export interface OpenClawPayload {
  /** The hook event that triggered this call */
  event: OpenClawHookEvent;
  /** Interpolated instruction text */
  instruction: string;
  /** Alias of instruction — allows OpenClaw /hooks/wake to consume the payload directly */
  text: string;
  /** ISO timestamp */
  timestamp: string;
  /** Session identifier (if available) */
  sessionId?: string;
  /** Project directory path */
  projectPath?: string;
  /** Project basename */
  projectName?: string;
  /** Tmux session name (if running inside tmux) */
  tmuxSession?: string;
  /** Recent tmux pane output (for stop/session-end events) */
  tmuxTail?: string;
  /** Originating channel for reply routing (if OPENCLAW_REPLY_CHANNEL is set) */
  channel?: string;
  /** Reply target user/bot (if OPENCLAW_REPLY_TARGET is set) */
  to?: string;
  /** Reply thread ID (if OPENCLAW_REPLY_THREAD is set) */
  threadId?: string;
  /** Context data from the hook (whitelisted fields only) */
  context: OpenClawContext;
}

/**
 * Context data passed from the hook to OpenClaw for template interpolation.
 *
 * All fields are explicitly enumerated (no index signature) to prevent
 * accidental leakage of sensitive data into gateway payloads.
 */
export interface OpenClawContext {
  sessionId?: string;
  projectPath?: string;
  tmuxSession?: string;
  prompt?: string;
  contextSummary?: string;
  reason?: string;
  question?: string;
  /** Recent tmux pane output (captured automatically for stop/session-end events) */
  tmuxTail?: string;
  /** Originating channel for reply routing (from OPENCLAW_REPLY_CHANNEL env var) */
  replyChannel?: string;
  /** Reply target user/bot (from OPENCLAW_REPLY_TARGET env var) */
  replyTarget?: string;
  /** Reply thread ID for threaded conversations (from OPENCLAW_REPLY_THREAD env var) */
  replyThread?: string;
}

/** Result of a gateway wake attempt */
export interface OpenClawResult {
  /** Gateway name */
  gateway: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** HTTP status code if available */
  statusCode?: number;
}
