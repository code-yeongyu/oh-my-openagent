// Releases a subscription at most once. Child subscriptions are released by two owners - the caller
// that subscribed (a task_output wait may release on settle AND on abort) and the manager's own
// sweep - so the raw handle detach must never run twice.
export function onceOnly(release: () => void): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    release()
  }
}
