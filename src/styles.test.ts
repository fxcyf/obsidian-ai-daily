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

describe("welcome workspace card styles", () => {
	it("keeps the accordion header stable across interaction states", () => {
		expect(styles).toMatch(
			/\.ai-daily-welcome-card-head\s*\{[^}]*background:\s*transparent !important;[^}]*box-shadow:\s*none;[^}]*transition:\s*none;[^}]*-webkit-tap-highlight-color:\s*transparent;/s
		);
		expect(styles).toMatch(
			/\.ai-daily-welcome-card-head:hover,\s*\.ai-daily-welcome-card-head:active,\s*\.ai-daily-welcome-card-head:focus\s*\{[^}]*background:\s*transparent !important;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;[^}]*outline:\s*none;/s
		);
		const expandedCardRule = styles.match(/\.ai-daily-welcome-card--expanded\s*\{([^}]*)\}/s)?.[1] ?? "";
		expect(expandedCardRule).not.toMatch(/background/);
	});

	it("separates the compact mode buttons from the header", () => {
		expect(styles).toMatch(
			/\.ai-daily-welcome-card-panel\s*\{[^}]*padding:\s*6px 14px 12px;/s
		);
		expect(styles).toMatch(
			/\.ai-daily-welcome-chip\s*\{[^}]*font-size:\s*11\.5px;[^}]*padding:\s*4px 8px;[^}]*min-height:\s*28px;/s
		);
		expect(styles).toMatch(
			/\.ai-daily-welcome-chip-bolt svg\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s
		);
	});
});
