import { expect, test } from "bun:test"
import { marquee } from "./marquee"
import { checkSource } from "./support/check-source"

test.each([
	["<marquee>News</marquee>", 1],
	["<style>@keyframes roll{from{transform:translateX(0)}to{transform:translateX(-100%)}}.track{animation:roll 10s linear infinite}</style>", 1],
	["<style>@keyframes roll{from{transform:translateX(0)}to{transform:translateX(-100%)}}.track{animation:roll 10s linear 1}</style>", 0],
	["<style>@keyframes fade{from{opacity:0}to{opacity:1}}.track{animation:fade 1s infinite}</style>", 0],
])("#given marquee source #then returns %i findings", (source, count) => {
	expect(checkSource(marquee, `<html>${source}</html>`, { path: "a.astro" })).toHaveLength(count)
})
