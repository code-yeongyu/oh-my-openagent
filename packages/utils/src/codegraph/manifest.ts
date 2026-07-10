import type { CodegraphProvisionManifest } from "./provision"

export const CODEGRAPH_PROVISION_MANIFEST: CodegraphProvisionManifest = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "d4931334e2497a4861b214ec077d78e5e38702a258fe4e05c33ed3bc1d144a90",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.3.1/codegraph-darwin-arm64.tar.gz",
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "e9364cf8b104cf290c7c96ef1ed3dcd30d17af56583cdf0091efa0b001e3669e",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.3.1/codegraph-darwin-x64.tar.gz",
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "28130da6f6c7087d293337737dfca1040f0694996b0252c9528a7706a5721d8b",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.3.1/codegraph-linux-arm64.tar.gz",
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "e605073f6eb170fe161e986c2350b6a0681e68018ed844ce57f72814c09fea1d",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.3.1/codegraph-linux-x64.tar.gz",
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "025a3fb7bf6a4e3dae17446afdfbf978f633af692b4e46717fb21b8dbe5f4ab7",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.3.1.tgz",
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "bcab91ad4c17b9f0449d44f11b0cc9ead6f1f0515d080d7518ad3ccc24d9113f",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.3.1.tgz",
    },
  },
  version: "1.3.1",
}
