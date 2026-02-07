import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import pc from "picocolors"
import type { ServerConnection } from "./types"
import { getAvailableServerPort, isPortAvailable, DEFAULT_SERVER_PORT } from "../../shared/port-utils"

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
      const { client, server } = await createOpencode({ signal, port, hostname: "127.0.0.1" })
      console.log(pc.dim("Server listening at"), pc.cyan(server.url))
      return { client, cleanup: () => server.close() }
    }

    console.log(pc.dim("Port"), pc.cyan(port.toString()), pc.dim("is occupied, attaching to existing server"))
    const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${port}` })
    return { client, cleanup: () => {} }
  }

  const { port: selectedPort, wasAutoSelected } = await getAvailableServerPort(DEFAULT_SERVER_PORT, "127.0.0.1")
  if (wasAutoSelected) {
    console.log(pc.dim("Auto-selected port"), pc.cyan(selectedPort.toString()))
  } else {
    console.log(pc.dim("Starting server on port"), pc.cyan(selectedPort.toString()))
  }
  const { client, server } = await createOpencode({ signal, port: selectedPort, hostname: "127.0.0.1" })
  console.log(pc.dim("Server listening at"), pc.cyan(server.url))
  return { client, cleanup: () => server.close() }
}
