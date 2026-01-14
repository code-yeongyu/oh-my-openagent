import TurndownService from "turndown"

/**
 * HTML to Markdown converter with custom rules for documentation
 */
export class HtmlToMarkdownConverter {
  private turndown: TurndownService

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "_",
      strongDelimiter: "**",
    })

    this.addCustomRules()
  }

  private addCustomRules(): void {
    // Preserve code language hints from pre > code blocks
    this.turndown.addRule("codeBlock", {
      filter: (node): boolean =>
        node.nodeName === "PRE" &&
        node.querySelector("code") !== null,
      replacement: (_content, node): string => {
        const codeElement = (node as HTMLElement).querySelector("code")
        if (!codeElement) return ""

        // Extract language from class (e.g., "language-typescript", "hljs language-js")
        const classNames = codeElement.className || ""
        const langMatch = classNames.match(/(?:language-|lang-)(\w+)/)
        const lang = langMatch?.[1] || ""

        const codeText = codeElement.textContent || ""
        return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`
      },
    })

    // Handle inline code
    this.turndown.addRule("inlineCode", {
      filter: (node): boolean =>
        node.nodeName === "CODE" &&
        node.parentNode?.nodeName !== "PRE",
      replacement: (content): string => {
        if (!content.trim()) return ""
        // Escape backticks within inline code
        if (content.includes("`")) {
          return `\`\` ${content} \`\``
        }
        return `\`${content}\``
      },
    })

    // Handle definition lists (often used in API docs)
    this.turndown.addRule("definitionList", {
      filter: (node): boolean => node.nodeName === "DL",
      replacement: (_content, node): string => {
        const dl = node as HTMLElement
        const items: string[] = []
        let currentTerm = ""

        for (const child of Array.from(dl.children)) {
          if (child.nodeName === "DT") {
            currentTerm = child.textContent?.trim() || ""
          } else if (child.nodeName === "DD") {
            const definition = child.textContent?.trim() || ""
            items.push(`**${currentTerm}**: ${definition}`)
          }
        }

        return items.length > 0 ? "\n" + items.join("\n\n") + "\n" : ""
      },
    })

    // Handle callouts/admonitions (common in documentation)
    this.turndown.addRule("callout", {
      filter: (node): boolean => {
        if (node.nodeName !== "DIV" && node.nodeName !== "ASIDE") return false
        const className = (node as HTMLElement).className || ""
        return /(?:note|warning|tip|info|caution|danger|admonition|callout)/i.test(className)
      },
      replacement: (content, node): string => {
        const className = (node as HTMLElement).className || ""
        let type = "Note"
        if (/warning|caution/i.test(className)) type = "Warning"
        else if (/tip|hint/i.test(className)) type = "Tip"
        else if (/danger|error/i.test(className)) type = "Danger"
        else if (/info/i.test(className)) type = "Info"

        const trimmedContent = content.trim()
        return `\n> **${type}:** ${trimmedContent}\n`
      },
    })

    // Handle tables better (ensure proper markdown table format)
    this.turndown.addRule("tableCell", {
      filter: ["th", "td"],
      replacement: (content): string => {
        return ` ${content.replace(/\n/g, " ").trim()} |`
      },
    })

    this.turndown.addRule("tableRow", {
      filter: "tr",
      replacement: (content, node): string => {
        const row = "|" + content
        const parent = node.parentNode

        // Add separator after header row
        if (parent?.nodeName === "THEAD") {
          const cellCount = (node as HTMLElement).children.length
          const separator = "\n|" + " --- |".repeat(cellCount)
          return row + separator + "\n"
        }

        return row + "\n"
      },
    })

    // Remove empty links
    this.turndown.addRule("emptyLink", {
      filter: (node): boolean =>
        node.nodeName === "A" &&
        !node.textContent?.trim(),
      replacement: (): string => "",
    })
  }

  /**
   * Convert HTML to Markdown
   */
  convert(html: string): string {
    if (!html || !html.trim()) {
      return ""
    }

    try {
      const markdown = this.turndown.turndown(html)
      return this.postProcess(markdown)
    } catch (error) {
      // If conversion fails, return a basic text extraction
      return this.fallbackTextExtraction(html)
    }
  }

  /**
   * Post-process the markdown to clean up common issues
   */
  private postProcess(markdown: string): string {
    return markdown
      // Remove excessive blank lines (more than 2)
      .replace(/\n{3,}/g, "\n\n")
      // Clean up spaces before punctuation
      .replace(/ +([.,;:!?])/g, "$1")
      // Ensure proper spacing around headers
      .replace(/([^\n])\n(#{1,6} )/g, "$1\n\n$2")
      // Remove trailing whitespace from lines
      .replace(/ +$/gm, "")
      // Ensure file ends with single newline
      .trim() + "\n"
  }

  /**
   * Fallback text extraction when turndown fails
   */
  private fallbackTextExtraction(html: string): string {
    return html
      // Remove script and style elements
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Convert common HTML elements
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
      .replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
      // Remove remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      // Clean up whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  }
}

/**
 * Create a singleton converter instance
 */
let converterInstance: HtmlToMarkdownConverter | null = null

export function getHtmlConverter(): HtmlToMarkdownConverter {
  if (!converterInstance) {
    converterInstance = new HtmlToMarkdownConverter()
  }
  return converterInstance
}
