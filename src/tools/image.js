import { ToolError } from "../lib/utils.js"
import { medianCut, qrCodeTool, svgOptimizeTool, imagePaletteTool } from "./media.js"

const FORMAT_MIME = {
	auto: "auto",
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	pdf: "application/pdf",
}

const FORMAT_LABELS = {
	auto: "Auto (best format for the image)",
	png: "PNG",
	jpeg: "JPEG",
	webp: "WebP",
	avif: "AVIF",
	bmp: "BMP",
	gif: "GIF",
	ico: "ICO (favicon)",
	pdf: "PDF",
}

export const QUALITY_TARGETS = {
	lossless: 0.985,
	high: 0.975,
	balanced: 0.96,
}

export function dataUrlToBytes(dataUrl) {
	const match = String(dataUrl).match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
	if (!match) throw new ToolError("Invalid image data, expected a data URL")
	const binary = atob(match[2])
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return { mime: match[1] || "application/octet-stream", bytes }
}

export function computeResize(origW, origH, targetW, targetH, mode = "contain") {
	if (!targetW && !targetH) return { width: origW, height: origH }
	const w = targetW ? Math.max(1, Math.round(Number(targetW))) : 0
	const h = targetH ? Math.max(1, Math.round(Number(targetH))) : 0
	if (w && h) {
		if (mode === "exact") return { width: w, height: h }
		const scale = mode === "cover" ? Math.max(w / origW, h / origH) : Math.min(w / origW, h / origH)
		return { width: Math.max(1, Math.round(origW * scale)), height: Math.max(1, Math.round(origH * scale)) }
	}
	if (w) return { width: w, height: Math.max(1, Math.round((origH * w) / origW)) }
	return { width: Math.max(1, Math.round((origW * h) / origH)), height: h }
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

function concatBytes(parts) {
	const total = parts.reduce((sum, p) => sum + p.length, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		out.set(part, offset)
		offset += part.length
	}
	return out
}

// Checksums

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

export function crc32(bytes, start = 0, end = bytes.length, seed = 0) {
	let c = ~seed >>> 0
	for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
	return ~c >>> 0
}

export function adler32(bytes) {
	let a = 1
	let b = 0
	for (let i = 0; i < bytes.length; ) {
		// 5552 is the largest block that cannot overflow 32 bits before the modulo.
		const end = Math.min(i + 5552, bytes.length)
		for (; i < end; i++) {
			a += bytes[i]
			b += a
		}
		a %= 65521
		b %= 65521
	}
	return ((b << 16) | a) >>> 0
}

function zlibStored(bytes) {
	const blocks = [Uint8Array.of(0x78, 0x01)]
	for (let i = 0; i < bytes.length || i === 0; i += 65535) {
		const chunk = bytes.subarray(i, Math.min(i + 65535, bytes.length))
		const last = i + 65535 >= bytes.length ? 1 : 0
		const len = chunk.length
		blocks.push(Uint8Array.of(last, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff), chunk)
		if (!bytes.length) break
	}
	const sum = adler32(bytes)
	blocks.push(Uint8Array.of(sum >>> 24, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff))
	return concatBytes(blocks)
}

// CompressionStream("deflate") already emits the zlib wrapper and Adler32; stored blocks are only a fallback.
export async function zlibDeflate(bytes) {
	if (typeof CompressionStream !== "function") return zlibStored(bytes)
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Colour analysis

function pixelView(rgba) {
	const bytes = rgba.byteOffset % 4 ? rgba.slice() : rgba
	return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >>> 2)
}

export function exactPalette(rgba, maxColors = 256) {
	const map = new Map()
	const view = pixelView(rgba)
	for (let i = 0; i < view.length; i++) {
		const key = view[i]
		if (!map.has(key)) {
			if (map.size >= maxColors) return null
			map.set(key, map.size)
		}
	}
	return map
}

export function hasTransparency(rgba) {
	for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
	return false
}

export function isGrayscale(rgba) {
	for (let i = 0; i < rgba.length; i += 4) if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) return false
	return true
}

