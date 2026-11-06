import type { Metadata, Viewport } from "next"
import { getStats, FALLBACK_DESCRIPTION } from "@/lib/stats"

const primarySiteUrl = "https://omo.dev"

export async function generateSiteMetadata(): Promise<Metadata> {
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh site metadata; using fallback description", error)
  }

  return {
    metadataBase: new URL(primarySiteUrl),
    title: {
      default: "OmO: Your tool for real work. But it's an agent.",
      template: "%s | OmO",
    },
    description,
    keywords: [
      "opencode",
      "oh-my-opencode",
      "openagent",
      "oh-my-openagent",
      "ai agent",
      "code agent",
      "multi-model",
      "team mode",
      "agent orchestration",
      "claude",
      "gpt",
      "coding assistant",
      "lazycodex",
      "lazycodex-ai",
      "codex cli",
      "codex plugin",
    ],
    authors: [{ name: "Yeongyu Kim", url: "https://github.com/code-yeongyu" }],
    creator: "Yeongyu Kim",
    alternates: {
      canonical: "/",
      languages: {
        en: "/",
        ko: "/ko",
        ja: "/ja",
        zh: "/zh",
        es: "/es",
        fr: "/fr",
        de: "/de",
        "pt-BR": "/pt-BR",
        it: "/it",
      },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      alternateLocale: ["ko_KR", "ja_JP", "zh_CN", "es_ES", "fr_FR", "de_DE", "pt_BR", "it_IT"],
      url: primarySiteUrl,
      siteName: "OmO",
      title: "OmO: Your tool for real work. But it's an agent.",
      description,
      // Next.js supplies the dynamic image from app/opengraph-image.tsx.
    },
    twitter: {
      card: "summary_large_image",
      title: "OmO: Your tool for real work. But it's an agent.",
      description,
      // app/twitter-image.tsx shares the Open Graph image generator.
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  }
}

export const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OmO",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  url: primarySiteUrl,
  author: {
    "@type": "Person",
    name: "Yeongyu Kim",
    url: "https://github.com/code-yeongyu",
  },
  description:
    "The batteries-included agent harness for OpenCode. Multi-model orchestration, Team Mode, background agents, 55 lifecycle hooks.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
}

export const gaMeasurementId = "G-S0QJFKT46Q"
export const gaTrackedDomain = "omo.dev"

/** The site is dark-only (DESIGN.md §2): form controls, scrollbars and autofill follow it before CSS loads. */
export const siteViewport: Viewport = { colorScheme: "dark" }
