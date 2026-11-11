import { expect, test } from "vitest"

import { dependencyPackageNames, packageName } from "../src/index.ts"

test("the package entry exports its own name and its architecture edges", () => {
  expect(packageName).toBe("@oh-my-opencode/omo-computer-engine")
  expect(dependencyPackageNames).toEqual(["@oh-my-opencode/omo-computer-protocol"])
})
