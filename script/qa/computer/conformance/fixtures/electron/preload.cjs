"use strict"

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("conformanceHost", { post: (json) => ipcRenderer.send("report", json) })
