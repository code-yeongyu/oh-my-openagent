/**
 * The human summary `omo thread` prints without `--json`: one line per thread, binding, row or
 * transcript item. Scripts use `--json`; these lines are for a person and may change.
 */

function bindingLine(binding) {
  return `${binding.binding_id} r${binding.revision} ${binding.status} ${binding.platform}:${binding.account_id}/${binding.chat_id}/${binding.thread_id} -> ${binding.session_durable_id}`
}

function rowLine(row) {
  const token = row.reply_token === null ? "" : ` (reply token ${row.reply_token})`
  return `#${row.cursor} ${row.event} [${row.state}] ${row.text}${token}`
}

function modelLine(model) {
  if (model === null || model === undefined) return "model unknown"
  const level = model.thinking_level === null ? "" : `${model.thinking_level}, `
  const why = model.provenance === "auto" ? "auto" : model.provenance === "fallback" ? `fallback after ${model.reason ?? "a provider error"}` : `set by ${model.set_by ?? "user"}`
  return `model ${model.provider}/${model.id} (${level}${why})`
}

const RENDER = {
  list: (result) =>
    result.threads.length === 0
      ? [`no threads in ${result.scope === "all" ? "any workspace" : "this workspace"} (try --all-scope)`]
      : result.threads.map((thread) => `${thread.thread_id}  ${thread.surface ?? "?"}  ${thread.status}  ${thread.name || "(unnamed)"}  ${thread.cwd}`),
  create: (result) => [`created ${result.thread.thread_id} ${result.thread.name || "(unnamed)"}  ${modelLine(result.thread.model)}`],
  models: (result) => [
    ...(result.current === null ? [] : [`current: ${modelLine(result.current)}`]),
    ...result.available.map((entry) => `${entry.provider}/${entry.id}  ${entry.name}  thinking ${entry.thinking_levels.join(",") || "-"}`),
  ],
  "set-model": (result) => [
    `${result.thread_id}: ${modelLine(result.model)}`,
    ...(result.pending === undefined || result.pending === null ? [] : [`model ${result.pending.provider}/${result.pending.id} pending until the engine applies it`]),
    ...(result.superseded === undefined || result.superseded === null ? [] : [`model ${result.superseded.provider}/${result.superseded.id} not applied: another switch replaced it`]),
  ],
  "set-reasoning": (result) => [`${result.thread_id}: thinking ${result.level} (${result.scope})`],
  send: (result) => [`${result.delivery?.kind ?? "sent"}: delivery ${result.delivery_id} to ${result.thread_id}${result.deduplicated ? " (already sent)" : ""}`],
  read: (result) => [
    ...result.items.map((item) => `[${item.role}] ${item.content}`),
    ...(result.truncated ? [`(truncated; continue with --cursor ${result.next_cursor})`] : []),
  ],
  bind: (result) => [`bound ${bindingLine(result.binding)}${result.deduplicated ? " (already bound)" : ""}`],
  unbind: (result) => [`unbound ${bindingLine(result.binding)}${result.already_closed ? " (already closed)" : ""}`],
  rebind: (result) => [`rebound ${bindingLine(result.binding)}`],
  bindings: (result) => [...result.bindings.map(bindingLine), ...(result.next_cursor === null ? [] : [`(more: --cursor ${result.next_cursor})`])],
  report: (result) => [`reported ${result.event} to ${result.binding_id} at cursor ${result.cursor}${result.reply_token ? ` (reply token ${result.reply_token})` : ""}`],
  answer: (result) => [`answered through ${result.binding_id} (cursor ${result.cursor})`],
  outbox: (result) => [
    ...result.rows.map(rowLine),
    `next cursor ${result.next_cursor}, acked through ${result.acked === undefined || result.acked === null ? result.acked_cursor : result.acked.acked_cursor}`,
  ],
  ack: (result) => [`acked ${result.binding_id} through ${result.acked_cursor}${result.changed ? "" : " (no change)"}`],
}

export function humanLines(name, result) {
  return RENDER[name](result)
}
