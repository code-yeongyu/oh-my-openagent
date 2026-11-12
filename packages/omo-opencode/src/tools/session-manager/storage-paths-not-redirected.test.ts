import { expect, test } from "bun:test"
import * as shared from "../../shared"
import * as messageDir from "../../shared/opencode-message-dir"
import * as storageDetection from "../../shared/opencode-storage-detection"
import * as storagePaths from "../../shared/opencode-storage-paths"
import * as constants from "./constants"
import * as sessionManager from "./index"

test("later file: no storage path or helper still points into a session-manager fixture", () => {
  const paths = {
    "shared.OPENCODE_STORAGE": shared.OPENCODE_STORAGE,
    "shared.MESSAGE_STORAGE": shared.MESSAGE_STORAGE,
    "storagePaths.MESSAGE_STORAGE": storagePaths.MESSAGE_STORAGE,
    "constants.MESSAGE_STORAGE": constants.MESSAGE_STORAGE,
    "constants.TODO_DIR": constants.TODO_DIR,
    "sessionManager.MESSAGE_STORAGE": sessionManager.MESSAGE_STORAGE,
    "sessionManager.TODO_DIR": sessionManager.TODO_DIR,
  }
  expect(Object.entries(paths).filter(([, path]) => path.includes("omo-test-session-manager-"))).toEqual([])
  expect(shared.getMessageDir).toBe(messageDir.getMessageDir)
  expect(shared.isSqliteBackend).toBe(storageDetection.isSqliteBackend)
})
