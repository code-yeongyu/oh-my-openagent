import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { startDashboardServer, stopDashboardServer, isDashboardRunning } from "./index"

const PORT = 18765

describe("Dashboard Web", () => {
  beforeAll(() => {
    startDashboardServer(PORT)
  })

  afterAll(() => {
    stopDashboardServer()
  })

  it("should report as running", () => {
    // when
    const running = isDashboardRunning()

    // then
    expect(running).toBe(true)
  })

  it("should serve health endpoint", async () => {
    // given
    const res = await fetch(`http://localhost:${PORT}/api/health`)
    const body = await res.json()

    // then
    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
    expect(body.data.status).toBe("ok")
  })

  it("should serve dashboard HTML", async () => {
    // given
    const res = await fetch(`http://localhost:${PORT}/`)
    const html = await res.text()

    // then
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(html).toContain("OMO Dashboard")
    expect(html).toContain("chart.js")
  })

  it("should return 404 for unknown routes", async () => {
    // given
    const res = await fetch(`http://localhost:${PORT}/api/unknown`)
    const body = await res.json()

    // then
    expect(body.ok).toBe(false)
    expect(res.status).toBe(404)
  })
})