// Photos rarely have identical neighbouring pixels, while UI screenshots, logos and diagrams are mostly flat runs.
export function classifyImage(rgba, width, height) {
	const palette = exactPalette(rgba, 256)
	const alpha = hasTransparency(rgba)
	const pairs = width * Math.max(height, 1)
	const stride = Math.max(1, Math.floor(pairs / 200000))
	let equal = 0
	let total = 0
	const sampled = new Set()
	for (let p = 0; p + 1 < pairs; p += stride) {
		if ((p + 1) % width === 0) continue
		const i = p * 4
		const same = rgba[i] === rgba[i + 4] && rgba[i + 1] === rgba[i + 5] && rgba[i + 2] === rgba[i + 6] && rgba[i + 3] === rgba[i + 7]
		if (same) equal++
		total++
		if (sampled.size < 65536) sampled.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2])
	}
	const equalRatio = total ? equal / total : 1
	return {
		colors: palette ? palette.size : 257,
		palette,
		hasAlpha: alpha,
		equalNeighbourRatio: Math.round(equalRatio * 1000) / 1000,
		sampledColors: sampled.size,
		isPhoto: !palette && equalRatio < 0.35,
	}
}

// PNG encoder

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

function u32(n) {
	return Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
}

function pngChunk(type, data) {
	const typeBytes = new TextEncoder().encode(type)
	const body = concatBytes([typeBytes, data])
	return concatBytes([u32(data.length), body, u32(crc32(body))])
}

function paeth(a, b, c) {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	if (pa <= pb && pa <= pc) return a
	return pb <= pc ? b : c
}

function filterRow(type, row, prev, bpp, out) {
	let sum = 0
	for (let i = 0; i < row.length; i++) {
		const a = i >= bpp ? row[i - bpp] : 0
		const b = prev ? prev[i] : 0
		const c = prev && i >= bpp ? prev[i - bpp] : 0
		const predictor = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >>> 1 : paeth(a, b, c)
		const v = (row[i] - predictor) & 0xff
		out[i] = v
		sum += v < 128 ? v : 256 - v
	}
	return sum
}

// Picks, per row, the filter whose output has the smallest sum of absolute signed bytes (the libpng heuristic).
export function filterScanlines(raw, height, rowBytes, bpp, adaptive = true) {
	const out = new Uint8Array(height * (rowBytes + 1))
	const scratch = Array.from({ length: 5 }, () => new Uint8Array(rowBytes))
	for (let y = 0; y < height; y++) {
		const row = raw.subarray(y * rowBytes, (y + 1) * rowBytes)
		const prev = y ? raw.subarray((y - 1) * rowBytes, y * rowBytes) : null
		let best = 0
		if (adaptive) {
			let bestSum = Infinity
			for (let type = 0; type < 5; type++) {
				const sum = filterRow(type, row, prev, bpp, scratch[type])
				if (sum < bestSum) {
					bestSum = sum
					best = type
				}
			}
		} else filterRow(0, row, prev, bpp, scratch[0])
		const offset = y * (rowBytes + 1)
		out[offset] = best
		out.set(scratch[best], offset + 1)
	}
	return out
}

function packIndexed(rgba, width, height, palette, bitDepth) {
	const view = pixelView(rgba)
	const rowBytes = Math.ceil((width * bitDepth) / 8)
	const raw = new Uint8Array(rowBytes * height)
	const perByte = 8 / bitDepth
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = palette.get(view[y * width + x])
			const byte = y * rowBytes + Math.floor(x / perByte)
			const shift = 8 - bitDepth * ((x % perByte) + 1)
			raw[byte] |= index << shift
		}
	}
	return { raw, rowBytes }
}

function orderedPalette(palette) {
	// Translucent entries go first so the tRNS chunk can stop at the last one.
	const entries = [...palette.keys()].map((key) => {
		const bytes = new Uint8Array(new Uint32Array([key]).buffer)
		return { key, r: bytes[0], g: bytes[1], b: bytes[2], a: bytes[3] }
	})
	entries.sort((x, y) => (x.a === 255) - (y.a === 255) || x.a - y.a)
	const map = new Map(entries.map((e, i) => [e.key, i]))
	return { entries, map }
}

