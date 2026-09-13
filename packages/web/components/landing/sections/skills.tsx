import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { SKILLS } from "@/components/landing/story-data"
import { Ticker } from "@/components/landing/story-primitives"
import { Frame } from "@/components/ledger/frame"

export async function SkillsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")
  const rows = SKILLS.map((skill) => ({
    key: skill.name,
    content: (
      <div className="flex items-baseline gap-4">
        <code className="text-accent shrink-0 font-mono text-sm">{skill.name}</code>
        <span className="text-text-mid text-sm leading-[1.55]">{skill.blurb}</span>
      </div>
    ),
  }))

  return (
    <section
      data-section="skills"
      aria-labelledby="skills-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
          <Reveal className="lg:col-span-6">
            <SectionHeader
              id="skills-title"
              eyebrow="skills"
              title={t("skills.title")}
              intro={t("skills.body")}
            />
          </Reveal>
          <Reveal index={1} className="lg:col-span-6">
            <Ticker rows={rows} className="border-line bg-ink-1 max-h-[22rem] border px-5" />
          </Reveal>
        </div>
      </Frame>
    </section>
  )
}
