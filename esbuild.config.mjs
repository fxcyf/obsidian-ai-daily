import esbuild from "esbuild";
import process from "process";
import { execSync } from "child_process";
import { cpSync, existsSync } from "fs";

const production = process.argv[2] === "production";

const buildOptions = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "child_process", "path"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
};

if (production) {
	await esbuild.build(buildOptions);

	// Build and bundle MCP server for Claude Code integration
	if (existsSync("mcp-server/package.json")) {
		try {
			execSync("npm run build", { cwd: "mcp-server", stdio: "inherit" });
			cpSync("mcp-server/dist", "mcp-dist", { recursive: true });
			console.log("  mcp-dist/  bundled");
		} catch (e) {
			console.warn("  mcp-server build skipped:", e.message);
		}
	}
} else {
	const ctx = await esbuild.context(buildOptions);
	await ctx.watch();
}