export async function encodePng(rgba, width, height, { forceTruecolor = false } = {}) {
	const pixels = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length)
	const chunks = [PNG_SIGNATURE]
	const palette = forceTruecolor ? null : exactPalette(pixels, 256)
	let colorType
	let bitDepth = 8
	let filtered
	const extra = []
	if (palette) {
		const { entries, map } = orderedPalette(palette)
		bitDepth = entries.length <= 2 ? 1 : entries.length <= 4 ? 2 : entries.length <= 16 ? 4 : 8
		colorType = 3
		const { raw, rowBytes } = packIndexed(pixels, width, height, map, bitDepth)
		filtered = filterScanlines(raw, height, rowBytes, 1, bitDepth === 8)
		extra.push(pngChunk("PLTE", Uint8Array.from(entries.flatMap((e) => [e.r, e.g, e.b]))))
		const translucent = entries.filter((e) => e.a < 255)
		if (translucent.length) extra.push(pngChunk("tRNS", Uint8Array.from(translucent.map((e) => e.a))))
	} else {
		const alpha = hasTransparency(pixels)
		const gray = isGrayscale(pixels)
		const channels = (gray ? 1 : 3) + (alpha ? 1 : 0)
		colorType = gray ? (alpha ? 4 : 0) : alpha ? 6 : 2
		const raw = new Uint8Array(width * height * channels)
		for (let p = 0, o = 0; p < pixels.length; p += 4) {
			raw[o++] = pixels[p]
			if (!gray) {
				raw[o++] = pixels[p + 1]
				raw[o++] = pixels[p + 2]
			}
			if (alpha) raw[o++] = pixels[p + 3]
		}
		filtered = filterScanlines(raw, height, width * channels, channels, true)
	}
	const ihdr = concatBytes([u32(width), u32(height), Uint8Array.of(bitDepth, colorType, 0, 0, 0)])
	chunks.push(pngChunk("IHDR", ihdr), ...extra, pngChunk("IDAT", await zlibDeflate(filtered)), pngChunk("IEND", new Uint8Array(0)))
	return concatBytes(chunks)
}

// BMP, ICO and GIF containers

export function encodeBmp(width, height, rgba, background = [255, 255, 255]) {
	const rowBytes = Math.ceil((width * 3) / 4) * 4
	const imageSize = rowBytes * height
	const out = new Uint8Array(54 + imageSize)
	const dv = new DataView(out.buffer)
	out[0] = 0x42
	out[1] = 0x4d
	dv.setUint32(2, out.length, true)
	dv.setUint32(10, 54, true)
	dv.setUint32(14, 40, true)
	dv.setInt32(18, width, true)
	dv.setInt32(22, height, true)
	dv.setUint16(26, 1, true)
	dv.setUint16(28, 24, true)
	dv.setUint32(34, imageSize, true)
	dv.setInt32(38, 2835, true)
	dv.setInt32(42, 2835, true)
	for (let y = 0; y < height; y++) {
		// BMP rows are stored bottom up in BGR order.
		const rowStart = 54 + (height - 1 - y) * rowBytes
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4
			const a = rgba[i + 3] / 255
			const o = rowStart + x * 3
			out[o] = Math.round(rgba[i + 2] * a + background[2] * (1 - a))
			out[o + 1] = Math.round(rgba[i + 1] * a + background[1] * (1 - a))
			out[o + 2] = Math.round(rgba[i] * a + background[0] * (1 - a))
		}
	}
	return out
}

