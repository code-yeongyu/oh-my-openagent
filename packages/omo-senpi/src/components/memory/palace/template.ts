import { palaceClientScript } from "./client-script"
import { PALACE_STYLES } from "./styles"

// Self-contained memory palace HTML shell. No external fonts, stylesheets, scripts or network calls.
// Design tokens (ported from the letta memory viewer, system font stacks substituted for the CDN
// webfonts) live in :root / html.dark; every rule below references a token, never a raw literal.

export const PALACE_DATA_PLACEHOLDER = "<!--OMO_PALACE_DATA-->"
export const PALACE_DATA_ELEMENT_ID = "omo-palace-data"

// The people tab and panel are stripped verbatim by the generator when `memory.people.enabled`
// is false, so a disabled people layer leaves no tab, no panel and no payload behind.
export const PALACE_PEOPLE_TAB = `<button class="tab" data-tab="people" type="button">People</button>`
export const PALACE_PEOPLE_PANEL = `<section id="panel-people" hidden></section>`

export const PALACE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Memory Palace</title>
<style>
${PALACE_STYLES}</style>
</head>
<body>
<div class="shell">
  <header class="header">
    <h1>Memory Palace</h1>
    <div class="meta">
      <div>identity <strong id="meta-identity"></strong></div>
      <div>HEAD <strong id="meta-head"></strong></div>
      <div>recompiled <strong id="meta-recompiled"></strong></div>
    </div>
  </header>
  <nav class="tabs" id="tabs">
    <button class="tab active" data-tab="core" type="button">Core</button>
    <button class="tab" data-tab="external" type="button">External</button>
    <button class="tab" data-tab="history" type="button">History</button>
    <button class="tab" data-tab="reflection" type="button">Reflection</button>
    ${PALACE_PEOPLE_TAB}
  </nav>
  <main class="main">
    <section id="panel-core"></section>
    <section id="panel-external" hidden></section>
    <section id="panel-history" hidden></section>
    <section id="panel-reflection" hidden></section>
    ${PALACE_PEOPLE_PANEL}
  </main>
  <footer class="footer" id="footer"></footer>
</div>
<script type="application/json" id="${PALACE_DATA_ELEMENT_ID}">${PALACE_DATA_PLACEHOLDER}</script>
<script>
${palaceClientScript(PALACE_DATA_ELEMENT_ID)}</script>
</body>
</html>
`
