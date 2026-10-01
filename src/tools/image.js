import { ToolError } from "../lib/utils.js"

const FORMAT_MIME = {
	auto: "auto",
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	pdf: "application/pdf",
}

const FORMAT_LABELS = {
	auto: "Auto (Best quality & size)",
	png: "PNG",
	jpeg: "JPEG",
	webp: "WebP",
	bmp: "BMP",
	gif: "GIF",
	ico: "ICO (favicon)",
	pdf: "PDF",
}

export function dataUrlToBytes(dataUrl) {
	const match = String(dataUrl).match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
	if (!match) throw new ToolError("Invalid image data — expected a data URL")
	const binary = atob(match[2])
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return { mime: match[1] || "application/octet-stream", bytes }
}

export function buildImagePdf(width, height, pngDataUrl) {
	const { bytes: imgBytes } = dataUrlToBytes(pngDataUrl)

	const pageW = width
	const pageH = height
	const imgLen = imgBytes.length

	const objects = []
	let nextObj = 1

	function addObj(content) {
		const id = nextObj++
		objects.push({ id, content })
		return id
	}

	const catalogId = addObj(null)
	const pagesId = addObj(null)
	const pageId = addObj(null)
	const contentsId = addObj(null)
	const imageId = addObj(null)

	const drawCmd = `q ${pageW} 0 0 ${pageH} 0 0 cm /Img Do Q`
	const contentsStream = new TextEncoder().encode(drawCmd)

	objects[catalogId - 1].content = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
	objects[pagesId - 1].content = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`
	objects[pageId - 1].content = [
		`<< /Type /Page /Parent ${pagesId} 0 R`,
		`/MediaBox [0 0 ${pageW} ${pageH}]`,
		`/Contents ${contentsId} 0 R`,
		`/Resources << /XObject << /Img ${imageId} 0 R >> >> >>`,
	].join(" ")
	objects[contentsId - 1].content = `stream`
	objects[contentsId - 1].stream = contentsStream
	objects[imageId - 1].content = `image`
	objects[imageId - 1].imageBytes = imgBytes
	objects[imageId - 1].width = width
	objects[imageId - 1].height = height

	const lines = ["%PDF-1.4"]
	const offsets = []

	for (const obj of objects) {
		offsets.push(lines.join("\n").length + 1)
		if (obj.content === "stream") {
			lines.push(`${obj.id} 0 obj`)
			lines.push(`<< /Length ${obj.stream.length} >>`)
			lines.push("stream")
			lines.push(new TextDecoder().decode(obj.stream))
			lines.push("endstream")
			lines.push("endobj")
		} else if (obj.content === "image") {
			lines.push(`__IMAGE_PLACEHOLDER_${obj.id}__`)
		} else {
			lines.push(`${obj.id} 0 obj`)
			lines.push(obj.content)
			lines.push("endobj")
		}
	}

	return {
		needsCanvas: true,
		catalogId,
		pagesId,
		pageId,
		contentsId,
		imageId,
		pageW,
		pageH,
		drawCmd,
		imgBytes,
	}
}

export function buildPdfFromRgb(width, height, rgbData) {
	const enc = new TextEncoder()
	const streamData = rgbData

	const imgDict = [
		`<< /Type /XObject /Subtype /Image`,
		`/Width ${width} /Height ${height}`,
		`/ColorSpace /DeviceRGB /BitsPerComponent 8`,
		`/Length ${streamData.length} >>`,
	].join(" ")

	const drawCmd = `q ${width} 0 0 ${height} 0 0 cm /Img Do Q`
	const contentsBytes = enc.encode(drawCmd)

	const parts = []
	const offsets = []
	let pos = 0

	function write(str) {
		const b = enc.encode(str)
		parts.push(b)
		pos += b.length
	}

	function writeBin(bytes) {
		parts.push(bytes)
		pos += bytes.length
	}

	write("%PDF-1.4\n%\xC0\xC1\xC2\xC3\n")

	offsets.push(pos)
	write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

	offsets.push(pos)
	write("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")

	offsets.push(pos)
	write(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>\nendobj\n`)

	offsets.push(pos)
	write(`4 0 obj\n<< /Length ${contentsBytes.length} >>\nstream\n`)
	writeBin(contentsBytes)
	write("\nendstream\nendobj\n")

	offsets.push(pos)
	write(`5 0 obj\n${imgDict}\nstream\n`)
	writeBin(streamData)
	write("\nendstream\nendobj\n")

	const xrefPos = pos
	write("xref\n")
	write(`0 6\n`)
	write("0000000000 65535 f \n")
	for (const off of offsets) {
		write(`${String(off).padStart(10, "0")} 00000 n \n`)
	}

	write("trailer\n")
	write(`<< /Size 6 /Root 1 0 R >>\n`)
	write("startxref\n")
	write(`${xrefPos}\n`)
	write("%%EOF\n")

	const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
	const result = new Uint8Array(totalLen)
	let offset = 0
	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}
	return result
}

export function computeResize(origW, origH, targetW, targetH, mode = "contain") {
	if (!targetW && !targetH) return { width: origW, height: origH }

	const w = targetW ? Math.max(1, Math.round(Number(targetW))) : 0
	const h = targetH ? Math.max(1, Math.round(Number(targetH))) : 0

	if (w && h) {
		if (mode === "exact") return { width: w, height: h }
		const scaleW = w / origW
		const scaleH = h / origH
		const scale = mode === "cover" ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH)
		return {
			width: Math.max(1, Math.round(origW * scale)),
			height: Math.max(1, Math.round(origH * scale)),
		}
	}

	if (w) {
		const scale = w / origW
		return { width: w, height: Math.max(1, Math.round(origH * scale)) }
	}

	const scale = h / origH
	return { width: Math.max(1, Math.round(origW * scale)), height: h }
}

