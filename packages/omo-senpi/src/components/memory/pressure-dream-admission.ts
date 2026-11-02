import type { ComponentLogger } from "../../extension/types"

export function createPressureDreamAdmission(options: {
  readonly request: (sessionId: string) => Promise<unknown>
  readonly logger?: ComponentLogger
}) {
  const deferred = new Set<string>()
  const request = (sessionId: string): void => {
    void options.request(sessionId).catch((error: unknown) => {
      options.logger?.warn("omo-senpi memory pressure dream trigger failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  return {
    reset(sessionId: string): void {
      deferred.delete(sessionId)
    },
    deferOrRequest(sessionId: string, admitted: boolean): void {
      if (!admitted) {
        deferred.add(sessionId)
        return
      }
      request(sessionId)
    },
    requestDeferred(sessionId: string): void {
      if (deferred.delete(sessionId)) request(sessionId)
    },
  }
}
