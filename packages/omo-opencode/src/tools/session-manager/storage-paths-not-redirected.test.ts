import { expect, test } from "bun:test"
import * as shared from "../../shared"
import * as messageDir from "../../shared/opencode-message-dir"
import * as storagePaths from "../../shared/opencode-storage-paths"
import * as constants from "./constants"
import * as sessionManager from "./index"

test("later file: no storage path or helper still points into a session-manager fixture", () => {
  // Other files' mocks of the shared barrel and opencode-message-dir can leave the two exports as different
  // functions in a full-suite process, so the helpers are checked by what they resolve, not by identity.
  const sessionID = "ses_storage_paths_not_redirected"
  const pointers: Record<string, string | null> = {
    "shared.OPENCODE_STORAGE": shared.OPENCODE_STORAGE,
    "shared.MESSAGE_STORAGE": shared.MESSAGE_STORAGE,
    "storagePaths.MESSAGE_STORAGE": storagePaths.MESSAGE_STORAGE,
    "constants.MESSAGE_STORAGE": constants.MESSAGE_STORAGE,
    "constants.TODO_DIR": constants.TODO_DIR,
    "sessionManager.MESSAGE_STORAGE": sessionManager.MESSAGE_STORAGE,
    "sessionManager.TODO_DIR": sessionManager.TODO_DIR,
    "shared.getMessageDir()": shared.getMessageDir(sessionID),
    "messageDir.getMessageDir()": messageDir.getMessageDir(sessionID),
  }
  expect(Object.entries(pointers).filter(([, path]) => path?.includes("omo-test-session-manager-"))).toEqual([])
  // The storage files tag their fixture functions; a leaked mock is caught by its tag, not by what it returns,
  // because a fixture getMessageDir returns null once its directory is gone, exactly like the real one. Only a
  // re-exporter (the shared barrel) can keep a stale binding: the preload restores every module a file mocks
  // directly after each test, so the barrel's getMessageDir is the one helper this can catch.
  const helpers: Record<string, unknown> = {
    "shared.getMessageDir": shared.getMessageDir,
  }
  expect(
    Object.entries(helpers).filter(([, helper]) => Reflect.get(Object(helper), "__sessionManagerFixture") === true),
  ).toEqual([])
})
