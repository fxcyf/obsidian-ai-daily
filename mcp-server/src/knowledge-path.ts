import * as path from "node:path";

function normalizeRelativePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Map paths relative to a single configured logical knowledge root onto their
 * physical vault-relative path. Already-prefixed paths remain unchanged.
 * Multiple roots are intentionally left explicit because the prefix would be
 * ambiguous.
 */
export function resolveKnowledgePath(value: string, knowledgeFolders: string[]): string {
	const normalized = normalizeRelativePath(value);
	if (!normalized || knowledgeFolders.length !== 1) return normalized;

	const root = normalizeRelativePath(knowledgeFolders[0]);
	if (!root || normalized === root || normalized.startsWith(`${root}/`)) {
		return normalized;
	}
	return path.posix.join(root, normalized);
}
