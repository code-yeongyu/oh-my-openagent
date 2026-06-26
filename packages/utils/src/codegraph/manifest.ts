import type { CodegraphProvisionManifest } from "./provision"
import { CODEGRAPH_VERSION } from "./version"

export const CODEGRAPH_PROVISION_MANIFEST: CodegraphProvisionManifest = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "fac558004b53fc9456c093d4cf46a9f1de767bc7e7a4f5e03ec811ce7c7e1cca",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.1.1/codegraph-darwin-arm64.tar.gz",
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "d46566fa70438d374b113d27a670335e7dd131f396f7e204a339206182323a7c",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.1.1/codegraph-darwin-x64.tar.gz",
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "289bc3351a2b5e5b760082ae59b340aac510fa34ebec31da549696425a6c76ec",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.1.1/codegraph-linux-arm64.tar.gz",
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "0be7013c579227284e8032f8a369770ad02663d67a13478781590a30dd57ee7f",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.1.1/codegraph-linux-x64.tar.gz",
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "87df31584b09a622352acc363ed4cee77ff6614136a6976abb00fcc3c0656b2f",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.1.1.tgz",
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "c4b72afc9055b719642e49c50f99c91e8c8e40b78fbbf9e37f56e29693db6144",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.1.1.tgz",
    },
  },
  version: CODEGRAPH_VERSION,
}
