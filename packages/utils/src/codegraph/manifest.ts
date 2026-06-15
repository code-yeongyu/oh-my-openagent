import type { CodegraphProvisionManifest } from "./provision"

export const CODEGRAPH_PROVISION_MANIFEST: CodegraphProvisionManifest = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "95bb27bf6382b69659e158e0c04d71cc394778951e1317d582be7807e7866908",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-arm64.tar.gz",
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "3311cc1d1f0f0ad742709b6a43d8a9187b1ef0af0dd30e0b58008dc673e29478",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-x64.tar.gz",
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "e16f612bc96c2ebccd04574cbed500c9939147c80666ad6bb024398dff7992ae",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-arm64.tar.gz",
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "d45a068f44596a85c7ba7d0ef924eaf7103fbbf3cafbeb668127daff60a52228",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-x64.tar.gz",
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "8d57ced73b24d35f758f2ede2318e80e1d7241987f37a999e3d80edb6fddf961",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.0.1.tgz",
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "52607fe73b05e741fd1087da2ceca9d3c8f565e36bf1a7070600bdbdf3931e32",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.0.1.tgz",
    },
  },
  version: "1.0.1",
}
