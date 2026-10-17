export const BROWSER_CONFIRMATION_POLICY = "ask-before-irreversible"
export const BROWSER_ENGINE_ENV = "OMO_BROWSER_ENGINE"
export const BROWSER_STATE_EVENT = "omo.browser.state"

const BRIDGE_TOOL = "omo_browser_bridge"
const ENGINES = new Set(["connected", "builtin", "none"])
const NOT_CONNECTED_CODES = new Set(["no_browser_connected", "no_daemon", "unsupported"])
const CLASSIFY_HTML_BYTES = 4096
const QUESTION_HEADER = "Browser"
const ALLOW = "Allow"
const DECLINE = "Don't allow"
const READ_ONLY_RAW_TOOLS = new Set(["observe", "snapshot", "get_html", "screenshot", "tab_list", "console", "network"])

const OWNED_SESSION_CREATORS = new Set(["connect", "connectPipe", "connectCloakProfile"])
const PASSTHROUGH_FUNCTIONS = new Set([
  "bskDoctor",
  "bskOnboard",
  "installBskCli",
  "readDaemonInfo",
  "resolveBskHome",
  "listBrowsers",
  "catalogBrowsers",
  "detectBrowsers",
  "identifyBrowser",
  "probeBrowserSignals",
  "findCloakBrowserPath",
  "resolveCloakProfile",
  "registerExternalExtension",
  "unregisterExternalExtension",
  "externalExtensionEntry",
  "buildSnapshotExpression",
  "buildCloakBrowserArgs",
  "compactSnapshot",
  "snapshotTokens",
  "describeLayers",
  "layersHeader",
  "decodeFrames",
  "encodeFrame",
  "reconcileFrames",
  "normalizeDialogPolicy",
  "resolveDialogAction",
  "sanitizeCookies",
  "toHar",
  "BskRpcError",
  "BridgeProtocolError",
  "BridgeUnavailableError",
  "BrowserCdpCommandError",
  "UnsupportedOperationError",
])

class CodedError extends Error {
  constructor(name, code, message, options) {
    super(message, options)
    this.name = name
    this.code = code
  }
}

export class BrowserEngineRefusal extends CodedError {
  constructor(code, message) {
    super("BrowserEngineRefusal", code, message)
  }
}

export class BrowserNotConnectedError extends CodedError {
  constructor(message, options) {
    super("BrowserNotConnectedError", "browser_not_connected", message, options)
  }
}

export class BrowserUserStoppedError extends CodedError {
  constructor(message = "The user stopped browser use. Report that and do not start another browser session this turn.") {
    super("BrowserUserStoppedError", "user_stopped", message)
  }
}

export class BrowserActionDeclinedError extends CodedError {
  constructor(message, code = "user_declined") {
    super("BrowserActionDeclinedError", code, message)
  }
}

