import {
	FORMAT_MIME,
	FORMAT_LABELS,
	QUALITY_TARGETS,
	computeResize,
	humanSize,
	classifyImage,
	encodePng,
	encodeBmp,
	encodeGif,
	buildIco,
	buildPdfFromJpeg,
	resizeLanczos,
	ssim,
} from "../tools/image.js"

const MAX_INPUT_BYTES = 50 * 1024 * 1024
const EVAL_MAX_SIDE = 1024
const TARGET_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]
const ICO_SIZES = [16, 32, 48, 64, 128, 256]
const ORIGINAL_FORMATS = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/avif": "avif" }

// Heavy pixel work (Lanczos, SSIM, PNG filtering, classification) runs in a module worker built from this same file.

function heavy(op, payload) {
	if (op === "resize") return resizeLanczos(payload.data, payload.srcW, payload.srcH, payload.dstW, payload.dstH)
	if (op === "ssim") return ssim(payload.a, payload.b, payload.width, payload.height)
	if (op === "png") return encodePng(payload.data, payload.width, payload.height)
	if (op === "classify") {
		const { palette, ...rest } = classifyImage(payload.data, payload.width, payload.height)
		return { ...rest, exactPalette: Boolean(palette) }
	}
	throw new Error(`Unknown image operation: ${op}`)
}

async function handleWorkerMessage(event) {
	const { id, op, payload } = event.data
	try {
		const result = await heavy(op, payload)
		globalThis.postMessage({ id, result }, result?.buffer ? [result.buffer] : [])
	} catch (error) {
		globalThis.postMessage({ id, error: error?.message ?? String(error) })
	}
}

const IN_WORKER = typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope
if (IN_WORKER) globalThis.onmessage = handleWorkerMessage

const WORKER_FAILED = Symbol("worker failed")
let worker = null
let workerBroken = false
let nextId = 0
const pending = new Map()

function failAllPending() {
	workerBroken = true
	for (const { reject } of pending.values()) reject(WORKER_FAILED)
	pending.clear()
	worker?.terminate()
	worker = null
}

function getWorker() {
	if (IN_WORKER || workerBroken || typeof Worker !== "function") return null
	if (worker) return worker
	try {
		worker = new Worker(new URL("./image-converter.js", import.meta.url), { type: "module" })
		worker.onmessage = (event) => {
			const job = pending.get(event.data.id)
			if (!job) return
			pending.delete(event.data.id)
			if (event.data.error) job.reject(new Error(event.data.error))
			else job.resolve(event.data.result)
		}
		worker.onerror = failAllPending
		worker.onmessageerror = failAllPending
	} catch {
		workerBroken = true
		worker = null
	}
	return worker
}

function releaseWorker() {
	worker?.terminate()
	worker = null
}

// Falls back to running on the page when module workers are unavailable (older Firefox, restricted contexts).
async function compute(op, payload) {
	const w = getWorker()
	if (!w) return heavy(op, payload)
	try {
		return await new Promise((resolve, reject) => {
			const id = ++nextId
			pending.set(id, { resolve, reject })
			w.postMessage({ id, op, payload })
		})
	} catch (error) {
		if (error === WORKER_FAILED) return heavy(op, payload)
		throw error
	}
}

// Canvas helpers

function makeCanvas(width, height) {
	if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height)
	const canvas = document.createElement("canvas")
	canvas.width = width
	canvas.height = height
	return canvas
}

function context(canvas) {
	return canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })
}

function canvasToBlob(canvas, mime, quality) {
	if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality })
	return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

function imageCanvas(image, flattenWhite = false) {
	const canvas = makeCanvas(image.width, image.height)
	const ctx = context(canvas)
	ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
	if (!flattenWhite) return canvas
	// putImageData ignores compositing, so the white backdrop has to be drawn underneath in a second canvas.
	const flat = makeCanvas(image.width, image.height)
	const fctx = context(flat)
	fctx.fillStyle = "#ffffff"
	fctx.fillRect(0, 0, image.width, image.height)
	fctx.drawImage(canvas, 0, 0)
	return flat
}

function readPixels(source, width, height, drawWidth = width, drawHeight = height) {
	const canvas = makeCanvas(drawWidth, drawHeight)
	const ctx = context(canvas)
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(source, 0, 0, width, height, 0, 0, drawWidth, drawHeight)
	return { data: ctx.getImageData(0, 0, drawWidth, drawHeight).data, width: drawWidth, height: drawHeight }
}

