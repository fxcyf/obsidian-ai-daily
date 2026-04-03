import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

const buildOptions = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
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
} else {
	const ctx = await esbuild.context(buildOptions);
	await ctx.watch();
}
