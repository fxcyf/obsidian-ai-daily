import { describe, it, expect } from "vitest";
import { extractYouTubeId } from "./podcast-tools";

describe("extractYouTubeId", () => {
	it("extracts ID from standard watch URL", () => {
		expect(extractYouTubeId("https://www.youtube.com/watch?v=abc12345678")).toBe("abc12345678");
	});

	it("extracts ID from short URL", () => {
		expect(extractYouTubeId("https://youtu.be/abc12345678")).toBe("abc12345678");
	});

	it("extracts ID from embed URL", () => {
		expect(extractYouTubeId("https://www.youtube.com/embed/abc12345678")).toBe("abc12345678");
	});

	it("extracts ID from shorts URL", () => {
		expect(extractYouTubeId("https://www.youtube.com/shorts/abc12345678")).toBe("abc12345678");
	});

	it("extracts ID with extra query params", () => {
		expect(extractYouTubeId("https://www.youtube.com/watch?v=abc12345678&t=120")).toBe("abc12345678");
	});

	it("handles URL with hyphens and underscores in ID", () => {
		expect(extractYouTubeId("https://youtu.be/aB-_cD3eF4g")).toBe("aB-_cD3eF4g");
	});

	it("returns null for non-YouTube URLs", () => {
		expect(extractYouTubeId("https://example.com/video")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractYouTubeId("")).toBeNull();
	});

	it("returns null for malformed YouTube URL", () => {
		expect(extractYouTubeId("https://youtube.com/")).toBeNull();
	});
});
