// The seven CU eval tasks (DESIGN section 10). Each task is one declarative `plan` the three arms interpret
// (sdk-direct calls the SDK, model+tool scripts `computer` run code, model+CUA scripts `computer_actions`), a
// `readback` of what the oracles look at, the oracles themselves, and a `restore` plan with its post-check so
// the shared Mac is left as found.
//
// Two surfaces per task:
// - `fake`: a scenario for the `senpi-desktop-backend-fake` (`SENPI_DESKTOP_BACKEND=fake:<file>`). The fake
//   applies AX writes (setValue, typeText) to its tree but never runs app logic, so an effect the fake cannot
//   show (a calculator result, a toggled switch, a menu command) is checked on the engine audit file instead.
// - `live`: the same task against real macOS apps (English UI). Its oracles read AX and files the way a person
//   would check the result, and `setup`/`restore` leave the apps as found.
// An `oracle` sees the windows and files as the plan left them, before any restore step. A `postcheck` sees the
// readback taken after the restore steps (before any teardown op closes a window), only the audit lines the
// restore wrote, and the windows and files observed after the teardown ops.
//
// Plan ops: `press` (AX press), `setValue`, `type` (element typing), `menu` (window menu path). An element is
// `{ role, name }`, matched by exact title or description after the engine's substring `ax.query`.
import { createHash } from "node:crypto"

const DISPLAY = {
  id: "1",
  name: "Built-in Display",
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scale: 1,
  pixelX: 0,
  pixelY: 0,
  pixelWidth: 1920,
  pixelHeight: 1080,
  isPrimary: true,
}

function window(id, app, title, x, y, focused = true) {
  return { id, title, app, pid: 4000 + Number(id), x, y, width: 800, height: 600, focused, elevated: null }
}

function node(role, nativeRole, title, x, y, width, height, extra = {}) {
  return {
    role,
    native_role: nativeRole,
    ...(title === null ? {} : { title }),
    bounds: { x, y, width, height },
    ...extra,
  }
}

const button = (title, x, y) => node("button", "AXButton", title, x, y, 60, 40, { actions: ["press"] })
const textfield = (title, x, y) =>
  node("textfield", "AXTextField", title, x, y, 300, 28, { value: "", actions: ["focus"] })
const textarea = (title, x, y) =>
  node("textarea", "AXTextArea", title, x, y, 760, 480, { value: "", actions: ["focus"] })

function scenario(windows, ax, extra = {}) {
  return { displays: [DISPLAY], windows, ax, ...extra }
}

function root(win, children) {
  return node("window", "AXWindow", win.title, win.x, win.y, win.width, win.height, { children })
}

const KOREAN_TEXT = "안녕하세요 컴퓨터 사용 평가"
const TWO_WINDOW_TEXT = "only the second window"

/** Audit lines of `action` that succeeded on `target`. */
function auditCount(audit, action, target) {
  return audit.filter(
    (line) => line.action === action && line.status === "success" && (target === undefined || line.target === target),
  ).length
}

/**
 * `true` when `n` AX presses reached `target`; `null` when only `n` coordinate clicks landed somewhere (a CUA
 * route: delivered, but the audit cannot say which element took them); `false` otherwise.
 */
export function pressesReached(audit, target, n) {
  if (auditCount(audit, "ax.perform", target) >= n) return true
  return auditCount(audit, "click") >= n ? null : false
}

/**
 * `true` when the AX value reads `text`; `null` when the audit shows a typeText whose hash prefix matches
 * `text` (delivered as keys to a target the audit names, so the receiving field is unknown); `false` otherwise.
 */
export function textLanded(value, audit, text) {
  if (value === text) return true
  const sha = createHash("sha256").update(text).digest("hex").slice(0, 16)
  return audit.some((line) => line.action === "typeText" && line.status === "success" && line.textSha256 === sha)
    ? null
    : false
}

