import type { GuardRules } from "./remote-import-guard-check"

// Design "one remote module" v6, sections 1 and 12 (guard G1). L0 is the vendored relay-daemon local-API client, L1 the
// device service (device-service-core), L1m the vendored bunshin relay transport, L2 `omo-senpi/src/components/remote`.
const DEVICE_SERVICE_CORE = "packages/device-service-core/src/"
const LOCAL_API = "packages/device-service-core/src/local-api/"
const BUNSHIN_TS_RELAY = "packages/omo-senpi/vendor/bunshin-ts-relay/"
const REMOTE = "packages/omo-senpi/src/components/remote/"

// The surfaces of #13414 (thread tools, the omo remote CLI, the TUI's /remote under components/remote/tui) are thin callers
// of the one remote module: S3 lets them reach the remote layer only through its index, type-only imports included. A
// surface importing another surface file (the TUI's own files) is not reaching the layer. Scope: S3 sees direct static
// imports, require() and literal import() only; a route through another module, or bin/lib/thread.js loading built
// bundles by a non-literal import() (frozen by NON_LITERAL_IMPORT_OFFENDERS), is outside it.
const isRemoteSurface = (file: string): boolean =>
  file.startsWith("packages/omo-senpi/src/components/thread/") ||
  file.startsWith(`${REMOTE}tui/`) ||
  /^packages\/omo-native\/remote-[^/]+\.ts$/.test(file) ||
  file === "packages/omo-native/bin/lib/thread.js"

// Tests, test helpers and QA fakes are exempt from S1, S2 and S3 (v6 V6).
const isTestFile = (file: string): boolean =>
  file.endsWith(".test.ts") || file.split("/").some((segment) => segment === "test" || segment === "testing")

export const REMOTE_IMPORT_RULES: GuardRules = {
  testFile: isTestFile,
  s1: [
    // The QA fake device service speaks the local API on the service side.
    {
      target: LOCAL_API,
      allowedImporters: [DEVICE_SERVICE_CORE, "packages/omo-senpi/scripts/qa/bunshin-ts-fake-service.ts"],
    },
    { target: BUNSHIN_TS_RELAY, allowedImporters: [REMOTE] },
  ],
  s2Origins: [
    { names: ["connectDeviceService", "connectLocalApi", "openAttach"], modules: [DEVICE_SERVICE_CORE] },
    {
      names: ["createDeviceServiceSessions"],
      modules: [REMOTE],
    },
    { names: ["createRelayTransport"], modules: [BUNSHIN_TS_RELAY] },
  ],
  s2AllowedImporters: [
    DEVICE_SERVICE_CORE,
    REMOTE,
    // The three infrastructure callers of section 1: endpoint registration, sign-in hand-off, memory re-adopt/forget.
    "packages/device-service-core/src/registrant.ts",
    "packages/omo-native/device-service-handoff.ts",
    "packages/omo-senpi/src/components/memory/device-session/account-runtime.ts",
  ],
  s3: { surface: isRemoteSurface, layers: [DEVICE_SERVICE_CORE, REMOTE, BUNSHIN_TS_RELAY], entry: `${REMOTE}index.ts` },
}

type Offender = { readonly uses: readonly string[]; readonly removedBy: string }

// Offender lists may only shrink: the guard fails on a new entry AND on an entry that no longer offends, so the PR that
// removes a use also removes its row.
export const S1_OFFENDERS: Readonly<Record<string, Offender>> = {
  "packages/omo-senpi/src/extension/bunshin-ts-pick-transport.ts": {
    uses: [BUNSHIN_TS_RELAY],
    removedBy: "omo PR 4c-3",
  },
  "packages/omo-senpi/src/extension/bunshin-ts-sdk.ts": { uses: [BUNSHIN_TS_RELAY], removedBy: "omo PR 4c-3" },
}

export const S2_OFFENDERS: Readonly<Record<string, Offender>> = {
  "packages/omo-native/remote-cli.ts": { uses: ["createDeviceServiceSessions"], removedBy: "omo PR 4c-2" },
  "packages/omo-native/remote-local.ts": { uses: ["connectDeviceService"], removedBy: "omo PR 4c-1" },
  "packages/omo-native/remote-session-verbs.ts": { uses: ["createDeviceServiceSessions"], removedBy: "omo PR 4c-2" },
  "packages/omo-senpi/src/extension/bunshin-ts-pick-transport.ts": {
    uses: ["createRelayTransport"],
    removedBy: "omo PR 4c-3",
  },
  "packages/omo-senpi/src/extension/bunshin-ts-sdk.ts": { uses: ["createRelayTransport"], removedBy: "omo PR 4c-3" },
}

