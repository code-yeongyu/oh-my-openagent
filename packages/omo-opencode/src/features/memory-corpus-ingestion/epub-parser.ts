import { unzipSync, strFromU8 } from "fflate"

import type { TextSection } from "./text-chunker"

export interface EpubParseInput {
  title?: string
  content: Uint8Array
}

export function parseEpub(input: EpubParseInput): TextSection[] {
  const entries = unzipSync(input.content)
  const containerXml = entries["META-INF/container.xml"]
  if (!containerXml) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found")
  }

  const opfPath = extractOpfPath(strFromU8(containerXml))
  const opfBytes = entries[opfPath]
  if (!opfBytes) {
    throw new Error(`Invalid EPUB: content.opf (${opfPath}) not found`)
  }

  const opfXml = strFromU8(opfBytes)
  const opfBase = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : ""
  const manifest = parseManifest(opfXml)
  const spine = parseSpine(opfXml)

  const sections: TextSection[] = []
  for (const idref of spine) {
    const item = manifest.get(idref)
    if (!item) continue
    const resolvedHref = resolveHref(opfBase, item.href)
    const entry = entries[resolvedHref]
    if (!entry) continue

    const xhtml = strFromU8(entry)
    const { heading, text } = extractTextFromXhtml(xhtml)
    if (!text.trim()) continue

    sections.push({
      heading: heading ?? input.title,
      text,
    })
  }

  if (sections.length === 0) {
    throw new Error("EPUB parsed but no readable text sections were found")
  }

  return sections
}

export function extractOpfPath(containerXml: string): string {
  const match = /<rootfile[^>]*\sfull-path="([^"]+)"/i.exec(containerXml)
  if (!match?.[1]) {
    throw new Error("Invalid container.xml: full-path attribute missing")
  }
  return match[1]
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
}

export function parseManifest(opfXml: string): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>()
  const itemPattern = /<item\b([^>]*)\/?>/gi
  let match = itemPattern.exec(opfXml)
  while (match !== null) {
    const attrs = match[1] ?? ""
    const id = attrAttr(attrs, "id")
    const href = attrAttr(attrs, "href")
    const mediaType = attrAttr(attrs, "media-type") ?? ""
    if (id && href) {
      manifest.set(id, { id, href, mediaType })
    }
    match = itemPattern.exec(opfXml)
  }
  return manifest
}

export function parseSpine(opfXml: string): string[] {
  const spineMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opfXml)
  if (!spineMatch?.[1]) return []

  const idrefs: string[] = []
  const itemRefPattern = /<itemref\b([^>]*)\/?>/gi
  let match = itemRefPattern.exec(spineMatch[1])
  while (match !== null) {
    const attrs = match[1] ?? ""
    const idref = attrAttr(attrs, "idref")
    if (idref) idrefs.push(idref)
    match = itemRefPattern.exec(spineMatch[1])
  }
  return idrefs
}

function attrAttr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}="([^"]+)"`, "i")
  const match = pattern.exec(attrs)
  return match?.[1]
}

function resolveHref(base: string, href: string): string {
  if (href.startsWith("/")) return href.slice(1)
  if (!base) return href
  const combined = `${base}${href}`
  return normalizePath(combined)
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}

export function extractTextFromXhtml(xhtml: string): { heading?: string; text: string } {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)
  const body = bodyMatch?.[1] ?? xhtml

  const headingMatch = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(body)
  const heading = headingMatch?.[1] ? stripTags(headingMatch[1]).trim() : undefined

  const text = stripTags(body)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()

  return {
    heading: heading || undefined,
    text,
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}