async function decodeBlob(blob, drawWidth, drawHeight) {
	const bitmap = await createImageBitmap(blob)
	try {
		return readPixels(bitmap, bitmap.width, bitmap.height, drawWidth ?? bitmap.width, drawHeight ?? bitmap.height)
	} finally {
		bitmap.close?.()
	}
}

async function decodeFile(file) {
	try {
		// The imageOrientation option applies EXIF rotation; encoding again from pixels then drops all metadata.
		return await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "none" })
	} catch {
		try {
			return await createImageBitmap(file)
		} catch {
			return decodeWithImageElement(file)
		}
	}
}

async function decodeWithImageElement(file) {
	if (typeof Image !== "function") throw new Error("This browser cannot decode the image")
	const url = URL.createObjectURL(file)
	try {
		const img = await new Promise((resolve, reject) => {
			const image = new Image()
			image.onload = () => resolve(image)
			image.onerror = () => reject(new Error("Failed to decode image; the file may be corrupted or in an unsupported format"))
			image.src = url
		})
		await img.decode?.().catch(() => {})
		return img
	} finally {
		URL.revokeObjectURL(url)
	}
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result)
		reader.onerror = () => reject(new Error("Could not read the converted image"))
		reader.readAsDataURL(blob)
	})
}

// Feature tests

const support = new Map()

async function canEncode(mime) {
	if (!support.has(mime)) {
		support.set(
			mime,
			(async () => {
				try {
					const canvas = makeCanvas(2, 2)
					// OffscreenCanvas refuses to encode until a context exists.
					context(canvas).fillRect(0, 0, 1, 1)
					const blob = await canvasToBlob(canvas, mime, 0.8)
					return blob?.type === mime
				} catch {
					return false
				}
			})(),
		)
	}
	return support.get(mime)
}

// Chrome's canvas WebP is lossy even at quality 1, so lossless output is verified by a pixel exact round trip.
async function canEncodeLosslessWebp() {
	if (!support.has("webp-lossless")) {
		support.set(
			"webp-lossless",
			(async () => {
				if (!(await canEncode("image/webp"))) return false
				try {
					const size = 16
					const data = new Uint8ClampedArray(size * size * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 97) % 251))
					const blob = await canvasToBlob(imageCanvas({ data, width: size, height: size }), "image/webp", 1)
					const back = await decodeBlob(blob)
					return back.data.every((v, i) => v === data[i])
				} catch {
					return false
				}
			})(),
		)
	}
	return support.get("webp-lossless")
}

export async function supportedOutputFormats() {
	const formats = ["auto", "png", "jpeg", "bmp", "gif", "ico", "pdf"]
	if (await canEncode("image/webp")) formats.splice(1, 0, "webp")
	if (await canEncode("image/avif")) formats.push("avif")
	return formats
}

// Option parsing accepts both the current option values and the older label strings.

function normalizeFormat(raw) {
	const value = String(raw ?? "auto").toLowerCase()
	if (FORMAT_MIME[value]) return value
	if (value.startsWith("auto")) return "auto"
	if (value.startsWith("ico")) return "ico"
	if (value === "jpg") return "jpeg"
	const key = Object.keys(FORMAT_MIME).find((k) => value.startsWith(k))
	if (!key) throw new Error(`Unsupported output format: ${raw}`)
	return key
}

function normalizeResizeMode(raw) {
	const value = String(raw ?? "contain").toLowerCase()
	if (value.startsWith("cover")) return "cover"
	if (value.startsWith("exact")) return "exact"
	return "contain"
}

function normalizeTarget(raw) {
	const value = String(raw ?? "lossless").toLowerCase()
	if (QUALITY_TARGETS[value]) return { key: value, ssim: QUALITY_TARGETS[value] }
	if (value.startsWith("high")) return { key: "high", ssim: QUALITY_TARGETS.high }
	if (value.startsWith("bal")) return { key: "balanced", ssim: QUALITY_TARGETS.balanced }
	return { key: "lossless", ssim: QUALITY_TARGETS.lossless }
}

