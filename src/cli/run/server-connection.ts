import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import pc from "picocolors"
import type { ServerConnection } from "./types"
import { getAvailableServerPort, isPortAvailable, DEFAULT_SERVER_PORT } from "../../shared/port-utils"
import { withWorkingOpencodePath } from "./opencode-binary-resolver"

function isPortStartFailure(error: unknown, port: number): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes(`Failed to start server on port ${port}`)
}

function isPortRangeExhausted(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes("No available port found in range")
}

async function startServer(options: { signal: AbortSignal, port: number }): Promise<ServerConnection> {
  const { signal, port } = options
  const { client, server } = await withWorkingOpencodePath(() =>
    createOpencode({ signal, port, hostname: "127.0.0.1" }),
  )

  console.log(pc.dim("Server listening at"), pc.cyan(server.url))
  return { client, cleanup: () => server.close() }
}

export async function createServerConnection(options: {
  port?: number
  attach?: string
  signal: AbortSignal
}): Promise<ServerConnection> {
  const { port, attach, signal } = options

  if (attach !== undefined) {
    console.log(pc.dim("Attaching to existing server at"), pc.cyan(attach))
    const client = createOpencodeClient({ baseUrl: attach })
    return { client, cleanup: () => {} }
  }

  if (port !== undefined) {
    if (port < 1 || port > 65535) {
      throw new Error("Port must be between 1 and 65535")
    }

    const available = await isPortAvailable(port, "127.0.0.1")

    if (available) {
      console.log(pc.dim("Starting server on port"), pc.cyan(port.toString()))
      try {
        return await startServer({ signal, port })
      } catch (error) {
        if (!isPortStartFailure(error, port)) {
          throw error
        }

        const stillAvailable = await isPortAvailable(port, "127.0.0.1")
        if (stillAvailable) {
          throw error
        }

        console.log(pc.dim("Port"), pc.cyan(port.toString()), pc.dim("became occupied, attaching to existing server"))
        const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${port}` })
        return { client, cleanup: () => {} }
      }
    }

    console.log(pc.dim("Port"), pc.cyan(port.toString()), pc.dim("is occupied, attaching to existing server"))
    const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${port}` })
    return { client, cleanup: () => {} }
  }

  let selectedPort: number
  let wasAutoSelected: boolean
  try {
    const selected = await getAvailableServerPort(DEFAULT_SERVER_PORT, "127.0.0.1")
    selectedPort = selected.port
    wasAutoSelected = selected.wasAutoSelected
  } catch (error) {
    if (!isPortRangeExhausted(error)) {
      throw error
    }

    const defaultPortIsAvailable = await isPortAvailable(DEFAULT_SERVER_PORT, "127.0.0.1")
    if (defaultPortIsAvailable) {
      throw error
    }

    console.log(pc.dim("Port range exhausted, attaching to existing server on"), pc.cyan(DEFAULT_SERVER_PORT.toString()))
    const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${DEFAULT_SERVER_PORT}` })
    return { client, cleanup: () => {} }
  }

  if (wasAutoSelected) {
    console.log(pc.dim("Auto-selected port"), pc.cyan(selectedPort.toString()))
  } else {
    console.log(pc.dim("Starting server on port"), pc.cyan(selectedPort.toString()))
  }

  try {
    return await startServer({ signal, port: selectedPort })
  } catch (error) {
    if (!isPortStartFailure(error, selectedPort)) {
      throw error
    }

    const { port: retryPort } = await getAvailableServerPort(selectedPort + 1, "127.0.0.1")
    console.log(pc.dim("Retrying server start on port"), pc.cyan(retryPort.toString()))
    return await startServer({ signal, port: retryPort })
  }
}
