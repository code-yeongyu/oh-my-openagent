import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import Script from "next/script"
import { getStats, FALLBACK_DESCRIPTION } from "@/lib/stats"
import "./globals.css"

const primarySiteUrl = "https://omo.dev"

export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh site metadata; using fallback description", error)
  }

  return {
    metadataBase: new URL(primarySiteUrl),
    title: {
      default: "OmO — Your tool for real work. But it's an agent.",
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
      },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      alternateLocale: ["ko_KR", "ja_JP", "zh_CN"],
      url: primarySiteUrl,
      siteName: "OmO",
      title: "OmO — Your tool for real work. But it's an agent.",
      description,
      // Next.js supplies the dynamic image from app/opengraph-image.tsx.
    },
    twitter: {
      card: "summary_large_image",
      title: "OmO — Your tool for real work. But it's an agent.",
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

const jsonLd = {
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

const gaMeasurementId = "G-S0QJFKT46Q"
const gaTrackedDomain = "omo.dev"

export default function RootLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="flex min-h-screen flex-col bg-[#0a0a0a] text-[#ededed] antialiased">
        {process.env.NODE_ENV === "development" && (
          <>
            <Script
              src="//unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
            <Script
              src="//unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          </>
        )}
        <Script id="google-analytics-loader" strategy="lazyOnload">
          {`if (typeof window !== 'undefined' && window.location.hostname === '${gaTrackedDomain}') {
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}';
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${gaMeasurementId}', { cookie_domain: '${gaTrackedDomain}' });
}`}
        </Script>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  )
}
