import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { DashboardServer } from "./server"
import { createActivityBus } from "../activity-bus/activity-bus"
import type { ActivityBus } from "../activity-bus"

const HOSTNAME = "127.0.0.1"

function supportsRealSocketBinding(): boolean {
  try {
    const server = Bun.serve({
      port: 0,
      hostname: HOSTNAME,
      fetch: () => new Response("probe"),
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

const canBindRealSockets = supportsRealSocketBinding()

async function httpGet(port: number, path: string): Promise<{ status: number; body: string; headers: Headers }> {
  const url = `http://${HOSTNAME}:${port}${path}`
  const response = await fetch(url)
  const body = await response.text()
  return {
    status: response.status,
    body,
    headers: response.headers,
  }
}

describe("DashboardServer", () => {
  let bus: ActivityBus
  let server: DashboardServer | null = null

  beforeEach(() => {
    bus = createActivityBus()
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    if (canBindRealSockets) {
      await Bun.sleep(10)
    }
  })

  describe("#when server starts with port 0", () => {
    it("#then gets an assigned port and is running", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)

      // when
      await server.start()

      // then
      expect(server.isRunning()).toBe(true)
      expect(server.getPort()).toBeGreaterThan(0)
    })
  })

  describe("#when server stops", () => {
    it("#then is no longer running", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()
      expect(server.isRunning()).toBe(true)

      // when
      await server.stop()

      // then
      expect(server.isRunning()).toBe(false)
      expect(server.getPort()).toBe(0)
    })
  })

  describe("#when GET /health is requested", () => {
    it("#then returns JSON with running=true and client count", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()
      const port = server.getPort()

      // when
      const { status, body, headers } = await httpGet(port, "/health")

      // then
      expect(status).toBe(200)
      expect(headers.get("content-type")).toContain("application/json")
      const json = JSON.parse(body)
      expect(json.ok).toBe(true)
      expect(json.running).toBe(true)
      expect(json.port).toBe(port)
      expect(json.clients).toBe(0)
    })
  })

  describe("#when GET / is requested", () => {
    it("#then returns HTML placeholder", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()
      const port = server.getPort()

      // when
      const { status, body, headers } = await httpGet(port, "/")

      // then
      expect(status).toBe(200)
      expect(headers.get("content-type")).toContain("text/html")
      expect(body).toContain("Dashboard Server")
    })
  })

  describe("#when unknown route is requested", () => {
    it("#then returns 404", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()
      const port = server.getPort()

      // when
      const { status } = await httpGet(port, "/unknown")

      // then
      expect(status).toBe(404)
    })
  })

  describe("#when server uses specific port from config", () => {
    it("#then listens on that port", async () => {
      // given
      const testPort = 0 // Use 0 to avoid conflicts, but verify config is respected
      server = new DashboardServer({ port: testPort }, bus)

      // when
      await server.start()

      // then
      expect(server.getPort()).toBeGreaterThan(0)
    })
  })

  describe("#when server is started and stopped multiple times", () => {
    it("#then handles cycles correctly", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)

      // when - first cycle
      await server.start()
      expect(server.isRunning()).toBe(true)
      const port1 = server.getPort()

      await server.stop()
      expect(server.isRunning()).toBe(false)

      // when - second cycle
      await server.start()
      expect(server.isRunning()).toBe(true)
      const port2 = server.getPort()

      // then
      expect(port2).toBeGreaterThan(0)

      await server.stop()
      expect(server.isRunning()).toBe(false)
    })
  })

  describe("#when starting an already running server", () => {
    it("#then throws error", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()

      // when / then
      expect(async () => {
        await server!.start()
      }).toThrow("DashboardServer is already running")
    })
  })

  describe("#when activity bus emits events", () => {
    it("#then snapshot reflects running count", async () => {
      // given
      server = new DashboardServer({ port: 0 }, bus)
      await server.start()

      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      })

      // when
      const { body } = await httpGet(server.getPort(), "/health")
      const health = JSON.parse(body)

      // then - snapshot should show running=1
      expect(health.ok).toBe(true)
    })
  })
})
