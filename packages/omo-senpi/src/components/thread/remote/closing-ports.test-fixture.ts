import { afterEach } from "bun:test"
import { createDeviceServiceSessions } from "./device-service"
import type { RemoteSessionsPort } from "./ports"

type PortOptions = Parameters<typeof createDeviceServiceSessions>[0]

/**
 * The device-service port maker of one test file, whose every port is closed after each test: closing clears the
 * attach pool's idle detach timers, which would otherwise outlive the test and fire into a later one (#13873).
 */
export function closingPorts(): (options: PortOptions) => RemoteSessionsPort {
  const opened: RemoteSessionsPort[] = []
  afterEach(async () => {
    await Promise.all(opened.splice(0).map(async (port) => await port.close?.()))
  })
  return (options) => {
    const port = createDeviceServiceSessions(options)
    opened.push(port)
    return port
  }
}
