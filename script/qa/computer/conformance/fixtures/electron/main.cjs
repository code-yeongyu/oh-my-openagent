"use strict"

// Electron host of the shared fixture page (../web). Usage: electron main.cjs --report <path>. Same report
// and stdin control protocol as native-linux/fixture.py.
const { app, BrowserWindow, Menu, ipcMain } = require("electron")
const { createReadStream, renameSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
const readline = require("node:readline")

const APP = "Conformance Fixture"
const SCHEMA = "omo-conformance-fixture/1"
const SABOTAGE = process.env.CONFORMANCE_FIXTURE_SABOTAGE ?? ""
const reportPath = process.argv[process.argv.indexOf("--report") + 1]
const windows = []
const states = new Map()
let initial = null

app.setName(APP)

function sorted(value) {
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
}

function compose() {
  const main = states.get(windows[0].id)
  const savedDocuments = windows.filter((window) => states.get(window.id)?.savedOnce).length
  return { schema: SCHEMA, app: APP, toolkit: "electron", fields: { ...main.fields }, saved: { ...main.saved, savedDocuments } }
}

function writeReport() {
  if (windows.length === 0 || !states.has(windows[0].id)) return
  const report = compose()
  initial ??= structuredClone(report)
  for (const section of ["fields", "saved"]) {
    if (SABOTAGE in report[section]) report[section][SABOTAGE] = initial[section][SABOTAGE]
  }
  writeFileSync(`${reportPath}.tmp`, `${JSON.stringify(sorted(report), null, 2)}\n`)
  renameSync(`${reportPath}.tmp`, reportPath)
}

function openWindow() {
  const number = windows.length + 1
  const title = number === 1 ? "Document" : `Document ${number}`
  const window = new BrowserWindow({
    title,
    width: 640,
    height: 720,
    show: true,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  })
  window.on("page-title-updated", (event) => event.preventDefault())
  windows.push(window)
  void window.loadFile(join(__dirname, "..", "web", "index.html"))
  return window
}

async function inPage(window, call) {
  const state = await window.webContents.executeJavaScript(call)
  states.set(window.id, state)
  writeReport()
}

async function menu(window, path) {
  if (path === "File/New Window") {
    const opened = openWindow()
    await new Promise((resolve) => opened.webContents.once("did-finish-load", resolve))
    writeReport()
    return
  }
  await inPage(window, `conformance.menu(${JSON.stringify(path)})`)
}

function buildMenu() {
  const items = {
    File: ["Save", "Rename…", "New Window"],
    Edit: ["Undo"],
    Priority: ["Low", "Normal", "High"],
    Test: ["Conformance"],
  }
  const template = Object.entries(items).map(([title, labels]) => ({
    label: title,
    submenu: labels.map((label) => ({
      label,
      click: (_item, focused) => void menu(focused ?? windows[0], `${title}/${label}`),
    })),
  }))
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function control(line) {
  const [verb, rest = ""] = line.split(/ (.*)/s)
  const main = windows[0]
  if (verb === "poke") await inPage(main, `conformance.poke(${JSON.stringify(rest)})`)
  else if (verb === "menu") await menu(main, rest)
  else if (verb === "set") {
    const [label, text = ""] = rest.split(/ (.*)/s)
    await inPage(main, `conformance.set(${JSON.stringify(label)}, ${JSON.stringify(text)})`)
  } else throw new Error(`unknown control line ${line}`)
  return `OK ${line}`
}

function listen() {
  const input = readline.createInterface({ input: createReadStream(null, { fd: 0 }) })
  let queue = Promise.resolve()
  input.on("line", (line) => {
    if (line === "") return
    if (line === "quit") {
      app.quit()
      return
    }
    queue = queue.then(() =>
      control(line).then(
        (answer) => process.stdout.write(`${answer}\n`),
        (error) => process.stdout.write(`ERR ${error.message.split("\n")[0]}\n`),
      ),
    )
  })
  input.on("close", () => {
    process.stderr.write("fixture: control input closed, quitting\n")
    app.quit()
  })
}

ipcMain.on("report", (event, json) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window === null) return
  states.set(window.id, JSON.parse(json))
  writeReport()
})

app.whenReady().then(() => {
  if (reportPath === undefined || !process.argv.includes("--report")) {
    process.stderr.write("usage: electron main.cjs --report <path>\n")
    app.exit(2)
    return
  }
  buildMenu()
  const main = openWindow()
  main.webContents.once("did-finish-load", () => {
    void inPage(main, "conformance.state()").then(() => {
      process.stdout.write(`READY pid=${process.pid}\n`)
      listen()
    })
  })
})

app.on("window-all-closed", () => app.quit())
