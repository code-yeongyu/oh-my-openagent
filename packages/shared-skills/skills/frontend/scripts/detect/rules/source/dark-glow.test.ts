import { expect, test } from "bun:test"
import { darkGlow } from "./dark-glow"
import { checkSource } from "./support/check-source"

test.each([
	["<html><style>.a{box-shadow:0 0 20px #f00}</style></html>", 1],
	["<html><style>body{background:#000}.a{box-shadow:0 4px 20px #f00}</style></html>", 1],
	["<html><style>.a{box-shadow:0 4px 20px #f00}</style></html>", 0],
	["<html><style>.a{box-shadow:0 0 20px #777}</style></html>", 0],
	["<html><style>.a{box-shadow:0 0 4px #f00}</style></html>", 0],
	["<html><style>.a{box-shadow:0 0 20px rgba(255,0,0,.1)}</style></html>", 0],
	["<html><style>.a{box-shadow:0 0 20px -11px #f00}</style></html>", 0],
])("#given glow page source #then returns %i findings", (source, count) => {
	expect(checkSource(darkGlow, source, { path: "a.astro" })).toHaveLength(count)
})
