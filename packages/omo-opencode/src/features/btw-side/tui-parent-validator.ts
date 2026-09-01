export function createBtwParentValidator(dependencies: {
  fetchStatus: (
    sessionID: string,
  ) => Promise<"exists" | "missing" | "retry">
}) {
  const deletedSessionIDs = new Set<string>()

  return {
    exists: async (sessionID: string): Promise<boolean> => {
      if (deletedSessionIDs.has(sessionID)) return false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const status = await dependencies.fetchStatus(sessionID)
        if (deletedSessionIDs.has(sessionID)) return false
        if (status === "exists") return true
        if (status === "missing") return false
      }
      return false
    },
    markDeleted: (sessionID: string): void => {
      deletedSessionIDs.add(sessionID)
    },
  }
}
