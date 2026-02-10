import pc from "picocolors"
import type { OpencodeClient } from "./types"
import { serializeError } from "./events"

const SESSION_CREATE_MAX_RETRIES = 3
const SESSION_CREATE_RETRY_DELAY_MS = 1000

export async function resolveSession(options: {
  client: OpencodeClient
  sessionId?: string
}): Promise<string> {
  const { client, sessionId } = options

  if (sessionId) {
    const res = await client.session.get({ path: { id: sessionId } })
    if (res.error || !res.data) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return sessionId
  }

  for (let attempt = 1; attempt <= SESSION_CREATE_MAX_RETRIES; attempt++) {
    const res = await client.session.create({
      body: {
        title: "oh-my-opencode run",
        // In CLI run mode there's no TUI to answer questions.
        permission: [
          { permission: "question", action: "deny" as const, pattern: "*" },
        ],
      } as any,
    })

    if (res.error) {
      console.error(
        pc.yellow(`Session create attempt ${attempt}/${SESSION_CREATE_MAX_RETRIES} failed:`)
      )
      console.error(pc.dim(`  Error: ${serializeError(res.error)}`))

      if (attempt < SESSION_CREATE_MAX_RETRIES) {
        const delay = SESSION_CREATE_RETRY_DELAY_MS * attempt
        console.log(pc.dim(`  Retrying in ${delay}ms...`))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      continue
    }

    if (res.data?.id) {
      return res.data.id
    }

    console.error(
      pc.yellow(
        `Session create attempt ${attempt}/${SESSION_CREATE_MAX_RETRIES}: No session ID returned`
      )
    )

    if (attempt < SESSION_CREATE_MAX_RETRIES) {
      const delay = SESSION_CREATE_RETRY_DELAY_MS * attempt
      console.log(pc.dim(`  Retrying in ${delay}ms...`))
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error("Failed to create session after all retries")
}
