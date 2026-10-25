/**
 * A turn this handle asked the engine to start (a run Resume). Its agent_start re-arms turn
 * tracking like any new turn, but is consumed here so it is never announced as a self-resumed run.
 */
export function createTurnClaim() {
  let claimed: object | undefined
  return {
    claim(): () => void {
      const claim = {}
      claimed = claim
      return () => { if (claimed === claim) claimed = undefined }
    },
    consume(): boolean {
      if (claimed === undefined) return false
      claimed = undefined
      return true
    },
  }
}
