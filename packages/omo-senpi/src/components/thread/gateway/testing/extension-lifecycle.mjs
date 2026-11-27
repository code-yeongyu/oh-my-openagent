export * from "./store-extension.mjs"

let retained

export function hang(tx) {
  tx.exec("INSERT INTO alpha_items VALUES (1, 'uncommitted')")
  return new Promise(() => {})
}

export function retain(tx) {
  retained = tx
  return null
}

export function staleSync() {
  try {
    retained.exec("INSERT INTO alpha_items VALUES (2, 'stale')")
  } catch (error) {
    return { code: error.code }
  }
}

export function staleTimer() {
  setTimeout(() => retained.exec("INSERT INTO alpha_items VALUES (3, 'timer')"), 0)
  return null
}

export function lateThrow() {
  setTimeout(() => {
    throw new Error("late extension throw")
  }, 0)
  return null
}

export function lateReject() {
  void Promise.reject(new Error("late extension rejection"))
  return null
}
