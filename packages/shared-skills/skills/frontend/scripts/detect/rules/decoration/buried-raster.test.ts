import { test } from "bun:test"
import { buriedRaster } from "./buried-raster"
import { assertCases } from "./support/assert-cases"
import type { NodeSpec } from "../../testing/build-snapshot"
test("#given faint rasters with captured motion #then only running opacity motion exempts them", () => {
	const image: NodeSpec = { tag: "img", rect: { width: 400, height: 200 }, style: { opacity: ".05" } }
	assertCases(buriedRaster, [
		{ children: [{ ...image, id: "running", motion: ["opacity"] }] },
		{ children: [{ ...image, id: "paused", motion: [], style: { opacity: ".05", "animation-play-state": "paused" } }] },
		{ children: [{ ...image, id: "transform", motion: ["transform"] }] },
		{ children: [{ ...image, id: "rest" }] },
	], ["#paused", "#transform", "#rest"])
})
test("#given raster images under near opaque washes #then legible tints and reversed layers pass", () => {
	const image = "url(photo.png)",
		wash = "linear-gradient(rgba(240,237,226,.96),rgba(240,237,226,.96))",
		tint = "linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45))"
	assertCases(
		buriedRaster,
		[
			{ id: "flag", style: { "background-image": wash + ", " + image } },
			{ id: "tint", style: { "background-image": tint + ", " + image } },
			{ id: "reverse", style: { "background-image": image + ", " + wash } },
			{ id: "gradient", style: { "background-image": wash } },
			{ id: "blend", style: { "background-image": wash + ", " + image, "background-blend-mode": "multiply" } },
			{ id: "blend-list", style: { "background-image": wash + ", " + image, "background-blend-mode": "normal, multiply" } },
			{ id: "mix-blend", style: { "background-image": wash + ", " + image, "mix-blend-mode": "multiply" } },
			{ id: "normal-list", style: { "background-image": wash + ", " + image, "background-blend-mode": "normal, normal", "mix-blend-mode": "normal" } },
		],
		["#flag", "#normal-list"],
	)
})
test("#given hidden posters and nested videos #then only a video actually painted can replace the poster", () => {
	const photo: NodeSpec = { tag: "img", style: { opacity: "0" }, rect: { width: 400, height: 200 } }
	const video: NodeSpec = { tag: "video", rect: { width: 400, height: 200 } }
	assertCases(buriedRaster, [
		{ children: [{ children: [video] }, { ...photo, id: "poster" }] },
		{ children: [{ style: { opacity: "0" }, children: [video] }, { ...photo, id: "unseen" }] },
		{ children: [{ children: [{ ...photo, style: { opacity: "1" } }] }, { ...photo, id: "buried" }] },
	], ["#unseen", "#buried"])
})
test("#given pending lazy images and observed class reveals #then held faint material still reports", () => {
	const photo = (id: string, opacity: string, attributes: Readonly<Record<string, string>>): NodeSpec => ({
		id, tag: "img", attributes, rect: { width: 400, height: 200 }, style: { opacity },
	})
	assertCases(buriedRaster, [
		{ children: [
		photo("native", ".08", { loading: "lazy" }),
		] },
		{ children: [
		photo("utility", ".08", { class: "lazy transition", src: "photo.png" }),
		] },
		{ children: [
		photo("lazy", "0", { class: "lazy" }),
		photo("tween", ".07", { class: "lazy", style: "opacity: .07;" }),
		photo("pending", "0", { "data-loaded": "false" }),
		photo("waiting", "0", { class: "thumb waiting" }),
		...["one", "two"].map(id => ({
			...photo(id, "1", { class: "thumb shown" }),
			style: { opacity: "1", "transition-property": "opacity", "transition-duration": ".3s" },
		})),
		] },
		{ style: { opacity: "0" }, children: [photo("ancestor", ".05", {})] },
	], ["#native", "#utility"])
})
test("#given faint produced rasters #then SVG sources and icon sized state images pass", () => {
	assertCases(
		buriedRaster,
		[
			{ id: "flag", tag: "img", attributes: { src: "paper.png" }, rect: { width: 400, height: 300 }, style: { opacity: "0.04" } },
			{ id: "icon", tag: "img", attributes: { src: "pin.png" }, rect: { width: 24, height: 24 }, style: { opacity: "0" } },
			{ id: "svg", tag: "img", attributes: { src: "icon.svg?state=on" }, style: { opacity: "0" } },
			{ id: "text", text: "Faint text", style: { opacity: ".04" } },
		],
		["#flag"],
	)
})
test("#given overlapping crossfade and blurred placeholders #then isolated faint rasters remain findings", () => {
	const photo = (id: string, opacity: string): NodeSpec => ({
		id,
		tag: "img",
		attributes: { src: "photo.png" },
		rect: { width: 320, height: 180 },
		style: { opacity },
	})
	assertCases(
		buriedRaster,
		[
			{ children: [photo("flag", ".04"), { tag: "p", text: "Copy" }] },
			{ children: [photo("painted", "1"), photo("frame", "0")] },
			{ ...photo("blurred", "0"), style: { opacity: "0", filter: "blur(10px)" } },
		],
		["#flag"],
	)
})
