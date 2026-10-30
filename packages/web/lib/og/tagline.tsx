import { ogPalette } from "./palette"

interface Word {
  readonly text: string
  readonly quoted: boolean
}

function toWords(text: string): ReadonlyArray<Word> {
  const words: Word[] = []
  let quoted = false
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const opens = raw.startsWith('"')
    const closes = raw.length > 1 && /["”][.,;:!?]*$/.test(raw)
    if (opens) quoted = true
    words.push({ text: raw, quoted })
    if (closes) quoted = false
  }
  return words
}

export function OgTagline({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width: 720,
        maxHeight: 230,
        overflow: "hidden",
        fontFamily: "Geist",
        fontWeight: 500,
        fontSize: 54,
        lineHeight: 1.08,
        letterSpacing: -1.6,
        color: ogPalette.textHi,
      }}
    >
      {toWords(text).map((word, index) => (
        <span
          key={index}
          style={{
            color: word.quoted ? ogPalette.accent : ogPalette.textHi,
            marginRight: 12,
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  )
}