const calcWin = window("301", "Calculator", "Calculator", 200, 150)
const finderWin = window("311", "Finder", "Recents", 150, 120)
const editWin = window("321", "TextEdit", "cu-eval-korean.txt", 120, 100)
const safariWin = window("331", "Safari", "cu-eval form", 100, 80)
const settingsWin = window("341", "System Settings", "Display", 160, 110)
const firstWin = window("351", "TextEdit", "cu-eval-a.txt", 100, 100)
const secondWin = window("352", "TextEdit", "cu-eval-b.txt", 400, 200, false)
const menuWin = window("361", "TextEdit", "cu-eval-menu.txt", 120, 100)

export const TASKS = [
  {
    id: "calculator-multiply",
    title: "계산기 곱셈",
    prompt: "In Calculator, compute 7 x 8 with the keypad buttons.",
    fake: {
      scenario: scenario([calcWin], {
        301: root(calcWin, [
          node("statictext", "AXStaticText", "display", 220, 170, 760, 60, { value: "0" }),
          button("7", 220, 300),
          button("8", 290, 300),
          button("multiply", 430, 300),
          button("equals", 430, 440),
          button("clear", 220, 250),
        ]),
      }),
      window: { app: "Calculator" },
      plan: [
        { op: "press", el: { role: "button", name: "7" } },
        { op: "press", el: { role: "button", name: "multiply" } },
        { op: "press", el: { role: "button", name: "8" } },
        { op: "press", el: { role: "button", name: "equals" } },
      ],
      readback: [{ key: "display", el: { role: "statictext", name: "display" }, field: "value" }],
      expect: { presses: 4 },
      oracle: ({ audit, expect }) => [
        {
          check: `${expect.presses} keypad presses reached the calculator window`,
          kind: "audit",
          ok: pressesReached(audit, "301", expect.presses),
        },
        // The fake runs no arithmetic: the display result is a live-only oracle.
        { check: "the display shows 56", kind: "ax", ok: null, why: "the fake backend runs no app logic" },
      ],
      restore: [{ op: "press", el: { role: "button", name: "clear" } }],
      postcheck: ({ audit }) => [
        {
          check: "the clear press reached the calculator",
          kind: "audit",
          ok: auditCount(audit, "ax.perform", "301") >= 1,
        },
      ],
    },
    live: {
      setup: [["open", "-a", "Calculator"]],
      window: { app: "Calculator" },
      before: [{ op: "press", el: { role: "button", name: "All Clear" }, optional: true }],
      plan: [
        { op: "press", el: { role: "button", name: "7" } },
        { op: "press", el: { role: "button", name: "Multiply" } },
        { op: "press", el: { role: "button", name: "8" } },
        { op: "press", el: { role: "button", name: "Equals" } },
      ],
      readback: [{ key: "display", el: { role: "statictext", name: "" }, field: "value", last: true }],
      expect: { display: "56" },
      oracle: ({ readback, expect }) => [
        { check: "the display shows 56", kind: "ax", ok: digits(readback.display) === expect.display },
      ],
      restore: [
        { op: "press", el: { role: "button", name: "All Clear" }, optional: true },
        { op: "quit", app: "Calculator" },
      ],
      postcheck: ({ readback }) => [
        { check: "the display is cleared again", kind: "ax", ok: digits(readback.display) === "0" },
      ],
    },
  },
  {
    id: "finder-sidebar-navigate",
    title: "Finder 사이드바 이동",
    prompt: "In the Finder window, go to Downloads using the sidebar.",
    fake: {
      scenario: scenario([finderWin], {
        311: root(finderWin, [
          node("outline", "AXOutline", "sidebar", 160, 160, 180, 500, {
            children: [
              node("row", "AXRow", "Recents", 160, 170, 180, 24, { actions: ["press"] }),
              node("row", "AXRow", "Documents", 160, 200, 180, 24, { actions: ["press"] }),
              node("row", "AXRow", "Downloads", 160, 230, 180, 24, { actions: ["press"] }),
            ],
          }),
        ]),
      }),
      window: { app: "Finder" },
      plan: [{ op: "press", el: { role: "row", name: "Downloads" } }],
      readback: [],
      expect: { presses: 1 },
      oracle: ({ audit, expect }) => [
        {
          check: "the sidebar press reached the Finder window",
          kind: "audit",
          ok: pressesReached(audit, "311", expect.presses),
        },
        { check: "the window now shows Downloads", kind: "ax", ok: null, why: "the fake backend runs no app logic" },
      ],
      restore: [{ op: "press", el: { role: "row", name: "Recents" } }],
      postcheck: ({ audit }) => [
        {
          check: "the return press reached the Finder window",
          kind: "audit",
          ok: auditCount(audit, "ax.perform", "311") >= 1,
        },
      ],
    },
    live: {
      setup: [["open", "-a", "Finder", "/Applications"]],
      window: { app: "Finder", title: "Applications" },
      plan: [{ op: "press", el: { role: "row", name: "Downloads" } }],
      readback: [],
      expect: { title: "Downloads" },
      oracle: ({ windows, expect }) => [
        {
          check: "a Finder window shows Downloads",
          kind: "ax",
          ok: windows.some((w) => w.app === "Finder" && w.title === expect.title),
        },
      ],
      restore: [{ op: "press", el: { role: "row", name: "Applications" } }, { op: "closeWindow" }],
      postcheck: ({ windows }) => [
        {
          check: "no eval Finder window is left open",
          kind: "ax",
          ok: !windows.some((w) => w.app === "Finder" && ["Downloads", "Applications"].includes(w.title)),
        },
      ],
    },
  },
  {
    id: "textedit-korean-no-save",
    title: "TextEdit 한국어 입력 뒤 저장 안 함",
    prompt: `In the TextEdit document, type "${KOREAN_TEXT}", then close it without saving.`,
    fake: {
      scenario: scenario([editWin], { 321: root(editWin, [textarea("document", 130, 140), button("Save", 800, 640)]) }),
      window: { app: "TextEdit" },
      plan: [{ op: "type", el: { role: "textarea", name: "document" }, text: KOREAN_TEXT }],
      readback: [{ key: "document", el: { role: "textarea", name: "document" }, field: "value" }],
      expect: { document: KOREAN_TEXT },
      oracle: ({ readback, audit, expect }) => [
        {
          check: "the document holds the Korean text exactly",
          kind: "ax",
          ok: textLanded(readback.document, audit, expect.document),
        },
        { check: "Save was never pressed", kind: "audit", ok: auditCount(audit, "ax.perform", "321") === 0 },
      ],
      restore: [{ op: "setValue", el: { role: "textarea", name: "document" }, value: "" }],
      postcheck: ({ readback }) => [{ check: "the document is empty again", kind: "ax", ok: readback.document === "" }],
    },
    live: {
      files: { "cu-eval-korean.txt": "" },
      setup: [["open", "-a", "TextEdit", "{dir}/cu-eval-korean.txt"]],
      window: { app: "TextEdit", title: "cu-eval-korean.txt" },
      plan: [{ op: "type", el: { role: "textarea", name: "" }, text: KOREAN_TEXT }],
      readback: [{ key: "document", el: { role: "textarea", name: "" }, field: "value" }],
      expect: { document: KOREAN_TEXT },
      oracle: ({ readback, expect }) => [
        { check: "the document holds the Korean text exactly", kind: "ax", ok: readback.document === expect.document },
      ],
      restore: [
        { op: "setValue", el: { role: "textarea", name: "" }, value: "" },
        { op: "closeWindow", discard: true },
      ],
      postcheck: ({ files, windows }) => [
        { check: "the file on disk is unchanged (never saved)", kind: "file", ok: files["cu-eval-korean.txt"] === "" },
        {
          check: "the document window is closed",
          kind: "ax",
          ok: !windows.some((w) => w.title.startsWith("cu-eval-korean")),
        },
      ],
    },
  },
  {
    id: "safari-form-fill",
    title: "Safari 폼 입력",
    prompt: "In the Safari form, fill Name with 'Eval Tester' and Email with 'eval@example.com'.",
    fake: {
      scenario: scenario([safariWin], {
        331: root(safariWin, [
          node("webarea", "AXWebArea", "cu-eval form", 110, 140, 780, 520, {
            children: [textfield("Name", 130, 180), textfield("Email", 130, 230), button("Submit", 130, 280)],
          }),
        ]),
      }),
      window: { app: "Safari" },
      plan: [
        { op: "setValue", el: { role: "textfield", name: "Name" }, value: "Eval Tester" },
        { op: "setValue", el: { role: "textfield", name: "Email" }, value: "eval@example.com" },
      ],
      readback: [
        { key: "name", el: { role: "textfield", name: "Name" }, field: "value" },
        { key: "email", el: { role: "textfield", name: "Email" }, field: "value" },
      ],
      expect: { name: "Eval Tester", email: "eval@example.com" },
      oracle: ({ readback, audit, expect }) => [
        { check: "Name holds the requested value", kind: "ax", ok: textLanded(readback.name, audit, expect.name) },
        { check: "Email holds the requested value", kind: "ax", ok: textLanded(readback.email, audit, expect.email) },
      ],
      restore: [
        { op: "setValue", el: { role: "textfield", name: "Name" }, value: "" },
        { op: "setValue", el: { role: "textfield", name: "Email" }, value: "" },
      ],
      postcheck: ({ readback }) => [
        { check: "both fields are cleared", kind: "ax", ok: readback.name === "" && readback.email === "" },
      ],
    },
    live: {
      files: {
        "cu-eval-form.html":
          '<!doctype html><title>cu-eval form</title><form><label>Name <input aria-label="Name" name="name"></label><label>Email <input aria-label="Email" name="email"></label></form>',
      },
      setup: [["open", "-a", "Safari", "{dir}/cu-eval-form.html"]],
      window: { app: "Safari", title: "cu-eval form" },
      plan: [
        { op: "setValue", el: { role: "textfield", name: "Name" }, value: "Eval Tester" },
        { op: "setValue", el: { role: "textfield", name: "Email" }, value: "eval@example.com" },
      ],
      readback: [
        { key: "name", el: { role: "textfield", name: "Name" }, field: "value" },
        { key: "email", el: { role: "textfield", name: "Email" }, field: "value" },
      ],
      expect: { name: "Eval Tester", email: "eval@example.com" },
      oracle: ({ readback, expect }) => [
        { check: "Name holds the requested value", kind: "ax", ok: readback.name === expect.name },
        { check: "Email holds the requested value", kind: "ax", ok: readback.email === expect.email },
      ],
      restore: [
        { op: "setValue", el: { role: "textfield", name: "Name" }, value: "" },
        { op: "setValue", el: { role: "textfield", name: "Email" }, value: "" },
        { op: "closeWindow" },
      ],
      postcheck: ({ windows }) => [
        { check: "the form tab is closed", kind: "ax", ok: !windows.some((w) => w.title.includes("cu-eval form")) },
      ],
    },
  },
  {
    id: "settings-toggle",
    title: "시스템 설정 토글",
    prompt: "In System Settings > Accessibility > Display, turn Reduce motion on.",
    fake: {
      scenario: scenario([settingsWin], {
        341: root(settingsWin, [
          node("checkbox", "AXCheckBox", "Reduce motion", 400, 300, 40, 24, { value: "0", actions: ["press"] }),
        ]),
      }),
      window: { app: "System Settings" },
      plan: [{ op: "press", el: { role: "checkbox", name: "Reduce motion" } }],
      readback: [{ key: "toggle", el: { role: "checkbox", name: "Reduce motion" }, field: "value" }],
      expect: { presses: 1 },
      oracle: ({ audit, expect }) => [
        {
          check: "the toggle press reached System Settings",
          kind: "audit",
          ok: pressesReached(audit, "341", expect.presses),
        },
        { check: "the switch reads on", kind: "ax", ok: null, why: "the fake backend runs no app logic" },
      ],
      restore: [{ op: "press", el: { role: "checkbox", name: "Reduce motion" } }],
      postcheck: ({ audit }) => [
        {
          check: "the restoring press reached System Settings",
          kind: "audit",
          ok: auditCount(audit, "ax.perform", "341") >= 1,
        },
      ],
    },
    live: {
      setup: [["open", "x-apple.systempreferences:com.apple.preference.universalaccess?Seeing_Display"]],
      window: { app: "System Settings" },
      remember: [{ key: "toggle", el: { role: "checkbox", name: "Reduce motion" }, field: "value" }],
      plan: [{ op: "press", el: { role: "checkbox", name: "Reduce motion" } }],
      readback: [{ key: "toggle", el: { role: "checkbox", name: "Reduce motion" }, field: "value" }],
      expect: {},
      oracle: ({ readback, remembered }) => [
        {
          check: "the switch flipped",
          kind: "ax",
          ok: readback.toggle !== null && readback.toggle !== remembered.toggle,
        },
      ],
      restore: [
        { op: "press", el: { role: "checkbox", name: "Reduce motion" }, onlyIfChanged: "toggle" },
        { op: "quit", app: "System Settings" },
      ],
      postcheck: ({ remembered, readback }) => [
        { check: "the switch is back to its original value", kind: "ax", ok: readback.toggle === remembered.toggle },
      ],
    },
  },
  {
    id: "textedit-two-windows-target",
    title: "TextEdit 두 창 중 지정 창 타이핑",
    prompt: `Two TextEdit windows are open. Type "${TWO_WINDOW_TEXT}" into cu-eval-b.txt only.`,
    fake: {
      scenario: scenario([firstWin, secondWin], {
        351: root(firstWin, [textarea("document", 110, 140)]),
        352: root(secondWin, [textarea("document", 410, 240)]),
      }),
      window: { app: "TextEdit", title: "cu-eval-b.txt" },
      plan: [{ op: "type", el: { role: "textarea", name: "document" }, text: TWO_WINDOW_TEXT }],
      readback: [
        { key: "second", el: { role: "textarea", name: "document" }, field: "value" },
        {
          key: "first",
          window: { app: "TextEdit", title: "cu-eval-a.txt" },
          el: { role: "textarea", name: "document" },
          field: "value",
        },
      ],
      expect: { second: TWO_WINDOW_TEXT, first: "" },
      oracle: ({ readback, audit, expect }) => [
        { check: "the named window holds the text", kind: "ax", ok: textLanded(readback.second, audit, expect.second) },
        { check: "the other window is untouched", kind: "ax", ok: readback.first === expect.first },
      ],
      restore: [{ op: "setValue", el: { role: "textarea", name: "document" }, value: "" }],
      postcheck: ({ readback }) => [
        { check: "both documents are empty again", kind: "ax", ok: readback.second === "" && readback.first === "" },
      ],
    },
    live: {
      files: { "cu-eval-a.txt": "", "cu-eval-b.txt": "" },
      setup: [["open", "-a", "TextEdit", "{dir}/cu-eval-a.txt", "{dir}/cu-eval-b.txt"]],
      window: { app: "TextEdit", title: "cu-eval-b.txt" },
      plan: [{ op: "type", el: { role: "textarea", name: "" }, text: TWO_WINDOW_TEXT }],
      readback: [
        { key: "second", el: { role: "textarea", name: "" }, field: "value" },
        {
          key: "first",
          window: { app: "TextEdit", title: "cu-eval-a.txt" },
          el: { role: "textarea", name: "" },
          field: "value",
        },
      ],
      expect: { second: TWO_WINDOW_TEXT, first: "" },
      oracle: ({ readback, expect }) => [
        { check: "the named window holds the text", kind: "ax", ok: readback.second === expect.second },
        { check: "the other window is untouched", kind: "ax", ok: readback.first === expect.first },
      ],
      restore: [
        { op: "setValue", el: { role: "textarea", name: "" }, value: "" },
        { op: "closeWindow", discard: true },
        { op: "closeWindow", window: { app: "TextEdit", title: "cu-eval-a.txt" }, discard: true },
      ],
      postcheck: ({ files, windows }) => [
        {
          check: "neither file on disk changed",
          kind: "file",
          ok: files["cu-eval-a.txt"] === "" && files["cu-eval-b.txt"] === "",
        },
        { check: "both eval windows are closed", kind: "ax", ok: !windows.some((w) => w.title.startsWith("cu-eval-")) },
      ],
    },
  },
  {
    id: "menu-path-select",
    title: "메뉴 경로 선택",
    prompt: "In the TextEdit window, choose Format > Text > Show Ruler from the menu bar.",
    fake: {
      scenario: scenario(
        [menuWin],
        { 361: root(menuWin, [textarea("document", 130, 140)]) },
        {
          menus: {
            361: [
              { title: "File", children: [{ title: "Save", shortcut: "Cmd+S" }] },
              {
                title: "Format",
                children: [{ title: "Text", children: [{ title: "Show Ruler" }, { title: "Align Left" }] }],
              },
            ],
          },
        },
      ),
      window: { app: "TextEdit" },
      plan: [{ op: "menu", path: ["Format", "Text", "Show Ruler"] }],
      readback: [{ key: "submenu", menu: ["Format", "Text"] }],
      expect: { selects: 1, item: "Show Ruler" },
      oracle: ({ readback, audit, expect }) => [
        {
          check: "the menu command reached the window",
          kind: "audit",
          ok: auditCount(audit, "menus.select", "361") >= expect.selects,
        },
        {
          check: "the path exists in the window's menu",
          kind: "ax",
          ok: Array.isArray(readback.submenu) && readback.submenu.includes(expect.item),
        },
        {
          check: "no other menu command was chosen",
          kind: "audit",
          ok: auditCount(audit, "menus.select", "361") <= expect.selects,
        },
      ],
      restore: [],
      postcheck: () => [],
    },
    live: {
      files: { "cu-eval-menu.txt": "" },
      setup: [["open", "-a", "TextEdit", "{dir}/cu-eval-menu.txt"]],
      window: { app: "TextEdit", title: "cu-eval-menu.txt" },
      plan: [{ op: "menu", path: ["Format", "Text", "Show Ruler"] }],
      readback: [{ key: "submenu", menu: ["Format", "Text"] }],
      expect: { item: "Hide Ruler" },
      oracle: ({ readback, expect }) => [
        {
          check: "the ruler is shown (the menu now offers Hide Ruler)",
          kind: "ax",
          ok: Array.isArray(readback.submenu) && readback.submenu.includes(expect.item),
        },
      ],
      restore: [
        { op: "menu", path: ["Format", "Text", "Hide Ruler"] },
        { op: "closeWindow", discard: true },
      ],
      postcheck: ({ files, windows }) => [
        { check: "the file on disk is unchanged", kind: "file", ok: files["cu-eval-menu.txt"] === "" },
        {
          check: "the eval window is closed",
          kind: "ax",
          ok: !windows.some((w) => w.title.startsWith("cu-eval-menu")),
        },
      ],
    },
  },
]

function digits(value) {
  return typeof value === "string" ? value.replace(/[^0-9.-]/g, "") : null
}