export function buildIco(images) {
	const header = new Uint8Array(6 + images.length * 16)
	const dv = new DataView(header.buffer)
	dv.setUint16(2, 1, true)
	dv.setUint16(4, images.length, true)
	let offset = header.length
	images.forEach((image, i) => {
		const base = 6 + i * 16
		// A stored size of 0 means 256 pixels.
		header[base] = image.width >= 256 ? 0 : image.width
		header[base + 1] = image.height >= 256 ? 0 : image.height
		dv.setUint16(base + 4, 1, true)
		dv.setUint16(base + 6, 32, true)
		dv.setUint32(base + 8, image.bytes.length, true)
		dv.setUint32(base + 12, offset, true)
		offset += image.bytes.length
	})
	return concatBytes([header, ...images.map((image) => image.bytes)])
}

export function buildIcoFromPng(pngBytes, width, height) {
	return buildIco([{ width, height, bytes: pngBytes }])
}

function nearestIndex(colors, r, g, b) {
	let best = 0
	let bestDist = Infinity
	for (let i = 0; i < colors.length; i++) {
		const c = colors[i]
		const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2
		if (d < bestDist) {
			bestDist = d
			best = i
		}
	}
	return best
}

function gifPalette(rgba) {
	const opaque = []
	let transparent = false
	const stride = Math.max(1, Math.floor(rgba.length / 4 / 100000))
	for (let p = 0; p < rgba.length; p += 4 * stride) {
		if (rgba[p + 3] < 128) transparent = true
		else opaque.push(rgba[p], rgba[p + 1], rgba[p + 2])
	}
	for (let p = 3; !transparent && p < rgba.length; p += 4) if (rgba[p] < 128) transparent = true
	const exact = new Map()
	for (let p = 0; p < rgba.length && exact.size <= 256; p += 4) {
		if (rgba[p + 3] < 128) continue
		const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]
		if (!exact.has(key)) exact.set(key, { r: rgba[p], g: rgba[p + 1], b: rgba[p + 2] })
	}
	const limit = transparent ? 255 : 256
	const colors = exact.size <= limit ? [...exact.values()] : medianCut(Uint8Array.from(opaque), limit)
	return { colors: colors.length ? colors : [{ r: 0, g: 0, b: 0 }], transparent, exact: exact.size <= limit }
}

function gifIndices(rgba, colors, transparentIndex, exact) {
	const out = new Uint8Array(rgba.length / 4)
	const exactMap = exact ? new Map(colors.map((c, i) => [(c.r << 16) | (c.g << 8) | c.b, i])) : null
	// Nearest colour lookups are cached on a 15 bit key, which keeps big images linear in time.
	const cache = new Int16Array(32768).fill(-1)
	for (let p = 0, i = 0; p < rgba.length; p += 4, i++) {
		if (rgba[p + 3] < 128 && transparentIndex >= 0) {
			out[i] = transparentIndex
			continue
		}
		const r = rgba[p]
		const g = rgba[p + 1]
		const b = rgba[p + 2]
		if (exactMap) {
			out[i] = exactMap.get((r << 16) | (g << 8) | b)
			continue
		}
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
		if (cache[key] < 0) cache[key] = nearestIndex(colors, r, g, b)
		out[i] = cache[key]
	}
	return out
}

export function lzwEncode(indices, minCodeSize) {
	const out = []
	let bitBuffer = 0
	let bitCount = 0
	const clearCode = 1 << minCodeSize
	const eoiCode = clearCode + 1
	let codeSize = minCodeSize + 1
	let nextCode = eoiCode + 1
	let table = new Map()
	const emit = (code) => {
		bitBuffer |= code << bitCount
		bitCount += codeSize
		while (bitCount >= 8) {
			out.push(bitBuffer & 0xff)
			bitBuffer >>>= 8
			bitCount -= 8
		}
	}
	emit(clearCode)
	let prefix = indices[0]
	for (let i = 1; i < indices.length; i++) {
		const k = indices[i]
		const key = (prefix << 8) | k
		const found = table.get(key)
		if (found !== undefined) {
			prefix = found
			continue
		}
		emit(prefix)
		if (nextCode === 4096) {
			emit(clearCode)
			nextCode = eoiCode + 1
			codeSize = minCodeSize + 1
			table = new Map()
		} else {
			if (nextCode >= 1 << codeSize) codeSize++
			table.set(key, nextCode++)
		}
		prefix = k
	}
	emit(prefix)
	emit(eoiCode)
	if (bitCount > 0) out.push(bitBuffer & 0xff)
	return Uint8Array.from(out)
}

