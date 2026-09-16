import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import {
  ManifestoSection,
  PROSE_LIMIT,
  TITLE_CLASS,
} from "@/components/manifesto/manifesto-section"
import { ReadingParagraph } from "@/components/manifesto/reading/paragraph"

/** OpenAI, "On the Navier–Stokes Millennium Prize Problem" (September 2026). */
const MILLENNIUM_URL = "https://openai.com/index/navier-stokes-solution/"

const CHAPTERS = [
  { id: "yourWork", slug: "your-work", paragraphs: ["p1", "p2", "p3"] },
  { id: "ourTool", slug: "our-tool", paragraphs: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] },
  {
    id: "ourThinking",
    slug: "our-thinking",
    paragraphs: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  },
  { id: "tomorrow", slug: "tomorrow", paragraphs: ["p1", "p2"] },
] as const

type ChapterId = (typeof CHAPTERS)[number]["id"]
type ParagraphKey = (typeof CHAPTERS)[number]["paragraphs"][number]

export async function ManifestoChapters(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  const paragraph = (id: ChapterId, key: ParagraphKey): JSX.Element => {
    if (id === "ourThinking" && key === "p3") {
      return (
        <ReadingParagraph
          key={key}
          parts={[
            { text: t("chapters.ourThinking.p3Link"), href: MILLENNIUM_URL },
            { text: t("chapters.ourThinking.p3Rest") },
          ]}
        />
      )
    }
    return <ReadingParagraph key={key} text={t(`chapters.${id}.${key}`)} />
  }

  return (
    <>
      {CHAPTERS.map(({ id, slug, paragraphs }) => (
        <ManifestoSection
          key={id}
          data-section={`manifesto-${slug}`}
          labelledBy={`manifesto-${slug}-title`}
        >
          <div className={`${PROSE_LIMIT} space-y-10`}>
            <h2 id={`manifesto-${slug}-title`} className={TITLE_CLASS}>
              {t(`chapters.${id}.title`)}
            </h2>
            <div className="space-y-8">{paragraphs.map((key) => paragraph(id, key))}</div>
          </div>
        </ManifestoSection>
      ))}
    </>
  )
}
