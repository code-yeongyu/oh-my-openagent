import type { GateRoute } from "./consent-gate-routes.test-support"
import type { WriterSite } from "./consent-gate-sites.test-support"

// Every writer site in the telemetry component, reviewed against the one consent gate,
// `isOmoNativeTelemetryEnabled` (#10226 H1). An entry is one call site: its file, enclosing
// function chain, the guards it runs under, and its call text. consent-gate.audit.test.ts fails
// when a site appears that no entry names, when an entry matches no site, or when a reason is empty.

export type ReviewedWriter = WriterSite & { readonly reason: string; readonly count?: number; readonly route?: GateRoute }

const LEGACY_DAILY_ACTIVE = "legacy daily-active; its only registered caller is omo-native-session after the gate"
const SESSION_START_PATH = "called only from the session_started path, after the gate"
const FAN_IN = "capture fan-in: reaches a transport only through the session client the gate created; opted-out hashes are dropped"
const THROUGH_FAN_IN = "hands the event to the component fan-in, which forwards only through the gated session client"
const NOTICE_MARKER = "claimNotice runs only after isOmoNativeTelemetryEnabled returned true"
const CONSENTED_RECORDER = "the session-summary recorder sends only when isConsented holds"
const GATE: GateRoute = { kind: "gate" }
const VIA_FAN_IN: GateRoute = { kind: "fan-in" }
const VIA_SESSION_CLIENT: GateRoute = { kind: "session-client" }
const GATE_OWNER = "the gate's owner: every writer runs after the isOmoNativeTelemetryEnabled early return"
const CRASH_CLAIMS = "crash claims run from the gated session_started path"
const IDENTITY_FILES = "salt and install id are created only by a gated hash or attribution call"
const SUMMARY_STORE = "written only by the consent-checked session-summary recorder"

