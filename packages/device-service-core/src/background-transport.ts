import { createConnection, type Socket } from "node:net"
import { join } from "node:path"
import { SOCKET_FILE, tcpEndpoint, UNIX_ENDPOINT } from "./local-api/access.ts"
import { readEndpointPort, type Transport } from "./local-api/transport.ts"

// The vendored client's connectLocal with one difference: the socket is unref'd, so a long-lived engine-side
// connection (the agent-dir registrant) never keeps the process alive. The vendored transport has no such option.
const wrap = (socket: Socket, endpoint: string): Transport => {
  const closeListeners: (() => void)[] = []
  let closed = false
  socket.on("close", () => {
    closed = true
    for (const listener of closeListeners.splice(0)) listener()
  })
  // Node emits 'close' after every socket error; the close listeners are how a transport reports its end.
  socket.on("error", () => {})
  return {
    endpoint,
    write: (bytes) => {
      if (!closed) socket.write(bytes)
    },
    close: () => {
      socket.end()
    },
    destroy: () => {
      socket.destroy()
    },
    onData: (listener) => {
      socket.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
    },
    onClose: (listener) => {
      if (closed) listener()
      else closeListeners.push(listener)
    },
  }
}

export const connectLocalBackground = (stateDir: string): Promise<Transport> =>
  new Promise((resolve, reject) => {
    const port = process.platform === "win32" ? readEndpointPort(stateDir) : undefined
    const endpoint = port === undefined ? UNIX_ENDPOINT : tcpEndpoint(port)
    const socket =
      port === undefined
        ? createConnection({ path: join(stateDir, SOCKET_FILE) })
        : createConnection({ host: "127.0.0.1", port })
    socket.unref()
    socket.once("error", reject)
    socket.once("connect", () => {
      socket.off("error", reject)
      resolve(wrap(socket, endpoint))
    })
  })