function positiveNumber(raw) {
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

async function asBlob(file) {
	if (typeof Blob !== "undefined" && file instanceof Blob) return file
	if (file?.dataUrl) {
		const blob = await (await fetch(file.dataUrl)).blob()
		return Object.assign(blob, { name: file.name })
	}
	if (file?.bytes) return new Blob([file.bytes], { type: file.mime })
	throw new Error("Choose an image file first.")
}

// Lossy encoding

async function measureSsim(blob, reference) {
	const decoded = await decodeBlob(blob, reference.width, reference.height)
	return compute("ssim", { a: reference.data, b: decoded.data, width: reference.width, height: reference.height })
}

// Binary search for the lowest quality whose SSIM still meets the target; the canvas is reused across probes.
async function searchQualityForSsim(canvas, reference, mime, target) {
	const top = await canvasToBlob(canvas, mime, 1)
	const topScore = await measureSsim(top, reference)
	let best = { blob: top, quality: 1, ssim: topScore }
	if (topScore < target) return best
	let lo = 0.3
	let hi = 1
	for (let i = 0; i < 7 && hi - lo > 0.015; i++) {
		const q = Math.round(((lo + hi) / 2) * 1000) / 1000
		const blob = await canvasToBlob(canvas, mime, q)
		const score = await measureSsim(blob, reference)
		if (score >= target) {
			hi = q
			if (blob.size < best.blob.size) best = { blob, quality: q, ssim: score }
		} else lo = q
	}
	return best
}

// Highest quality that fits under maxBytes, judged by size only (no decode needed).
async function searchQualityForSize(canvas, mime, maxBytes) {
	const top = await canvasToBlob(canvas, mime, 0.95)
	if (top.size <= maxBytes) return { blob: top, quality: 0.95, fits: true }
	const floor = await canvasToBlob(canvas, mime, 0.05)
	if (floor.size > maxBytes) return { blob: floor, quality: 0.05, fits: false }
	let best = { blob: floor, quality: 0.05, fits: true }
	let lo = 0.05
	let hi = 0.95
	for (let i = 0; i < 8 && hi - lo > 0.01; i++) {
		const q = Math.round(((lo + hi) / 2) * 1000) / 1000
		const blob = await canvasToBlob(canvas, mime, q)
		if (blob.size <= maxBytes) {
			lo = q
			best = { blob, quality: q, fits: true }
		} else hi = q
	}
	return best
}

async function lossyAtTarget(image, formatKey, target, onStatus) {
	const mime = FORMAT_MIME[formatKey]
	onStatus?.(`Tuning ${FORMAT_LABELS[formatKey]} quality to SSIM ${target}…`)
	const canvas = imageCanvas(image, formatKey === "jpeg")
	const result = await searchQualityForSsim(canvas, image, mime, target)
	return { ...result, formatKey }
}

// Lossless encoding

async function losslessGraphic(image, classification, onStatus) {
	onStatus?.(classification.exactPalette ? `Writing ${classification.colors} colour palette PNG…` : "Writing lossless PNG…")
	const png = new Blob([await compute("png", { data: image.data, width: image.width, height: image.height })], { type: "image/png" })
	let best = { blob: png, formatKey: "png", quality: null, ssim: 1 }
	if (!classification.exactPalette && (await canEncodeLosslessWebp())) {
		const webp = await canvasToBlob(imageCanvas(image), "image/webp", 1)
		if (webp.size < png.size) best = { blob: webp, formatKey: "webp", quality: null, ssim: 1 }
	}
	return best
}

async function resized(source, width, height, onStatus) {
	if (width === source.width && height === source.height) return source
	onStatus?.(`Resizing to ${width}×${height} (Lanczos3)…`)
	const data = await compute("resize", { data: source.data, srcW: source.width, srcH: source.height, dstW: width, dstH: height })
	return { data, width, height }
}

function evalSize(width, height) {
	const scale = Math.min(1, EVAL_MAX_SIDE / Math.max(width, height))
	return { width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) }
}

