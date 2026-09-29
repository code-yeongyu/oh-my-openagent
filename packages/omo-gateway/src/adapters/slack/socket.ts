export type SocketHandlers = { onMessage(data: string): void; onClose(code: number): void; onError(message: string): void }
export type RealtimeSocket = { send(data: string): void; close(code: number): void }
export type SocketFactory = (url: string, headers: Readonly<Record<string, string>>, handlers: SocketHandlers) => RealtimeSocket

/** Bun's WebSocket with request headers (the RTM socket needs the `d` session cookie). */
export const webSocketFactory: SocketFactory = (url, headers, handlers) => {
  const ws = new WebSocket(url, { headers: { ...headers } })
  ws.addEventListener("message", (event) => handlers.onMessage(typeof event.data === "string" ? event.data : String(event.data)))
  ws.addEventListener("close", (event) => handlers.onClose(event.code))
  ws.addEventListener("error", () => handlers.onError("websocket error"))
  return { send: (data) => ws.send(data), close: (code) => ws.close(code) }
}
