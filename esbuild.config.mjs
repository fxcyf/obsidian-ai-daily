import esbuild from "esbuild";
import process from "process";
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from "fs";

const production = process.argv[2] === "production";
const DIST_DIR = "dist";

let mcpDefine = {};

if (production) {
	rmSync(DIST_DIR, { recursive: true, force: true });
	mkdirSync(DIST_DIR, { recursive: true });

	// Build MCP server first so we can embed it
	if (existsSync("mcp-server/src/index.ts")) {
		try {
			const mcpOutfile = `${DIST_DIR}/_mcp-server-tmp.js`;
			await esbuild.build({
				entryPoints: ["mcp-server/src/index.ts"],
				bundle: true,
				format: "esm",
				target: "node18",
				platform: "node",
				outfile: mcpOutfile,
				minify: true,
			});
			const mcpCode = readFileSync(mcpOutfile, "utf-8");
			mcpDefine = { __MCP_SERVER_CODE__: JSON.stringify(mcpCode) };
			rmSync(mcpOutfile);
			console.log("  mcp-server embedded");
		} catch (e) {
			console.warn("  mcp-server build skipped:", e.message);
		}
	}
}

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
	define: mcpDefine,
};

if (production) {
	await esbuild.build(buildOptions);

	// Copy static assets
	for (const file of ["manifest.json", "styles.css"]) {
		if (existsSync(file)) {
			cpSync(file, `${DIST_DIR}/${file}`);
		}
	}

	console.log(`\n  Output: ${DIST_DIR}/`);
} else {
	const ctx = await esbuild.context(buildOptions);
	await ctx.watch();
}
