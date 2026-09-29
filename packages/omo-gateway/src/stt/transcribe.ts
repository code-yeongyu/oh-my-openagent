import { sonioxTranscribe } from "./soniox"

/** The `gateway.stt` config section (see packages/omo-config-core/src/schema/gateway.ts). */
export type SttConfig = { provider: string; credentials_env: string }

export type TranscribeResult = { text: string } | { unavailable: string }

/** The event text a voice message gets when no transcript could be produced. */
export const NO_TRANSCRIPT = "(voice message, no transcript)"

export type TranscriberOptions = {
  stt: SttConfig | undefined
  env?: Readonly<Record<string, string | undefined>>
  fetch?: typeof fetch
  baseUrl?: string
  pollIntervalMs?: number
  timeoutMs?: number
  log?: (line: string) => void
}

export type Transcriber = (bytes: Uint8Array, filename: string) => Promise<TranscribeResult>

const PROVIDERS = { soniox: { baseUrl: "https://api.soniox.com/v1", run: sonioxTranscribe } } as const

function isProvider(name: string): name is keyof typeof PROVIDERS {
  return Object.hasOwn(PROVIDERS, name)
}

function redact(message: string, secret: string): string {
  return secret === "" ? message : message.split(secret).join("<redacted>")
}

/**
 * Build the transcriber every adapter uses for audio attachments. Audio stays in memory: the bytes
 * go straight into the provider upload and are never written to disk. Every failure resolves to
 * `{ unavailable }` with one log line that never carries the credential.
 */
export function createTranscriber(options: TranscriberOptions): Transcriber {
  const log = options.log ?? ((line: string) => console.warn(line))
  return async (bytes, filename) => {
    const stt = options.stt
    if (stt === undefined) return { unavailable: "no gateway.stt configured" }
    if (!isProvider(stt.provider)) {
      log(`gateway stt: unknown provider ${stt.provider}`)
      return { unavailable: `unknown provider ${stt.provider}` }
    }
    const key = (options.env ?? process.env)[stt.credentials_env]?.trim() ?? ""
    if (key === "") {
      log(`gateway stt: ${stt.credentials_env} is not set`)
      return { unavailable: `${stt.credentials_env} is not set` }
    }
    const provider = PROVIDERS[stt.provider]
    try {
      const text = await provider.run({
        bytes,
        filename,
        key,
        baseUrl: options.baseUrl ?? provider.baseUrl,
        fetch: options.fetch ?? fetch,
        pollIntervalMs: options.pollIntervalMs ?? 1000,
        timeoutMs: options.timeoutMs ?? 180_000,
      })
      return { text }
    } catch (error) {
      const reason = redact(error instanceof Error ? error.message : String(error), key)
      log(`gateway stt: ${stt.provider} failed: ${reason}`)
      return { unavailable: reason }
    }
  }
}

/**
 * The InboundEvent `text` and `transcript` for a voice message. A transcript fills `transcript` and
 * stands in for empty text; no transcript leaves `transcript` null and appends the fallback line,
 * so a failed transcription never looks like an empty successful message.
 */
export function voiceFields(text: string, result: TranscribeResult): { text: string; transcript: string | null } {
  const original = text.trim()
  if ("text" in result && result.text.trim() !== "") {
    const transcript = result.text.trim()
    return { text: original === "" ? transcript : original, transcript }
  }
  return { text: original === "" ? NO_TRANSCRIPT : `${original}\n${NO_TRANSCRIPT}`, transcript: null }
}

/** Whether an attachment is audio the transcriber should receive. */
export function isAudioAttachment(attachment: { name: string; mime: string }): boolean {
  return attachment.mime.startsWith("audio/") || /\.(oga|ogg|opus|m4a|mp3|wav|webm)$/i.test(attachment.name)
}
