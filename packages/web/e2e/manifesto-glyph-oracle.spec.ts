import { expect, test } from "@playwright/test"

import { expectUniformWordGlyphs } from "./manifesto-glyphs"

for (const locale of ["en", "ko"]) {
  test(`glyph oracle rejects a real half-dim word (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/manifesto`)
    await page.evaluate(async () => {
      await document.fonts.ready
      const block = document.querySelector<HTMLElement>(".lit-read")!
      block.scrollIntoView({ block: "center" })
    })
    await page.waitForFunction(() => {
      const block = document.querySelector<HTMLElement>(".lit-read")
      return block?.dataset.litMode === "observer"
    })
    // Freeze the reveal and paint real page words uniformly before injecting a split.
    const uniform = await page.addStyleTag({
      content: `.lit-word { background: none !important; color: var(--text-hi) !important;
        -webkit-text-fill-color: var(--text-hi) !important; }`,
    })
    await expectUniformWordGlyphs(page)
    await uniform.evaluate((style) => style.parentNode?.removeChild(style))
    await page.addStyleTag({
      content: `.lit-word { color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        background: linear-gradient(to right, var(--text-hi) 50%, var(--text-lo) 50%) !important;
        background-clip: text !important; -webkit-background-clip: text !important; }`,
    })
    await expect(expectUniformWordGlyphs(page)).rejects.toThrow(
      "a word must not contain both lit and unlit glyph regions",
    )
  })
}
