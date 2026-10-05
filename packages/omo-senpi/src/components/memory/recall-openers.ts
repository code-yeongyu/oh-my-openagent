// Pick once per memory read; the host retains the classification across redraws.
export const RECALL_OPENER_MAX_CHARS = 40

export const DEFAULT_RECALL_OPENER = "Oh, right —"

export const RECALL_OPENERS: readonly string[] = [
  DEFAULT_RECALL_OPENER,
  "Right —",
  "Ah, right —",
  "Oh, that's right —",
  "Ah, that's right —",
  "Oh yes —",
  "Ah yes —",
  "Oh, wait, right —",
  "Wait, right —",
  "Oh, of course —",
  "Of course —",
  "Ah, of course —",
  "Right, of course —",
  "Wait —",
  "Oh wait —",
  "Hold on —",
  "Oh, hold on —",
  "Hang on —",
  "Oh, hang on —",
  "Hang on a second —",
  "Wait a second —",
  "Hold that thought —",
  "Actually, hold on —",
  "Actually, wait —",
  "Hmm, wait —",
  "That reminds me —",
  "This reminds me of something —",
  "Come to think of it —",
  "Now that I think about it —",
  "It just came back to me —",
  "This just came back to me —",
  "Something just came back to me —",
  "It's coming back to me —",
  "It's all coming back now —",
  "It just occurred to me —",
  "Something just occurred to me —",
  "This rings a bell —",
  "Wait, this rings a bell —",
  "That rings a bell —",
  "This sounds familiar —",
  "Wait, this is familiar —",
  "I've seen this before —",
  "Oh, I've seen this before —",
  "I've been here before —",
  "We've been here before —",
  "This came up before —",
  "This has come up before —",
  "Oh, this came up once —",
  "This one came up before —",
  "Oh, this again —",
  "Oh, this one —",
  "Right, this one —",
  "Oh, that one —",
  "Ah, that one —",
  "I know this one —",
  "Oh, I know this one —",
  "Hold on, I know this one —",
  "Wait, I know this —",
  "Oh, I know this —",
  "Ah, I know this —",
  "Oh, I made a note of this —",
  "I noted this once —",
  "There's a note on this —",
  "Oh, there's a note on this —",
  "I have a note on this —",
  "I wrote this down once —",
  "Oh, I wrote this down —",
  "This is in my notes —",
  "My notes say —",
  "I kept a note on this —",
  "I've got this on file —",
  "Oh, I have this on file —",
  "If I recall —",
  "If I recall correctly —",
  "As I recall —",
  "If memory serves —",
  "From what I recall —",
  "I seem to recall —",
  "I figured this out once —",
  "Oh, I'd figured this out before —",
  "I've worked this out before —",
  "I've been through this —",
  "Been through this before —",
  "I ran into this before —",
  "I've run into this before —",
  "Oh, I hit this before —",
  "I looked into this once —",
  "Oh, I looked this up before —",
  "Oh, there it is —",
  "Ah, there it is —",
  "There it is —",
  "Before I forget —",
  "Oh, before I forget —",
  "Oh, I almost forgot —",
  "Almost forgot —",
  "Nearly forgot —",
  "Oh, nearly forgot —",
  "Almost slipped my mind —",
  "This nearly slipped my mind —",
  "Oh, this slipped my mind —",
]

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

export function isValidOpener(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (value.length === 0 || value.length > RECALL_OPENER_MAX_CHARS) return false
  if (value.trim().length === 0) return false
  return !CONTROL_CHARACTER.test(value)
}

export interface RecallOpenerPicker {
  pick(sessionId: string): string
  forget(sessionId: string): void
}

export interface RecallOpenerPickerOptions {
  readonly random?: () => number
  readonly pool?: readonly string[]
}

export function createRecallOpenerPicker(options: RecallOpenerPickerOptions = {}): RecallOpenerPicker {
  const random = options.random ?? Math.random
  const pool = options.pool ?? RECALL_OPENERS
  const lastBySession = new Map<string, string>()

  function clampedIndex(): number {
    const raw = Math.floor(random() * pool.length)
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), pool.length - 1) : 0
  }

  return {
    pick(sessionId) {
      let index = clampedIndex()
      if (pool.length > 1 && pool[index] === lastBySession.get(sessionId)) index = (index + 1) % pool.length
      const opener = pool[index] ?? DEFAULT_RECALL_OPENER
      lastBySession.set(sessionId, opener)
      return opener
    },
    forget(sessionId) {
      lastBySession.delete(sessionId)
    },
  }
}
