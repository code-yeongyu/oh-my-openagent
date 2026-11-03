import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { DocumentShell } from "@/app/_components/document-shell"
import { generateSiteMetadata, siteViewport } from "@/app/_components/site-metadata"
import { defaultLocale, languageTag } from "@/i18n/config"

// A root layout of its own since #11498, so it no longer inherits app/[locale]/layout.tsx's revalidate. Prerendered
// documents must keep initialRevalidateSeconds within next.config expireTime (3600); the deploy guard
// (scripts/retain-static-assets.mjs) rejects a build that leaves one at `false`.
export const revalidate = 3600
export const viewport = siteViewport

export function generateMetadata(): Promise<Metadata> {
  return generateSiteMetadata()
}

/** Root layout of the non-localized `/design` showcase (DESIGN.md §13). */
export default function DesignLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return <DocumentShell lang={languageTag(defaultLocale)}>{children}</DocumentShell>
}
