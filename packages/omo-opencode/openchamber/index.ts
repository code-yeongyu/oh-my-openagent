import { publishOpenChamberState, type OpenChamberHost } from "../src/v2/openchamber-state"

export const capabilities = ["files", "sessions"] as const

export async function activate(host: OpenChamberHost & {
  readFile: (path: string) => Promise<string>
}): Promise<void> {
  await publishOpenChamberState({ host, readFile: (path) => host.readFile(path) })
}
