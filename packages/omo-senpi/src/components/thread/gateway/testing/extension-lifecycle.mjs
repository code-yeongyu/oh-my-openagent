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
  try { retained.exec("INSERT INTO alpha_items VALUES (2, 'stale')") }
  catch (error) { return { code: error.code } }
}

export async function staleAsync() {
  let result
  try { result = retained.bindingFor({ platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat" }) }
  catch (error) { return { synchronous: true, code: error.code } }
  try { await result }
  catch (error) { return { synchronous: false, code: error.code } }
}

export function staleTimer() {
  setTimeout(() => retained.exec("INSERT INTO alpha_items VALUES (3, 'timer')"), 0)
  return null
}

export async function enqueuePair(tx, bindings) {
  const results = []
  for (const binding of bindings) {
    const bound = await tx.bind(binding)
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    results.push(await tx.enqueue({ binding_id: bound.binding.binding_id, event_id: binding.binding.chat_id, text: "hello" }))
  }
  return results
}

export function unawaitedEnqueue(tx, request) {
  tx.exec("INSERT INTO alpha_items VALUES (1, 'uncommitted')")
  void tx.enqueue(request)
  return "returned"
}

export async function hangAfterEnqueue(tx, binding) {
  const bound = await tx.bind(binding)
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const result = await tx.enqueue({ binding_id: bound.binding.binding_id, event_id: binding.binding.chat_id, text: "hello" })
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  return new Promise(() => {})
}

export async function rollbackAfterEnqueue(tx, binding) {
  const bound = await tx.bind(binding)
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const result = await tx.enqueue({ binding_id: bound.binding.binding_id, event_id: binding.binding.chat_id, text: "hello" })
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  throw new Error("the operation failed after its enqueue")
}

export function lateThrow() {
  setTimeout(() => { throw new Error("late extension throw") }, 0)
  return null
}

export function lateReject() {
  void Promise.reject(new Error("late extension rejection"))
  return null
}
