/**
 * Convert common LaTeX delimiters to the MathJax syntax understood by
 * Obsidian's Markdown renderer. Code spans and fenced code blocks are left
 * untouched so examples remain literal.
 */
export function normalizeMarkdownForObsidian(markdown: string): string {
	let fence: "`" | "~" | null = null;

	return markdown.split("\n").map((line) => {
		const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (fenceMatch) {
			const marker = fenceMatch[1][0] as "`" | "~";
			if (fence === marker) fence = null;
			else if (fence === null) fence = marker;
			return line;
		}
		if (fence !== null) return line;

		return line
			.split(/(`+[^`]*`+)/g)
			.map((segment, index) => {
				if (index % 2 === 1) return segment;
				return segment
					.replace(/\\\[/g, () => "$$")
					.replace(/\\\]/g, () => "$$")
					.replace(/\\\(/g, "$")
					.replace(/\\\)/g, "$");
			})
			.join("");
	}).join("\n");
}
