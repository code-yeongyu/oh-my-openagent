import { expect, test } from "bun:test"
import { sideTab } from "./side-tab"
import { checkSource } from "./support/check-source"

test.each([
	['<div className="border-l-4 rounded-r-lg" />', "a.tsx", 1],
	['<div className="border-r-8 rounded-r-lg" />', "a.tsx", 0],
	['<div className="border-l-4" />', "a.tsx", 0],
	['<div style={{borderLeft:"4px solid red", borderRadius:12}} />', "a.tsx", 1],
	['<div style={{borderLeft:"4px solid red", padding:12}} />', "a.tsx", 0],
	['<div className="w-1 shrink-0 bg-amber-500" />', "a.tsx", 1],
	['<div className="w-1 shrink-0 h-8 bg-amber-500" />', "a.tsx", 0],
	[".a{border-left:4px solid red;border-radius:12px}", "a.css", 1],
	[".a{border-left:4px solid #777;border-radius:12px}", "a.css", 0],
	[".a{border-left:4px solid red}.b{border-radius:2px}", "a.css", 0],
	[".a{border-radius:12px}.a.active{border-left:4px solid red}", "a.css", 1],
	[".a{border-radius:12px;box-shadow:inset 4px 0 var(--accent)}", "a.css", 1],
	[".a{border-radius:0;box-shadow:inset 4px 0 red}", "a.css", 0],
	[".a\n  border-radius: 12px\n  &.active\n    border-left: 4px solid red", "a.sass", 1],
	[".a\n  border-radius: 0\n  &.active\n    border-left: 4px solid red", "a.sass", 0],
	["const A = styled.div`border-radius:12px; &::before {position:absolute;left:0;top:0;bottom:0;width:4px;background:red;}`;", "a.tsx", 1],
	[".card{border-radius:12px;@media(min-width:600px){&::after{position:absolute;right:0;top:0;bottom:0;width:5px;background:red}}}", "a.scss", 1],
	[".card{border-radius:3px;border-left:4px solid red}", "a.css", 0],
	['<div className="border-l-4 rounded-sm" />', "a.tsx", 1],
	['<div className="border-l-4 rounded-xs" />', "a.tsx", 0],
	['<div style={{borderRight:"5px solid red",borderRadius:12}} />\n<div style={{borderLeft:"6px solid red",padding:16}} />\n<Box sx={{borderRadius:0,"@media (min-width:600px)":{borderLeft:"11px solid red"}}} />', "a.tsx", 1],
])("#given accent source %s #then returns expected findings", (source, path, count) => {
	expect(checkSource(sideTab, source, { path })).toHaveLength(count)
})
