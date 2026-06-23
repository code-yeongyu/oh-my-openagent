---
name: accessible-content
description: Use when writing or structuring any user-facing content — interface copy, labels, error messages, help text, headings, alt text, link text, or form instructions — ensures content is readable, navigable, and meaningful for everyone
---

# Accessible Content

Words are interface. Every label, every heading, every error message is a design decision. This skill ensures content works for screen readers, for people reading in a second language, for people under stress, and for people who just need things to be clear.

## When to Use

- Writing interface labels, button text, or form instructions
- Structuring headings and page hierarchy
- Writing error messages or help text
- Creating alt text for images
- Writing link text
- Structuring data tables
- Any time words appear on screen

## Process

### Step 1: Plain Language First

Every piece of content should meet these criteria:
- **Reading level:** aim for a reading age of 12-14 (roughly 6th-8th grade). Use short sentences and common words
- **One idea per sentence.** If a sentence has "and" in the middle, consider splitting it
- **Active voice.** "We sent your confirmation" not "Your confirmation has been sent"
- **Specific over vague.** "Save your changes" not "Submit" or "OK"
- **No jargon** unless the audience demonstrably uses it. When jargon is necessary, provide a plain explanation

### Step 2: Heading Structure

Headings are navigation for screen readers. Get the structure right:

- **One H1 per page** — describes the page purpose
- **Headings follow a logical hierarchy** — H1 → H2 → H3, never skip levels
- **Headings are descriptive** — a screen reader user scanning headings alone should understand the page structure
- **Do not use headings for visual styling** — if you need big bold text that is not a heading, use CSS

### Step 3: Form Labels and Instructions

Every form input must have:
- **A visible label** — placeholders are not labels (they disappear on focus)
- **Programmatic association** — `<label for="id">` or `aria-labelledby`
- **Required field indication** — visible and announced, not just an asterisk
- **Format hints** — "DD/MM/YYYY" before the input, not after
- **Error association** — `aria-describedby` linking the input to its error message

### Step 4: Alt Text

Alt text is content, not metadata:

| Image Type | Alt Text Approach |
|-----------|------------------|
| Informative image | Describe the information the image conveys, not the image itself |
| Decorative image | Empty alt (`alt=""`) — do not describe decorative images |
| Functional image (button/link) | Describe the action, not the image ("Search", not "magnifying glass") |
| Complex image (chart/graph) | Brief alt + detailed description in surrounding text or `<details>` |
| Image of text | Reproduce the full text content |

### Step 5: Link Text

Links must make sense out of context (screen reader users often navigate by links alone):

- Yes: "Read the accessibility guidelines"
- No: "Click here" or "Read more" or "Learn more"
- If multiple "Read more" links exist on a page, each must be distinguishable (via `aria-label` or visible text)

### Step 6: Error Messages

Follow the pattern: **[What happened] + [What to do]**

- Keep the language neutral — never blame the user
- Be specific about what needs to change
- Place the error message adjacent to the relevant field
- Announce errors to screen readers via `aria-live="assertive"` or by moving focus

### Step 7: Tables

Data tables need:
- `<caption>` describing the table's purpose
- `<th>` elements with `scope="col"` or `scope="row"`
- No layout tables — use CSS Grid or Flexbox for layout
- If a table is complex, provide a text summary

### Step 8: Content Review

Before finalising any content, verify:
- [ ] Every interactive element has a visible, descriptive label
- [ ] Heading hierarchy is logical and complete
- [ ] Link text makes sense out of context
- [ ] Error messages explain both the problem and the solution
- [ ] Alt text is present and appropriate for every image
- [ ] Reading level is appropriate for the audience
- [ ] Content works when translated (avoid idioms, cultural references that do not travel)

## Integration

- **Called by:** `writing-design-plans`, `ui-composition`, `interaction-design`
- **Pairs with:** `cognitive-accessibility` (reading load), `inclusive-personas` (audience awareness)
- **Reviewed by:** `designpowers-critique`
