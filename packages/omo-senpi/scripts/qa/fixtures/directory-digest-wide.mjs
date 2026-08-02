import { listFiles } from "../directory-digest.mjs"

const fileCount = 300_000
const operations = {
  readdirSync(path) {
    if (path === "root") return [directoryEntry("wide")]
    return Array.from({ length: fileCount }, (_, index) => fileEntry(`${index}.txt`))
  },
}

const files = listFiles("root", operations)
if (files.length !== fileCount) throw new Error(`expected ${fileCount} files, received ${files.length}`)

function directoryEntry(name) {
  return { name, isDirectory: () => true, isFile: () => false }
}

function fileEntry(name) {
  return { name, isDirectory: () => false, isFile: () => true }
}
