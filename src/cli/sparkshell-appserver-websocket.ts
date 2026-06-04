import { randomBytes } from "node:crypto"
import { createConnection, type Socket } from "node:net"

const SOCKET_READ_BUFFERS = new WeakMap<Socket, Buffer>()

export async function connectUnixWebSocket(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath)
  await new Promise<void>((resolveConnect, rejectConnect) => {
    socket.once("connect", resolveConnect)
    socket.once("error", rejectConnect)
  })
  const key = randomBytes(16).toString("base64")
  socket.write(
    [
      "GET /rpc HTTP/1.1",
      "Host: localhost",
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${key}`,
      "",
      "",
    ].join("\r\n"),
  )
  await readHttpUpgrade(socket)
  return socket
}

export function writeWebSocketText(socket: Socket, payload: string): void {
  const body = Buffer.from(payload)
  const mask = randomBytes(4)
  const length = body.length
  const header = createTextFrameHeader(length)
  const masked = Buffer.alloc(body.length)
  for (let index = 0; index < body.length; index += 1) {
    masked[index] = (body[index] ?? 0) ^ (mask[index % 4] ?? 0)
  }
  socket.write(Buffer.concat([header, mask, masked]))
}

export async function readWebSocketText(socket: Socket): Promise<string> {
  let frame = await readSocketChunk(socket)
  frame = await readAtLeast(socket, frame, 2)
  const opcode = frame[0] ?? 0
  const initialLength = frame[1] ?? 0
  if ((opcode & 0x0f) === 0x08) {
    throw new Error("appserver websocket closed")
  }
  let offset = 2
  let length = initialLength & 0x7f
  if (length === 126) {
    frame = await readAtLeast(socket, frame, offset + 2)
    length = frame.readUInt16BE(offset)
    offset += 2
  } else if (length === 127) {
    frame = await readAtLeast(socket, frame, offset + 8)
    const extendedLength = frame.readBigUInt64BE(offset)
    if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("appserver websocket message is too large")
    }
    length = Number(extendedLength)
    offset += 8
  }
  frame = await readAtLeast(socket, frame, offset + length)
  const endOffset = offset + length
  bufferUnreadSocketBytes(socket, frame.subarray(endOffset))
  return frame.subarray(offset, endOffset).toString("utf8")
}

function createTextFrameHeader(length: number): Buffer {
  if (length < 126) {
    return Buffer.from([0x81, 0x80 | length])
  }
  if (length <= 0xffff) {
    return Buffer.from([0x81, 0xfe, (length >> 8) & 0xff, length & 0xff])
  }
  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 0xff
  header.writeBigUInt64BE(BigInt(length), 2)
  return header
}

async function readHttpUpgrade(socket: Socket): Promise<void> {
  let buffer = Buffer.alloc(0)
  while (!buffer.includes("\r\n\r\n")) {
    buffer = Buffer.concat([buffer, await readSocketChunk(socket)])
  }
  const header = buffer.toString("utf8")
  if (!header.startsWith("HTTP/1.1 101")) {
    throw new Error("appserver websocket upgrade failed")
  }
  const headerEnd = buffer.indexOf("\r\n\r\n") + 4
  bufferUnreadSocketBytes(socket, buffer.subarray(headerEnd))
}

async function readSocketChunk(socket: Socket): Promise<Buffer> {
  const buffered = SOCKET_READ_BUFFERS.get(socket)
  if (buffered && buffered.length > 0) {
    SOCKET_READ_BUFFERS.delete(socket)
    return buffered
  }
  const existing = socket.read()
  if (Buffer.isBuffer(existing)) {
    return existing
  }
  return await new Promise<Buffer>((resolveRead, rejectRead) => {
    const cleanup = (): void => {
      socket.off("data", onData)
      socket.off("error", onError)
      socket.off("end", onEnd)
      socket.off("close", onClose)
    }
    const onData = (chunk: Buffer): void => {
      cleanup()
      resolveRead(chunk)
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectRead(error)
    }
    const onEnd = (): void => {
      cleanup()
      rejectRead(new Error("appserver websocket ended"))
    }
    const onClose = (): void => {
      cleanup()
      rejectRead(new Error("appserver websocket closed"))
    }
    socket.once("data", onData)
    socket.once("error", onError)
    socket.once("end", onEnd)
    socket.once("close", onClose)
  })
}

async function readAtLeast(socket: Socket, initial: Buffer, byteLength: number): Promise<Buffer> {
  let buffer = initial
  while (buffer.length < byteLength) {
    buffer = Buffer.concat([buffer, await readSocketChunk(socket)])
  }
  return buffer
}

function bufferUnreadSocketBytes(socket: Socket, unread: Buffer): void {
  if (unread.length === 0) return
  const existing = SOCKET_READ_BUFFERS.get(socket)
  SOCKET_READ_BUFFERS.set(socket, existing ? Buffer.concat([existing, unread]) : unread)
}
