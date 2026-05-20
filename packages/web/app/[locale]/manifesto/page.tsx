import type { JSX } from "react"
import { HeroSection } from "@/components/manifesto/sections/hero"
import { PainPointsSection } from "@/components/manifesto/sections/pain-points"
import { IndistinguishableSection } from "@/components/manifesto/sections/indistinguishable"
import { TokenCostSection } from "@/components/manifesto/sections/token-cost"
import { CognitiveLoadSection } from "@/components/manifesto/sections/cognitive-load"
import { PrinciplesSection } from "@/components/manifesto/sections/principles"
import { CoreLoopSection } from "@/components/manifesto/sections/core-loop"
import { FutureSection } from "@/components/manifesto/sections/future"
import { FinalCtaSection } from "@/components/manifesto/sections/final-cta"
import { Separator } from "@/components/ui/separator"

export default async function ManifestoPage(): Promise<JSX.Element> {
  return (
    <main className="bg-background text-foreground min-h-screen overflow-x-hidden">
      <HeroSection />
      <PainPointsSection />
      <Separator className="mx-auto max-w-4xl opacity-20" />
      <IndistinguishableSection />
      <TokenCostSection />
      <CognitiveLoadSection />
      <PrinciplesSection />
      <Separator className="mx-auto max-w-4xl opacity-20" />
      <CoreLoopSection />
      <FutureSection />
      <FinalCtaSection />
    </main>
  )
}
