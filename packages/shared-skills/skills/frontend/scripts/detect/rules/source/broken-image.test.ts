import { expect, test } from "bun:test"
import { brokenImage } from "./broken-image"
import { checkSource } from "./support/check-source"

test.each([
	['<img alt="photo" />', "a.tsx", 1],
	['<img\nsrc="#"\n/>', "a.tsx", 1],
	['<img src={url} />', "a.tsx", 0],
	['<img srcset="a.webp 1x" />', "a.tsx", 0],
	['<img {...props} />', "a.tsx", 0],
	['<img data-caption="src=example" />', "a.tsx", 1],
	['const example = "<img>";', "a.tsx", 0],
	['<script>const example = "<img>";</script><img src="a.png">', "a.vue", 0],
	['<img :src="url" />', "a.vue", 0],
	["<img {src} />", "a.svelte", 0],
	['<img src="" />', "a.astro", 1],
	["// Plain <img> comment\nexport const A=()=> <img src='a.png'/>;", "a.tsx", 0],
	['<div>{"<img>"}</div>', "a.tsx", 0],
	['const pattern=/<img>/;', "a.tsx", 0],
	['<div>{url ? <img src={url}/> : <img/>}</div>', "a.tsx", 1],
])("#given image source %s #then returns expected findings", (source, path, count) => {
	expect(checkSource(brokenImage, source, { path })).toHaveLength(count)
})

test("#given a multiline missing image #then identifies its opening position", () => {
	expect(checkSource(brokenImage, "\n  <img\n    alt='photo'\n  />")[0]).toMatchObject({ line: 2, column: 3 })
})
