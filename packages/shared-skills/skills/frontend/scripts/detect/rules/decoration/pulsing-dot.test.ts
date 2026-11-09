import { test } from "bun:test"
import { pulsingDot } from "./pulsing-dot"
import { assertCases, round } from "./support/assert-cases"
import type { NodeSpec } from "../../testing/build-snapshot"
const dot = (id: string, name: string, size = 8): NodeSpec => ({
	id,
	rect: { width: size, height: size },
	style: { ...round("50%"), "animation-name": name, "animation-iteration-count": "infinite" },
})
test("#given authored dots with inline empty boxes #then declarations report once per selector", () => {
	assertCases(pulsingDot, [
		{ id: "one", tag: "span", attributes: { class: "dot" }, rect: { width: 0, height: 0 } },
		{ id: "two", tag: "span", attributes: { class: "dot" }, rect: { width: 0, height: 0 } },
		{ id: "tw", tag: "span", attributes: { class: "animate-ping w-2 h-2 rounded-full" }, rect: { width: 0, height: 0 } },
	], ["#one", "#tw"], { cssText: [
		":root {--dot:8px} .dot {width:var(--dot);height:var(--dot);border-radius:50%} " +
		"@media (prefers-reduced-motion:no-preference) {.dot {animation:pulse 2s infinite}} " +
		"@media (prefers-reduced-motion:reduce) {.dot {animation:none}} @keyframes pulse {50%{opacity:.3}}",
	] })
})
test("#given tiny circular pulses #then finite animations and bars pass", () => {
	assertCases(
		pulsingDot,
		[
			dot("flag", "pulse"),
			{ ...dot("finite", "pulse"), style: { ...dot("finite", "pulse").style, "animation-iteration-count": "3" } },
			{ ...dot("bar", "pulse"), rect: { width: 3, height: 8 } },
			dot("large", "pulse", 24),
			{ ...dot("square", "pulse"), style: { ...dot("square", "pulse").style, ...round("2px") } },
		],
		["#flag"],
		{ cssText: ["@keyframes pulse {50%{opacity:.3}}"] },
	)
})
test("#given rotating travelling and swelling keyframes #then only stationary dot pulses report", () => {
	assertCases(
		pulsingDot,
		[dot("flag", "swell"), dot("spin", "spin"), dot("float", "float"), dot("eye", "eye"), dot("wave", "wave")],
		["#flag"],
		{
			cssText: [
				"@keyframes swell {from{transform:scale(.5);opacity:1} to{transform:scale(1);opacity:.5}} @keyframes spin {to{transform:rotate(360deg)}} @keyframes float {from{transform:none;opacity:.4}to{transform:translateY(-14px);opacity:.6}} @keyframes eye {from{transform:scaleY(1)}to{transform:scaleY(.1)}} @keyframes wave {from{height:4px;opacity:.3}to{height:16px;opacity:1}}",
			],
		},
	)
})
test("#given tiny bobs centred ripples and connector travel #then travel alone is excluded", () => {
	assertCases(
		pulsingDot,
		[dot("bob", "bob"), dot("ring", "ring"), dot("ripple", "ripple"), dot("connector", "travel")],
		["#bob", "#ring", "#ripple"],
		{
			cssText: [
				"@keyframes bob {from{transform:translateY(0);opacity:1}to{transform:translateY(-2px);opacity:.4}} @keyframes ring {from{transform:translate(-50%,-50%) scale(1);opacity:1}to{transform:translate(-50%, -50%) scale(2);opacity:0}} @keyframes ripple {from{width:8px;height:8px;margin:0;opacity:1}to{width:16px;height:16px;margin:-4px;opacity:0}} @keyframes travel {from{left:0px;opacity:0}to{left:calc(100% - 4px);opacity:1}}",
			],
		},
	)
})
