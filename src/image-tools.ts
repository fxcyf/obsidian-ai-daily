import type { App, TFile } from "obsidian";

export interface ImageRef {
	raw: string;
	path: string;
}

export interface PreparedImage {
	ref: ImageRef;
	mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
	base64: string;
}

export interface SkippedImage {
	ref: ImageRef;
	reason: string;
}

const SUPPORTED_EXTENSIONS: Record<
	string,
	PreparedImage["mediaType"]
> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

const WIKILINK_IMG_RE = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
const MARKDOWN_IMG_RE = /!\[[^\]]*?\]\((?!https?:\/\/)([^)]+?)\)/g;

export function extractLocalImageRefs(text: string): ImageRef[] {
	const seen = new Set<string>();
	const refs: ImageRef[] = [];

	const collect = (raw: string, path: string) => {
		const ext = path.split(".").pop()?.toLowerCase() ?? "";
		if (!(ext in SUPPORTED_EXTENSIONS)) return;
		if (seen.has(path)) return;
		seen.add(path);
		refs.push({ raw, path });
	};

	for (const m of text.matchAll(WIKILINK_IMG_RE)) {
		collect(m[0], m[1].trim());
	}
	for (const m of text.matchAll(MARKDOWN_IMG_RE)) {
		collect(m[0], decodeURIComponent(m[1].trim()));
	}

	return refs;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

const TARGET_BYTES = 300_000;
const MAX_DIMENSION = 1200;
const JPEG_QUALITY_START = 0.75;
const JPEG_QUALITY_MIN = 0.4;

function loadImage(buf: ArrayBuffer, mediaType: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const blob = new Blob([buf], { type: mediaType });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片加载失败")); };
		img.src = url;
	});
}

function compressToJpeg(img: HTMLImageElement, maxDim: number, quality: number): string {
	let w = img.naturalWidth;
	let h = img.naturalHeight;
	if (w > maxDim || h > maxDim) {
		const scale = maxDim / Math.max(w, h);
		w = Math.round(w * scale);
		h = Math.round(h * scale);
	}
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(img, 0, 0, w, h);
	const dataUrl = canvas.toDataURL("image/jpeg", quality);
	return dataUrl.split(",")[1];
}

async function compressImage(
	buf: ArrayBuffer,
	mediaType: string,
): Promise<{ base64: string; mediaType: PreparedImage["mediaType"] }> {
	const originalBase64 = arrayBufferToBase64(buf);
	const originalBytes = Math.ceil(originalBase64.length * 3 / 4);

	if (originalBytes <= TARGET_BYTES) {
		return { base64: originalBase64, mediaType: mediaType as PreparedImage["mediaType"] };
	}

	if (mediaType === "image/gif") {
		return { base64: originalBase64, mediaType: "image/gif" };
	}

	try {
		const img = await loadImage(buf, mediaType);

		let quality = JPEG_QUALITY_START;
		let base64 = compressToJpeg(img, MAX_DIMENSION, quality);

		while (Math.ceil(base64.length * 3 / 4) > TARGET_BYTES && quality > JPEG_QUALITY_MIN) {
			quality -= 0.1;
			base64 = compressToJpeg(img, MAX_DIMENSION, quality);
		}

		return { base64, mediaType: "image/jpeg" };
	} catch {
		return { base64: originalBase64, mediaType: mediaType as PreparedImage["mediaType"] };
	}
}

export interface PrepareOptions {
	maxImages?: number;
	maxBytes?: number;
}

export async function prepareLocalImages(
	app: App,
	refs: ImageRef[],
	opts?: PrepareOptions
): Promise<{ images: PreparedImage[]; skipped: SkippedImage[] }> {
	const maxImages = opts?.maxImages ?? 3;
	const maxBytes = opts?.maxBytes ?? 10_485_760;

	const images: PreparedImage[] = [];
	const skipped: SkippedImage[] = [];

	for (const ref of refs) {
		if (images.length >= maxImages) {
			skipped.push({ ref, reason: `超过单次上限 ${maxImages} 张` });
			continue;
		}

		const ext = ref.path.split(".").pop()?.toLowerCase() ?? "";
		const mediaType = SUPPORTED_EXTENSIONS[ext];
		if (!mediaType) {
			skipped.push({ ref, reason: `不支持的格式: .${ext}` });
			continue;
		}

		const file = app.vault.getFiles().find((f: TFile) => {
			if (f.path === ref.path) return true;
			if (f.name === ref.path) return true;
			if (f.path.endsWith("/" + ref.path)) return true;
			return false;
		});

		if (!file) {
			skipped.push({ ref, reason: "文件未找到" });
			continue;
		}

		try {
			const buf = await app.vault.readBinary(file);
			if (buf.byteLength > maxBytes) {
				const sizeMB = (buf.byteLength / 1_048_576).toFixed(1);
				const limitMB = (maxBytes / 1_048_576).toFixed(1);
				skipped.push({
					ref,
					reason: `文件过大 (${sizeMB}MB > ${limitMB}MB)`,
				});
				continue;
			}

			const compressed = await compressImage(buf, mediaType);
			images.push({
				ref,
				mediaType: compressed.mediaType,
				base64: compressed.base64,
			});
		} catch {
			skipped.push({ ref, reason: "读取失败" });
		}
	}

	return { images, skipped };
}
