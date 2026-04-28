import esbuild from "esbuild";
import process from "process";
import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";

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
	// Clean and create dist/
	rmSync(DIST_DIR, { recursive: true, force: true });
	mkdirSync(DIST_DIR, { recursive: true });

	await esbuild.build(buildOptions);

	// Copy static assets
	for (const file of ["manifest.json", "styles.css"]) {
		if (existsSync(file)) {
			cpSync(file, `${DIST_DIR}/${file}`);
		}
	}

	// Build and bundle MCP server
	if (existsSync("mcp-server/package.json")) {
		try {
			execSync("npm run build", { cwd: "mcp-server", stdio: "inherit" });
			cpSync("mcp-server/dist", `${DIST_DIR}/mcp-dist`, { recursive: true });
			console.log("  mcp-dist/  bundled");
		} catch (e) {
			console.warn("  mcp-server build skipped:", e.message);
		}
	}

	console.log(`\n  Output: ${DIST_DIR}/`);
} else {
	const ctx = await esbuild.context(buildOptions);
	await ctx.watch();
}
