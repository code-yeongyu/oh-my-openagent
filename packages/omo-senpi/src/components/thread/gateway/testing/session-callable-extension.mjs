// Test fixture: a store extension whose ops a session may call through a declared tool.
// openThread records exactly the arguments the store handed it, so a test can prove which
// caller fields were stamped (and that a forged one never reached the op).

export function openThread(tx, args) {
  tx.exec("INSERT INTO gw_opens (args) VALUES (?)", [JSON.stringify(args)])
  if (args.await === true) return { opened: false, await_request_id: args.await_request_id }
  return { opened: true, received: args }
}

export function threadOpenStatus(tx, args) {
  const row = tx.one(["status"], "SELECT status FROM gw_requests WHERE id = ?", [args.await_request_id])
  return { status: row?.status ?? "pending", await_request_id: args.await_request_id, caller: args.caller_session_durable_id }
}

export function expireThreadOpen(tx, args) {
  tx.exec("INSERT INTO gw_requests (id, status) VALUES (?, 'refused') ON CONFLICT(id) DO UPDATE SET status = CASE WHEN status = 'pending' THEN 'refused' ELSE status END", [args.await_request_id])
  return { expired: true }
}

export function completeThreadOpen(tx, args) {
  tx.exec("INSERT INTO gw_requests (id, status) VALUES (?, 'opened') ON CONFLICT(id) DO UPDATE SET status = 'opened'", [args.await_request_id])
  return { completed: true }
}

export async function bindingsOf(tx, args) {
  return await tx.bindingsForSession(args.session)
}

export async function workItemStatus(tx, args) {
  if (args.work_item_id !== undefined) {
    const lead = tx.one(["lead"], "SELECT lead FROM gw_leads WHERE item = ?", [args.work_item_id])
    if (lead?.lead !== args.caller_session_durable_id) return { updated: false, reason: "not_item_lead" }
    tx.exec("INSERT INTO gw_items (binding_id, status) VALUES (?, ?) ON CONFLICT(binding_id) DO UPDATE SET status = excluded.status", [args.work_item_id, args.status])
    return { updated: true, binding_id: args.work_item_id }
  }
  const [binding] = await tx.bindingsForSession(args.caller_session_durable_id)
  if (binding === undefined) return { updated: false, reason: "no_binding" }
  tx.exec("INSERT INTO gw_items (binding_id, status) VALUES (?, ?) ON CONFLICT(binding_id) DO UPDATE SET status = excluded.status", [binding.binding_id, args.status])
  return { updated: true, binding_id: binding.binding_id }
}

export function sql(tx, args) {
  return tx.exec(args.sql, args.params ?? [])
}

export function failAfterWrite(tx, args) {
  tx.exec("INSERT INTO gw_opens (args) VALUES (?)", [JSON.stringify(args)])
  throw new Error("fixture rollback")
}

export const migrations = [[
  "CREATE TABLE gw_opens (id INTEGER PRIMARY KEY, args TEXT NOT NULL)",
  "CREATE TABLE gw_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_items (binding_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_leads (item TEXT PRIMARY KEY, lead TEXT NOT NULL)",
]]
