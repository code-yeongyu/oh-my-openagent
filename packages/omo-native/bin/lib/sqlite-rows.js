/**
 * Read rows from a SQLite database without creating a prepared statement.
 *
 * Bun 1.4's `node:sqlite` does not finalize outstanding `StatementSync` objects when
 * `DatabaseSync.close()` runs (oven-sh/bun#40001), so `sqlite3_close()` returns SQLITE_BUSY
 * and the file handle is retained until the statement object is garbage collected. On POSIX an
 * open handle does not block `unlink`, so this is invisible; on Windows it keeps the database
 * file locked, which makes the next open of the same file block and the temp root fail teardown
 * with EBUSY. `StatementSync` exposes no `finalize()`, so the only deterministic release is to
 * never create one: `exec()` with a user-defined SQL function as the row sink delivers every
 * row to JavaScript with zero statement objects, and `close()` then releases the handle.
 *
 * `columns` is the exact projection order; each row comes back as a plain object keyed by those
 * names. `sql` must be a complete SELECT whose projection matches `columns` in order.
 */
export function readRows(database, columns, sql) {
  const rows = []
  const sink = `omo_sink_${Math.random().toString(36).slice(2, 10)}`
  database.function(sink, { varargs: true, deterministic: false }, (...values) => {
    const row = {}
    columns.forEach((column, index) => { row[column] = values[index] })
    rows.push(row)
    return null
  })
  database.exec(`SELECT ${sink}(${columns.join(", ")}) FROM (${sql})`)
  return rows
}

/** First row of `readRows`, or undefined. */
export function readRow(database, columns, sql) {
  return readRows(database, columns, sql)[0]
}
