import { closeSync, openSync } from "node:fs"
import { ReadStream, WriteStream } from "node:tty"

import type { PhraseSurface } from "../memory-core/src/sync/genesis/phrase-bridge.ts"
import type { PhraseEntrySurface } from "../memory-core/src/sync/recovery/bridge-recover-phrase.ts"
import { TypedPhrase } from "../memory-core/src/sync/recovery/phrase.ts"

/**
 * The CLI's only phrase surface (A3 contract sec 7, review F5): the controlling terminal, opened directly. Words
 * are written there and nowhere else (never stdout, stderr or a logger) and typed there with echo off; argv, env,
 * stdin and pipes are never read for them. An agent harness or CI refuses before anything secret exists.
 */
export const AGENT_MARKERS = ["PI_CODING_AGENT", "AI_AGENT", "CI"] as const

export interface PhraseTerminal {
  write(text: string): void
  /** One line typed by the person; `secret` turns echo off while it is typed. Null when the terminal closed. */
  readLine(secret: boolean): Promise<string | null>
  close(): void
}

export type TerminalRefusal = { readonly refused: true; readonly why: "agent-marker" | "no-terminal" }

/** Exactly the three markers, by presence (any value, empty included); never a prefix match. */
export const agentMarkerSet = (env: Readonly<Record<string, string | undefined>>): boolean =>
  AGENT_MARKERS.some((name) => Object.hasOwn(env, name))

/** Whether a controlling terminal can be opened, without touching its mode (the refusal check, sec 7). */
export function controllingTerminalAvailable(): boolean {
  try {
    if (process.platform === "win32") closeSync(openSync("CONIN$", "r"))
    else closeSync(openSync("/dev/tty", "r+"))
    return true
  } catch {
    return false
  }
}

export function openControllingTerminal(): PhraseTerminal | null {
  let input: ReadStream
  let output: WriteStream
  try {
    if (process.platform === "win32") {
      input = new ReadStream(openSync("CONIN$", "r"))
      output = new WriteStream(openSync("CONOUT$", "w"))
    } else {
      const fd = openSync("/dev/tty", "r+")
      input = new ReadStream(fd)
      output = new WriteStream(fd)
    }
  } catch {
    return null
  }
  input.setRawMode(true)
  return terminalFromStreams(input, output, () => {
    input.setRawMode(false)
    input.destroy()
    output.end()
  })
}

/**
 * The line reader over a terminal's streams. Ctrl+C, Ctrl+D, end of input, a closed stream and a stream error
 * all cancel: every pending and later `readLine` resolves null (review LOW, #13337; before, only Ctrl+C did and
 * an EOF left the command hanging).
 */
export function terminalFromStreams(
  input: NodeJS.ReadableStream,
  output: { write(text: string): unknown },
  release: () => void = () => undefined,
): PhraseTerminal {
  let buffered = ""
  let echo = true
  let closed = false
  const lines: string[] = []
  const waiting: ((line: string | null) => void)[] = []
  const cancel = () => {
    closed = true
    buffered = ""
    for (const wake of waiting.splice(0)) wake(null)
  }
  input.setEncoding("utf8")
  input.on("data", (chunk: string) => {
    for (const char of chunk) {
      if (char === "\u0003" || char === "\u0004") return cancel()
      if (char === "\r" || char === "\n") {
        output.write("\r\n")
        const line = buffered
        buffered = ""
        const wake = waiting.shift()
        if (wake === undefined) lines.push(line)
        else wake(line)
      } else if (char === "\u007f" || char === "\b") buffered = buffered.slice(0, -1)
      else {
        buffered += char
        if (echo) output.write(char)
      }
    }
  })
  input.on("end", cancel)
  input.on("close", cancel)
  input.on("error", cancel)
  input.resume()
  return {
    write: (text) => void output.write(text),
    readLine: (secret) => {
      echo = !secret
      const queued = lines.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      if (closed) return Promise.resolve(null)
      return new Promise((resolve) => waiting.push(resolve))
    },
    close: () => {
      cancel()
      lines.length = 0
      input.pause()
      release()
    },
  }
}

