import type { CodegraphProvisionManifest } from "./provision"

export const CODEGRAPH_PINNED_VERSION = "1.4.1"

export const CODEGRAPH_PROVISION_MANIFEST: CodegraphProvisionManifest = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "4a679ae5a5cb9fff900dd59bb786da6a581b7f68f4cf713bdedd137e347d34dc",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-darwin-arm64.tar.gz",
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "436f96943cfd926ea6d0a8454f18833d21254d5fd9b3d224317b1426132def95",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-darwin-x64.tar.gz",
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "0d62c5eb2722f8d19d20f7a1bd974445e18d5294cb59be116a0c3d55ce87591f",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-linux-arm64.tar.gz",
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "fb585ff5018d6faaa46d282b61f4f689bc7967ed8a1b467a5c556dd7ced9b542",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-linux-x64.tar.gz",
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "e2a2a28c802a79804c7df203afa50bd461309c6c180ce3f76079fdc7cddc7697",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.4.1.tgz",
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "4f08700fda5f4a03ad5b2956135c5788d739a351b3433db2b5820e5d5224c30d",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.4.1.tgz",
    },
  },
  version: CODEGRAPH_PINNED_VERSION,
}
