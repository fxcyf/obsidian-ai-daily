import esbuild from "esbuild";
import process from "process";
import { existsSync, mkdirSync, rmSync, cpSync } from "fs";

const production = process.argv[2] === "production";
const DIST_DIR = "dist";

const buildOptions = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "child_process", "path", "fs"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: production ? `${DIST_DIR}/main.js` : "main.js",
	minify: production,
};

if (production) {
	rmSync(DIST_DIR, { recursive: true, force: true });
	mkdirSync(DIST_DIR, { recursive: true });

	await esbuild.build(buildOptions);

	// Copy static assets
	for (const file of ["manifest.json", "styles.css"]) {
		if (existsSync(file)) {
			cpSync(file, `${DIST_DIR}/${file}`);
		}
	}

	// Bundle MCP server into a single file via esbuild (no subdirectory)
	if (existsSync("mcp-server/src/index.ts")) {
		try {
			await esbuild.build({
				entryPoints: ["mcp-server/src/index.ts"],
				bundle: true,
				format: "esm",
				target: "node18",
				platform: "node",
				outfile: `${DIST_DIR}/mcp-server.js`,
				minify: true,
			});
			console.log("  mcp-server.js  bundled");
		} catch (e) {
			console.warn("  mcp-server build skipped:", e.message);
		}
	}

	console.log(`\n  Output: ${DIST_DIR}/`);
} else {
	const ctx = await esbuild.context(buildOptions);
	await ctx.watch();
}
