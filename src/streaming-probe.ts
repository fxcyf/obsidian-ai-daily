/**
 * Streaming connectivity probe — Phase 0 of `plan/feature-real-streaming.md`.
 *
 * 唯一目的：在真实 Obsidian 环境（桌面 / iOS / Android）里验证带
 * `anthropic-dangerous-direct-browser-access: true` 头的原生 fetch
 * 是否真的能逐字节流式拿到 Anthropic SSE。
 *
 * 上次 (`fc03352` → `ce3e360`) 真流式失败的根因假设是缺这个头；本探针
 * 用最小代价证伪/证实该假设，决定 Phase 1 是否启动。
 *
 * 探针通过后会在 Phase 2 合并进 ClaudeClient，本文件随之删除。
 */

import { Notice } from "obsidian";

const API_URL = "https://api.anthropic.com/v1/messages";

export interface ProbeResult {
	ok: boolean;
	chunkCount: number;
	firstChunkMs: number;
	totalMs: number;
	textLength: number;
	deltaTimings: number[];
	error?: string;
	rawSample?: string;
}

/**
 * 用最小请求触发流式响应，记录 chunk 时间分布。
 * `model` 默认用 haiku 4.5 节省 token；`maxTokens` 限制在 256 内。
 */
export async function probeStreamingConnectivity(opts: {
	apiKey: string;
	model?: string;
	maxTokens?: number;
	prompt?: string;
}): Promise<ProbeResult> {
	const start = performance.now();
	const result: ProbeResult = {
		ok: false,
		chunkCount: 0,
		firstChunkMs: 0,
		totalMs: 0,
		textLength: 0,
		deltaTimings: [],
	};

	if (!opts.apiKey) {
		result.error = "no api key";
		return result;
	}

	let res: Response;
	try {
		res = await fetch(API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": opts.apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify({
				model: opts.model ?? "claude-haiku-4-5",
				max_tokens: opts.maxTokens ?? 256,
				stream: true,
				messages: [
					{
						role: "user",
						content:
							opts.prompt ??
							"从 1 数到 30，每个数字独占一行，不要其他多余文字。",
					},
				],
			}),
		});
	} catch (e) {
		result.error = `fetch threw: ${describeError(e)}`;
		result.totalMs = performance.now() - start;
		return result;
	}

	if (!res.ok) {
		const text = await safeReadText(res);
		result.error = `HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 500)}`;
		result.totalMs = performance.now() - start;
		return result;
	}

	if (!res.body) {
		result.error = "response has no body (Obsidian env may not expose ReadableStream)";
		result.totalMs = performance.now() - start;
		return result;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let raw = "";
	let collectedText = "";

	try {
		// 边读边粗略提取 text_delta 内容用于人眼校验。这里不做完整 SSE 解析，
		// 只是为了让用户在控制台/Notice 里能看到"模型确实在边生成边发"的证据。
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const now = performance.now();
			const chunk = decoder.decode(value, { stream: true });
			raw += chunk;
			result.chunkCount += 1;
			if (result.chunkCount === 1) {
				result.firstChunkMs = now - start;
			}
			result.deltaTimings.push(Math.round(now - start));
			collectedText += extractTextDeltaSamples(chunk);
		}
	} catch (e) {
		result.error = `stream read failed: ${describeError(e)}`;
		result.totalMs = performance.now() - start;
		result.rawSample = raw.slice(-500);
		return result;
	}

	result.totalMs = performance.now() - start;
	result.textLength = collectedText.length;
	result.ok = result.chunkCount > 1 && result.firstChunkMs < result.totalMs - 50;
	// chunkCount > 1 排除"requestUrl 那种一次性整段返回"的伪流；
	// firstChunk 明显早于 total 才说明真的是边到边读。
	result.rawSample = raw.slice(0, 800);
	return result;
}

/**
 * 极简 text_delta 抽取：从 SSE 文本中找 `"text":"…"` 段拼起来。
 * 只用于人眼校验，不参与正式逻辑。
 */
function extractTextDeltaSamples(sseChunk: string): string {
	const out: string[] = [];
	const re = /"type":"text_delta","text":"((?:\\.|[^"\\])*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(sseChunk)) !== null) {
		try {
			out.push(JSON.parse(`"${m[1]}"`));
		} catch {
			out.push(m[1]);
		}
	}
	return out.join("");
}

async function safeReadText(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return "<failed to read body>";
	}
}

function describeError(e: unknown): string {
	if (e instanceof Error) return `${e.name}: ${e.message}`;
	return String(e);
}

/** 用户友好的报告字符串，给 Notice / 控制台用。 */
export function formatProbeReport(r: ProbeResult): string {
	if (!r.ok) {
		return [
			"❌ streaming probe FAILED",
			`error: ${r.error ?? "(unknown)"}`,
			`chunks=${r.chunkCount} firstChunkMs=${r.firstChunkMs.toFixed(0)} totalMs=${r.totalMs.toFixed(0)}`,
			r.rawSample ? `raw[0..800]: ${r.rawSample}` : "",
		]
			.filter(Boolean)
			.join("\n");
	}
	return [
		"✅ streaming probe OK",
		`chunks=${r.chunkCount}`,
		`firstChunkMs=${r.firstChunkMs.toFixed(0)} totalMs=${r.totalMs.toFixed(0)}`,
		`textLen=${r.textLength}`,
		`timing[ms]=[${r.deltaTimings.slice(0, 12).join(",")}${r.deltaTimings.length > 12 ? ",…" : ""}]`,
	].join("\n");
}

/** 一键探测：跑一次 + 同时把结果发到 Notice 与 console。 */
export async function runProbeAndReport(apiKey: string, model?: string): Promise<ProbeResult> {
	new Notice("Streaming probe: 开始探测…", 2500);
	const r = await probeStreamingConnectivity({ apiKey, model });
	const report = formatProbeReport(r);
	console.log("[ai-daily streaming-probe]\n" + report);
	console.log("[ai-daily streaming-probe] full result:", r);
	new Notice(report, r.ok ? 8000 : 12000);
	return r;
}
