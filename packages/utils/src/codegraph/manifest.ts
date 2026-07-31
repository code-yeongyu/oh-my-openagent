import type { CodegraphProvisionManifest } from "./provision"

export const CODEGRAPH_PINNED_VERSION = "1.5.0"

export const CODEGRAPH_PROVISION_MANIFEST: CodegraphProvisionManifest = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "cf5ee435a6e44d097b2f98f2b7b8b9422bb1094844404efed82519c5da1af2cf",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-darwin-arm64.tar.gz",
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "0a0ccc29bf7da9d10be1458d89d7e15c55927ae24cd95e9fa3de4bdfea059dde",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-darwin-x64.tar.gz",
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "9f17750aedf45d51f68caae39ed21d6e2a7290b2326e5c53f95a165918ebd1d8",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-linux-arm64.tar.gz",
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "2ba65e87a1210b706bb1e67d5e48b5fc4a1935e43dbb3fb5f31c5597840d2e58",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-linux-x64.tar.gz",
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "19e0237ea5d8928f705d60e339eb319e7ec37490a69585712933c1534f3c0bc2",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.5.0.tgz",
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "ef64c878acb129885c2d8306ddec6674af865810b4c0f6a9ba9fcd61e21ff9d8",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.5.0.tgz",
    },
  },
  version: CODEGRAPH_PINNED_VERSION,
}
