/**
 * Serialize HarnessMode[] back to modes.md content.
 * Inverse of parseModesFromContent() in harness-view.ts.
 *
 * Output format:
 *   ```yaml modes
 *   - id: ...
 *     label: ...
 *     ...
 *   ```
 *
 *   ## {id}
 *   {systemPromptAppend}
 */

import type { HarnessMode } from "./settings";

function yamlEscape(s: string): string {
	if (/[:#\[\]{},&*!|>'"%@`\n]/.test(s) || /^[-?]/.test(s) || /^\s|\s$/.test(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

function serializeMode(m: HarnessMode): string {
	const lines: string[] = [];
	lines.push(`- id: ${m.id}`);
	lines.push(`  label: ${yamlEscape(m.label)}`);
	lines.push(`  emoji: ${yamlEscape(m.emoji || "📋")}`);

	if (m.files.length === 0) {
		lines.push(`  files: []`);
	} else {
		lines.push(`  files:`);
		for (const f of m.files) lines.push(`    - ${f}`);
	}

	if (m.actions.length === 0) {
		lines.push(`  actions: []`);
	} else {
		lines.push(`  actions:`);
		for (const a of m.actions) {
			lines.push(`    - label: ${yamlEscape(a.label)}`);
			if (a.icon) lines.push(`      icon: ${a.icon}`);
			lines.push(`      prompt: ${yamlEscape(a.prompt)}`);
		}
	}

	return lines.join("\n");
}

export function serializeModesToContent(modes: HarnessMode[]): string {
	const yamlLines: string[] = ["```yaml modes"];
	for (const m of modes) yamlLines.push(serializeMode(m));
	yamlLines.push("```");

	const sections: string[] = [];
	for (const m of modes) {
		sections.push("");
		sections.push(`## ${m.id}`);
		sections.push("");
		sections.push(m.systemPromptAppend.trim());
	}

	return yamlLines.join("\n") + "\n" + sections.join("\n") + "\n";
}
