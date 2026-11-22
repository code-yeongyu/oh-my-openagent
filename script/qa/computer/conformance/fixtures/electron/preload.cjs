"use strict"

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("conformanceHost", {
  hideA11y: process.env.CONFORMANCE_FIXTURE_SABOTAGE === "a11y",
  post: (json) => ipcRenderer.send("report", json) })
