import { describe, it, expect } from "vitest";
import { extractLocalImageRefs } from "./image-tools";

describe("extractLocalImageRefs", () => {
	it("extracts wikilink images", () => {
		const text = "Some text ![[photo.png]] and more";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([{ raw: "![[photo.png]]", path: "photo.png" }]);
	});

	it("extracts wikilink images with size suffix", () => {
		const text = "![[dir/img.jpg|300]]";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([{ raw: "![[dir/img.jpg|300]]", path: "dir/img.jpg" }]);
	});

	it("extracts markdown-style local images", () => {
		const text = "![alt text](./photos/cat.webp)";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([
			{ raw: "![alt text](./photos/cat.webp)", path: "./photos/cat.webp" },
		]);
	});

	it("ignores http/https URLs in markdown syntax", () => {
		const text = "![web](https://example.com/img.png)";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([]);
	});

	it("ignores unsupported file extensions", () => {
		const text = "![[document.pdf]] ![[video.mp4]]";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([]);
	});

	it("deduplicates identical paths", () => {
		const text = "![[photo.png]] some text ![[photo.png]]";
		const refs = extractLocalImageRefs(text);
		expect(refs).toHaveLength(1);
	});

	it("handles multiple images of different types", () => {
		const text = `
![[a.png]]
![[b.jpg]]
![c](./c.gif)
![[d.webp|500]]
		`;
		const refs = extractLocalImageRefs(text);
		expect(refs).toHaveLength(4);
		expect(refs.map((r) => r.path)).toEqual([
			"a.png",
			"b.jpg",
			"d.webp",
			"./c.gif",
		]);
	});

	it("returns empty array for text with no images", () => {
		const text = "Just some text with [[a link]] but no images";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([]);
	});

	it("handles wikilink images with spaces in path", () => {
		const text = "![[my photos/vacation pic.png]]";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([
			{ raw: "![[my photos/vacation pic.png]]", path: "my photos/vacation pic.png" },
		]);
	});

	it("decodes percent-encoded markdown image paths", () => {
		const text = "![img](my%20photos/pic.png)";
		const refs = extractLocalImageRefs(text);
		expect(refs).toEqual([
			{ raw: "![img](my%20photos/pic.png)", path: "my photos/pic.png" },
		]);
	});
});
