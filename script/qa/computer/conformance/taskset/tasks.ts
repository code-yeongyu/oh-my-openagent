interface ReferenceCell {
  readonly action: "run"
  readonly code: string
}

interface SavedStateOracle {
  readonly field: string
  readonly equals: string | number | boolean
}

export interface Task {
  readonly id: string
  readonly cells: readonly ReferenceCell[]
  readonly oracle: readonly SavedStateOracle[]
}

const FIXTURE_APP = "Conformance Fixture"
export const MAX_REFERENCE_CELLS = 6

const open = `const win = await desktop.window({ app: "${FIXTURE_APP}", title: "Document" })`
const field = (label: string) => `win.ref((await win.find({ role: "textfield", title: "${label}", limit: 1 }))[0].ref)`
const button = (label: string) => `win.ref((await win.find({ role: "button", title: "${label}", limit: 1 }))[0].ref)`
const save = `${open}\nawait win.menu.select(["File", "Save"])\nawait wait({ settle: {} })`
const run = (...lines: string[]): ReferenceCell => ({ action: "run", code: lines.join("\n") })

export const TASKS: readonly Task[] = [
  {
    id: "fill-title-and-save",
    cells: [run(open, `await ${field("Title")}.type("Quarterly plan")`), run(save)],
    oracle: [{ field: "title", equals: "Quarterly plan" }],
  },
  {
    id: "fill-three-fields-and-save",
    cells: [
      run(open, `await ${field("Name")}.type("Ada")`, `await ${field("Email")}.type("ada@example.test")`),
      run(open, `await ${field("City")}.setValue("Seoul")`, `assert(await ${field("City")}.readValue() === "Seoul")`),
      run(save),
    ],
    oracle: [
      { field: "name", equals: "Ada" },
      { field: "email", equals: "ada@example.test" },
      { field: "city", equals: "Seoul" },
    ],
  },
  {
    id: "toggle-checkbox-and-save",
    cells: [
      run(
        open,
        `const box = (await win.find({ role: "checkbox", title: "Archived", limit: 1 }))[0]`,
        `await win.ref(box.ref).perform("toggle")`,
      ),
      run(save),
    ],
    oracle: [{ field: "archived", equals: true }],
  },
  {
    id: "choose-popup-item-by-title",
    cells: [run(open, `await win.menu.select(["Priority", "High"])`), run(save)],
    oracle: [{ field: "priority", equals: "High" }],
  },
  {
    id: "reorder-list-by-drag",
    cells: [
      run(
        open,
        `const [a, b] = await win.find({ role: "row", limit: 2 })`,
        `await win.drag({ x: b.bounds.x + 4, y: b.bounds.y + 4 }, { x: a.bounds.x + 4, y: a.bounds.y + 1 })`,
      ),
      run(save),
    ],
    oracle: [{ field: "order", equals: "b,a,c" }],
  },
  {
    id: "scroll-to-row-and-mark-done",
    cells: [
      run(
        open,
        `const list = (await win.find({ role: "list", limit: 1 }))[0]`,
        `await win.scroll(list.bounds.x + 10, list.bounds.y + 10, { direction: "down", clicks: 20 })`,
      ),
      run(
        open,
        `const row = (await win.find({ role: "row", title: "Row 40", limit: 1 }))[0]`,
        `await win.ref(row.ref).click()`,
        `await ${button("Mark done")}.click()`,
      ),
      run(save),
    ],
    oracle: [{ field: "doneRow", equals: 40 }],
  },
  {
    id: "type-multiline-note",
    cells: [
      run(
        open,
        `const note = ${field("Note")}`,
        `await note.type("first line")`,
        `await note.press("enter")`,
        `await note.type("second line")`,
      ),
      run(save),
    ],
    oracle: [{ field: "note", equals: "first line\nsecond line" }],
  },
  {
    id: "replace-existing-text",
    cells: [
      run(
        open,
        `const title = ${field("Title")}`,
        `const old = (await title.readValue()) ?? ""`,
        `await title.selectText({ start: 0, end: old.length })`,
        `await title.type("Replaced")`,
      ),
      run(save),
    ],
    oracle: [{ field: "title", equals: "Replaced" }],
  },
  {
    id: "rename-through-sheet",
    cells: [
      run(
        open,
        `await win.menu.select(["File", "Rename…"])`,
        `await wait({ surface: { kind: "sheet", state: "appeared" } })`,
      ),
      run(open, `await ${field("New name")}.type("Renamed")`, `await ${button("Rename")}.click()`),
      run(save),
    ],
    oracle: [{ field: "documentName", equals: "Renamed" }],
  },
  {
    id: "add-three-items",
    cells: [
      run(
        open,
        ...["one", "two", "three"].flatMap((item) => [
          `await ${field("New item")}.type("${item}")`,
          `await ${button("Add")}.click()`,
        ]),
      ),
      run(save),
    ],
    oracle: [{ field: "items", equals: "one,two,three" }],
  },
  {
    id: "undo-last-edit",
    cells: [
      run(open, `await ${field("Title")}.type("Keep")`),
      run(open, `await ${field("Title")}.type(" discard")`, `await win.menu.select(["Edit", "Undo"])`),
      run(save),
    ],
    oracle: [{ field: "title", equals: "Keep" }],
  },
  {
    id: "second-window-and-save-both",
    cells: [
      run(
        open,
        `await win.menu.select(["File", "New Window"])`,
        `await wait({ window: { app: "${FIXTURE_APP}", title: "Document 2", state: "appeared" } })`,
      ),
      run(
        `const second = await desktop.window({ app: "${FIXTURE_APP}", title: "Document 2" })`,
        `await second.ref((await second.find({ role: "textfield", title: "Title", limit: 1 }))[0].ref).type("Second")`,
        `await second.menu.select(["File", "Save"])`,
      ),
      run(open, `await ${field("Title")}.type("First")`),
      run(save),
    ],
    oracle: [
      { field: "title", equals: "First" },
      { field: "savedDocuments", equals: 2 },
    ],
  },
]
