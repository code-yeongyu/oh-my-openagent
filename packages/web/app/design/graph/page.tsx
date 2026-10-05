import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { getMessages } from "next-intl/server"
import { GraphHero } from "@/components/landing/graph/graph-hero"

export default async function GraphDesignPage() {
  if (process.env.OMO_WEB_SHOWCASE !== "1") notFound()
  const messages = await getMessages()
  return (
    <NextIntlClientProvider messages={messages}>
      <section className="grid min-h-[100dvh] place-items-center">
        <GraphHero />
      </section>
    </NextIntlClientProvider>
  )
}
