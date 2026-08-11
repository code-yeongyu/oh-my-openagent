// Build-time resolution target for `@code-yeongyu/senpi` inside the omo-omp extension bundle.
//
// The senpi-task modules that the omo-omp task/team components reach (tool builders via defineTool,
// and the in-process child runner via createAgentSession/SessionManager/SettingsManager/
// createExtensionRuntime) import these members from the senpi ENGINE. That engine — model SDKs,
// jsdom, the interactive runtime, ~15 MB bundled — must never ride inside an omp extension: the omp
// host is a different harness with its own providers and TUI. The omp build's senpi-shim plugin
// (build-extension.mjs) rewrites every `@code-yeongyu/senpi` import to THIS module, which provides:
//
//   - defineTool: an identity. The tool builders construct record-shaped definitions
//     (name/description/parameters/handler) and the omp adapter's registerTool consumes the record
//     exactly as emitted. The senpi-side validation the real defineTool performs is redundant here
//     (the records are already valid) and the identity keeps the shape lossless.
//
//   - createAgentSession / SessionManager / SettingsManager / createExtensionRuntime: the senpi
//     in-process child runtime. The omp adapter deliberately never runs that path (task children are
//     real OMP sessions via the RPC process runner), so these throw a loud, specific error if some
//     future code path ever reaches them — never silently no-op.
export function defineTool<T>(tool: T): T {
  return tool
}

export function createAgentSession(): never {
  throw new Error(
    "omo-omp: the senpi in-process agent session engine is not available inside omp; task children run as OMP process sessions",
  )
}

export function SessionManager(): never {
  throw new Error(
    "omo-omp: the senpi in-process SessionManager is not available inside omp; task children run as OMP process sessions",
  )
}

export function SettingsManager(): never {
  throw new Error(
    "omo-omp: the senpi SettingsManager is not available inside omp; task children run as OMP process sessions",
  )
}

export function createExtensionRuntime(): never {
  throw new Error(
    "omo-omp: the senpi extension runtime is not available inside omp; task children run as OMP process sessions",
  )
}
