"use strict"

// The page of the Electron and web-view fixtures. A host loads it, gives it native menus that call
// conformance.menu(path), and writes the report: the page hands its state to window.conformanceHost.post
// after every change and returns it from every conformance.* call, so the host never reads the DOM.
const UNDO_GROUP_MS = 1000
const LONG_ROWS = 60
const $ = (selector) => document.querySelector(selector)

const state = {
  pressCount: 0,
  chords: [],
  scrollSteps: 0,
  order: ["a", "b", "c"],
  menuSelection: "",
  priority: "",
  documentName: "Document",
  items: [],
  doneRow: 0,
  saved: null,
  savedOnce: false,
}
const undo = { groups: [], lastText: new Map(), lastLabel: null, lastAt: 0, restoring: false }
const fields = new Map()
let dragSource = null

function documentState() {
  const text = (label) => fields.get(label).value
  return {
    title: text("Title"),
    name: text("Name"),
    email: text("Email"),
    city: text("City"),
    archived: $("#archived").checked,
    priority: state.priority,
    order: state.order.join(","),
    doneRow: state.doneRow,
    note: text("Note"),
    documentName: state.documentName,
    items: state.items.join(","),
  }
}

function snapshot() {
  return {
    fields: {
      value: fields.get("Value").value,
      receivedKeys: state.chords.join(","),
      pressCount: state.pressCount,
      scrollSteps: state.scrollSteps,
      dragOrder: state.order.join(","),
      menuSelection: state.menuSelection,
    },
    saved: state.saved,
    savedOnce: state.savedOnce,
  }
}

function changed() {
  window.conformanceHost?.post(JSON.stringify(snapshot()))
}

function edited(label) {
  if (!undo.restoring) {
    const now = performance.now()
    if (undo.lastLabel !== label || now - undo.lastAt > UNDO_GROUP_MS) undo.groups.push([label, undo.lastText.get(label)])
    undo.lastLabel = label
    undo.lastAt = now
  }
  undo.lastText.set(label, fields.get(label).value)
  changed()
}

function setText(label, text) {
  const field = fields.get(label)
  field.value = text
  field.dispatchEvent(new Event("input", { bubbles: true }))
}

function renderOrder() {
  const list = $("#order")
  list.replaceChildren(
    ...state.order.map((item) => {
      const row = document.createElement("li")
      row.textContent = item
      row.setAttribute("role", "row")
      row.setAttribute("aria-label", item)
      row.dataset.item = item
      return row
    }),
  )
}

function dropOn(target, clientY) {
  const source = dragSource
  dragSource = null
  if (source === null || target === null || target.dataset.item === source) return
  const box = target.getBoundingClientRect()
  const order = state.order.filter((item) => item !== source)
  const index = order.indexOf(target.dataset.item) + (clientY >= box.top + box.height / 2 ? 1 : 0)
  order.splice(index, 0, source)
  state.order = order
  renderOrder()
  changed()
}

function onKey(event) {
  if (!(event.ctrlKey || event.altKey || event.metaKey) || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return
  const parts = [["ctrl", event.ctrlKey], ["alt", event.altKey], ["shift", event.shiftKey], ["super", event.metaKey]]
  state.chords.push([...parts.filter(([, on]) => on).map(([name]) => name), event.key.toLowerCase()].join("+"))
  changed()
}

const MENU = {
  "File/Save": () => {
    state.saved = documentState()
    state.savedOnce = true
  },
  "File/Rename…": () => $("#rename").showModal(),
  "Edit/Undo": () => {
    const group = undo.groups.pop()
    if (group === undefined) return
    undo.lastLabel = null
    undo.restoring = true
    try {
      setText(group[0], group[1])
    } finally {
      undo.restoring = false
    }
  },
  "Priority/Low": () => (state.priority = "Low"),
  "Priority/Normal": () => (state.priority = "Normal"),
  "Priority/High": () => (state.priority = "High"),
  "Test/Conformance": () => (state.menuSelection = "Conformance"),
}

function mouse(type, element, clientY) {
  const box = element.getBoundingClientRect()
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: box.left + 4, clientY }))
}

const POKE = {
  click: () => $("#press").click(),
  "ax.perform": () => $("#press").click(),
  typeText: () => setText("Value", `${fields.get("Value").value}conformance`),
  "ax.setValue": () => setText("Value", "conformance"),
  keyChord: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })),
  scroll: () => {
    for (let i = 0; i < 3; i++) $("#scroll").dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }))
  },
  drag: () => {
    const row = (item) => $(`#order [data-item="${item}"]`)
    mouse("mousedown", row("b"), row("b").getBoundingClientRect().top + 4)
    mouse("mouseup", row("a"), row("a").getBoundingClientRect().top + 1)
  },
  "menu.select": () => MENU["Test/Conformance"](),
}

window.conformance = {
  state: snapshot,
  menu(path) {
    if (!(path in MENU)) throw new Error(`unknown menu item ${path}`)
    MENU[path]()
    changed()
    return snapshot()
  },
  poke(action) {
    if (!(action in POKE)) throw new Error(`unknown action ${action}`)
    POKE[action]()
    return snapshot()
  },
  set(label, text) {
    if (!fields.has(label)) throw new Error(`unknown field ${label}`)
    setText(label, text)
    return snapshot()
  },
}

for (const field of document.querySelectorAll("[data-field]")) {
  const label = field.getAttribute("aria-label")
  fields.set(label, field)
  undo.lastText.set(label, field.value)
  field.addEventListener("input", () => edited(label))
}
$("#press").addEventListener("click", () => {
  state.pressCount += 1
  changed()
})
$("#archived").addEventListener("change", changed)
$("#add").addEventListener("click", () => {
  if (fields.get("New item").value !== "") {
    state.items.push(fields.get("New item").value)
    setText("New item", "")
  }
  changed()
})
$("#scroll").addEventListener("wheel", (event) => {
  event.preventDefault()
  if (event.deltaY === 0) return
  state.scrollSteps += Math.sign(event.deltaY)
  changed()
})
$("#order").addEventListener("mousedown", (event) => {
  dragSource = event.target.closest("li")?.dataset.item ?? null
})
$("#order").addEventListener("mouseup", (event) => dropOn(event.target.closest("li"), event.clientY))
$("#rows").replaceChildren(
  ...Array.from({ length: LONG_ROWS }, (_, i) => new Option(`Row ${i + 1}`, String(i + 1))),
)
$("#mark-done").addEventListener("click", () => {
  if ($("#rows").value === "") return
  state.doneRow = Number($("#rows").value)
  changed()
})
$("#rename-button").addEventListener("click", () => {
  if ($("#new-name").value !== "") state.documentName = $("#new-name").value
  $("#rename").close()
  changed()
})
document.addEventListener("keydown", onKey, true)
renderOrder()
state.saved = documentState()
changed()

// Sabotage leg of the a11y check: the host asks the page to hide itself from assistive technology.
if (window.conformanceHost?.hideA11y) document.body.setAttribute("aria-hidden", "true")
