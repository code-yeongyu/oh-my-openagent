const STATUS_REQUEST_TIMEOUT_MS = 5_000

/** One cancellable registry request, including transports that ignore abort. */
export class SessionStatusPoll {
  private active?: AbortController

  async read<T>(request: (options: { signal: AbortSignal; throwOnError: true }) => Promise<T>): Promise<T> {
    if (this.active) throw new Error("Previous session status request has not settled")

    const controller = new AbortController()
    this.active = controller
    let onAbort!: () => void
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    const response = Promise.resolve().then(() => request({ signal: controller.signal, throwOnError: true }))
    const release = (): void => {
      if (this.active === controller) this.active = undefined
    }
    // A deadline releases the poll, not the underlying request slot. An SDK
    // ignoring cancellation cannot accumulate another orphan on each tick.
    void response.then(release, release)
    const timer = setTimeout(() => {
      controller.abort(new Error("Session status request timed out"))
    }, STATUS_REQUEST_TIMEOUT_MS)
    try {
      const result = await Promise.race([response, aborted])
      if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
        throw result.error
      }
      const registry = result && typeof result === "object" && "data" in result ? result.data : result
      if (!registry || typeof registry !== "object" || Array.isArray(registry)
        || Object.values(registry).some((status: unknown) => !status || typeof status !== "object"
          || !("type" in status) || typeof status.type !== "string")) {
        throw new Error("Session status registry is unavailable")
      }
      return result
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener("abort", onAbort)
    }
  }

  cancel(): void {
    this.active?.abort(new Error("Session status polling stopped"))
  }
}
