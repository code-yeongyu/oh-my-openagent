import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Inter, Manrope } from "next/font/google"
import Script from "next/script"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
})

const primarySiteUrl = "https://ohmyopenagent.com"

export const metadata: Metadata = {
  metadataBase: new URL(primarySiteUrl),
  title: {
    default: "Oh My OpenAgent — The Best Agent Harness",
    template: "%s | Oh My OpenAgent",
  },
  description:
    "Meet Sisyphus: The batteries-included agent that codes like you. Multi-model orchestration, background agents, 40+ lifecycle hooks.",
  keywords: [
    "opencode",
    "oh-my-opencode",
    "openagent",
    "oh-my-openagent",
    "ai agent",
    "code agent",
    "sisyphus",
    "multi-model",
    "claude",
    "gpt",
    "gemini",
    "coding assistant",
  ],
  authors: [{ name: "Yeongyu Kim", url: "https://github.com/code-yeongyu" }],
  creator: "Yeongyu Kim",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: primarySiteUrl,
    siteName: "Oh My OpenAgent",
    title: "Oh My OpenAgent — The Best Agent Harness",
    description:
      "Meet Sisyphus: The batteries-included agent that codes like you. Multi-model orchestration, background agents, 40+ lifecycle hooks.",
    images: [{ url: "/images/hero.png", width: 1200, height: 630, alt: "Oh My OpenAgent" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Oh My OpenAgent — The Best Agent Harness",
    description: "Meet Sisyphus: The batteries-included agent that codes like you.",
    images: ["/images/hero.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Oh My OpenAgent",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  url: primarySiteUrl,
  author: {
    "@type": "Person",
    name: "Yeongyu Kim",
    url: "https://github.com/code-yeongyu",
  },
  description:
    "The batteries-included agent harness for OpenCode. Multi-model orchestration, background agents, 40+ lifecycle hooks.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
}

const gaMeasurementId = "G-S0QJFKT46Q"
const gaTrackedDomain = "ohmyopenagent.com"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col bg-[#0a0a0a] text-[#ededed] antialiased">
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaMeasurementId}', { cookie_domain: '${gaTrackedDomain}' });`}
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
