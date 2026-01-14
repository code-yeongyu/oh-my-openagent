/**
 * Content extractor for pulling main documentation content from HTML pages
 */

export interface ExtractedContent {
  title: string
  content: string
  description?: string
  keywords?: string[]
}

/**
 * CSS selectors for finding main content (in priority order)
 */
const CONTENT_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  ".main-content",
  ".content",
  ".docs-content",
  ".documentation",
  ".markdown-body",
  "#content",
  "#main",
  ".post-content",
  ".entry-content",
] as const

/**
 * CSS selectors for elements to remove before extraction
 */
const REMOVE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  ".sidebar",
  ".navigation",
  ".nav",
  ".toc",
  ".table-of-contents",
  ".breadcrumb",
  ".breadcrumbs",
  ".pagination",
  ".comments",
  ".advertisement",
  ".ads",
  ".banner",
  ".cookie-notice",
  ".cookie-banner",
  "script",
  "style",
  "noscript",
  "iframe",
  "[hidden]",
  "[aria-hidden='true']",
] as const

/**
 * Extract the main content from an HTML string
 * Uses a regex-based approach that works in Bun without DOM APIs
 */
export function extractMainContent(html: string): ExtractedContent {
  // Extract title
  const title = extractTitle(html)

  // Extract meta description
  const description = extractMetaDescription(html)

  // Extract keywords from meta tags
  const keywords = extractKeywords(html)

  // Remove unwanted elements first
  let cleanedHtml = removeUnwantedElements(html)

  // Try to find main content area
  let content = findMainContent(cleanedHtml)

  // If no main content found, use the body
  if (!content) {
    const bodyMatch = cleanedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    content = bodyMatch ? bodyMatch[1] : cleanedHtml
  }

  return {
    title,
    content,
    description: description || undefined,
    keywords: keywords.length > 0 ? keywords : undefined,
  }
}

/**
 * Extract the title from HTML
 */
function extractTitle(html: string): string {
  // Try h1 first (most specific to the page content)
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    return stripHtmlTags(h1Match[1]).trim()
  }

  // Fall back to title tag
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    // Remove site name suffix (common pattern: "Page Title | Site Name")
    let title = stripHtmlTags(titleMatch[1]).trim()
    const separators = [" | ", " - ", " :: ", " // ", " — "]
    for (const sep of separators) {
      if (title.includes(sep)) {
        title = title.split(sep)[0].trim()
        break
      }
    }
    return title
  }

  // Try og:title meta tag
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
  if (ogTitleMatch) {
    return stripHtmlTags(ogTitleMatch[1]).trim()
  }

  return "Untitled Document"
}

/**
 * Extract meta description from HTML
 */
function extractMetaDescription(html: string): string | null {
  // Standard meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
  if (descMatch) {
    return stripHtmlTags(descMatch[1]).trim()
  }

  // OpenGraph description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
  if (ogDescMatch) {
    return stripHtmlTags(ogDescMatch[1]).trim()
  }

  return null
}

/**
 * Extract keywords from meta tags
 */
function extractKeywords(html: string): string[] {
  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i)
  if (keywordsMatch) {
    return keywordsMatch[1]
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0)
  }
  return []
}

/**
 * Remove unwanted elements from HTML
 */