export const REVIEWED_WRITERS: readonly ReviewedWriter[] = [
  {
    file: "lazy-posthog.ts", fn: "createLazyPostHogTransportFactory>=>>forward",
    guard: "",
    route: VIA_SESSION_CLIENT,
    call: "target.capture(message)",
    reason: "forwards only the captures admitted by the existing gated clients; the unchanged SDK fetch gate also checks delayed sends",
  },
  {
    file: "lazy-posthog.ts", fn: "createLazyPostHogTransportFactory>=>>load>=>",
    guard: "unless(module === undefined)",
    call: "module.createDefaultPostHogTransport(apiKey)",
    reason: "constructed only on the first admitted capture or a flush of its queue; receives the same consent-gated fetch and SDK options",
  },
  {
    file: "index.ts", fn: "recordSenpiDailyActive",
    guard: "",
    route: { kind: "callers", fn: "recordSenpiDailyActive" },
    call: "recordDailyActive(input)", reason: LEGACY_DAILY_ACTIVE,
  },
  {
    file: "index.ts", fn: "createSenpiTelemetryComponent>register>on(=>)",
    guard: "",
    route: { kind: "unregistered", exports: ["createSenpiTelemetryComponent", "omoSenpiTelemetryComponent"] },
    call: "recordSenpiDailyActive(options)", reason: LEGACY_DAILY_ACTIVE,
  },
  {
    file: "omo-native-category-config.ts", fn: "createCategoryConfigCapture>observe",
    guard: "unless(form === canonical)",
    route: VIA_SESSION_CLIENT,
    call: "options.captureEvent(\"category_config\")", reason: SESSION_START_PATH,
  },
  {
    file: "omo-native-component.ts", fn: "createOmoNativeTelemetryComponent>captureEvent",
    guard: "unless(state.isConsented?.() !== true) unless(properties.$session_id === OPTED_OUT_SESSION_HASH) if(isOmoNativeEventName(name))",
    route: GATE,
    call: "state.capture(name)", reason: FAN_IN,
  },
  {
    file: "omo-native-component.ts", fn: "installCaptureFacade",
    guard: "",
    call: "createEventTelemetryClient({ diagnostics: options.diagnostics, distinctId: template.dis)", reason: FAN_IN,
  },
  {
    file: "omo-native-component.ts", fn: "forwardValidatedCapture",
    guard: "",
    route: VIA_SESSION_CLIENT,
    call: "transport.capture(message)", reason: FAN_IN,
  },
  {
    file: "omo-native-computer-use.ts", fn: "registerOmoNativeComputerUseTelemetry>subscribe(=>)",
    guard: "",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"computer_use_activation\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-computer-use.ts", fn: "registerOmoNativeComputerUseTelemetry>subscribe(=>)",
    guard: "",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"computer_use_permission_denied\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-computer-use.ts", fn: "registerOmoNativeComputerUseTelemetry>subscribe(=>)",
    guard: "",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"computer_use_engine_error\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-crash.ts", fn: "captureProcessCrashes",
    guard: "",
    route: VIA_SESSION_CLIENT,
    call: "input.captureEvent(\"process_crashed\")", reason: SESSION_START_PATH,
  },
  {
    file: "omo-native-delegation.ts", fn: "createOmoNativeDelegationCapture>subscribe(=>)",
    guard: "",
    route: VIA_FAN_IN,
    call: "capture(options)", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-delegation.ts", fn: "capture",
    guard: "unless(emitted.has(key))",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"delegation_completed\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-kibitzer-summary.ts", fn: "registerOmoNativeKibitzerSummary>on(=>)",
    guard: "unless(sessionId === undefined) unless(snapshot === undefined) unless(properties === undefined)",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"kibitzer_summary\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-notice.ts", fn: "claimNotice",
    guard: "",
    call: "mkdirSync(stateDir)", reason: NOTICE_MARKER,
  },
  {
    file: "omo-native-notice.ts", fn: "claimNotice",
    guard: "",
    call: "writeFileSync(join(stateDir, MARKER_FILE_NAME))", reason: NOTICE_MARKER,
  },
  {
    file: "omo-native-parallel-summary.ts", fn: "registerOmoNativeParallelSummary>on(=>)",
    guard: "unless(sessionId === undefined) unless(snapshot === undefined) unless(properties === undefined)",
    route: VIA_FAN_IN,
    call: "captureEvent(\"parallelism_summary\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-prompt.ts", fn: "createOmoNativePromptComponent>register>emit",
    guard: "unless(prompt === undefined || completed.has(inputId))",
    route: VIA_FAN_IN,
    call: "options.client.captureEvent(\"prompt_submitted\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-session-summary.ts", fn: "createSessionSummaryRecorder>emit",
    guard: "",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"session_summary\")", reason: CONSENTED_RECORDER,
  },
  {
    file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart",
    guard: "unless(sessionClosed) unless(!isOmoNativeTelemetryEnabled(options, eventCtx, env))",
    call: "createEventTelemetryClient({ diagnostics: options.diagnostics, distinctId: attribution.)", reason: GATE_OWNER,
  },
  {
    file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart",
    guard: "unless(sessionClosed) unless(!isOmoNativeTelemetryEnabled(options, eventCtx, env)) unless(!client.enabled)",
    call: "getDailyActiveCaptureState({ diagnostics: options.diagnostics, now: options.now, stateD)", reason: GATE_OWNER,
  },
  {
    file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart",
    guard: "unless(sessionClosed) unless(!isOmoNativeTelemetryEnabled(options, eventCtx, env)) unless(!client.enabled) if(activity.captureDaily)",
    route: GATE,
    call: "client.captureEvent(\"daily_active\")", reason: GATE_OWNER,
  },
  {
    file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart",
    guard: "unless(sessionClosed) unless(!isOmoNativeTelemetryEnabled(options, eventCtx, env)) unless(!client.enabled)",
    route: GATE,
    call: "client.captureEvent(\"session_started\")", reason: GATE_OWNER,
  },
  {
    file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart",
    guard: "unless(sessionClosed) unless(!isOmoNativeTelemetryEnabled(options, eventCtx, env)) unless(!client.enabled)",
    route: GATE,
    call: "recordSenpiDailyActive({ env, now: options.now, osProvider, stateDir: getSenpiTelem)", reason: GATE_OWNER,
  },
  {
    file: "omo-native-tools.ts", fn: "registerOmoNativeToolTelemetry>on(=>)",
    guard: "unless(event === undefined) unless(sessionId === undefined) if(matchesToolName(event.toolName, \"read\") && !event.isError) if(skillName !== undefined)",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"skill_loaded\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-tools.ts", fn: "registerOmoNativeToolTelemetry>on(=>)",
    guard: "unless(event === undefined) unless(sessionId === undefined) unless(matchesToolName(event.toolName, \"read\") && !event.isError) if(matchesToolName(event.toolName, \"task\") && !event.isError)",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"delegation_started\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-tools.ts", fn: "registerOmoNativeToolTelemetry>on(=>)",
    guard: "unless(event === undefined) unless(sessionId === undefined) unless(matchesToolName(event.toolName, \"read\") && !event.isError) unless(matchesToolName(event.toolName, \"task\") && !event.isError) unless(feature === undefined) unless(used.has(feature))",
    route: VIA_FAN_IN,
    call: "options.captureEvent(\"feature_used\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "omo-native-turns.ts", fn: "createOmoNativeTurnHandler>=>",
    guard: "unless(event.message.role !== \"assistant\") if(options.summary.isRawTurnSampled(options.sessionId) && options.isConsented())",
    route: GATE,
    call: "options.client.captureEvent(\"turn_completed\")", reason: THROUGH_FAN_IN,
  },
  {
    file: "process-crash-records.ts", fn: "claimUnreportedCrashRecords",
    guard: "",
    call: "mkdirSync(claimDir)", reason: CRASH_CLAIMS,
  },
  {
    file: "process-crash-records.ts", fn: "claim",
    guard: "",
    call: "openSync(path)", reason: CRASH_CLAIMS,
  },
  {
    file: "process-crash-records.ts", fn: "pruneStaleClaims",
    guard: "if(now - statSync(path).mtimeMs > STALE_CLAIM_MS)",
    call: "rmSync(path)", reason: CRASH_CLAIMS,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateSalt",
    guard: "unless(persisted !== undefined)",
    call: "mkdirSync(getOmoNativeStateDir())", reason: IDENTITY_FILES,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateSalt",
    guard: "unless(persisted !== undefined)",
    call: "writeFileSync(path)", reason: IDENTITY_FILES,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateSalt",
    guard: "unless(persisted !== undefined) unless(concurrentlyCreated !== undefined)",
    call: "writeFileSync(path)", reason: IDENTITY_FILES,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateInstallId",
    guard: "unless(persisted !== undefined)",
    call: "mkdirSync(dirname(path))", reason: IDENTITY_FILES,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateInstallId",
    guard: "unless(persisted !== undefined)",
    call: "writeFileSync(path)", reason: IDENTITY_FILES,
  },
  {
    file: "product-identity.ts", fn: "readOrCreateInstallId",
    guard: "unless(persisted !== undefined) unless(concurrentlyCreated !== undefined)",
    call: "writeFileSync(path)", reason: IDENTITY_FILES,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>write",
    guard: "",
    call: "mkdirSync(dir)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>write",
    guard: "",
    call: "writeFileSync(temp)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>write",
    guard: "",
    call: "renameSync(temp)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>remove",
    guard: "",
    call: "rmSync(pathOf(sessionHash))", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>claimOrphans",
    guard: "if(leftover !== null) if(owner !== pid && !isAlive(owner))",
    call: "rmSync(path)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>claimOrphans",
    guard: "if(rollup !== undefined && now() - rollup.updatedAt > ROLLUP_TTL_MS)",
    call: "rmSync(path)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>claimOrphans",
    guard: "",
    call: "renameSync(path)", reason: SUMMARY_STORE,
  },
  {
    file: "session-summary-store.ts", fn: "createSummaryStore>claimOrphans",
    guard: "",
    call: "rmSync(claimPath)", reason: SUMMARY_STORE,
  },
]
