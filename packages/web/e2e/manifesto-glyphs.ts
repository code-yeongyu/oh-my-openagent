import { writeFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"

async function attachGlyphEvidence(
  name: string,
  body: string | Buffer,
  contentType: string,
): Promise<void> {
  const extension = contentType === "application/json" ? ".json" : ".png"
  const path = test.info().outputPath(`${name}${extension}`)
  // Body-only attachments remain in reporter memory; list/GitHub reporters do not save them.
  // Persist public-page glyph evidence explicitly so CI can upload it after assertion failure.
  await writeFile(path, body)
  await test.info().attach(name, { path, contentType })
}

export async function expectUniformWordGlyphs(page: Page): Promise<number> {
  // Match rasterization across the gradient actual frame and flat endpoint references.
  // LCD text can give their thin vertical stems different colored fringes.
  const smoothing = await page.addStyleTag({
    content: ".lit-read, .lit-read * { -webkit-font-smoothing: antialiased !important; }",
  })
  const actual = await page.screenshot({ animations: "disabled", scale: "css" })
  const words = await page.evaluate(() => {
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>(".lit-read .lit-word"),
    ).filter((word) => {
      const rect = word.getBoundingClientRect()
      return (
        rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      )
    })
    const words = visible.map((word) => {
      const rect = word.getBoundingClientRect()
      const saved = word.getAttribute("style")
      const computed = getComputedStyle(word)
      const actualColor = computed.color
      const actualProgress = computed.getPropertyValue("--lit-local")
      word.dataset.uniformSavedStyle = saved ?? ""
      // Capture the same glyph geometry at both brightness endpoints.
      word.style.setProperty("background", "none", "important")
      word.style.setProperty("color", "var(--text-lo)", "important")
      word.style.setProperty("-webkit-text-fill-color", "var(--text-lo)", "important")
      word.style.setProperty("filter", "none", "important")
      word.style.setProperty("mask-image", "none", "important")
      word.style.setProperty("text-shadow", "none", "important")
      word.dataset.uniformReference = "true"
      return {
        text: word.textContent,
        actualColor,
        actualProgress,
        clientRects: Array.from(word.getClientRects(), (rect) => ({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })),
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }
    })
    const style = document.createElement("style")
    style.id = "uniform-word-reference"
    style.textContent = `
      [data-uniform-reference] * { color: inherit !important; -webkit-text-fill-color: inherit !important;
        background: none !important; opacity: 1 !important; filter: none !important;
        mask-image: none !important; text-shadow: none !important; }
      [data-uniform-reference]::before, [data-uniform-reference]::after { display: none !important; }
    `
    document.head.append(style)
    return words
  })
  const low = await page.screenshot({ animations: "disabled", scale: "css" })
  await page.evaluate(() => {
    for (const word of document.querySelectorAll<HTMLElement>("[data-uniform-reference]")) {
      word.style.setProperty("color", "var(--text-hi)", "important")
      word.style.setProperty("-webkit-text-fill-color", "var(--text-hi)", "important")
    }
  })
  const high = await page.screenshot({ animations: "disabled", scale: "css" })
  await page.evaluate(() => {
    document.getElementById("uniform-word-reference")?.remove()
    for (const word of document.querySelectorAll<HTMLElement>("[data-uniform-reference]")) {
      if (word.dataset.uniformSavedStyle) word.setAttribute("style", word.dataset.uniformSavedStyle)
      else word.removeAttribute("style")
      delete word.dataset.uniformSavedStyle
      delete word.dataset.uniformReference
    }
  })
  await smoothing.evaluate((style) => style.parentNode?.removeChild(style))
  const measurement = await page.evaluate(
    async ({ actual, low, high, words }) => {
      async function pixels(base64: string): Promise<ImageData> {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext("2d")!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [a, lo, hi] = await Promise.all([pixels(actual), pixels(low), pixels(high)])
      let sampledGlyphPixels = 0
      const differences = words.flatMap((word) => {
        let glyphPixels = 0
        let litPixels = 0
        let unlitPixels = 0
        const columns = Array.from(
          { length: Math.ceil(word.x + word.width) - Math.floor(word.x) },
          () => ({ lit: 0, unlit: 0, intermediate: 0 }),
        )
        const classes = document.createElement("canvas")
        classes.width = columns.length
        classes.height = Math.ceil(word.y + word.height) - Math.floor(word.y)
        const classContext = classes.getContext("2d")!
        for (let y = Math.ceil(word.y); y < Math.floor(word.y + word.height); y += 1) {
          for (let x = Math.ceil(word.x); x < Math.floor(word.x + word.width); x += 1) {
            const offset = (y * a.width + x) * 4
            let projection = 0
            let magnitude = 0
            for (const channel of [0, 1, 2]) {
              const delta = hi.data[offset + channel]! - lo.data[offset + channel]!
              projection += (a.data[offset + channel]! - lo.data[offset + channel]!) * delta
              magnitude += delta * delta
            }
            // Ignore the background and antialiased glyph fringes. Endpoint references retain
            // each glyph's coverage; interior pixels carry enough contrast to measure brightness.
            if (magnitude < 3 * 70 ** 2) continue
            const fraction = projection / magnitude
            glyphPixels += 1
            const column = columns[x - Math.floor(word.x)]!
            if (fraction >= 0.8) {
              litPixels += 1
              column.lit += 1
              classContext.fillStyle = "#22c55e"
            } else if (fraction <= 0.2) {
              unlitPixels += 1
              column.unlit += 1
              classContext.fillStyle = "#ef4444"
            } else {
              column.intermediate += 1
              classContext.fillStyle = "#eab308"
            }
            classContext.fillRect(x - Math.floor(word.x), y - Math.floor(word.y), 1, 1)
          }
        }
        sampledGlyphPixels += glyphPixels
        const significant = Math.max(4, glyphPixels * 0.1)
        if (litPixels < significant || unlitPixels < significant) return []
        function crop(frame: ImageData): string {
          const canvas = document.createElement("canvas")
          canvas.width = classes.width
          canvas.height = classes.height
          const context = canvas.getContext("2d")!
          const source = document.createElement("canvas")
          source.width = frame.width
          source.height = frame.height
          source.getContext("2d")!.putImageData(frame, 0, 0)
          context.drawImage(source, -Math.floor(word.x), -Math.floor(word.y))
          return canvas.toDataURL("image/png").split(",")[1]!
        }
        return [
          {
            text: word.text,
            glyphPixels,
            litPixels,
            unlitPixels,
            bounds: word,
            columns,
            // Preserve spatial evidence before deciding whether AA or a trailing syllable is split.
            crops: {
              actual: crop(a),
              low: crop(lo),
              high: crop(hi),
              classes: classes.toDataURL("image/png").split(",")[1]!,
            },
          },
        ]
      })
      return { differences, sampledGlyphPixels }
    },
    {
      actual: actual.toString("base64"),
      low: low.toString("base64"),
      high: high.toString("base64"),
      words,
    },
  )
  if (measurement.differences.length > 0) {
    await attachGlyphEvidence(
      "glyph-diagnostics",
      JSON.stringify(
        {
          legend: {
            green: "lit >= 0.8",
            red: "unlit <= 0.2",
            yellow: "intermediate",
            transparent: "excluded background/AA fringe",
          },
          words: measurement.differences.map(({ crops: _crops, ...word }) => word),
        },
        null,
        2,
      ),
      "application/json",
    )
    for (const [index, word] of measurement.differences.entries()) {
      for (const [kind, png] of Object.entries(word.crops)) {
        await attachGlyphEvidence(`glyph-${index}-${kind}`, Buffer.from(png, "base64"), "image/png")
      }
    }
  }
  expect(measurement.sampledGlyphPixels, "expected measurable glyph interiors").toBeGreaterThan(0)
  expect(
    measurement.differences.map(({ text, glyphPixels, litPixels, unlitPixels }) => ({
      text,
      glyphPixels,
      litPixels,
      unlitPixels,
    })),
    "a word must not contain both lit and unlit glyph regions",
  ).toEqual([])
  return words.length
}