// Target size mode: every scale and format combination is fitted under the cap by quality, then compared on a shared evaluation grid.
async function fitTargetSize({ source, outW, outH, formats, maxBytes, allowScale, onStatus }) {
	const evalDims = evalSize(outW, outH)
	const reference = readPixels(imageCanvas(source), source.width, source.height, evalDims.width, evalDims.height)
	const scales = allowScale ? TARGET_SCALES : [1]
	let best = null
	let smallest = null
	for (const scale of scales) {
		const w = Math.max(1, Math.round(outW * scale))
		const h = Math.max(1, Math.round(outH * scale))
		const image = await resized(source, w, h, onStatus)
		let bestAtScale = null
		for (const formatKey of formats) {
			onStatus?.(`Fitting ${FORMAT_LABELS[formatKey]} at ${w}×${h} under ${humanSize(maxBytes)}…`)
			const canvas = imageCanvas(image, formatKey === "jpeg" || formatKey === "pdf")
			const mime = formatKey === "pdf" ? "image/jpeg" : FORMAT_MIME[formatKey]
			const fit = await searchQualityForSize(canvas, mime, maxBytes)
			const candidate = { ...fit, formatKey, width: w, height: h, scale }
			if (!smallest || fit.blob.size < smallest.blob.size) smallest = candidate
			if (!fit.fits) continue
			candidate.ssim = await measureSsim(fit.blob, reference)
			if (!bestAtScale || candidate.ssim > bestAtScale.ssim) bestAtScale = candidate
		}
		if (!bestAtScale) continue
		// Prefer the larger scale unless shrinking buys a clearly better score.
		if (!best || bestAtScale.ssim > best.ssim + 0.002) best = bestAtScale
		else if (best && bestAtScale.ssim < best.ssim - 0.002) break
		if (best.ssim >= 0.995) break
	}
	return best ? { ...best, fits: true } : { ...smallest, fits: false }
}

// Cover means fill the box and trim the overflow, so the source is centre cropped to the box aspect ratio first.
function coverCrop(image, targetW, targetH, mode) {
	if (mode !== "cover" || !targetW || !targetH) return image
	const scale = Math.max(targetW / image.width, targetH / image.height)
	const cropW = Math.min(image.width, Math.round(targetW / scale))
	const cropH = Math.min(image.height, Math.round(targetH / scale))
	if (cropW === image.width && cropH === image.height) return image
	const ox = Math.floor((image.width - cropW) / 2)
	const oy = Math.floor((image.height - cropH) / 2)
	const data = new Uint8ClampedArray(cropW * cropH * 4)
	for (let y = 0; y < cropH; y++) data.set(image.data.subarray(((y + oy) * image.width + ox) * 4, ((y + oy) * image.width + ox + cropW) * 4), y * cropW * 4)
	return { data, width: cropW, height: cropH }
}

function fileNameFor(originalName, formatKey) {
	const base = String(originalName || "image").replace(/\.[^.]+$/, "") || "image"
	return `${base}.${formatKey === "jpeg" ? "jpg" : formatKey}`
}

async function buildFavicon(source, outW, outH, onStatus) {
	const base = Math.min(256, Math.max(outW, outH))
	const sizes = [...new Set([...ICO_SIZES.filter((s) => s < base), base])]
	const entries = []
	for (const size of sizes) {
		onStatus?.(`Rendering ${size}×${size} icon…`)
		const fit = computeResize(source.width, source.height, size, size, "contain")
		const scaled = await resized(source, fit.width, fit.height)
		// Icons must be square, so non square art is centred on a transparent canvas.
		const square = new Uint8ClampedArray(size * size * 4)
		const ox = Math.floor((size - fit.width) / 2)
		const oy = Math.floor((size - fit.height) / 2)
		for (let y = 0; y < fit.height; y++) square.set(scaled.data.subarray(y * fit.width * 4, (y + 1) * fit.width * 4), ((y + oy) * size + ox) * 4)
		entries.push({ width: size, height: size, bytes: await compute("png", { data: square, width: size, height: size }) })
	}
	return { bytes: buildIco(entries), size: base, count: entries.length }
}

async function encodeExplicit({ formatKey, image, classification, target, onStatus }) {
	if (formatKey === "png") {
		onStatus?.("Writing optimized PNG…")
		const bytes = await compute("png", { data: image.data, width: image.width, height: image.height })
		return { blob: new Blob([bytes], { type: "image/png" }), formatKey, quality: null, ssim: 1 }
	}
	if (formatKey === "bmp") return { blob: new Blob([encodeBmp(image.width, image.height, image.data)], { type: "image/bmp" }), formatKey, quality: null }
	if (formatKey === "gif") {
		onStatus?.("Building GIF palette…")
		const gif = encodeGif(image.width, image.height, image.data)
		const notice = gif.lossless ? null : `GIF allows 256 colours; the image was reduced to ${gif.colors} colours. Use PNG or WebP to keep every colour.`
		return { blob: new Blob([gif.bytes], { type: "image/gif" }), formatKey, quality: null, notice }
	}
	if (formatKey === "pdf") {
		const jpeg = classification.isPhoto
			? await lossyAtTarget(image, "jpeg", target, onStatus)
			: { blob: await canvasToBlob(imageCanvas(image, true), "image/jpeg", 0.95), quality: 0.95 }
		const bytes = new Uint8Array(await jpeg.blob.arrayBuffer())
		return { blob: new Blob([buildPdfFromJpeg(image.width, image.height, bytes)], { type: "application/pdf" }), formatKey, quality: jpeg.quality, ssim: jpeg.ssim }
	}
	if (!(await canEncode(FORMAT_MIME[formatKey]))) throw new Error(`This browser cannot encode ${FORMAT_LABELS[formatKey]}; choose another format`)
	return lossyAtTarget(image, formatKey, target, onStatus)
}

