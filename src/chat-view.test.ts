import { describe, expect, it } from "vitest";
import { getSelectedTextWithinElement, shouldShowChatMoreButton } from "./chat-view";

describe("shouldShowChatMoreButton", () => {
	it("shows menu for a harness context before the first message is sent", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: false,
				hasHarnessContext: true,
			})
		).toBe(true);
	});

	it("shows menu for existing conversations", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 1,
				hasSession: false,
				hasHarnessContext: false,
			})
		).toBe(true);
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: true,
				hasHarnessContext: false,
			})
		).toBe(true);
	});

	it("hides menu on the welcome screen without active conversation state", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: false,
				hasHarnessContext: false,
			})
		).toBe(false);
	});
});

describe("getSelectedTextWithinElement", () => {
	const insideStart = {} as Node;
	const insideEnd = {} as Node;
	const outside = {} as Node;
	const element = {
		contains: (node: Node | null) => node === insideStart || node === insideEnd,
	};

	it("returns trimmed text when the whole selection belongs to the reply", () => {
		expect(getSelectedTextWithinElement(element, {
			anchorNode: insideStart,
			focusNode: insideEnd,
			isCollapsed: false,
			toString: () => "  selected reply text  ",
		})).toBe("selected reply text");
	});

	it("ignores collapsed selections and selections crossing outside the reply", () => {
		expect(getSelectedTextWithinElement(element, {
			anchorNode: insideStart,
			focusNode: insideStart,
			isCollapsed: true,
			toString: () => "ignored",
		})).toBe("");

		expect(getSelectedTextWithinElement(element, {
			anchorNode: insideStart,
			focusNode: outside,
			isCollapsed: false,
			toString: () => "cross-message text",
		})).toBe("");
	});
});
