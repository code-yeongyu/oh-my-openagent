import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export default function captureSystemPrompt(pi) {
  pi.on("agent_start", (_, ctx) => {
    const role = process.env.SENPI_MEMORY_REFLECTION === "1" ? "reflection" : "parent"
    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), `live-driver-${role}-${process.pid}.system.txt`), ctx.getSystemPrompt())
  })
}
