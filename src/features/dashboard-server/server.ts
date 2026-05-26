import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http"
import { randomUUID } from "node:crypto"
import type { ActivityBus } from "../activity-bus"
import type { ActivityEvent } from "../activity-bus/types"
import type { DashboardClientMessage, DashboardServerConfig, DashboardServerMessage } from "./types"
import { DASHBOARD_HTML } from "./frontend"
import { AnalyticsEngine } from "../agent-analytics"

const HEARTBEAT_INTERVAL_MS = 30000
const MAX_MISSED_PONGS = 3
const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// @allow - simple SHA-1 for WebSocket handshake (Node.js built-in)
function sha1Base64(input: string): string {
  const crypto = require("node:crypto")
  return crypto.createHash("sha1").update(input).digest("base64")
}

function parseWebSocketKey(request: IncomingMessage): string | null {
  const key = request.headers["sec-websocket-key"]
  return typeof key === "string" ? key : null
}

function buildWebSocketAccept(key: string): string {
  return sha1Base64(key + WS_MAGIC_STRING)
}

function writeWebSocketFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf8")
  const payloadLen = payload.length
  let frame: Buffer

  if (payloadLen < 126) {
    frame = Buffer.allocUnsafe(2 + payloadLen)
    frame[0] = 0x81
    frame[1] = payloadLen
    payload.copy(frame, 2)
  } else if (payloadLen < 65536) {
    frame = Buffer.allocUnsafe(4 + payloadLen)
    frame[0] = 0x81
    frame[1] = 126
    frame.writeUInt16BE(payloadLen, 2)
    payload.copy(frame, 4)
  } else {
    frame = Buffer.allocUnsafe(10 + payloadLen)
    frame[0] = 0x81
    frame[1] = 127
    frame.writeBigUInt64BE(BigInt(payloadLen), 2)
    payload.copy(frame, 10)
  }

  return frame
}

function parseWebSocketFrame(buffer: Buffer): { message: string; consumed: number } | null {
  if (buffer.length < 2) return null

  const fin = (buffer[0] & 0x80) !== 0
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let payloadLen = buffer[1] & 0x7f
  let offset = 2

  if (payloadLen === 126) {
    if (buffer.length < 4) return null
    payloadLen = buffer.readUInt16BE(2)
    offset = 4
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null
    payloadLen = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }

  const maskLen = masked ? 4 : 0
  if (buffer.length < offset + maskLen + payloadLen) return null

  const mask = masked ? buffer.subarray(offset, offset + 4) : null
  offset += maskLen

  const payload = buffer.subarray(offset, offset + payloadLen)
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4]
    }
  }

  // Handle close frame
  if (opcode === 0x08) {
    return { message: "", consumed: offset + payloadLen }
  }

  // Handle ping frame
  if (opcode === 0x09) {
    return { message: "__ping__", consumed: offset + payloadLen }
  }

  // Text or binary frame
  if (opcode === 0x01 || opcode === 0x02) {
    return { message: payload.toString("utf8"), consumed: offset + payloadLen }
  }

  // Unknown opcode - skip
  return { message: "", consumed: offset + payloadLen }
}

type WebSocketClient = {
  id: string
  socket: import("node:stream").Duplex
  filter: string[] | null
  missedPongs: number
  heartbeatInterval: ReturnType<typeof setInterval> | null
  unsubscribe: (() => void) | null
  buffer: Buffer
}