export function encodeGif(width, height, rgba) {
	const { colors, transparent, exact } = gifPalette(rgba)
	const transparentIndex = transparent ? colors.length : -1
	const tableSize = Math.max(2, 2 ** Math.ceil(Math.log2(colors.length + (transparent ? 1 : 0))))
	const sizeBits = Math.log2(tableSize)
	const indices = gifIndices(rgba, colors, transparentIndex, exact)
	const minCodeSize = Math.max(2, sizeBits)
	const lzw = lzwEncode(indices, minCodeSize)
	const parts = [new TextEncoder().encode("GIF89a")]
	parts.push(Uint8Array.of(width & 0xff, width >> 8, height & 0xff, height >> 8, 0x80 | 0x70 | (sizeBits - 1), 0, 0))
	const table = new Uint8Array(tableSize * 3)
	colors.forEach((c, i) => table.set([c.r, c.g, c.b], i * 3))
	parts.push(table)
	if (transparent) parts.push(Uint8Array.of(0x21, 0xf9, 0x04, 0x01, 0, 0, transparentIndex, 0))
	parts.push(Uint8Array.of(0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, minCodeSize))
	for (let i = 0; i < lzw.length; i += 255) {
		const block = lzw.subarray(i, i + 255)
		parts.push(Uint8Array.of(block.length), block)
	}
	parts.push(Uint8Array.of(0, 0x3b))
	return { bytes: concatBytes(parts), colors: colors.length, lossless: exact }
}

// PDF wrappers

function buildPdf(width, height, streamData, imageDict) {
	const enc = new TextEncoder()
	const drawCmd = enc.encode(`q ${width} 0 0 ${height} 0 0 cm /Img Do Q`)
	const parts = []
	const offsets = []
	let pos = 0
	const write = (value) => {
		const bytes = typeof value === "string" ? enc.encode(value) : value
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
	write(`4 0 obj\n<< /Length ${drawCmd.length} >>\nstream\n`)
	write(drawCmd)
	write("\nendstream\nendobj\n")
	offsets.push(pos)
	write(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${imageDict}/Length ${streamData.length} >>\nstream\n`)
	write(streamData)
	write("\nendstream\nendobj\n")
	const xrefPos = pos
	write(`xref\n0 6\n0000000000 65535 f \n${offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n \n`).join("")}`)
	write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)
	return concatBytes(parts)
}

export function buildPdfFromRgb(width, height, rgbData) {
	return buildPdf(width, height, rgbData, "")
}

// Embedding the JPEG stream as is keeps a photo PDF a fraction of the size of raw RGB.
export function buildPdfFromJpeg(width, height, jpegBytes) {
	return buildPdf(width, height, jpegBytes, "/Filter /DCTDecode ")
}

// Resampling and quality metric

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
	const s = i / 255
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
})

const LINEAR_STEPS = 4096
const LINEAR_TO_SRGB = new Uint8Array(LINEAR_STEPS + 1).map((_, i) => {
	const v = i / LINEAR_STEPS
	const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
	return Math.round(s * 255)
})

export function lanczos3(x) {
	if (x === 0) return 1
	if (x <= -3 || x >= 3) return 0
	const px = Math.PI * x
	return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px)
}

export function resampleWeights(srcSize, dstSize) {
	const scale = dstSize / srcSize
	const filterScale = Math.min(scale, 1)
	const support = 3 / filterScale
	const maxTaps = Math.ceil(support * 2) + 2
	const starts = new Int32Array(dstSize)
	const counts = new Int32Array(dstSize)
	const weights = new Float32Array(dstSize * maxTaps)
	for (let i = 0; i < dstSize; i++) {
		const center = (i + 0.5) / scale
		const start = Math.max(0, Math.floor(center - support))
		const end = Math.min(srcSize - 1, Math.ceil(center + support))
		let total = 0
		let n = 0
		for (let j = start; j <= end && n < maxTaps; j++, n++) {
			const w = lanczos3((j + 0.5 - center) * filterScale)
			weights[i * maxTaps + n] = w
			total += w
		}
		for (let k = 0; k < n; k++) weights[i * maxTaps + k] /= total || 1
		starts[i] = start
		counts[i] = n
	}
	return { starts, counts, weights, maxTaps }
}

