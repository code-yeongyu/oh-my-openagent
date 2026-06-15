import { afterEach, describe, expect, it } from "bun:test"
import { createServer, type Server } from "node:http"
import { createConnection } from "node:net"
import { startCallbackServer } from "./callback-server"

const DEFAULT_CALLBACK_PORT = 19877
const HOSTNAME = "127.0.0.1"

let occupiedServer: Server | null = null

function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOSTNAME, port })
    let settled = false

    const finish = (occupied: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(occupied)
    }

    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.setTimeout(1_000, () => finish(false))
  })
}

function occupyPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((_request, response) => {
      response.statusCode = 200
      response.end("occupied")
    })
    server.once("error", reject)
    server.once("listening", () => {
      server.off("error", reject)
      occupiedServer = server
      resolve()
    })
    server.listen(port, HOSTNAME)
  })
}

function closeOccupiedPort(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!occupiedServer) {
      resolve()
      return
    }
    const server = occupiedServer
    occupiedServer = null
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

afterEach(async () => {
  await closeOccupiedPort()
})

describe("OAuth callback server port fallback", () => {
  it("#given default port is occupied #when starting server #then fallback port responds", async () => {
    // given
    if (!(await isPortOccupied(DEFAULT_CALLBACK_PORT))) {
      await occupyPort(DEFAULT_CALLBACK_PORT)
    }

    // when
    const callbackServer = await startCallbackServer()

    try {
      // then
      expect(callbackServer.port).toBeGreaterThan(DEFAULT_CALLBACK_PORT)
      const response = await fetch(`http://${HOSTNAME}:${callbackServer.port}/other`)
      expect(response.status).toBe(404)
    } finally {
      await callbackServer.close()
    }
  })
})
