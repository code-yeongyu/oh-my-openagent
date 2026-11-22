// The record the relay parity sweep (script/rpc-relay-parity-sweep.ts, #13478) sends for each engine method, the same
// record locally and through the relay. Methods come from the engine's own table; this file only supplies arguments.
// A method with no entry is sent with no arguments, so a method the engine adds is still probed (and its typed refusal
// compared) before anyone writes arguments for it.

export type Route = "session" | "endpoint"

export interface ProbeContext {
  /** The routing id of the leg's fixture session: the engine's on the local leg, the listing key through the relay. */
  readonly sessionId: string
}

type ProbeArgs = Readonly<Record<string, unknown>>

const NONE = "rpcpar-none"
const NO_PATH = "/nonexistent/rpcpar-none"
const NO_PROVIDER = "rpcpar-none"

/**
 * Destructive, credential and device-wide methods. They are probed, never skipped, but only in a form the engine must
 * refuse or that changes nothing: an id, provider or path that does not exist, or a value the schema rejects. Both legs
 * must give the same typed refusal.
 */
export const UNSAFE_TO_PROBE: ReadonlySet<string> = new Set([
  "close_session",
  "unload_session",
  "park_session",
  "claim_session",
  "attach_session",
  "fork",
  "switch_session",
  "import_jsonl",
  "write_project_file",
  "set_project_setting",
  "set_project_trust",
  "cleanup_bash_output",
  "login_start",
  "login_cancel",
  "login_api_key",
  "logout",
  "verify_api_key",
  "get_provider_accounts",
  "account_order",
  "account_pin",
  "account_remove",
  "account_reset",
  "test_provider_account",
  "set_favorite_models",
  "set_scoped_models",
  "cycle_model",
  "set_fast_mode",
  "set_steering_mode",
  "set_follow_up_mode",
  "set_auto_retry",
  "edit_assistant_message",
  "edit_user_message",
  "navigate_tree",
  "pause_for_run",
  "resume_for_run",
  "select_hand",
])

const ARGS: Readonly<Record<string, ProbeArgs>> = {
  get_effect_status: { effectId: NONE },
  get_model_thinking_level: { provider: "w4mock", modelId: "fixed" },
  get_media: { toolCallId: NONE, contentIndex: 0 },
  get_snapshot: { tail: 5 },
  get_entries: { tail: 5 },
  "eval_cells.peek": { cellId: NONE },
  "eval_cells.stop": { cellId: NONE },
  prompt: { message: "rpcpar parity probe: reply ok", expandPromptTemplates: false },
  steer: { message: "rpcpar parity steer" },
  follow_up: { message: "rpcpar parity follow-up" },
  dequeue_message: { queuedId: NONE },
  edit_queued_message: { queuedId: NONE, text: "rpcpar" },
  hold_input: { inputId: "rpcpar-hold", revision: 0, text: "rpcpar held input" },
  withdraw_held_input: { inputId: "rpcpar-hold" },
  append_user_message: { content: "rpcpar appended" },
  edit_user_message: { entryId: NONE, text: "rpcpar" },
  navigate_tree: { targetId: NONE },
  set_label: { entryId: NONE, label: "rpcpar" },
  set_session_name: { name: "rpcpar-fixture" },
  set_thinking_level: { level: "off", scope: "turn" },
  set_model: { provider: "w4mock", modelId: "fixed", scope: "session" },
  set_auto_compaction: { enabled: false },
  set_permission_preset: { permissionPreset: "ask" },
  set_retry_fallback: { retryFallback: NONE },
  pause_for_run: { parentSessionId: NONE, parentPauseSeq: 0, runRef: { kind: "task", id: NONE } },
  resume_for_run: { parentSessionId: NONE, parentPauseSeq: 0, resumeId: NONE, childSeqCutoff: 0 },
  wake: { delivery_ids: [] },
  append_session_entry: { entry: NONE },
  extension_ui_response: { id: NONE, cancelled: true },
  extension_ui_progress: { id: NONE },
  new_session: { parentSession: NO_PATH },
  claim_session: { cwd: NO_PATH },
  // A relative cwd is refused (open_failed: invalid_path) before anything is built; an absolute one parks a session.
  park_session: { cwd: "rpcpar-relative" },
  fork: { entryId: NONE },
  close_session: { sessionId: NONE },
  unload_session: { sessionId: NONE },
  set_session_context: { patch: { rpcpar: "1" } },
  attach_session: { sessionId: NONE, durableSessionId: NONE },
  select_hand: { device: null },
  bash: { command: "true", excludeFromContext: true },
  record_bash_result: { command: "true", result: NONE },
  cleanup_bash_output: { path: NO_PATH },
  extension_request: { name: NONE },
  resolve_path: { path: "." },
  login_start: { provider: NO_PROVIDER },
  login_cancel: { provider: NO_PROVIDER },
  login_api_key: { provider: NO_PROVIDER, key: NONE },
  logout: { provider: NO_PROVIDER },
  verify_api_key: { provider: NO_PROVIDER, key: NONE },
  get_provider_accounts: { provider: NO_PROVIDER },
  account_order: { provider: NO_PROVIDER, names: null },
  account_pin: { provider: NO_PROVIDER, name: null },
  account_remove: { provider: NO_PROVIDER, name: NONE },
  account_reset: { provider: NO_PROVIDER, name: NONE },
  test_provider_account: { provider: NO_PROVIDER, name: NONE },
  set_favorite_models: { models: NONE },
  set_scoped_models: { models: NONE },
  cycle_model: { direction: NONE },
  set_fast_mode: { enabled: NONE },
  set_steering_mode: { mode: NONE },
  set_follow_up_mode: { mode: NONE },
  set_auto_retry: { enabled: NONE },
  set_project_trust: { choice: NONE },
  set_project_setting: { key: NONE, value: null, expectedCwd: NO_PATH },
  read_project_file: { path: "rpcpar-none.txt" },
  write_project_file: { path: "rpcpar-none.txt", content: "", ifEtag: null, expectedCwd: NO_PATH },
  edit_assistant_message: { entryId: NONE, text: "rpcpar" },
  send_custom_message: { customType: "rpcpar", content: "rpcpar", display: false },
  switch_session: { sessionPath: `${NO_PATH}.jsonl` },
  import_jsonl: { inputPath: `${NO_PATH}.jsonl` },
  export_html: { outputPath: "/tmp/rpcpar-export.html" },
  export_jsonl: { outputPath: "/tmp/rpcpar-export.jsonl" },
}

/**
 * The record for `method` on `route`. The session route names the leg's fixture session as `sessionId` (unless the
 * arguments name another one, for the refusal they must get); the endpoint route sends the record with no session.
 */
export function probeRecord(method: string, route: Route, context: ProbeContext, id: string): Record<string, unknown> {
  const args = ARGS[method] ?? {}
  const routed = route === "session" && !("sessionId" in args) ? { sessionId: context.sessionId } : {}
  // extension_ui_* records carry the dialog id in `id`; every other record's `id` is the request id.
  return { id, ...routed, ...args, type: method }
}