function toLinearPremultiplied(rgba, width, height) {
	const out = new Float32Array(width * height * 4)
	for (let i = 0; i < rgba.length; i += 4) {
		const a = rgba[i + 3] / 255
		out[i] = SRGB_TO_LINEAR[rgba[i]] * a
		out[i + 1] = SRGB_TO_LINEAR[rgba[i + 1]] * a
		out[i + 2] = SRGB_TO_LINEAR[rgba[i + 2]] * a
		out[i + 3] = a
	}
	return out
}

// Integer area averaging first keeps Lanczos cheap on very large reductions without visible quality loss.
function boxReduce(linear, width, height, factor) {
	const w = Math.floor(width / factor)
	const h = Math.floor(height / factor)
	const out = new Float32Array(w * h * 4)
	const norm = 1 / (factor * factor)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 4
			for (let dy = 0; dy < factor; dy++) {
				let i = ((y * factor + dy) * width + x * factor) * 4
				for (let dx = 0; dx < factor; dx++, i += 4) {
					out[o] += linear[i]
					out[o + 1] += linear[i + 1]
					out[o + 2] += linear[i + 2]
					out[o + 3] += linear[i + 3]
				}
			}
			out[o] *= norm
			out[o + 1] *= norm
			out[o + 2] *= norm
			out[o + 3] *= norm
		}
	}
	return { data: out, width: w, height: h }
}

function encodeLinear(value) {
	return LINEAR_TO_SRGB[Math.max(0, Math.min(LINEAR_STEPS, Math.round(value * LINEAR_STEPS)))]
}

// Lanczos3 in linear light with premultiplied alpha, so edges against transparency do not get dark halos.
export function resizeLanczos(rgba, srcW, srcH, dstW, dstH) {
	let src = { data: toLinearPremultiplied(rgba, srcW, srcH), width: srcW, height: srcH }
	const factor = Math.floor(Math.min(srcW / dstW, srcH / dstH) / 2)
	if (factor >= 2) src = boxReduce(src.data, srcW, srcH, factor)
	const { data, width, height } = src
	const wx = resampleWeights(width, dstW)
	const wy = resampleWeights(height, dstH)
	const column = new Float32Array(width * 4)
	const out = new Uint8ClampedArray(dstW * dstH * 4)
	for (let y = 0; y < dstH; y++) {
		column.fill(0)
		const ys = wy.starts[y]
		for (let k = 0; k < wy.counts[y]; k++) {
			const w = wy.weights[y * wy.maxTaps + k]
			const rowOffset = (ys + k) * width * 4
			for (let i = 0; i < width * 4; i++) column[i] += data[rowOffset + i] * w
		}
		for (let x = 0; x < dstW; x++) {
			let r = 0
			let g = 0
			let b = 0
			let a = 0
			const xs = wx.starts[x]
			for (let k = 0; k < wx.counts[x]; k++) {
				const w = wx.weights[x * wx.maxTaps + k]
				const i = (xs + k) * 4
				r += column[i] * w
				g += column[i + 1] * w
				b += column[i + 2] * w
				a += column[i + 3] * w
			}
			const o = (y * dstW + x) * 4
			const alpha = Math.max(0, Math.min(1, a))
			if (alpha > 0) {
				out[o] = encodeLinear(r / alpha)
				out[o + 1] = encodeLinear(g / alpha)
				out[o + 2] = encodeLinear(b / alpha)
			}
			out[o + 3] = Math.round(alpha * 255)
		}
	}
	return out
}

