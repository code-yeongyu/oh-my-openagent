import { describe, expect, it } from "bun:test"

import {
  classifyPathEnvironment,
  describePathClassification,
} from "./classify-path-environment"

describe("classifyPathEnvironment", () => {
  it("classifies macOS iCloud path as icloud", () => {
    expect(
      classifyPathEnvironment(
        "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/project/file.txt",
      ),
    ).toBe("icloud")
  })

  it("classifies OneDrive path on unix style", () => {
    expect(classifyPathEnvironment("/Users/x/OneDrive/foo")).toBe("onedrive")
  })

  it("classifies OneDrive path on windows style", () => {
    expect(classifyPathEnvironment("C:\\Users\\x\\OneDrive\\foo")).toBe("onedrive")
  })

  it("classifies macOS Desktop path as desktop-sync", () => {
    expect(classifyPathEnvironment("/Users/x/Desktop/foo")).toBe("desktop-sync")
  })

  it("classifies /Volumes path as network-drive", () => {
    expect(classifyPathEnvironment("/Volumes/NetworkShare/foo")).toBe("network-drive")
  })

  it("classifies random path as unknown", () => {
    expect(classifyPathEnvironment("/tmp/foo")).toBe("unknown")
  })

  it("classifies empty string as unknown", () => {
    expect(classifyPathEnvironment("")).toBe("unknown")
  })

  it("matches OneDrive case-insensitively", () => {
    expect(classifyPathEnvironment("/Users/x/oNeDrIvE/foo")).toBe("onedrive")
  })
})

describe("describePathClassification", () => {
  it("returns human-readable descriptions", () => {
    expect(describePathClassification("icloud")).toBe("iCloud Drive")
    expect(describePathClassification("onedrive")).toBe("OneDrive")
    expect(describePathClassification("desktop-sync")).toBe("Desktop sync (macOS)")
    expect(describePathClassification("network-drive")).toBe("Network drive")
    expect(describePathClassification("unknown")).toBe(
      "filesystem that does not support fsync",
    )
  })
})
