import { expect, test } from "bun:test"
import { bounceEasing } from "./bounce-easing"
import { checkSource } from "./support/check-source"

test.each([
	["animate-bounce", 1],
	["animation: spring-in 1s", 1],
	["transition: all cubic-bezier(.2, -0.2, .3, 1)", 1],
	["transition: all cubic-bezier(.2, -.1, .3, 1.1)", 0],
	["animation: fade-in 1s", 0],
])("#given motion source %s #then returns %i findings", (source, count) => {
	expect(checkSource(bounceEasing, source)).toHaveLength(count)
})

test("#given an intentional easing #then removes that curve only", () => {
	expect(checkSource(bounceEasing, "cubic-bezier(.2, -.2, .3, 1)\nanimate-bounce", { config: { allowEasings: ["cubic-bezier(.2,-.2,.3,1)"] } })).toHaveLength(1)
	expect(checkSource(bounceEasing, "animation: spring-in 1s\nanimation: bounce-out 1s", { config: { allowEasings: ["SPRING-IN"] } })).toHaveLength(1)
	expect(checkSource(bounceEasing, "animation: spring-in 1s, bounce-out 1s", { config: { allowEasings: ["spring-in"] } })[0]?.message).toBe("animation: bounce-out")
})