function lumaPlane(rgba, length) {
	const out = new Float32Array(length)
	for (let p = 0, i = 0; i < length; p += 4, i++) {
		const a = rgba[p + 3] / 255
		// Transparent areas are judged as they would look on a white page.
		const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
		out[i] = y * a + 255 * (1 - a)
	}
	return out
}

// Mean SSIM over 8x8 luma windows. Large images use a sparser window grid instead of downsampling, so artefacts stay visible to the metric.
export function ssim(rgbaA, rgbaB, width, height, { maxWindows = 60000 } = {}) {
	const size = width * height
	const a = lumaPlane(rgbaA, size)
	const b = lumaPlane(rgbaB, size)
	const win = Math.min(8, width, height)
	const step = Math.max(4, Math.ceil(Math.sqrt(((width - win + 1) * (height - win + 1)) / maxWindows)))
	const c1 = (0.01 * 255) ** 2
	const c2 = (0.03 * 255) ** 2
	const n = win * win
	let total = 0
	let count = 0
	for (let y = 0; y + win <= height; y += step) {
		for (let x = 0; x + win <= width; x += step) {
			let sa = 0
			let sb = 0
			let saa = 0
			let sbb = 0
			let sab = 0
			for (let dy = 0; dy < win; dy++) {
				let i = (y + dy) * width + x
				for (let dx = 0; dx < win; dx++, i++) {
					const va = a[i]
					const vb = b[i]
					sa += va
					sb += vb
					saa += va * va
					sbb += vb * vb
					sab += va * vb
				}
			}
			const ma = sa / n
			const mb = sb / n
			const va = saa / n - ma * ma
			const vb = sbb / n - mb * mb
			const cov = sab / n - ma * mb
			total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
			count++
		}
	}
	return count ? total / count : 1
}

const RESIZE_MODES = [
	{ value: "contain", label: "Contain (fit inside)" },
	{ value: "cover", label: "Cover (fill area)" },
	{ value: "exact", label: "Exact (stretch)" },
]

export const imageTools = [
	{
		id: "image-converter",
		name: "Image converter, compressor and resizer",
		category: "Media",
		roles: ["dev", "qa", "design", "it"],
		description: "Convert and compress images: exact palette PNG for flat graphics, SSIM tuned WebP/JPEG for photos, Lanczos resizing, target file size, plus BMP, GIF, ICO and PDF.",
		keywords: ["compress", "resize", "convert", "png", "jpeg", "jpg", "webp", "avif", "gif", "bmp", "favicon", "ico", "pdf", "optimize", "tinypng", "shrink"],
		async: true,
		live: false,
		inputs: [
			{ key: "file", label: "Image file", type: "file", accept: "image/*", read: "dataUrl" },
			{
				key: "format",
				label: "Output format",
				type: "select",
				options: Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label })),
				default: "auto",
				help: "Auto keeps flat graphics lossless and picks the smaller of WebP and JPEG for photos. AVIF works only where the browser can encode it.",
			},
			{
				key: "qualityTarget",
				label: "Quality",
				type: "select",
				options: [
					{ value: "lossless", label: "Visually lossless (SSIM 0.985)" },
					{ value: "high", label: "High (SSIM 0.975)" },
					{ value: "balanced", label: "Balanced (SSIM 0.96)" },
				],
				default: "lossless",
				help: "Lossy formats are tuned until they measurably match the original this closely.",
			},
			{ key: "targetSizeKb", label: "Target file size (KB)", type: "number", min: 1, help: "Optional cap. Quality and, unless you set a size below, dimensions are traded off to fit." },
			{ key: "width", label: "Resize width (px)", type: "number", min: 1, help: "Blank keeps the original." },
			{ key: "height", label: "Resize height (px)", type: "number", min: 1 },
			{ key: "resizeMode", label: "Resize mode", type: "select", options: RESIZE_MODES, default: "contain" },
		],
		run: () => {
			throw new ToolError("The image converter requires a browser; run it from the popup")
		},
	},
	qrCodeTool,
	svgOptimizeTool,
	imagePaletteTool,
]

export { FORMAT_MIME, FORMAT_LABELS }