export class DashboardServer {
  private server: Server | null = null
  private clients = new Map<string, WebSocketClient>()
  private config: DashboardServerConfig
  private activityBus: ActivityBus
  private _isRunning = false
  private actualPort = 0
  private analyticsEngine: AnalyticsEngine | null = null
  private analyticsBroadcastInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: DashboardServerConfig, activityBus: ActivityBus) {
    this.config = config
    this.activityBus = activityBus
  }

  isRunning(): boolean {
    return this._isRunning
  }

  getPort(): number {
    return this.actualPort
  }

  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error("DashboardServer is already running")
    }

    this.server = createServer((req, res) => {
      this.handleHttpRequest(req, res)
    })

    this.server.on("upgrade", (request, socket, head) => {
      this.handleWebSocketUpgrade(request, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error): void => {
        this.server?.off("error", handleError)
        reject(error)
      }

      this.server!.once("error", handleError)
      this.server!.once("listening", () => {
        this.server!.off("error", handleError)
        resolve()
      })

      this.server!.listen(this.config.port, this.config.host ?? "127.0.0.1")
    })

    const address = this.server.address()
    this.actualPort = typeof address === "object" && address !== null ? address.port : this.config.port
    this._isRunning = true

    // Start analytics engine
    this.analyticsEngine = new AnalyticsEngine(this.activityBus)
    this.analyticsEngine.start()

    // Broadcast analytics to all clients every 2s
    this.analyticsBroadcastInterval = setInterval(() => {
      if (!this.analyticsEngine || this.clients.size === 0) return
      const analytics = this.analyticsEngine.getSnapshot()
      for (const client of this.clients.values()) {
        this.sendToClient(client, {
          type: "snapshot",
          snapshot: { running: this.clients.size, queued: 0, analytics }
        })
      }
    }, 2000)
  }

  async stop(): Promise<void> {
    if (!this._isRunning || !this.server) {
      return
    }

    // Close all WebSocket clients
    for (const client of this.clients.values()) {
      this.cleanupClient(client)
    }
    this.clients.clear()

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve())
    })

    this.server = null
    this._isRunning = false
    this.actualPort = 0

    // Stop analytics engine
    this.analyticsEngine?.stop()
    this.analyticsEngine = null

    if (this.analyticsBroadcastInterval) {
      clearInterval(this.analyticsBroadcastInterval)
      this.analyticsBroadcastInterval = null
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost")

    if (req.method === "GET" && url.pathname === "/") {
      res.statusCode = 200
      res.setHeader("content-type", "text/html")
      res.end(DASHBOARD_HTML)
      return
      res.statusCode = 200
      res.setHeader("content-type", "text/html")
      res.end("Dashboard Server")
      return
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.statusCode = 200
      res.setHeader("content-type", "application/json")
      const health = {
        ok: true,
        running: this._isRunning,
        port: this.actualPort,
        clients: this.clients.size,
      }
      res.end(JSON.stringify(health))
      return
    }

    res.statusCode = 404
    res.setHeader("content-type", "text/plain")
    res.end("Not Found")
  }

  private handleWebSocketUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, _head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname !== "/ws") {
      socket.destroy()
      return
    }

    const key = parseWebSocketKey(request)
    if (!key) {
      socket.destroy()
      return
    }

    const accept = buildWebSocketAccept(key)

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
    )

    const clientId = randomUUID()
    const client: WebSocketClient = {
      id: clientId,
      socket,
      filter: null,
      missedPongs: 0,
      heartbeatInterval: null,
      unsubscribe: null,
      buffer: Buffer.alloc(0),
    }

    this.clients.set(clientId, client)

    // Send initial snapshot
    const busSnapshot = this.activityBus.getSnapshot()
    const analyticsSnapshot = this.analyticsEngine?.getSnapshot()
    this.sendToClient(client, {
      type: "snapshot",
      snapshot: { ...busSnapshot, analytics: analyticsSnapshot }
    })

    // Subscribe to activity bus
    client.unsubscribe = this.activityBus.onAny((event: ActivityEvent) => {
      this.sendToClient(client, { type: "event", data: event })
    })

    // Setup heartbeat
    client.heartbeatInterval = setInterval(() => {
      if (client.missedPongs >= MAX_MISSED_PONGS) {
        this.cleanupClient(client)
        this.clients.delete(clientId)
        return
      }
      client.missedPongs++
      // Send ping frame (opcode 0x09)
      const pingFrame = Buffer.from([0x89, 0x00])
      socket.write(pingFrame)
    }, HEARTBEAT_INTERVAL_MS)

    // Handle incoming data
    socket.on("data", (data: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, data])

      while (client.buffer.length > 0) {
        const result = parseWebSocketFrame(client.buffer)
        if (!result) break

        client.buffer = client.buffer.subarray(result.consumed)

        if (result.message === "__ping__") {
          // Respond with pong frame (opcode 0x0A)
          const pongFrame = Buffer.from([0x8a, 0x00])
          socket.write(pongFrame)
          continue
        }

        if (result.message === "") {
          // Close frame or empty message
          continue
        }

        try {
          const msg = JSON.parse(result.message) as DashboardClientMessage
          this.handleClientMessage(client, msg)
        } catch {
          this.sendToClient(client, { type: "error", error: "Invalid JSON" })
        }
      }
    })

    socket.on("close", () => {
      this.cleanupClient(client)
      this.clients.delete(clientId)
    })

    socket.on("error", () => {
      this.cleanupClient(client)
      this.clients.delete(clientId)
    })
  }

  private handleClientMessage(client: WebSocketClient, msg: DashboardClientMessage): void {
    switch (msg.type) {
      case "ping":
        this.sendToClient(client, { type: "pong" })
        break
      case "subscribe":
        client.filter = msg.filter ?? null
        break
      case "unsubscribe":
        client.filter = null
        break
    }
  }

  private sendToClient(client: WebSocketClient, msg: DashboardServerMessage): void {
    // Apply filter if set
    if (client.filter && msg.type === "event" && msg.data) {
      if (!client.filter.includes(msg.data.kind)) {
        return
      }
    }

    try {
      const frame = writeWebSocketFrame(JSON.stringify(msg))
      client.socket.write(frame)
    } catch {
      // Client disconnected
      this.cleanupClient(client)
      this.clients.delete(client.id)
    }
  }

  private cleanupClient(client: WebSocketClient): void {
    if (client.heartbeatInterval) {
      clearInterval(client.heartbeatInterval)
      client.heartbeatInterval = null
    }

    if (client.unsubscribe) {
      client.unsubscribe()
      client.unsubscribe = null
    }

    if (!client.socket.destroyed) {
      client.socket.destroy()
    }
  }
}