export function parseQuality(raw) {
	const q = Number(raw)
	if (Number.isNaN(q)) return 0.92
	return Math.min(1.0, Math.max(0.1, q))
}

export function humanSize(bytes) {
	const units = ["B", "KB", "MB", "GB"]
	let value = Number(bytes)
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	return `${Math.round(value * 100) / 100} ${units[unit]}`
}

// Binary search for highest quality setting that fits within targetBytes
export async function findOptimalQuality(measureSize, targetBytes, options = {}) {
	const minQ = options.minQuality ?? 0.01
	const maxQ = options.maxQuality ?? 1.0
	const maxIter = options.maxIter ?? 16

	const maxSize = await measureSize(maxQ)
	if (maxSize <= targetBytes) {
		return { quality: maxQ, size: maxSize, underTarget: true }
	}

	const minSize = await measureSize(minQ)
	if (minSize > targetBytes) {
		return { quality: minQ, size: minSize, underTarget: false }
	}

	let lo = minQ
	let hi = maxQ
	let bestQ = minQ
	let bestSize = minSize

	for (let i = 0; i < maxIter; i++) {
		const mid = Math.round(((lo + hi) / 2) * 10000) / 10000
		const size = await measureSize(mid)

		if (size <= targetBytes) {
			bestQ = mid
			bestSize = size
			lo = mid
		} else {
			hi = mid
		}

		if (hi - lo < 0.0005) break
	}

	return {
		quality: Math.round(bestQ * 10000) / 10000,
		size: bestSize,
		underTarget: bestSize <= targetBytes,
	}
}

// Binary search canvas quality for lossy formats (JPEG/WebP) to meet targetBytes
export function compressToTargetSize(canvas, mime, targetBytes, maxIter = 10) {
	let lo = 0.01
	let hi = 1.0
	let bestUrl = canvas.toDataURL(mime, hi)
	let bestQ = hi
	let bestSize = Math.round((bestUrl.split(",")[1] || "").length * 0.75)

	if (bestSize <= targetBytes) return { dataUrl: bestUrl, quality: bestQ, size: bestSize }

	const minUrl = canvas.toDataURL(mime, lo)
	const minSize = Math.round((minUrl.split(",")[1] || "").length * 0.75)
	if (minSize > targetBytes) {
		return { dataUrl: minUrl, quality: lo, size: minSize }
	}

	bestUrl = minUrl
	bestQ = lo
	bestSize = minSize

	for (let i = 0; i < maxIter; i++) {
		const mid = Math.round(((lo + hi) / 2) * 1000) / 1000
		const url = canvas.toDataURL(mime, mid)
		const size = Math.round((url.split(",")[1] || "").length * 0.75)

		if (size <= targetBytes) {
			bestUrl = url
			bestQ = mid
			bestSize = size
			lo = mid
		} else {
			hi = mid
		}

		if (hi - lo < 0.005) break
	}

	return { dataUrl: bestUrl, quality: Math.round(bestQ * 1000) / 1000, size: bestSize }
}

export const imageTools = [
	{
		id: "image-converter",
		name: "Image converter, compressor and resizer",
		category: "Media",
		roles: ["dev", "qa", "design", "it"],
		description: "Convert between PNG, JPEG, WebP, BMP, GIF, ICO and PDF. Compress to target file size using adaptive dual-format optimization with crisp quality, anti-pixelation noise filtering, and strict color preservation.",
		async: true,
		inputs: [
			{ key: "file", label: "Image file", type: "file", accept: "image/*" },
			{
				key: "format",
				label: "Output format",
				type: "select",
				options: ["Auto (Best quality & size)", "WebP", "JPEG", "PNG", "BMP", "GIF", "ICO (favicon)", "PDF"],
				default: "Auto (Best quality & size)",
			},
			{ key: "targetSizeKb", label: "Target file size (KB, blank = no limit)", type: "number" },
			{
				key: "strategy",
				label: "Compression strategy",
				type: "select",
				options: [
					"True color & high sharpness (crisp details, gentle scale if needed)",
					"Strict 100% resolution (never downscale pixels)",
					"Smallest file size (fit target at any cost)",
				],
				default: "True color & high sharpness (crisp details, gentle scale if needed)",
			},
			{ key: "quality", label: "Quality (0.1–1.0, for JPEG/WebP, ignored when target size is set)", type: "number", default: 0.82, min: 0.1, max: 1.0 },
			{ key: "width", label: "Resize width (px, blank = keep original)", type: "number" },
			{ key: "height", label: "Resize height (px, blank = keep original)", type: "number" },
			{
				key: "resizeMode",
				label: "Resize mode",
				type: "select",
				options: ["Contain (fit inside)", "Cover (fill area)", "Exact (stretch)"],
				default: "Contain (fit inside)",
			},
		],
		// run is handled by popup.js because it needs Canvas / file API
		run: () => {
			throw new ToolError("Image converter requires browser Canvas — run it from the popup UI")
		},
	},
]

export { FORMAT_MIME, FORMAT_LABELS }

