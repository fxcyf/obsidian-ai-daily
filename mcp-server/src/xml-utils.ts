/**
 * Minimal XML parsing utilities for Node.js (no DOMParser).
 * Handles simple RSS/Atom feed structures with regex.
 */

/**
 * Extract text content of all matching tags.
 * Handles both <tag>content</tag> and <ns:tag>content</ns:tag>.
 */
export function getTagContent(xml: string, tagName: string): string[] {
	// Match both <tagName> and <prefix:tagName> variants
	const pattern = new RegExp(
		`<(?:[a-zA-Z0-9]+:)?${escapeRegex(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${escapeRegex(tagName)}>`,
		"gi"
	);
	const results: string[] = [];
	let match;
	while ((match = pattern.exec(xml)) !== null) {
		results.push(decodeEntities(match[1].trim()));
	}
	return results;
}

/**
 * Get text content of the first matching tag, or empty string.
 */
export function getFirstTagContent(xml: string, tagName: string): string {
	const results = getTagContent(xml, tagName);
	return results.length > 0 ? results[0] : "";
}

/**
 * Extract an attribute value from a tag string.
 */
export function getAttr(tag: string, attrName: string): string {
	const pattern = new RegExp(`${escapeRegex(attrName)}\\s*=\\s*["']([^"']*)["']`, "i");
	const match = tag.match(pattern);
	return match ? decodeEntities(match[1]) : "";
}

/**
 * Remove HTML/XML tags from text.
 */
export function stripHtml(text: string): string {
	return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Decode common XML/HTML entities.
 */
function decodeEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract all occurrences of a tag (including the tag itself) from XML.
 * Returns the full tag + content strings for further parsing.
 */
export function extractBlocks(xml: string, tagName: string): string[] {
	const pattern = new RegExp(
		`<(?:[a-zA-Z0-9]+:)?${escapeRegex(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${escapeRegex(tagName)}>`,
		"gi"
	);
	const results: string[] = [];
	let match;
	while ((match = pattern.exec(xml)) !== null) {
		results.push(match[0]);
	}
	return results;
}

/**
 * Extract self-closing or open tags (e.g. <link href="..." />, <enclosure url="..." />).
 */
export function extractSelfClosingTags(xml: string, tagName: string): string[] {
	const pattern = new RegExp(
		`<(?:[a-zA-Z0-9]+:)?${escapeRegex(tagName)}\\s[^>]*?\\/?>`,
		"gi"
	);
	return [...xml.matchAll(pattern)].map((m) => m[0]);
}
