import { createConnection } from "node:net"

export class HostClient {
  static async connect(socketPath, label) {
    const socket = createConnection(socketPath)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`connect timeout ${socketPath}`)), 15_000)
      socket.once("connect", () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    return new HostClient(socket, label)
  }

  constructor(socket, label) {
    this.socket = socket
    this.label = label
    this.records = []
    this.waiters = new Set()
    this.buffer = ""
    this.sequence = 0
    socket.on("data", (chunk) => this.ingest(chunk.toString("utf8")))
  }

  ingest(text) {
    this.buffer += text
    for (;;) {
      const newline = this.buffer.indexOf("\n")
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      const index = this.records.length
      this.records.push(record)
      for (const waiter of [...this.waiters]) {
        if (index < waiter.from || !waiter.predicate(record)) continue
        clearTimeout(waiter.timer)
        this.waiters.delete(waiter)
        waiter.resolve(record)
      }
    }
  }

  mark() {
    return this.records.length
  }

  waitFor(predicate, from = 0, timeoutMs = 60_000) {
    for (let index = from; index < this.records.length; index += 1) {
      if (predicate(this.records[index])) return Promise.resolve(this.records[index])
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        from,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`[${this.label}] timeout waiting for record`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  async request(command, timeoutMs = 60_000) {
    this.sequence += 1
    const id = `${this.label}-${this.sequence}`
    const from = this.mark()
    this.socket.write(`${JSON.stringify({ id, ...command })}\n`)
    const response = await this.waitFor(
      (record) => record.type === "response" && record.id === id,
      from,
      timeoutMs,
    )
    if (response.success !== true) {
      throw new Error(`${command.type} failed: ${JSON.stringify(response.error ?? response)}`)
    }
    return response
  }

  async openSession(params) {
    const response = await this.request({ type: "open_session", ...params })
    return { routingId: response.data.sessionId, state: response.data.state }
  }

  async promptAndSettle(routingId, message, options = {}) {
    const from = this.mark()
    await this.request({ type: "prompt", sessionId: routingId, message, ...options })
    await this.waitFor(
      (record) => record.type === "agent_settled" && record.sessionId === routingId,
      from,
      120_000,
    )
  }

  close() {
    this.socket.destroy()
  }
}
