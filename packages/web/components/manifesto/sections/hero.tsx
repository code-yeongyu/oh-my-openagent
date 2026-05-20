import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"

export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <section
      data-section="manifesto-hero"
      className="relative flex min-h-[80dvh] flex-col items-center justify-center overflow-hidden px-6 pt-20 text-center"
    >
      <div className="absolute inset-0 z-0 opacity-20">
        <Image
          src="/images/core-loop.png"
          alt="Background"
          fill
          className="object-cover object-center"
          priority
        />
        <div className="from-background/80 via-background/90 to-background absolute inset-0 bg-gradient-to-b" />
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 relative z-10 mx-auto max-w-4xl space-y-6 duration-500">
        <Badge variant="outline" className="border-primary/50 text-primary mb-4 px-4 py-1 text-sm">
          {t("badge")}
        </Badge>
        <h1 className="from-foreground to-foreground/60 bg-gradient-to-b bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-7xl">
          {t("hero.title")}
        </h1>
        <p className="text-muted-foreground text-xl font-light tracking-wide md:text-2xl">
          {t("hero.subtitle")}
        </p>
      </div>
    </section>
  )
}
