import type { Recorder } from "./recorder"

// The engine host's status as slice C1b's diagnostics core reads it (diagnostics-contract HostStatusPort): one
// host.status {all, include_workers} call, answered with the scenario's stated endpoint list, else none (no host running).
export function hostStatusPort(recorder: Recorder) {
  return {
    status: async (request: { readonly all: boolean; readonly include_workers: boolean }) => {
      const { result } = recorder.record("host", "status", { ...request })
      return { endpoints: [], ...(result as { readonly endpoints?: readonly unknown[] } | undefined) }
    },
  }
}
