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

  let lastError: unknown
  for (let attempt = 1; attempt <= SESSION_CREATE_MAX_RETRIES; attempt++) {
    const res = await client.session.create({
      body: { title: "oh-my-opencode run" },
    })

    if (res.error) {
      lastError = res.error
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

    lastError = new Error(
      `Unexpected response: ${JSON.stringify(res, null, 2)}`
    )
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