async function encodeAuto({ image, classification, target, onStatus }) {
	if (!classification.isPhoto) return losslessGraphic(image, classification, onStatus)
	const candidates = []
	if (await canEncode("image/webp")) candidates.push(await lossyAtTarget(image, "webp", target, onStatus))
	// JPEG cannot hold transparency, so it only competes for opaque photos.
	if (!classification.hasAlpha) candidates.push(await lossyAtTarget(image, "jpeg", target, onStatus))
	if (!candidates.length) return losslessGraphic(image, classification, onStatus)
	return candidates.reduce((a, b) => (b.blob.size < a.blob.size ? b : a))
}

function targetFormats(formatKey, classification, webpOk) {
	if (formatKey === "pdf") return ["pdf"]
	if (formatKey === "webp" || formatKey === "jpeg" || formatKey === "avif") return [formatKey]
	const list = webpOk ? ["webp"] : []
	if (!classification.hasAlpha) list.push("jpeg")
	return list.length ? list : ["jpeg"]
}

async function convertForTarget({ formatKey, source, outW, outH, classification, maxBytes, allowScale, onStatus, targetSizeKb, target }) {
	if (formatKey === "bmp" || formatKey === "gif") {
		const image = await resized(source, outW, outH, onStatus)
		const result = await encodeExplicit({ formatKey, image, classification, target, onStatus })
		return { ...result, width: outW, height: outH, notice: [result.notice, `${FORMAT_LABELS[formatKey]} has no quality setting, so the ${targetSizeKb} KB target was not applied.`].filter(Boolean).join(" ") }
	}
	if (formatKey === "auto" || formatKey === "png") {
		const image = await resized(source, outW, outH, onStatus)
		const lossless = formatKey === "png" ? await encodeExplicit({ formatKey, image, classification, onStatus }) : await losslessGraphic(image, classification, onStatus)
		if (lossless.blob.size <= maxBytes) return { ...lossless, width: outW, height: outH, notice: `Lossless ${FORMAT_LABELS[lossless.formatKey]} already fits under ${targetSizeKb} KB.` }
		if (formatKey === "png") return { ...lossless, width: outW, height: outH, notice: `Lossless PNG is ${humanSize(lossless.blob.size)}, above the ${targetSizeKb} KB target. Choose Auto, WebP or JPEG to compress further.` }
	}
	if (formatKey === "avif" && !(await canEncode("image/avif"))) throw new Error("This browser cannot encode AVIF; choose another format")
	const formats = targetFormats(formatKey, classification, await canEncode("image/webp"))
	const best = await fitTargetSize({ source, outW, outH, formats, maxBytes, allowScale, onStatus })
	let blob = best.blob
	if (best.formatKey === "pdf") {
		const jpeg = new Uint8Array(await best.blob.arrayBuffer())
		blob = new Blob([buildPdfFromJpeg(best.width, best.height, jpeg)], { type: "application/pdf" })
	}
	const parts = []
	if (best.scale < 1) parts.push(`Scaled to ${best.width}×${best.height} (${Math.round(best.scale * 100)}%) because that scored higher at this size than full resolution.`)
	if (!best.fits) parts.push(`Could not reach ${targetSizeKb} KB even at the lowest quality; this is the smallest result (${humanSize(blob.size)}).`)
	if (formatKey !== "auto" && best.formatKey !== formatKey && formatKey !== "pdf") parts.push(`Switched to ${FORMAT_LABELS[best.formatKey]} to reach the target.`)
	return { blob, formatKey: best.formatKey, quality: best.quality, ssim: best.ssim ?? null, width: best.width, height: best.height, notice: parts.join(" ") || null }
}

