import type { JSX, ReactNode } from "react"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import Script from "next/script"
import { gaMeasurementId, gaTrackedDomain, jsonLd } from "@/app/_components/site-metadata"
import { installDetectScript } from "@/lib/install-targets"
import "../globals.css"

/**
 * The one `<html>`/`<body>` of every root layout. `lang` is the route's BCP 47 tag, so the
 * document language matches the page (WCAG 3.1.1); body colours come from the base layer tokens.
 */
export function DocumentShell({
  lang,
  children,
}: {
  readonly lang: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <html
      lang={lang}
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      data-omo-build={process.env.OMO_WEB_BUILD_ID || undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: installDetectScript }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
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
