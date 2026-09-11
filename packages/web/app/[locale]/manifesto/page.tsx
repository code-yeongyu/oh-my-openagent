import type { JSX } from "react"
import { Frame } from "@/components/ledger/frame"
import { HeroSection } from "@/components/manifesto/sections/hero"
import { PainPointsSection } from "@/components/manifesto/sections/pain-points"
import { IndistinguishableSection } from "@/components/manifesto/sections/indistinguishable"
import { TokenCostSection } from "@/components/manifesto/sections/token-cost"
import { CognitiveLoadSection } from "@/components/manifesto/sections/cognitive-load"
import { PrinciplesSection } from "@/components/manifesto/sections/principles"
import { CoreLoopSection } from "@/components/manifesto/sections/core-loop"
import { FutureSection } from "@/components/manifesto/sections/future"
import { FinalCtaSection } from "@/components/manifesto/sections/final-cta"

export default async function ManifestoPage(): Promise<JSX.Element> {
  return (
    <Frame as="div" className="bg-ink-0 text-text-hi">
      <HeroSection />
      <PainPointsSection />
      <IndistinguishableSection />
      <TokenCostSection />
      <CognitiveLoadSection />
      <PrinciplesSection />
      <CoreLoopSection />
      <FutureSection />
      <FinalCtaSection />
    </Frame>
  )
}