const ALT_SCREEN_ON = "\u001b[?1049h\u001b[H\u001b[2J"
const ALT_SCREEN_OFF = "\u001b[2J\u001b[H\u001b[?1049l"

/**
 * The genesis/enrollment surface (show + 3-word check) and the recovery surface (enter), all on the terminal's
 * alternate screen, which is cleared and left on every exit. The account label comes from this CLI's own
 * signed-in session, never from the engine wire (C1).
 */
export function terminalPhraseSurface(
  terminal: PhraseTerminal,
  accountLabel: string,
): PhraseSurface & PhraseEntrySurface & { readonly done: () => void } {
  let onAlternate = false
  const enter = () => {
    if (!onAlternate) terminal.write(ALT_SCREEN_ON)
    onAlternate = true
  }
  const leave = () => {
    if (onAlternate) terminal.write(ALT_SCREEN_OFF)
    onAlternate = false
  }
  return {
    show: async (phrase) => {
      enter()
      terminal.write(
        `Save your recovery phrase for ${accountLabel}: these 24 words plus your OmO sign-in can read your synced memory. ` +
          "OmO cannot show them again. OmO will never ask you for these words.\r\n\r\n" +
          "Write them on paper. Do not copy them anywhere else.\r\nPress Enter to show the words (Ctrl+C cancels).\r\n",
      )
      if ((await terminal.readLine(true)) === null) return false
      const words = phrase.reveal()
      terminal.write(words.map((word, index) => `${String(index + 1).padStart(2)}. ${word}`).join("\r\n"))
      terminal.write("\r\n\r\nWhen they are written down, press Enter.\r\n")
      const confirmed = await terminal.readLine(true)
      terminal.write("\u001b[2J\u001b[H")
      return confirmed !== null
    },
    confirm: async (positions) => {
      terminal.write(`Type words ${positions.join(", ")} of your recovery phrase, separated by spaces:\r\n`)
      const line = await terminal.readLine(true)
      return line === null ? null : new TypedPhrase(line)
    },
    enter: async (retry) => {
      enter()
      if (retry !== null)
        terminal.write(
          retry.reason === "unknown-word"
            ? `Word ${retry.position} is not a recovery-phrase word. Try again.\r\n`
            : retry.reason === "wrong-word-count"
              ? "A recovery phrase has exactly 24 words. Try again.\r\n"
              : "Those words do not form a valid recovery phrase; check for a typo. Try again.\r\n",
        )
      terminal.write("Type your 24-word recovery phrase, then press Enter (Ctrl+C cancels):\r\n")
      const line = await terminal.readLine(true)
      return line === null ? null : new TypedPhrase(line)
    },
    done: leave,
  }
}

/**
 * Opens the terminal only when words are about to be shown or typed, so a join that never needs a phrase keeps
 * the terminal in its normal mode (Ctrl+C still interrupts). `done` restores the screen and closes it.
 */
export function lazyTerminalSurface(
  open: () => PhraseTerminal | null,
  accountLabel: string,
): PhraseSurface & PhraseEntrySurface & { readonly done: () => void } {
  let terminal: PhraseTerminal | null = null
  let surface: ReturnType<typeof terminalPhraseSurface> | null = null
  const ready = () => {
    if (surface === null) {
      terminal = open()
      if (terminal !== null) surface = terminalPhraseSurface(terminal, accountLabel)
    }
    return surface
  }
  return {
    show: async (phrase) => (await ready()?.show(phrase)) ?? false,
    confirm: async (positions) => (await ready()?.confirm(positions)) ?? null,
    enter: async (retry) => (await ready()?.enter(retry)) ?? null,
    done: () => {
      surface?.done()
      terminal?.close()
      surface = null
      terminal = null
    },
  }
}
