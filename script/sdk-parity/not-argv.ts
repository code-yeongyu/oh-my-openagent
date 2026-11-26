// Literals the argv scan finds in reachable modules that are not this binary's argv: RPC record types, HTTP routes,
// the argv of a child process omo starts, another process's command line. Each is listed with its file and reason, and
// the list is exact both ways: a new finding that no row names and that is not here fails, and an entry the scan no
// longer finds fails, so the list only shrinks with the code.

type NotArgv = { readonly tokens: readonly string[]; readonly reason: string }

export const NOT_ARGV: Readonly<Record<string, NotArgv>> = {
  "packages/device-service-core/src/local-api/validate-command.ts": {
    tokens: ["alias", "device"],
    reason: "the local API's command target fields",
  },
  "packages/omo-native/bin/lib/doctor.js": {
    tokens: ["--internal-", "upgrade"],
    reason: "matches the command line of running engine processes, not omo's argv",
  },
  "packages/omo-native/bin/lib/reflection-lock.generated.js": {
    tokens: ["--batch", "-c"],
    reason: "arguments of the git child process the memory core runs",
  },
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/owner-marker.ts": {
    tokens: ["-a", "-s"],
    reason: "arguments of the macOS security child process",
  },
  "packages/omo-senpi/src/components/memory/desktop-sync/bootGate.ts": {
    tokens: ["--inspect"],
    reason: "reads NODE_OPTIONS of the running runtime",
  },
  "packages/omo-senpi/src/components/remote/sessions.ts": {
    tokens: ["device"],
    reason: "a session target's field",
  },
  "packages/omo-senpi/src/components/thread/endpoint-controls.ts": {
    tokens: [
      "extension_ui_response",
      "get_messages",
      "get_protocol_info",
      "get_state",
      "list_sessions",
      "rename",
      "set_model",
      "set_reasoning",
      "set_session_name",
      "subscribe",
    ],
    reason: "engine RPC record types",
  },
  "packages/omo-senpi/src/components/thread/gateway/store.ts": {
    tokens: ["--input-type"],
    reason: "filters the runtime's execArgv for a worker",
  },
  "packages/omo-senpi/src/components/thread/remote/alias-registry.ts": {
    tokens: ["claim", "of", "release", "rename", "resolve"],
    reason: "the alias service's HTTP routes",
  },
  "packages/senpi-desktop-engine/src/acquire.ts": {
    tokens: ["-musl"],
    reason: "a platform package name suffix",
  },
  "packages/senpi-task/src/runners/rpc-host/read-rpc-diagnostic.ts": {
    tokens: ["get_entries", "get_messages", "get_protocol_info", "list_sessions"],
    reason: "engine RPC record types",
  },
  "packages/utils/src/runtime/git-bash.ts": {
    tokens: ["--id", "--source", "-e"],
    reason: "arguments of the winget child process",
  },
}
