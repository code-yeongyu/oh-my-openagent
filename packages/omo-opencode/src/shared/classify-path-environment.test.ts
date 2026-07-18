import { describe, test, expect } from "bun:test"
import { classifyPathEnvironment, describePathClassification } from "./classify-path-environment"

describe("classifyPathEnvironment", () => {
  describe("#given an empty path", () => {
    test("#then it returns unknown", () => {
      expect(classifyPathEnvironment("")).toBe("unknown")
    })
  })

  describe("#given a path containing OneDrive", () => {
    describe("#when the path includes /OneDrive (unix style)", () => {
      test("#then it returns onedrive", () => {
        expect(classifyPathEnvironment("/Users/x/OneDrive/foo")).toBe("onedrive")
      })
    })

    describe("#when the path uses Windows backslashes", () => {
      test("#then it normalizes and returns onedrive", () => {
        expect(classifyPathEnvironment("C:\\Users\\x\\OneDrive\\foo")).toBe("onedrive")
      })
    })

    describe("#when the case varies", () => {
      test("#then it matches case-insensitively", () => {
        expect(classifyPathEnvironment("/Users/x/oNeDrIvE/foo")).toBe("onedrive")
      })

      test("#then it matches all uppercase", () => {
        expect(classifyPathEnvironment("/Users/x/ONEDRIVE/foo")).toBe("onedrive")
      })

      test("#then it matches all lowercase", () => {
        expect(classifyPathEnvironment("/Users/x/onedrive/foo")).toBe("onedrive")
      })
    })

    describe("#when OneDrive is a leaf directory", () => {
      test("#then it still detects onedrive", () => {
        expect(classifyPathEnvironment("/Users/x/OneDrive")).toBe("onedrive")
      })
    })
  })

  describe("#given a path containing iCloud", () => {
    describe("#when the path includes /Library/Mobile Documents/", () => {
      test("#then it returns icloud", () => {
        expect(
          classifyPathEnvironment(
            "/Users/x/Library/Mobile Documents/com~apple~CloudDocs/project/file.txt",
          ),
        ).toBe("icloud")
      })
    })

    describe("#when the path has nested iCloud content", () => {
      test("#then it returns icloud", () => {
        expect(
          classifyPathEnvironment("/Users/x/Library/Mobile Documents/iCloud~md~obsidian/Documents"),
        ).toBe("icloud")
      })
    })
  })

  describe("#given a path under /Volumes", () => {
    describe("#when the path is a network share", () => {
      test("#then it returns network-drive", () => {
        expect(classifyPathEnvironment("/Volumes/NetworkShare/foo")).toBe("network-drive")
      })
    })

    describe("#when the path is exactly /Volumes", () => {
      test("#then it returns network-drive", () => {
        expect(classifyPathEnvironment("/Volumes")).toBe("network-drive")
      })
    })
  })

  describe("#given a path under /Users Desktop or Documents", () => {
    describe("#when the path includes /Desktop/", () => {
      test("#then it returns desktop-sync", () => {
        expect(classifyPathEnvironment("/Users/x/Desktop/foo")).toBe("desktop-sync")
      })
    })

    describe("#when the path ends with /Desktop", () => {
      test("#then it returns desktop-sync", () => {
        expect(classifyPathEnvironment("/Users/x/Desktop")).toBe("desktop-sync")
      })
    })

    describe("#when the path includes /Documents/", () => {
      test("#then it returns desktop-sync", () => {
        expect(classifyPathEnvironment("/Users/x/Documents/project")).toBe("desktop-sync")
      })
    })

    describe("#when the path ends with /Documents", () => {
      test("#then it returns desktop-sync", () => {
        expect(classifyPathEnvironment("/Users/x/Documents")).toBe("desktop-sync")
      })
    })
  })

  describe("#given a regular path", () => {
    describe("#when the path is a normal project directory", () => {
      test("#then it returns unknown", () => {
        expect(classifyPathEnvironment("/tmp/foo")).toBe("unknown")
      })
    })

    describe("#when the path is a system directory", () => {
      test("#then it returns unknown", () => {
        expect(classifyPathEnvironment("/usr/local/bin")).toBe("unknown")
      })
    })

    describe("#when the path is a home subdirectory without sync", () => {
      test("#then it returns unknown", () => {
        expect(classifyPathEnvironment("/Users/x/projects/myapp")).toBe("unknown")
      })
    })
  })
})

describe("describePathClassification", () => {
  describe("#given each classification type", () => {
    test("#then icloud returns iCloud Drive", () => {
      expect(describePathClassification("icloud")).toBe("iCloud Drive")
    })

    test("#then onedrive returns OneDrive", () => {
      expect(describePathClassification("onedrive")).toBe("OneDrive")
    })

    test("#then desktop-sync returns Desktop sync (macOS)", () => {
      expect(describePathClassification("desktop-sync")).toBe("Desktop sync (macOS)")
    })

    test("#then network-drive returns Network drive", () => {
      expect(describePathClassification("network-drive")).toBe("Network drive")
    })

    test("#then unknown returns filesystem that does not support fsync", () => {
      expect(describePathClassification("unknown")).toBe("filesystem that does not support fsync")
    })
  })
})
