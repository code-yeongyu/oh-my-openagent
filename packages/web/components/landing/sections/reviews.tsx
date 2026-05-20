import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { Card, CardContent } from "@/components/ui/card"
import { Star } from "lucide-react"
import { REVIEW_KEYS } from "@/components/landing/constants"

export async function ReviewsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section className="border-t border-white/5 bg-[#0a0a0a] py-24" data-section="reviews">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div>
          <h2 className="mb-16 text-center text-4xl font-bold text-white md:text-5xl">
            {t("reviews.title")}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {REVIEW_KEYS.map((key) => (
            <div key={key}>
              <Card className="h-full border-zinc-800 bg-zinc-900/30">
                <CardContent className="pt-6">
                  <div className="mb-4 text-cyan-500">
                    <Star className="h-5 w-5 fill-cyan-500" />
                  </div>
                  <p className="mb-6 leading-relaxed text-zinc-300 italic">
                    &ldquo;{t(`reviews.${key}.text`)}&rdquo;
                  </p>
                  <p className="text-sm font-medium text-zinc-400">
                    — {t(`reviews.${key}.author`)}
                  </p>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
