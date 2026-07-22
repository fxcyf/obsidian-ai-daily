import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
	fileURLToPath(new URL("../styles.css", import.meta.url)),
	"utf8"
);

describe("message action toolbar styles", () => {
	it("gives the pin and fork buttons an opaque theme background", () => {
		expect(styles).toMatch(
			/\.ai-daily-msg-toolbar > div\s*\{[^}]*background:\s*var\(--background-primary\);/s
		);
		expect(styles).toMatch(
			/\.is-mobile \.ai-daily-msg-toolbar\s*\{[^}]*opacity:\s*1;/s
		);
	});
});
