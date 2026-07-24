import { describe, expect, it } from "vitest";
import {
	getChatInputHeight,
	getSelectedTextWithinElement,
	shouldSendChatInput,
	shouldShowChatMoreButton,
} from "./chat-view";

describe("shouldSendChatInput", () => {
	it("only sends desktop input with Cmd/Ctrl+Enter", () => {
		expect(shouldSendChatInput({
			key: "Enter",
			ctrlKey: true,
			metaKey: false,
			isComposing: false,
		})).toBe(true);
		expect(shouldSendChatInput({
			key: "Enter",
			ctrlKey: false,
			metaKey: true,
			isComposing: false,
		})).toBe(true);
		expect(shouldSendChatInput({
			key: "Enter",
			ctrlKey: false,
			metaKey: false,
			isComposing: false,
		})).toBe(false);
	});

	it("does not send while an IME composition is active", () => {
		expect(shouldSendChatInput({
			key: "Enter",
			ctrlKey: true,
			metaKey: false,
			isComposing: true,
		})).toBe(false);
	});
});

describe("getChatInputHeight", () => {
	it("grows with multiline content up to the normal height limit", () => {
		expect(getChatInputHeight(32, false, 900)).toBe(32);
		expect(getChatInputHeight(96, false, 900)).toBe(96);
		expect(getChatInputHeight(260, false, 900)).toBe(200);
	});

	it("uses half the viewport as the expanded height limit", () => {
		expect(getChatInputHeight(600, true, 900)).toBe(450);
	});
});

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
