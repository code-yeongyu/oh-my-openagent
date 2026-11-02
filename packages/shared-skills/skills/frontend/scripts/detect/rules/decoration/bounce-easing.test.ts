import { test } from "bun:test"
import { bounceEasing } from "./bounce-easing"
import { assertCases } from "./support/assert-cases"

test("#given overshooting curves and calm transitions #then only the overshoot reports", () => {
	assertCases(
		bounceEasing,
		[
			{ id: "flag", style: { "transition-timing-function": "cubic-bezier(.34,1.56,.64,1)" } },
			{ id: "calm", style: { "transition-timing-function": "cubic-bezier(.2,.8,.4,1)" } },
			{ id: "boundary", style: { "transition-timing-function": "cubic-bezier(.2,-.1,.4,1.1)" } },
		],
		["#flag"],
	)
})
test("#given bounce names with readable pulse and travel keyframes #then pulses pass", () => {
	assertCases(
		bounceEasing,
		[
			{ id: "flag", style: { "animation-name": "fixture-bounce" } },
			{ id: "pulse", style: { "animation-name": "bounceDelay" } },
			{ id: "unknown", style: { "animation-name": "elastic-in" } },
		],
		["#flag", "#unknown"],
		{
			cssText: [
				"@keyframes bounceDelay {from {transform:scale(0)} to {transform:scale(1)}} @keyframes fixture-bounce {from {transform:translateY(-25%)} to {transform:none}}",
			],
		},
	)
})
test("#given allowed timing functions #then unrelated overshoot remains reportable", () => {
	assertCases(
		bounceEasing,
		[
			{ id: "flag", style: { "transition-timing-function": "cubic-bezier(.2,1.4,.4,1)" } },
			{ id: "allowed", style: { "transition-timing-function": "cubic-bezier(0.34, 1.56, 0.64, 1)" } },
			{ id: "calm" },
		],
		["#flag"],
		{ config: { allowEasings: ["cubic-bezier(0.34,1.56,0.64,1)"] } },
	)
})

test("#given an offscreen tray #then its parked seek bar does not report", () => {
	const style = { "transition-timing-function": "cubic-bezier(.34,1.56,.64,1)" }
	assertCases(bounceEasing, [
		{ style: { position: "absolute" }, rect: { x: -2000, width: 300, height: 100 }, children: [
			{ id: "parked", rect: { x: -2000, width: 140, height: 2 }, style },
		] },
		{ id: "shown", style },
	], ["#shown"])
})

test("#given an unbound keyframe easing #then its page form remains unless a matching element covers it", () => {
	const cssText = ["@keyframes springy { to { animation-timing-function: cubic-bezier(0.3, 1.8, 0.6, 1); } }"]
	assertCases(bounceEasing, [{ text: "Ordinary copy" }], ["page"], { cssText })
	assertCases(bounceEasing, [{ id: "covered", style: { "transition-timing-function": "cubic-bezier(.30,1.80,.60,1.0)" } }], ["#covered"], { cssText })
	assertCases(bounceEasing, [{ text: "Ordinary copy" }], [], { cssText, config: { allowEasings: ["cubic-bezier(0.3,1.8,0.6,1)"] } })
})

test("#given pulse aliases unused tokens and hidden declared motion #then silent declarations create no page finding", () => {
	assertCases(bounceEasing, [
		{ attributes: { class: "pulse" }, style: { "animation-name": "bounceDelay", "animation-iteration-count": "infinite" } },
		{ attributes: { class: "hidden" }, style: { opacity: "0", "transition-timing-function": "cubic-bezier(.68,-.55,.265,1.55)" } },
	], [], { cssText: [
		":root { --unused: cubic-bezier(.34,1.56,.64,1); }",
		".missing { transition: transform .3s cubic-bezier(.2,1.4,.4,1); }",
		".hidden { transition: transform .3s cubic-bezier(.68,-.55,.265,1.55); }",
		".pulse { animation: bounceDelay 1s infinite; } @keyframes bounceDelay { from { transform: scale(0); } to { transform: scale(1); } }",
	] })
})