function removeUnwantedElements(html: string): string {
  let result = html

  // Remove script tags and their content
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "")

  // Remove style tags and their content
  result = result.replace(/<style[\s\S]*?<\/style>/gi, "")

  // Remove noscript tags
  result = result.replace(/<noscript[\s\S]*?<\/noscript>/gi, "")

  // Remove comments
  result = result.replace(/<!--[\s\S]*?-->/g, "")

  // Remove nav elements
  result = result.replace(/<nav[\s\S]*?<\/nav>/gi, "")

  // Remove header elements (but not h1-h6)
  result = result.replace(/<header[\s\S]*?<\/header>/gi, "")

  // Remove footer elements
  result = result.replace(/<footer[\s\S]*?<\/footer>/gi, "")

  // Remove aside elements
  result = result.replace(/<aside[\s\S]*?<\/aside>/gi, "")

  // Remove elements with sidebar-related classes
  result = result.replace(/<[^>]*class=["'][^"']*(?:sidebar|navigation|nav|toc|breadcrumb|pagination)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "")

  return result
}

/**
 * Find the main content area in HTML
 */
function findMainContent(html: string): string | null {
  // Try each content selector
  for (const selector of CONTENT_SELECTORS) {
    const content = extractBySelector(html, selector)
    if (content && content.trim().length > 100) {
      return content
    }
  }

  return null
}

/**
 * Extract content by a CSS-like selector (simplified regex-based)
 */
function extractBySelector(html: string, selector: string): string | null {
  let pattern: RegExp

  if (selector.startsWith(".")) {
    // Class selector
    const className = selector.slice(1)
    pattern = new RegExp(
      `<([a-z][a-z0-9]*)[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      "i"
    )
  } else if (selector.startsWith("#")) {
    // ID selector
    const id = selector.slice(1)
    pattern = new RegExp(
      `<([a-z][a-z0-9]*)[^>]*id=["']${escapeRegex(id)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      "i"
    )
  } else if (selector.startsWith("[")) {
    // Attribute selector
    const attrMatch = selector.match(/\[([^=]+)=['"]?([^'"\]]+)['"]?\]/)
    if (attrMatch) {
      const [, attr, value] = attrMatch
      pattern = new RegExp(
        `<([a-z][a-z0-9]*)[^>]*${escapeRegex(attr)}=["']${escapeRegex(value)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
        "i"
      )
    } else {
      return null
    }
  } else {
    // Tag selector
    pattern = new RegExp(
      `<${escapeRegex(selector)}[^>]*>([\\s\\S]*?)<\\/${escapeRegex(selector)}>`,
      "i"
    )
  }

  const match = html.match(pattern)
  if (match) {
    // For tag selectors, the content is in group 1
    // For class/id selectors, the content is in group 2
    return selector.match(/^[a-z]/) ? match[1] : match[2]
  }

  return null
}

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Extract tags from URL path for documentation categorization
 */
export function extractTagsFromUrl(url: string): string[] {
  const tags: string[] = []

  try {
    const urlObj = new URL(url)
    const lowerPath = urlObj.pathname.toLowerCase()
    const lowerHost = urlObj.hostname.toLowerCase()

    // Common documentation patterns
    const patterns: Array<{ pattern: RegExp; tag: string }> = [
      { pattern: /\/api\b/i, tag: "api" },
      { pattern: /\/reference\b/i, tag: "reference" },
      { pattern: /\/guide/i, tag: "guide" },
      { pattern: /\/tutorial/i, tag: "tutorial" },
      { pattern: /\/example/i, tag: "example" },
      { pattern: /\/doc(?:s|umentation)?\b/i, tag: "documentation" },
      { pattern: /\/getting-started/i, tag: "getting-started" },
      { pattern: /\/quick-?start/i, tag: "quickstart" },
      { pattern: /\/install/i, tag: "installation" },
      { pattern: /\/config/i, tag: "configuration" },
      { pattern: /\/hook/i, tag: "hooks" },
      { pattern: /\/component/i, tag: "components" },
      { pattern: /\/concept/i, tag: "concepts" },
      { pattern: /\/learn/i, tag: "learning" },
      { pattern: /\/blog/i, tag: "blog" },
    ]

    for (const { pattern, tag } of patterns) {
      if (pattern.test(lowerPath)) {
        tags.push(tag)
      }
    }

    // Extract library/framework name from common doc hosts
    if (lowerHost.includes("react")) tags.push("react")
    else if (lowerHost.includes("vue")) tags.push("vue")
    else if (lowerHost.includes("angular")) tags.push("angular")
    else if (lowerHost.includes("nodejs") || lowerHost.includes("node.js")) tags.push("nodejs")
    else if (lowerHost.includes("typescript")) tags.push("typescript")
    else if (lowerHost.includes("python")) tags.push("python")
    else if (lowerHost.includes("rust")) tags.push("rust")
    else if (lowerHost.includes("go") || lowerHost.includes("golang")) tags.push("go")

    // Extract version if present in URL
    const versionMatch = lowerPath.match(/\/v?(\d+(?:\.\d+)?(?:\.\d+)?)\b/)
    if (versionMatch) {
      tags.push(`v${versionMatch[1]}`)
    }

  } catch {
    // Invalid URL, return empty tags
  }

  return [...new Set(tags)] // Deduplicate
}

/**
 * Infer content type from URL and content
 */
export function inferContentType(
  url: string,
  content: string
): "api" | "guide" | "example" | "reference" | "tutorial" {
  try {
    const urlObj = new URL(url)
    const lowerPath = urlObj.pathname.toLowerCase()
    const lowerContent = content.toLowerCase().substring(0, 2000)

    // Check URL path patterns (not hostname)
    if (lowerPath.includes("/api") || lowerPath.includes("/reference")) {
      return "api"
    }
    if (lowerPath.includes("/tutorial") || lowerPath.includes("/learn")) {
      return "tutorial"
    }
    if (lowerPath.includes("/guide") || lowerPath.includes("/getting-started")) {
      return "guide"
    }
    if (lowerPath.includes("/example") || lowerPath.includes("/sample")) {
      return "example"
    }

    // Check content patterns
    if (lowerContent.includes("step 1") || lowerContent.includes("step-by-step")) {
      return "tutorial"
    }
    // Only match "example" in content if it appears as a standalone word, not in domain
    if (/\bexamples?\b/.test(lowerContent) && lowerContent.includes("```")) {
      return "example"
    }
    if (lowerContent.includes("function") || lowerContent.includes("method") || lowerContent.includes("parameter")) {
      return "api"
    }
  } catch {
    // Invalid URL, fall through to default
  }

  return "reference"
}