// S3 starts at today's surfaces; U5 and U6 move them onto components/remote/index.ts and remove their rows.
export const S3_OFFENDERS: Readonly<Record<string, Offender>> = {
  "packages/omo-native/remote-attach-dialogs.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-attach-presentation.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-attach.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-bootstrap.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-cli.ts": {
    uses: [DEVICE_SERVICE_CORE, REMOTE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-cold-wake.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-entry.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-local.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-render.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-native/remote-session-verbs.ts": {
    uses: [DEVICE_SERVICE_CORE, REMOTE],
    removedBy: "omo#13414 U6 (CLI + attach onto the module)",
  },
  "packages/omo-senpi/src/components/thread/consumer/device-service-port.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/attach-pool.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  // Part 4a-1 moved the thread tools' device-service port into the remote module (remote/port/): these two reach it there.
  "packages/omo-senpi/src/components/thread/live-surface.ts": {
    uses: [REMOTE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/default-remote.ts": {
    uses: [REMOTE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/outcome.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/ports.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/remote-ops.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
  "packages/omo-senpi/src/components/thread/remote/remote-watch.ts": {
    uses: [DEVICE_SERVICE_CORE],
    removedBy: "omo#13414 U5 (thread tools onto the module)",
  },
}

// Non-literal `import()` sites outside tests, frozen at their count per file (v6 section 12): any new one fails.
export const NON_LITERAL_IMPORT_OFFENDERS: Readonly<Record<string, number>> = {
  "packages/lsp-daemon/scripts/qa/cancellation-smoke.mjs": 6,
  "packages/lsp-daemon/scripts/qa/commit-barrier-smoke.mjs": 1,
  "packages/omo-codex/plugin/scripts/materialize-shared-upstreams.mjs": 2,
  "packages/omo-codex/plugin/skills/browser/scripts/omowright.mjs": 1,
  "packages/omo-codex/plugin/skills/lsp-setup/scripts/verify-lsp.ts": 1,
  "packages/omo-codex/scripts/install-generated-bundle.test.mjs": 1,
  "packages/omo-codex/scripts/install-local.mjs": 1,
  "packages/omo-native/bin/lib/category-coverage.js": 2,
  "packages/omo-native/bin/lib/computer-use-doctor.js": 1,
  "packages/omo-native/bin/lib/config-doctor.js": 1,
  "packages/omo-native/bin/lib/engine-boot.js": 5,
  "packages/omo-native/bin/lib/engine-models.js": 1,
  "packages/omo-native/bin/lib/host-status.js": 1,
  "packages/omo-native/bin/lib/launcher.js": 1,
  "packages/omo-native/bin/lib/model-chains.js": 1,
  // omo PR 4c-3 removes these three.
  "packages/omo-native/bin/lib/thread.js": 3,
  "packages/omo-native/compiled-diagnostic-runtime.ts": 1,
  "packages/omo-opencode/src/hooks/compaction-todo-preserver/hook.ts": 1,
  "packages/omo-opencode/src/tools/task/todo-sync.ts": 1,
  "packages/omo-senpi/plugin/scripts/build-extension-runtimes.test.mjs": 1,
  "packages/omo-senpi/plugin/scripts/build-extension.test.mjs": 1,
  "packages/omo-senpi/plugin/scripts/bundle-inputs.test.mjs": 1,
  "packages/omo-senpi/plugin/skills/browser/scripts/omowright.mjs": 1,
  "packages/omo-senpi/plugin/skills/lsp-setup/scripts/verify-lsp.ts": 1,
  "packages/omo-senpi/scripts/qa/agent-toolkit-catalog-qa.mjs": 1,
  "packages/omo-senpi/scripts/qa/fused-equivalence-e2e.mjs": 2,
  "packages/omo-senpi/scripts/qa/gateway-acceptance-trace.mjs": 1,
  "packages/omo-senpi/scripts/qa/lsp-e2e.mjs": 3,
  "packages/omo-senpi/scripts/qa/policy-continuation-e2e.mjs": 1,
  "packages/omo-senpi/scripts/qa/probe-cross-session.mjs": 2,
  "packages/omo-senpi/scripts/qa/task-14/version-capability.mjs": 3,
  "packages/omo-senpi/scripts/qa/task-host-e2e-gateway-cost.mjs": 1,
  "packages/omo-senpi/scripts/qa/task-host-e2e-mock-selftest.mjs": 1,
  "packages/omo-senpi/scripts/qa/task-rpc-e2e-scenarios.mjs": 3,
  "packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs": 3,
  "packages/omo-senpi/scripts/qa/task-rpc-reconcile-batch.mjs": 1,
  "packages/omo-senpi/scripts/qa/task-terminal-provider-error-qa.mjs": 4,
  "packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs": 2,
  "packages/omo-senpi/scripts/qa/thread-tools/lib/harness.mjs": 7,
  "packages/omo-senpi/scripts/qa/todo-fanout-reminder-e2e.mjs": 1,
  "packages/omo-senpi/src/components/computer-use/permission-registry.test-fixture.ts": 1,
  "packages/omo-senpi/src/components/init-deep-advisor/component.ts": 1,
  "packages/omo-senpi/src/components/lsp/daemon-tool-client.ts": 1,
  "packages/omo-senpi/src/components/onboarding/scan-component.ts": 1,
  "packages/omo-senpi/src/components/side-panel/index.ts": 1,
  "packages/omo-senpi/src/components/thread/gateway/extension-registrations.ts": 1,
  // A test fixture for the paged thread_read tests (#14053); it loads senpi's projector by a computed specifier.
  "packages/omo-senpi/src/components/thread/thread-remote-entries-fixture.ts": 1,
  // A child-process test fixture for hand-browser-placement.test.ts; it imports the engine entry by path like permission-registry.test-fixture.ts.
  "packages/omo-senpi/src/extension/hand-browser-placement.test-fixture.ts": 1,
  "packages/omo-senpi/src/senpi-test-runtime.ts": 12,
  "packages/omo-senpi/test-support/split-local-session.ts": 1,
  "packages/shared-skills/skills/browser/scripts/omowright.mjs": 1,
  "packages/shared-skills/skills/lsp-setup/scripts/verify-lsp.ts": 1,
  "packages/web/app/_components/localized-page-shell.tsx": 1,
  "packages/web/i18n/request.ts": 1,
}
