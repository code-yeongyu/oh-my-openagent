// Test fixture: a fake dori host registration. Every op appends one row to dori_calls, so a test
// counts real dispatches through the store instead of trusting the replay layer's own answer.

function dispatched(tx, op, args) {
  tx.exec("INSERT INTO dori_calls (op, args) VALUES (?, ?)", [op, JSON.stringify(args)])
  const row = tx.one(["n"], "SELECT count(*) AS n FROM dori_calls", [])
  return { op, dispatch_number: Number(row?.n ?? 0), caller: args.caller_session_durable_id }
}

export function replyMark(tx, args) {
  return dispatched(tx, "reply.mark", args)
}

export function sendPost(tx, args) {
  return dispatched(tx, "send.post", args)
}

export function ping() {
  return { pinged: true }
}

export const migrations = [["CREATE TABLE dori_calls (id INTEGER PRIMARY KEY, op TEXT NOT NULL, args TEXT NOT NULL)"]]