async function keepOriginal(blob, file, origW, origH, candidate) {
	const formatKey = ORIGINAL_FORMATS[blob.type] ?? "png"
	return {
		dataUrl: await blobToDataUrl(blob),
		blob,
		fileName: file.name || fileNameFor("image", formatKey),
		format: FORMAT_LABELS[formatKey] ?? blob.type,
		formatKey,
		originalWidth: origW,
		originalHeight: origH,
		outputWidth: origW,
		outputHeight: origH,
		originalSize: blob.size,
		outputSize: blob.size,
		originalName: file.name || "image",
		quality: null,
		targetSizeKb: null,
		notice: `Original kept: re-encoding gave ${humanSize(candidate.blob.size)} as ${FORMAT_LABELS[candidate.formatKey]}, which is not smaller than the ${humanSize(blob.size)} original. Metadata was not stripped.`,
		tip: "Set a target file size or pick a lower quality preset to force smaller output.",
		ssim: 1,
		lossless: true,
	}
}

export async function convertImage(file, values = {}, onStatus) {
	if (!file) throw new Error("Choose an image file first.")
	const blob = await asBlob(file)
	if (blob.type && !blob.type.startsWith("image/")) throw new Error("The selected file is not an image")
	if (blob.size > MAX_INPUT_BYTES) throw new Error("The file exceeds the 50 MB limit")
	const formatKey = normalizeFormat(values.format)
	const target = normalizeTarget(values.qualityTarget)
	const targetSizeKb = positiveNumber(values.targetSizeKb)
	const targetW = positiveNumber(values.width)
	const targetH = positiveNumber(values.height)
	const manualResize = targetW > 0 || targetH > 0
	try {
		onStatus?.("Reading image…")
		const decoded = await decodeFile(blob)
		const origW = decoded.naturalWidth || decoded.width
		const origH = decoded.naturalHeight || decoded.height
		if (!origW || !origH) throw new Error("The image has zero dimensions")
		const resizeMode = normalizeResizeMode(values.resizeMode)
		const source = coverCrop(readPixels(decoded, origW, origH), targetW, targetH, resizeMode)
		decoded.close?.()
		const cover = source.width !== origW || source.height !== origH
		const { width: outW, height: outH } = cover ? { width: targetW, height: targetH } : computeResize(origW, origH, targetW, targetH, resizeMode)
		onStatus?.("Analysing colours…")
		const classification = await compute("classify", { data: source.data, width: source.width, height: source.height })

		let result
		if (formatKey === "ico") {
			const ico = await buildFavicon(source, outW, outH, onStatus)
			result = { blob: new Blob([ico.bytes], { type: "image/x-icon" }), formatKey, quality: null, width: ico.size, height: ico.size, notice: `Favicon with ${ico.count} sizes up to ${ico.size}×${ico.size}.` }
		} else if (targetSizeKb > 0) {
			result = await convertForTarget({ formatKey, source, outW, outH, classification, maxBytes: targetSizeKb * 1024, allowScale: !manualResize, onStatus, targetSizeKb, target: target.ssim })
		} else {
			const image = await resized(source, outW, outH, onStatus)
			result = formatKey === "auto" ? await encodeAuto({ image, classification, target: target.ssim, onStatus }) : await encodeExplicit({ formatKey, image, classification, target: target.ssim, onStatus })
			result.width = outW
			result.height = outH
		}

		const untouched = formatKey === "auto" && !manualResize && !targetSizeKb
		if (untouched && result.blob.size >= blob.size) return await keepOriginal(blob, file, origW, origH, result)

		onStatus?.("Finishing…")
		const lossless = result.quality === null || result.quality === undefined
		const keptExact = formatKey === "auto" && !classification.isPhoto && lossless
		const tip = keptExact ? `Detected a flat graphic (${classification.colors > 256 ? "over 256" : classification.colors} colours), so it was kept pixel exact.` : null
		return {
			dataUrl: await blobToDataUrl(result.blob),
			blob: result.blob,
			fileName: fileNameFor(file.name ?? blob.name, result.formatKey),
			format: FORMAT_LABELS[result.formatKey] ?? result.formatKey,
			formatKey: result.formatKey,
			originalWidth: origW,
			originalHeight: origH,
			outputWidth: result.width,
			outputHeight: result.height,
			originalSize: blob.size,
			outputSize: result.blob.size,
			originalName: file.name ?? blob.name ?? "image",
			quality: lossless ? null : result.quality,
			targetSizeKb: targetSizeKb || null,
			notice: result.notice ?? null,
			tip,
			ssim: result.ssim === undefined || result.ssim === null ? null : Math.round(result.ssim * 10000) / 10000,
			lossless,
			classification: classification.isPhoto ? "photo" : "graphic",
		}
	} finally {
		releaseWorker()
	}
}
