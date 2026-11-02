import { watch } from "node:fs"

// This is a failure deadline, not an observation window. Subscribe before triggering work and
// return on the product transition; an idle machine never pays the loaded-machine allowance.
export const STATE_DEADLINE_MS = Number(process.env.TASK_HOST_E2E_OBSERVE_MS) || 600_000

export function observeState(root, probe, { trigger = () => {}, timeoutMs = STATE_DEADLINE_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let checking = false
    let dirty = false
    let watcher
    let timer
    const finish = (value, error) => {
      if (settled) return
      settled = true
      watcher?.close()
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const check = async () => {
      dirty = true
      if (checking || settled) return
      checking = true
      try {
        while (dirty && !settled) {
          dirty = false
          const value = await probe()
          if (value) finish(value)
        }
      } catch (error) {
        finish(undefined, error)
      } finally {
        checking = false
      }
    }
    watcher = watch(root, { recursive: true }, check)
    watcher.on("error", (error) => finish(undefined, error))
    timer = setTimeout(() => finish(undefined), timeoutMs)
    try {
      trigger()
      void check()
    } catch (error) {
      finish(undefined, error)
    }
  })
}

export async function stopParent(parent) {
  if (!parent) return
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  await parent.closed
}
