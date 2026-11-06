import type { JSX, ReactNode } from "react"
import Script from "next/script"

import { gaMeasurementId, gaTrackedDomain, jsonLd } from "@/app/_components/site-metadata"
import { jetBrainsMono, timelessSans } from "@/components/home/fonts"
import { themeInitScript } from "@/components/home/theme-init"
import { installDetectScript } from "@/lib/install-targets"
// The site stylesheet first (Tailwind, the shared palette the workflow graph draws from), then the home page's own.
import "../../app/globals.css"
import "./styles/index.css"

/** The home page's <html>/<body>: its own fonts and stylesheet, the same analytics and JSON-LD as the docs shell. */
export function HomeDocument({
  lang,
  cjk,
  children,
}: {
  readonly lang: string
  readonly cjk: boolean
  readonly children: ReactNode
}): JSX.Element {
  return (
    <html
      lang={lang}
      className={`home ${timelessSans.variable} ${jetBrainsMono.variable}`}
      data-omo-build={process.env.OMO_WEB_BUILD_ID || undefined}
      suppressHydrationWarning
    >
      {/* eslint-disable-next-line @next/next/no-head-element -- an App Router root layout owns its <head>; next/head is Pages Router only */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: installDetectScript }} />
        {cjk ? (
          <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        ) : null}
        {cjk ? (
          <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
            crossOrigin="anonymous"
          />
        ) : null}
      </head>
      <body>
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
