import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { brokenImage } from "./broken-image"

test("#given absent empty and hash sources #then real source aliases and responsive images pass", () => {
	const snapshot = buildSnapshot([
		{ tag: "img", id: "absent" }, { tag: "img", id: "empty", attributes: { src: " " } },
		{ tag: "img", id: "hash", attributes: { src: "#" } },
		{ tag: "img", id: "real", attributes: { src: "photo.png" } },
		{ tag: "img", id: "set", attributes: { src: "", srcset: "photo.png 1x" } },
		{ tag: "img", id: "lazy", attributes: { "data-src": "photo.png" } },
		{ tag: "img", id: "misleading", attributes: { alt: "src=photo.png" } },
		{ tag: "div", id: "other" },
	])
	expect(brokenImage.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#absent", "#empty", "#hash", "#misleading"])
})

test("#given placeholder srcset and valid alternate sources #then either usable attribute is enough", () => {
	const snapshot = buildSnapshot([
		{ tag: "img", id: "placeholder", attributes: { src: "#", srcset: " " } },
		{ tag: "img", id: "inline", attributes: { src: "data:image/svg+xml,<svg/>" } },
		{ tag: "img", id: "lazyset", attributes: { "data-srcset": "/small.png 300w" } },
	])
	expect(brokenImage.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#placeholder"])
})
