# Korean design vocabulary and Korean-market constraints

Read this when the brief arrives in Korean design words ("깔끔하게", "모던하게", "고급스럽게", "심플하게") or when the product ships to Korean users (a public-sector service, a fintech screen, a Korean-first marketing page). It turns the adjectives into tokens you can put in `DESIGN.md`, names the question that separates two readings of the same word, and lists the Korean standards and typography facts a build has to satisfy. The token table and the clarifying questions are adapted from the `dev-uiux-design` skill of lidge-jun/codexclaw (MIT); the standards section is omo's own.

## 1. Adjective to tokens

A Korean brief rarely names a reference product. It names a feeling, and each feeling has a stable translation into spacing, radius, weight, palette and motion. Start from the row, write the tokens into the Brief, then adjust against the project's `DESIGN.md`.

| Korean | Literal | Tokens to start from | Nearest reference |
|---|---|---|---|
| 깔끔하게 | clean | 24-48 px gaps, strict grid, 2-3 colors with saturation under 60%, 1 px borders or none, 4-8 px radius, one typeface, no or faint shadows | Notion (warm) or Vercel (cool) |
| 모던하게 | modern | geometric sans, negative letter-spacing on headings, dark mode or high-contrast light, 6-16 px radius, spring micro-interactions | Linear or Vercel |
| 고급스럽게 | premium | 48-96 px padding, weights 300-400, low-saturation palette, slow motion (800 ms and up), 0-4 px radius, serif only with an editorial or luxury reason | Apple or Stripe |
| 심플하게 | simple | 3-4 element types per screen, 1-2 colors, one typeface, 2-3 type sizes, hidden or minimal navigation, zero decoration | Vercel |
| 따뜻하게 | warm | stone, amber, orange hue range, 12-20 px radius, warm-tinted shadows (`rgba(180,140,100,0.1)`), rounded or humanist sans | Notion or Toss |
| 차가운 | cool | slate and zinc grays, blue-tinted whites, geometric sans, thin weights, 0-8 px radius | Linear |
| 감성적으로 | emotional, editorial | serif display plus sans body, muted or pastel colors, generous line-height, photography-led layout | editorial sites |
| 전문적으로 | professional | 6 px radius, medium density, neutral palette, one accent, tabular numbers | Linear or GitHub |
| 대담하게 | bold | 0 px radius, black 900 weight, hard borders, saturated accent | neobrutalism |
| 재미있게 | playful | 16 px and larger radius, a custom grotesque, one saturated accent, bouncy but short motion | Figma |
| 트렌디하게 | trendy | the brief owes a reference site before any token is chosen; glass, bento and gradient mesh are each a decision, never a default | ask |

Two words in one brief ("깔끔하고 고급스럽게") take the stricter row for radius and decoration and the looser row for spacing.

## 2. One question per word

Each adjective has two common readings. Ask the one question that splits them, and ask it before the first draft.

- 깔끔: "Notion처럼 따뜻한 깔끔함인지, Vercel처럼 차가운 깔끔함인지요?"
- 모던: "다크 모드에 날카로운 쪽(Linear)인지, 화이트에 미니멀한 쪽(Vercel)인지요?"
- 고급: "브랜드의 고급감(Apple, Stripe)인지, 패션 럭셔리(Art Deco)인지요?"
- 심플: "기능이 적은 건지, 기능은 많지만 화면이 심플해 보이길 원하는 건지요?"

When the user cannot answer, pick the first reading, say which one you picked, and show the result at 390 and 1440 before building the second screen.

## 3. Hangul typography

- Typeface: Pretendard is the Korean-first default; SUIT, Wanted Sans, LINE Seed KR, Noto Sans KR and Spoqa Han Sans Neo are the close alternatives. For a serif display line in Hangul use MaruBuri at 400-600, paired with Pretendard for UI text. Inter as the default Latin face is the most common tell of generated UI; pick the Latin face with the Hangul face in mind.
- Line breaking: Hangul breaks between any two syllables, so a narrow column cuts words in half. Set `word-break: keep-all` (and `overflow-wrap: anywhere` as the fallback for long URLs) on body text, headings and buttons. There is no hyphenation to lean on.
- Line height and size: Hangul glyphs sit taller and denser than Latin at the same size; body text reads at 15-16 px with line-height 1.6-1.7, headings at 1.3-1.4. Negative letter-spacing that looks modern on Latin headings crowds Hangul; keep it at 0 to -0.01 em.
- Numbers and currency: amounts take thousands separators and the unit after the number ("12,000원"); use tabular figures for columns of amounts. Dates read "2026년 11월 7일" or "2026.11.07".
- Mixed script: an English product name inside a Korean sentence keeps its Latin face; do not force it into the Hangul face's Latin glyphs when they differ in weight.

## 4. Korean public-sector work: KRDS and KWCAG

- KRDS (Korea Design System, https://www.krds.go.kr) is the design system for Korean central and local government digital services: components, patterns, tokens and writing rules. A screen for a 공공 service starts from KRDS components and its tokens; a Layer A taste skill is applied only where KRDS leaves the choice open.
- KWCAG 2.2 (한국형 웹 콘텐츠 접근성 지침 2.2, national standard KS X OT0003:2022, revised December 2022) is the accessibility standard Korean public services are audited against. It has 4 principles, 14 guidelines and 33 checkpoints, and it is built on WCAG 2.1 with some 2.2 items. A WCAG 2.2 AA pass is evidence for KWCAG, not a KWCAG verdict: a KWCAG claim is checked item by item against the 33 checkpoints, and the result names the items.
- The checkpoints that fail most often in Korean audits are the ones a quick build skips: alt text on meaningful images and empty alt on decoration, 4.5:1 contrast on body text (light-gray captions and placeholders are the usual failure), keyboard reach and a visible focus order, a skip link over repeated regions, `caption`/`th`/`scope` on data tables, a `label` on every input, error text that names the field and the reason, a stop control on anything that moves for more than 3 seconds (the main banner slider is the classic case), and a warning before a link opens a new window. The 2.2 additions also cover single-pointer input, pointer cancellation, label-name match and motion-actuation alternatives on the mobile layout.

## 5. Korean fintech and consumer screens

- Amounts and account numbers dominate the screen: tabular figures, the won sign or "원" after the number, grouping digits in thousands, and masking in the middle of an account or card number ("1234-****-****-5678").
- Identity and consent flows are dense by law: show the mandatory consent items as individual checkboxes with the full text one tap away, and keep the optional ones visibly separate.
- Toss-style warmth (large radius, friendly copy, one bright accent) is a choice the brief has to make; a bank or an insurer's brief more often lands on the 전문적으로 row.