const IRREVERSIBLE_LABELS = [
  /\b(send|post|publish|tweet|reply)\b/i,
  /\b(pay|purchase|buy|subscribe|donate|checkout|submit|confirm|transfer|approve|merge)\b/i,
  /\b(e-?sign|sign\s+(the\s+|this\s+|your\s+)?(document|contract|agreement|transaction|petition|form))\b/i,
  /\border\b(?!\s+(history|status|details|number|tracking))/i,
  /\b(delete|remove|unsubscribe|deactivate)\b/i,
  /\bcancel\s+(my\s+|your\s+)?(subscription|membership|plan|account)\b/i,
  /\bclose\s+(my\s+|your\s+)?account\b/i,
  /결제|구매|주문|구독|삭제|제거|탈퇴|전송|발송|게시|발행|제출|승인|송금|이체|병합/,
]
const IRREVERSIBLE_ACTION_PATH = /\/(send|post|publish|pay|purchase|order|subscribe|delete|remove)\b/i
const SCRIPT_DRIVES_UI = /\.(click|submit|requestSubmit)\s*\(|\bdispatchEvent\b/
const SCRIPT_BEACON = /\bsendBeacon\s*\(/
const SCRIPT_REACHES_NETWORK = /\b(fetch|XMLHttpRequest)\b/
const SCRIPT_WRITES = /["'`](POST|PUT|PATCH|DELETE)["'`]/i
const ENTER_KEY = /(^|\+)(Enter|Return)$/i
const SENDING_CHORD = /(^|\+)(Control|Ctrl|Meta|Cmd|Command)\+/i

export function isIrreversibleLabel(label) {
  return typeof label === "string" && IRREVERSIBLE_LABELS.some((pattern) => pattern.test(label))
}

function labelsOf(descriptor) {
  return [descriptor?.text, descriptor?.ariaLabel, descriptor?.title, descriptor?.value].filter((label) => typeof label === "string" && label.length > 0)
}

function markupIsEditable(html) {
  return /\bcontenteditable\b(?!\s*=\s*["']?false)|\brole\s*=\s*["']textbox["']|<textarea\b/i.test(html)
}

function labelsFromMarkup(html) {
  const labels = []
  for (const match of html.matchAll(/\b(?:aria-label|title|value|alt)\s*=\s*"([^"]*)"/gi)) labels.push(match[1])
  labels.push(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
  return labels.filter((label) => label.length > 0)
}

function scriptNeedsConfirmation(expression) {
  if (typeof expression !== "string") return false
  if (SCRIPT_DRIVES_UI.test(expression) || SCRIPT_BEACON.test(expression)) return true
  return SCRIPT_REACHES_NETWORK.test(expression) && SCRIPT_WRITES.test(expression)
}

function describeElementExpression(selector) {
  return `(function (selector) {
  const el = selector ? document.querySelector(selector) : document.activeElement
  if (!el || el === document.body || el === document.documentElement) return null
  const text = (el.innerText || el.textContent || "").trim().slice(0, 200)
  const form = el.form || (el.closest ? el.closest("form") : null)
  return {
    tag: el.localName,
    editable: el.isContentEditable === true || el.localName === "textarea" || el.getAttribute("role") === "textbox",
    text,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    title: el.getAttribute("title") || undefined,
    value: el.localName === "button" || (el.localName === "input" && /^(submit|button|image)$/i.test(el.type)) ? el.value : undefined,
    form: form ? {
      action: form.getAttribute("action") || "",
      method: (form.getAttribute("method") || "get").toLowerCase(),
      submitLabels: Array.from(form.querySelectorAll("button, input[type=submit], input[type=image]")).filter((b) => (b.type || "submit") === "submit").map((b) => (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().slice(0, 100)),
    } : undefined,
  }
})(${JSON.stringify(selector ?? null)})`
}

function codeOf(error) {
  return typeof error?.code === "string" ? error.code : error instanceof Error ? error.name : "error"
}

function targetKind(target) {
  if (typeof target === "string") return /^@?e\d+$/.test(target) ? { kind: "ref", ref: target } : { kind: "selector", selector: target }
  if (target && typeof target === "object") {
    if (typeof target.ref === "string") return { kind: "ref", ref: target.ref }
    if (typeof target.selector === "string") return { kind: "selector", selector: target.selector }
  }
  return { kind: "point" }
}

function createBridge(host, context) {
  const call = async (args) => {
    if (host === undefined) return undefined
    try {
      const result = await host.callTool(BRIDGE_TOOL, args)
      return result?.hasError === true ? undefined : result
    } catch {
      return undefined
    }
  }
  return {
    async emit(status, extra = {}) {
      const data = { engine: context.engine, status }
      if (context.sessionId !== undefined) data.session = context.sessionId
      for (const [key, value] of Object.entries(extra)) if (value !== undefined) data[key] = value
      await call({ op: "state", data })
    },
    async stopped() {
      return (await call({ op: "status" }))?.details?.stopped === true
    },
    async markStopped() {
      await call({ op: "stopped" })
    },
  }
}

function describeTab(tab) {
  if (!tab || typeof tab !== "object") return undefined
  const favicon = tab.favicon_url ?? tab.faviconUrl ?? tab.favIconUrl ?? tab.favicon
  const described = { id: tab.id, url: tab.url, title: tab.title }
  if (typeof favicon === "string") described.favicon = favicon
  return described
}

async function currentTab(rawSession) {
  try {
    const { tabs } = await rawSession.tabList({ scope: "agent" })
    return describeTab(tabs?.find((tab) => tab.active) ?? tabs?.[0])
  } catch {
    return undefined
  }
}

function questionFor(variant, description) {
  const options = [
    { label: ALLOW, description: "Do it this once." },
    { label: DECLINE, description: "Stop this action and tell the agent." },
  ]
  const question = `Allow the agent to ${description}?`
  if (variant === "ask_user_question") {
    return { waitForAnswer: true, questions: [{ header: QUESTION_HEADER, question, multiSelect: false, options }] }
  }
  return { wait_for_answer: true, questions: [{ id: "confirm_browser_action", header: QUESTION_HEADER, question, options }] }
}

function chosenAnswer(variant, details) {
  if (details?.status !== "answered") return undefined
  const entries = Object.values(details.answers ?? {})
  if (entries.length !== 1) return undefined
  return variant === "ask_user_question" ? entries[0] : entries[0]?.answers?.[0]
}

async function confirmWithUser({ host, bridge, rawSession, description, action }) {
  const decline = (unavailableReason) =>
    unavailableReason === undefined
      ? new BrowserActionDeclinedError(`The user declined: ${description}. Nothing was done; report that and do not retry it.`)
      : new BrowserActionDeclinedError(`Nothing was done: ${description}. ${unavailableReason}`, "confirmation_unavailable")
  let variant
  try {
    const names = host === undefined ? [] : await host.listTools()
    variant = ["ask_user_question", "request_user_input"].find((name) => names.includes(name))
  } catch {
    variant = undefined
  }
  if (host === undefined || variant === undefined) {
    throw decline("The user could not be asked because this session has no question tool.")
  }
  const tab = await currentTab(rawSession)
  await bridge.emit("awaiting_confirmation", { action, tab })
  let answer
  try {
    const result = await host.callTool(variant, questionFor(variant, description))
    answer = result?.hasError === true ? undefined : chosenAnswer(variant, result?.details)
  } catch {
    answer = undefined
  }
  if (answer !== ALLOW) {
    await bridge.emit("failed", { action, reason: "user_declined", tab })
    throw decline()
  }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

async function describeForConfirmation(rawSession, label, rawSessionTab) {
  const site = hostOf(rawSessionTab?.url)
  return site === undefined ? label : `${label} on ${site}`
}

function wrapSession(rawSession, context, bridge, host) {
  const nowStopped = async () => {
    if (!(await bridge.stopped())) return
    try {
      await rawSession.stop()
    } catch {
      // The daemon may already have ended the session.
    }
    throw new BrowserUserStoppedError()
  }

  const confirm = async (action, label) => {
    const tab = await currentTab(rawSession)
    await confirmWithUser({ host, bridge, rawSession, description: await describeForConfirmation(rawSession, label, tab), action })
  }

  const readTarget = async (target) => {
    const kind = targetKind(target)
    if (kind.kind === "point") return { unknown: true, labels: [] }
    try {
      if (kind.kind === "ref") {
        const reply = await rawSession.getHtml({ ref: kind.ref, maxBytes: CLASSIFY_HTML_BYTES })
        const html = String(reply?.html ?? "")
        return { unknown: false, labels: labelsFromMarkup(html), editable: markupIsEditable(html) }
      }
      const reply = await rawSession.evaluate(describeElementExpression(kind.selector), { returnByValue: true, awaitPromise: false })
      if (!reply || reply.ok === false) return { unknown: true, labels: [] }
      if (reply.value === null || reply.value === undefined) return { unknown: false, labels: [], missing: true }
      return { unknown: false, labels: labelsOf(reply.value), descriptor: reply.value }
    } catch {
      return { unknown: true, labels: [] }
    }
  }

  const preflightClick = async (target) => {
    const read = await readTarget(target)
    if (read.unknown) return confirm("click", "click a control whose label could not be read")
    const label = read.labels.find(isIrreversibleLabel)
    if (label !== undefined) return confirm("click", `click "${label}"`)
    return undefined
  }

  const preflightPress = async (key, options) => {
    if (typeof key !== "string" || !ENTER_KEY.test(key)) return undefined
    if (SENDING_CHORD.test(key)) return confirm("press", `press ${key}, which sends in many apps`)
    if (/(^|\+)Shift\+/i.test(key)) return undefined
    const sendsFromMessageBox = () => confirm("press", "press Enter in a message box, which sends in many apps")
    const target = options?.target
    if (target !== undefined && targetKind(target).kind !== "selector") {
      const read = await readTarget(target)
      if (read.unknown) return confirm("press", "press Enter on a control that could not be read")
      if (read.editable) return sendsFromMessageBox()
      const label = read.labels.find(isIrreversibleLabel)
      return label === undefined ? undefined : confirm("press", `press Enter on "${label}"`)
    }
    let described
    try {
      const reply = await rawSession.evaluate(describeElementExpression(target === undefined ? undefined : targetKind(target).selector), {
        returnByValue: true,
        awaitPromise: false,
      })
      if (!reply || reply.ok === false) return confirm("press", "press Enter in a field that could not be read")
      described = reply.value
    } catch {
      return confirm("press", "press Enter in a field that could not be read")
    }
    if (described === null || described === undefined) return undefined
    const form = described.form
    if (described.editable === true && (form === undefined || form.method !== "get")) return sendsFromMessageBox()
    const own = labelsOf(described).find(isIrreversibleLabel)
    if (own !== undefined && described.tag !== "input") return confirm("press", `press Enter on "${own}"`)
    if (form === undefined) return undefined
    const submit = (form.submitLabels ?? []).find(isIrreversibleLabel)
    if (submit !== undefined) return confirm("press", `submit a form with "${submit}"`)
    if (form.method === "post" && IRREVERSIBLE_ACTION_PATH.test(String(form.action))) return confirm("press", "submit a form that sends")
    return undefined
  }

  const act = async (kind, run, { navigates = false, preflight } = {}) => {
    await nowStopped()
    if (preflight !== undefined) await preflight()
    await bridge.emit("acting", { action: kind })
    let result
    try {
      result = await run()
    } catch (error) {
      if (codeOf(error) === "user_aborted") {
        await bridge.markStopped()
        await bridge.emit("user_stopped", { action: kind })
        try {
          await rawSession.stop()
        } catch {
          // The daemon already ended it.
        }
        throw new BrowserUserStoppedError()
      }
      await bridge.emit("failed", { action: kind, reason: codeOf(error) })
      throw error
    }
    if (navigates) await bridge.emit("navigated", { action: kind, tab: await currentTab(rawSession) })
    await bridge.emit("idle", { action: kind })
    return result
  }

  const plain = (method, navigates) => (...args) => act(method, () => rawSession[method](...args), { navigates })
  const handlers = {
    navigate: plain("navigate", true),
    back: plain("back", true),
    forward: plain("forward", true),
    reload: plain("reload", true),
    waitForNavigation: plain("waitForNavigation", true),
    tabCreate: plain("tabCreate", true),
    tabSelect: plain("tabSelect", true),
    tabClose: plain("tabClose", true),
    tabBorrow: plain("tabBorrow", true),
    tabReturn: plain("tabReturn", true),
    fill: plain("fill", false),
    select: plain("select", false),
    hover: plain("hover", false),
    focus: plain("focus", false),
    blur: plain("blur", false),
    scrollTo: plain("scrollTo", false),
    wheel: plain("wheel", false),
    click: (target, options) => act("click", () => rawSession.click(target, options), { preflight: () => preflightClick(target) }),
    press: (key, options) => act("press", () => rawSession.press(key, options), { preflight: () => preflightPress(key, options) }),
    evaluate: (expression, options) =>
      act("evaluate", () => rawSession.evaluate(expression, options), {
        preflight: () => (scriptNeedsConfirmation(expression) ? confirm("evaluate", "run a script that can click, submit or send in your browser") : undefined),
      }),
    tool: async (name, params) => {
      if (!READ_ONLY_RAW_TOOLS.has(name)) {
        throw new BrowserEngineRefusal("browser_tool_blocked", `session.tool("${name}") skips the confirmation policy; only reads go through it. Call the matching session method instead.`)
      }
      return await rawSession.tool(name, params)
    },
    async stop() {
      if (rawSession.stopped) return null
      try {
        return await rawSession.stop()
      } finally {
        await bridge.emit("stopped")
      }
    },
  }

  return new Proxy(rawSession, {
    get(target, property) {
      if (Object.hasOwn(handlers, property)) return handlers[property]
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

const GUARDED_SESSIONS = new WeakMap()

function connectErrorFor(error) {
  if (NOT_CONNECTED_CODES.has(codeOf(error))) {
    return new BrowserNotConnectedError(
      "Connect your browser: this session is set to drive the user's own browser, and none is connected. Ask the user to open the browser that has the BrowserSkill extension enabled, then try again. Do not use or launch another browser.",
      { cause: error },
    )
  }
  return error
}

export function guardOmowright(raw, { env = process.env, host } = {}) {
  const engine = env[BROWSER_ENGINE_ENV]
  if (engine === undefined || engine === "") return raw

  const connectBrowserSkill = async (options) => {
    if (!ENGINES.has(engine)) {
      throw new BrowserEngineRefusal("browser_engine_unsupported", `${BROWSER_ENGINE_ENV} is "${engine}", which is not connected, builtin or none; browser use is refused.`)
    }
    if (engine === "none") {
      throw new BrowserEngineRefusal("browser_engine_none", "Agent browser access is off for this project. Tell the user; do not try another browser.")
    }
    if (engine === "builtin") {
      throw new BrowserEngineRefusal("browser_engine_builtin", "This session uses the app's built-in browser. Do not call connectBrowserSkill(); use the app's in-app browser tools.")
    }
    const context = { engine, sessionId: undefined }
    const bridge = createBridge(host, context)
    if (await bridge.stopped()) throw new BrowserUserStoppedError()
    let rawSession
    try {
      rawSession = await raw.connectBrowserSkill(options)
    } catch (error) {
      await bridge.emit("connect_failed", { reason: codeOf(error) })
      throw connectErrorFor(error)
    }
    context.sessionId = rawSession.sessionId
    const session = wrapSession(rawSession, context, bridge, host)
    GUARDED_SESSIONS.set(session, rawSession)
    await bridge.emit("started")
    return session
  }

  const bskSnapshot = (session, options) => raw.bskSnapshot(GUARDED_SESSIONS.get(session) ?? session, options)

  return allowlistedLibrary(raw, engine, { connectBrowserSkill, bskSnapshot })
}

function ownedBrowserRefusal(engine) {
  const why =
    engine === "none"
      ? "Agent browser access is off for this project."
      : engine === "builtin"
        ? "This session uses the app's built-in browser."
        : engine === "connected"
          ? "This session drives the user's own browser only."
          : `${BROWSER_ENGINE_ENV} is "${engine}", which is not connected, builtin or none.`
  const refusal = new BrowserEngineRefusal("browser_engine_owned_blocked", `${why} Do not launch an owned browser; tell the user instead.`)
  refusal.engine = engine
  return refusal
}

function blockedExport(name, engine) {
  const blocked = function () {
    const refusal = new BrowserEngineRefusal(
      OWNED_SESSION_CREATORS.has(name) ? "browser_engine_owned_blocked" : "browser_engine_export_blocked",
      OWNED_SESSION_CREATORS.has(name)
        ? ownedBrowserRefusal(engine).message
        : `omowright.${name} is not available while ${BROWSER_ENGINE_ENV} is set; it can act on a browser without the engine and confirmation policy.`,
    )
    refusal.engine = engine
    if (new.target !== undefined) throw refusal
    return Promise.reject(refusal)
  }
  Object.defineProperty(blocked, "name", { value: name })
  return blocked
}

function allowlistedLibrary(raw, engine, guarded) {
  const library = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "function") library[name] = value
    else if (PASSTHROUGH_FUNCTIONS.has(name)) library[name] = value
    else library[name] = blockedExport(name, engine)
  }
  return Object.assign(library, guarded)
}
