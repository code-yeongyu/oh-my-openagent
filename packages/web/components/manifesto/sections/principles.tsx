import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"
import { Section } from "@/components/ui/section"

export async function PrinciplesSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")
  const principles = ["predictable", "continuous", "delegatable"] as const

  return (
    <Section data-section="manifesto-principles" className="mx-auto max-w-6xl">
      <div className="grid gap-8 md:grid-cols-3">
        {principles.map((key) => (
          <div
            key={key}
            className="bg-secondary/10 border-border/30 rounded-xl border p-6 text-center transition-colors"
          >
            <div className="mb-4 flex justify-center">
              <Image
                src={`/images/${key}.png`}
                alt={key}
                width={64}
                height={64}
                className="rounded-lg"
              />
            </div>
            <h3 className="mb-3 text-xl font-bold">{t(`principles.${key}.title`)}</h3>
            <p className="text-muted-foreground">{t(`principles.${key}.description`)}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
