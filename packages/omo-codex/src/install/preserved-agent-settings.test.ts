import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { restorePreservedServiceTier } from "./preserved-agent-settings"

const BUNDLED_EXPLORER = 'name = "explorer"\nmodel = "gpt-5.6-luna"\nservice_tier = "fast"\n'

async function writeAgent(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omo-service-tier-"))
	const path = join(dir, "explorer.toml")
	await writeFile(path, content)
	return path
}

describe("restorePreservedServiceTier", () => {
	test("#given a user changed the tier to standard #when a reinstall relinks the bundled fast agent #then the user tier is restored", async () => {
		// given
		const linkPath = await writeAgent(BUNDLED_EXPLORER)
		// when
		await restorePreservedServiceTier({ linkPath, preserved: true, value: "standard" })
		// then
		expect(await readFile(linkPath, "utf8")).toContain('service_tier = "standard"')
	})

	test("#given a user removed the tier entirely #when a reinstall relinks the bundled fast agent #then the tier stays absent so the parent tier is inherited", async () => {
		// given
		const linkPath = await writeAgent(BUNDLED_EXPLORER)
		// when
		await restorePreservedServiceTier({ linkPath, preserved: true, value: null })
		// then
		expect(await readFile(linkPath, "utf8")).not.toContain("service_tier")
	})

	test("#given a fresh install with nothing preserved #when relinking #then the bundled fast tier is left unchanged", async () => {
		// given
		const linkPath = await writeAgent(BUNDLED_EXPLORER)
		// when
		await restorePreservedServiceTier({ linkPath, preserved: false, value: null })
		// then
		expect(await readFile(linkPath, "utf8")).toContain('service_tier = "fast"')
	})
})
