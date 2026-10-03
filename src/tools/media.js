import { ToolError, clamp, formatBytes, required, round } from "../lib/utils.js"
import { parseColor, toHex, rgbToHsl, rgbToOklab, contrastRatio } from "./design.js"

// QR code encoder following ISO/IEC 18004. Tables are indexed by error correction level then version (index 0 unused).

const ECL_ORDER = ["L", "M", "Q", "H"]
const ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }

const ECC_CODEWORDS_PER_BLOCK = {
	L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
	M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
	Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
	H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
}

const NUM_ECC_BLOCKS = {
	L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
	M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
	Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
	H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
}

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"

const MODES = {
	numeric: { indicator: 0b0001, countBits: [10, 12, 14] },
	alphanumeric: { indicator: 0b0010, countBits: [9, 11, 13] },
	byte: { indicator: 0b0100, countBits: [8, 16, 16] },
}

export function qrSize(version) {
	return version * 4 + 17
}

export function numRawDataModules(version) {
	let result = (16 * version + 128) * version + 64
	if (version >= 2) {
		const numAlign = Math.floor(version / 7) + 2
		result -= (25 * numAlign - 10) * numAlign - 55
		if (version >= 7) result -= 36
	}
	return result
}

export function numDataCodewords(version, ecl) {
	return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ECC_BLOCKS[ecl][version]
}

export function alignmentPositions(version) {
	if (version === 1) return []
	const numAlign = Math.floor(version / 7) + 2
	const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
	const result = [6]
	for (let pos = qrSize(version) - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
	return result
}

function gfMultiply(x, y) {
	let z = 0
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d)
		z ^= ((y >>> i) & 1) * x
	}
	return z & 0xff
}

export function reedSolomonDivisor(degree) {
	const result = new Array(degree).fill(0)
	result[degree - 1] = 1
	let root = 1
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root)
			if (j + 1 < result.length) result[j] ^= result[j + 1]
		}
		root = gfMultiply(root, 0x02)
	}
	return result
}

export function reedSolomonRemainder(data, divisor) {
	const result = new Array(divisor.length).fill(0)
	for (const byte of data) {
		const factor = byte ^ result.shift()
		result.push(0)
		for (let i = 0; i < divisor.length; i++) result[i] ^= gfMultiply(divisor[i], factor)
	}
	return result
}

function utf8Bytes(text) {
	return [...new TextEncoder().encode(text)]
}

export function chooseMode(text) {
	if (/^\d*$/.test(text)) return "numeric"
	if ([...text].every((ch) => ALPHANUMERIC.includes(ch))) return "alphanumeric"
	return "byte"
}

function pushBits(bits, value, length) {
	for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

function encodePayload(text, mode) {
	const bits = []
	if (mode === "numeric") {
		for (let i = 0; i < text.length; i += 3) {
			const chunk = text.slice(i, i + 3)
			pushBits(bits, Number(chunk), chunk.length * 3 + 1)
		}
		return { bits, count: text.length }
	}
	if (mode === "alphanumeric") {
		for (let i = 0; i < text.length; i += 2) {
			if (i + 1 < text.length) pushBits(bits, ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11)
			else pushBits(bits, ALPHANUMERIC.indexOf(text[i]), 6)
		}
		return { bits, count: text.length }
	}
	const bytes = utf8Bytes(text)
	for (const b of bytes) pushBits(bits, b, 8)
	return { bits, count: bytes.length }
}

function countBitsFor(mode, version) {
	return MODES[mode].countBits[version <= 9 ? 0 : version <= 26 ? 1 : 2]
}

export function buildDataCodewords(text, version, ecl, mode = chooseMode(text)) {
	const payload = encodePayload(text, mode)
	const bits = []
	pushBits(bits, MODES[mode].indicator, 4)
	pushBits(bits, payload.count, countBitsFor(mode, version))
	bits.push(...payload.bits)
	const capacity = numDataCodewords(version, ecl) * 8
	if (bits.length > capacity) return null
	for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0)
	while (bits.length % 8) bits.push(0)
	const codewords = []
	for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))
	for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad)
	return codewords
}

export function addEccAndInterleave(data, version, ecl) {
	const numBlocks = NUM_ECC_BLOCKS[ecl][version]
	const eccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version]
	const rawCodewords = Math.floor(numRawDataModules(version) / 8)
	const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
	const shortBlockLen = Math.floor(rawCodewords / numBlocks)
	const divisor = reedSolomonDivisor(eccLen)
	const blocks = []
	for (let i = 0, k = 0; i < numBlocks; i++) {
		const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1))
		k += dat.length
		const ecc = reedSolomonRemainder(dat, divisor)
		if (i < numShortBlocks) dat.push(0)
		blocks.push(dat.concat(ecc))
	}
	const result = []
	for (let i = 0; i < blocks[0].length; i++) {
		blocks.forEach((block, j) => {
			// Short blocks carry a placeholder byte at this index that must not be emitted.
			if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(block[i])
		})
	}
	return result
}

const MASKS = [
	(x, y) => (x + y) % 2 === 0,
	(x, y) => y % 2 === 0,
	(x) => x % 3 === 0,
	(x, y) => (x + y) % 3 === 0,
	(x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
	(x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
	(x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
	(x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

export function formatBits(ecl, mask) {
	const data = (ECL_FORMAT_BITS[ecl] << 3) | mask
	let rem = data
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
	return ((data << 10) | rem) ^ 0x5412
}

export function versionBits(version) {
	let rem = version
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
	return (version << 12) | rem
}

function createGrid(size) {
	return {
		size,
		modules: Array.from({ length: size }, () => new Array(size).fill(false)),
		isFunction: Array.from({ length: size }, () => new Array(size).fill(false)),
	}
}

function setFunction(grid, x, y, dark) {
	grid.modules[y][x] = dark
	grid.isFunction[y][x] = true
}

function drawFunctionPatterns(grid, version) {
	const { size } = grid
	for (let i = 0; i < size; i++) {
		setFunction(grid, 6, i, i % 2 === 0)
		setFunction(grid, i, 6, i % 2 === 0)
	}
	for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const x = cx + dx
				const y = cy + dy
				const dist = Math.max(Math.abs(dx), Math.abs(dy))
				if (x >= 0 && x < size && y >= 0 && y < size) setFunction(grid, x, y, dist !== 2 && dist !== 4)
			}
		}
	}
	const positions = alignmentPositions(version)
	const last = positions.length - 1
	positions.forEach((px, i) => {
		positions.forEach((py, j) => {
			if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) setFunction(grid, px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
			}
		})
	})
	drawFormat(grid, "L", 0)
	if (version >= 7) {
		const bits = versionBits(version)
		for (let i = 0; i < 18; i++) {
			const dark = ((bits >>> i) & 1) === 1
			const a = size - 11 + (i % 3)
			const b = Math.floor(i / 3)
			setFunction(grid, a, b, dark)
			setFunction(grid, b, a, dark)
		}
	}
}

function drawFormat(grid, ecl, mask) {
	const { size } = grid
	const bits = formatBits(ecl, mask)
	const bit = (i) => ((bits >>> i) & 1) === 1
	for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i))
	setFunction(grid, 8, 7, bit(6))
	setFunction(grid, 8, 8, bit(7))
	setFunction(grid, 7, 8, bit(8))
	for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(i))
	for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(i))
	for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(i))
	setFunction(grid, 8, size - 8, true)
}

function drawCodewords(grid, codewords) {
	const { size } = grid
	let i = 0
	const total = codewords.length * 8
	for (let right = size - 1; right >= 1; right -= 2) {
		// The vertical timing pattern occupies column 6, so the zigzag skips over it.
		if (right === 6) right = 5
		for (let vert = 0; vert < size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j
				const upward = ((right + 1) & 2) === 0
				const y = upward ? size - 1 - vert : vert
				if (!grid.isFunction[y][x] && i < total) {
					grid.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
					i++
				}
			}
		}
	}
}

function applyMask(grid, mask) {
	const fn = MASKS[mask]
	for (let y = 0; y < grid.size; y++) {
		for (let x = 0; x < grid.size; x++) if (!grid.isFunction[y][x] && fn(x, y)) grid.modules[y][x] = !grid.modules[y][x]
	}
}

function lineAt(modules, index, horizontal) {
	return horizontal ? modules[index] : modules.map((row) => row[index])
}

const FINDER_LIKE = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]]

function linePenalty(line) {
	let score = 0
	let run = 1
	for (let i = 1; i <= line.length; i++) {
		if (i < line.length && line[i] === line[i - 1]) run++
		else {
			if (run >= 5) score += 3 + (run - 5)
			run = 1
		}
	}
	for (let i = 0; i + 11 <= line.length; i++) {
		for (const pattern of FINDER_LIKE) if (pattern.every((v, k) => Boolean(v) === line[i + k])) score += 40
	}
	return score
}

export function penaltyScore(modules) {
	const size = modules.length
	let score = 0
	let dark = 0
	for (let i = 0; i < size; i++) score += linePenalty(lineAt(modules, i, true)) + linePenalty(lineAt(modules, i, false))
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (modules[y][x]) dark++
			if (x < size - 1 && y < size - 1) {
				const c = modules[y][x]
				if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3
			}
		}
	}
	score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
	return score
}

export function encodeQr(text, { ecl = "M", minVersion = 1, maxVersion = 40, mask = -1, mode } = {}) {
	if (!ECL_ORDER.includes(ecl)) throw new ToolError(`Unknown error correction level: ${ecl}`)
	const chosenMode = mode ?? chooseMode(text)
	let version = 0
	let data = null
	for (let v = clamp(minVersion, 1, 40); v <= clamp(maxVersion, 1, 40); v++) {
		data = buildDataCodewords(text, v, ecl, chosenMode)
		if (data) {
			version = v
			break
		}
	}
	if (!data) throw new ToolError(`Text is too long for a QR code at level ${ecl} (max ${numDataCodewords(40, ecl) - 3} bytes); shorten it or lower the error correction`)
	const codewords = addEccAndInterleave(data, version, ecl)
	const base = createGrid(qrSize(version))
	drawFunctionPatterns(base, version)
	drawCodewords(base, codewords)
	const candidates = mask >= 0 && mask <= 7 ? [mask] : [0, 1, 2, 3, 4, 5, 6, 7]
	let best = null
	for (const m of candidates) {
		const grid = { size: base.size, modules: base.modules.map((row) => row.slice()), isFunction: base.isFunction }
		applyMask(grid, m)
		drawFormat(grid, ecl, m)
		const penalty = candidates.length > 1 ? penaltyScore(grid.modules) : 0
		if (!best || penalty < best.penalty) best = { modules: grid.modules, mask: m, penalty }
	}
	return { version, ecl, mask: best.mask, mode: chosenMode, size: base.size, modules: best.modules, dataCodewords: data, codewords }
}

export function qrToSvg(qr, { size = 256, margin = 4, foreground = "#000000", background = "#ffffff", transparent = false } = {}) {
	const total = qr.size + margin * 2
	let path = ""
	for (let y = 0; y < qr.size; y++) {
		let x = 0
		while (x < qr.size) {
			if (!qr.modules[y][x]) {
				x++
				continue
			}
			let run = 1
			while (x + run < qr.size && qr.modules[y][x + run]) run++
			path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`
			x += run
		}
	}
	const bg = transparent ? "" : `<rect width="${total}" height="${total}" fill="${background}"/>`
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">${bg}<path fill="${foreground}" d="${path}"/></svg>`
}

export function svgDataUri(svg) {
	const quoted = svg.includes("'") ? svg : svg.replace(/"/g, "'")
	const encoded = quoted.replace(/[\r\n%#()<>?[\\\]^`{|}"]|[^\x00-\x7f]/gu, (ch) => encodeURIComponent(ch))
	return `data:image/svg+xml,${encoded}`
}

function escapeWifi(value) {
	return String(value ?? "").replace(/([\\;,":])/g, "\\$1")
}

export function qrPayload(values) {
	const kind = values.kind ?? "text"
	if (kind === "wifi") {
		const security = values.security ?? "WPA"
		const ssid = required(values.ssid, "Network name (SSID)")
		const pass = security === "nopass" ? "" : `P:${escapeWifi(values.password)};`
		return `WIFI:T:${security};S:${escapeWifi(ssid)};${pass}${values.hidden ? "H:true;" : ""};`
	}
	if (kind === "email") {
		const params = new URLSearchParams()
		if (values.subject) params.set("subject", values.subject)
		if (values.body) params.set("body", values.body)
		const query = params.toString().replace(/\+/g, "%20")
		return `mailto:${required(values.to, "Email address")}${query ? `?${query}` : ""}`
	}
	if (kind === "phone") return `tel:${required(values.phone, "Phone number").replace(/[^\d+]/g, "")}`
	if (kind === "sms") return `SMSTO:${required(values.phone, "Phone number").replace(/[^\d+]/g, "")}:${values.body ?? ""}`
	return required(values.text, "Text")
}

function qrRun(values) {
	const payload = qrPayload(values)
	const qr = encodeQr(payload, { ecl: values.ecl || "M", mask: values.mask === "auto" || values.mask === undefined ? -1 : Number(values.mask) })
	const size = clamp(Math.round(Number(values.size) || 256), 64, 4096)
	const margin = clamp(Math.round(Number(values.margin ?? 4)), 0, 16)
	const foreground = toHex({ ...parseColor(values.foreground || "#000000"), a: 1 })
	const background = toHex({ ...parseColor(values.background || "#ffffff"), a: 1 })
	const svg = qrToSvg(qr, { size, margin, foreground, background, transparent: Boolean(values.transparent) })
	const dataUrl = svgDataUri(svg)
	const meta = {
		Version: `${qr.version} (${qr.size}×${qr.size} modules)`,
		"Error correction": `${qr.ecl} (${{ L: "7%", M: "15%", Q: "25%", H: "30%" }[qr.ecl]} recovery)`,
		Mode: qr.mode,
		Mask: qr.mask,
		Payload: `${utf8Bytes(payload).length} bytes`,
		"SVG size": formatBytes(svg.length),
	}
	const ratio = contrastRatio(foreground, background)
	if (!values.transparent && ratio < 3) meta.Warning = `Low contrast (${ratio}:1); many scanners need dark modules on a light background`
	if (margin < 4) meta.Note = "The spec asks for a 4 module quiet zone; smaller margins can fail on some scanners"
	return {
		type: "image",
		value: { dataUrl, width: size, height: size, meta, files: [{ name: "qr-code.svg", dataUrl }] },
		copy: svg,
		download: { filename: "qr-code.svg", mime: "image/svg+xml", text: svg },
	}
}

// SVG optimizer. Works on a light tokenizer instead of DOMParser so it also runs in Node and in the service worker.

const EDITOR_PREFIXES = ["inkscape", "sodipodi", "sketch", "serif", "i", "x", "graph", "a", "dc", "cc", "rdf", "figma", "bx", "vectornator", "krita", "ns1"]
const DROP_ELEMENTS = new Set(["metadata", "sodipodi:namedview", "inkscape:perspective", "inkscape:grid", "sketch:title"])
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "style", "script", "title", "desc"])
const NUMERIC_ATTRS = new Set([
	"d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height",
	"transform", "gradientTransform", "patternTransform", "stroke-width", "stroke-dashoffset", "stroke-dasharray",
	"stroke-miterlimit", "font-size", "letter-spacing", "dx", "dy", "offset", "opacity", "fill-opacity", "stroke-opacity",
])
const DROP_ATTRS = new Set(["data-name", "xml:space", "enable-background", "version", "baseProfile"])
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/?[A-Za-z][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+|</gi
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

function attrPrefix(name) {
	const index = name.indexOf(":")
	return index > 0 ? name.slice(0, index) : ""
}

function isEditorName(name) {
	const prefix = attrPrefix(name)
	if (prefix === "xmlns") return EDITOR_PREFIXES.includes(name.slice(6))
	return EDITOR_PREFIXES.includes(prefix)
}

function parseTag(token) {
	const closing = token.startsWith("</")
	const nameMatch = token.match(/^<\/?([^\s/>]+)/)
	const name = nameMatch[1]
	const attrs = []
	if (!closing) {
		const body = token.slice(nameMatch[0].length).replace(/\/?>$/, "")
		for (const m of body.matchAll(ATTR)) attrs.push([m[1], m[2] ?? m[3] ?? m[4] ?? ""])
	}
	return { closing, name, attrs, selfClosing: /\/>$/.test(token) }
}

export function parseSvgTree(source) {
	const root = { type: "root", children: [] }
	const stack = [root]
	for (const match of source.matchAll(TOKEN)) {
		const token = match[0]
		const parent = stack.at(-1)
		if (token.startsWith("<!--")) parent.children.push({ type: "comment", value: token })
		else if (token.startsWith("<![CDATA[")) parent.children.push({ type: "raw", value: token })
		else if (token.startsWith("<?") || /^<!DOCTYPE/i.test(token)) parent.children.push({ type: "decl", value: token })
		else if (token.startsWith("<") && token.length > 1) {
			const tag = parseTag(token)
			if (tag.closing) {
				const index = stack.findLastIndex((n) => n.name === tag.name)
				if (index > 0) stack.length = index
				continue
			}
			const element = { type: "element", name: tag.name, attrs: tag.attrs, children: [] }
			parent.children.push(element)
			if (!tag.selfClosing) stack.push(element)
		} else parent.children.push({ type: "text", value: token })
	}
	return root
}

function formatNumber(raw, precision) {
	const value = Number(raw)
	if (!Number.isFinite(value)) return raw
	const factor = 10 ** precision
	let text = String(Math.round(value * factor) / factor)
	if (text.includes("e")) return raw
	if (text === "-0") text = "0"
	return text.replace(/^(-?)0\./, "$1.")
}

export function roundNumbers(value, precision) {
	let out = ""
	let last = 0
	for (const m of value.matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)) {
		out += value.slice(last, m.index)
		const formatted = formatNumber(m[0], precision)
		// Path data may separate numbers only by a sign or decimal point ("1.5.5"), so rounding can glue them together.
		if (/[\d.]$/.test(out) && /^[\d.]/.test(formatted)) out += " "
		out += formatted
		last = m.index + m[0].length
	}
	return out + value.slice(last)
}

function collectReferences(node, refs) {
	if (node.type === "element") {
		for (const [, value] of node.attrs) for (const m of value.matchAll(/#([^\s"')]+)/g)) refs.add(m[1])
	}
	if (node.type === "text" || node.type === "raw") for (const m of node.value.matchAll(/#([A-Za-z_][\w-]*)/g)) refs.add(m[1])
	for (const child of node.children ?? []) collectReferences(child, refs)
}

function shortenColor(value) {
	const m = value.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i)
	return m ? `#${m[1]}${m[2]}${m[3]}`.toLowerCase() : value
}

function cleanElement(node, options, refs, stats) {
	node.attrs = node.attrs.filter(([name, value]) => {
		if (isEditorName(name) || DROP_ATTRS.has(name)) return false
		if (name === "id" && options.removeIds && !refs.has(value)) return false
		if (name === "style" && !value.trim()) return false
		return true
	})
	node.attrs = node.attrs.map(([name, value]) => {
		let next = value.replace(/\s+/g, " ").trim()
		if (NUMERIC_ATTRS.has(name)) next = roundNumbers(next, options.precision)
		if (name === "fill" || name === "stroke" || name === "stop-color") next = shortenColor(next)
		return [name, next]
	})
	const usesXlink = JSON.stringify(node).includes("xlink:")
	if (node.name === "svg" && !usesXlink) node.attrs = node.attrs.filter(([name]) => name !== "xmlns:xlink")
	stats.elements++
}

function cleanChildren(node, options, refs, stats, insideText) {
	const out = []
	for (const child of node.children) {
		if (child.type === "comment") {
			if (child.value.startsWith("<!--!")) out.push(child)
			continue
		}
		if (child.type === "decl") continue
		if (child.type === "text") {
			if (insideText) out.push(child)
			else if (child.value.trim()) out.push({ type: "text", value: child.value.replace(/\s+/g, " ").trim() })
			continue
		}
		if (child.type !== "element") {
			out.push(child)
			continue
		}
		if (DROP_ELEMENTS.has(child.name) || isEditorName(child.name) || (!options.keepTitle && (child.name === "title" || child.name === "desc"))) {
			stats.removedElements++
			continue
		}
		cleanElement(child, options, refs, stats)
		cleanChildren(child, options, refs, stats, insideText || TEXT_ELEMENTS.has(child.name))
		const empty = child.children.length === 0
		if ((child.name === "g" || child.name === "defs" || child.name === "style") && empty) {
			stats.removedElements++
			continue
		}
		// A group with no attributes changes nothing about rendering, so its children can move up a level.
		if (child.name === "g" && child.attrs.length === 0) {
			out.push(...child.children)
			stats.removedElements++
			continue
		}
		out.push(child)
	}
	node.children = out
}

function quoteAttr(value) {
	return value.includes('"') ? `'${value}'` : `"${value}"`
}

function serialize(node) {
	if (node.type === "root") return node.children.map(serialize).join("")
	if (node.type !== "element") return node.value
	const attrs = node.attrs.map(([name, value]) => ` ${name}=${quoteAttr(value)}`).join("")
	if (!node.children.length) return `<${node.name}${attrs}/>`
	return `<${node.name}${attrs}>${node.children.map(serialize).join("")}</${node.name}>`
}

const JSX_RENAMES = { class: "className", for: "htmlFor", "xlink:href": "xlinkHref", "xml:space": "xmlSpace", "xmlns:xlink": "xmlnsXlink", "xml:lang": "xmlLang" }

function camel(name) {
	return name.replace(/[-:]([a-z])/g, (_, ch) => ch.toUpperCase())
}

function styleToJsx(style) {
	const entries = style
		.split(";")
		.map((rule) => rule.split(":"))
		.filter(([key, value]) => key?.trim() && value !== undefined)
		.map(([key, ...rest]) => `${camel(key.trim())}: ${JSON.stringify(rest.join(":").trim())}`)
	return `{{ ${entries.join(", ")} }}`
}

function toJsx(node) {
	if (node.type === "root") return node.children.map(toJsx).join("")
	if (node.type === "text") return node.value.replace(/[{}]/g, (ch) => `{"${ch}"}`)
	if (node.type !== "element") return ""
	const attrs = node.attrs
		.map(([name, value]) => {
			if (name === "style") return ` style=${styleToJsx(value)}`
			const jsxName = JSX_RENAMES[name] ?? (/^(data|aria)-/.test(name) ? name : camel(name))
			return ` ${jsxName}=${quoteAttr(value)}`
		})
		.join("")
	if (!node.children.length) return `<${node.name}${attrs} />`
	return `<${node.name}${attrs}>${node.children.map(toJsx).join("")}</${node.name}>`
}

function svgDimensions(tree) {
	const svg = tree.children.find((n) => n.type === "element" && n.name === "svg")
	if (!svg) throw new ToolError("No <svg> root element found")
	const attr = (name) => svg.attrs.find(([k]) => k === name)?.[1]
	const viewBox = (attr("viewBox") ?? "").split(/[\s,]+/).map(Number)
	const width = parseFloat(attr("width")) || viewBox[2] || 300
	const height = parseFloat(attr("height")) || viewBox[3] || 150
	return { width: round(width, 2), height: round(height, 2) }
}

export function optimizeSvg(source, { precision = 2, removeIds = true, keepTitle = true } = {}) {
	const input = String(source ?? "")
	if (input.length > 10 * 1024 * 1024) throw new ToolError("SVG is larger than 10 MB")
	const tree = parseSvgTree(input)
	const refs = new Set()
	collectReferences(tree, refs)
	const stats = { elements: 0, removedElements: 0 }
	cleanChildren(tree, { precision: clamp(Math.round(Number(precision)), 0, 8), removeIds, keepTitle }, refs, stats, false)
	const dimensions = svgDimensions(tree)
	return { svg: serialize(tree), jsx: toJsx(tree), tree, dimensions, stats }
}

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="64" height="64" viewBox="0 0 64 64" id="svg2" inkscape:version="1.3">
  <metadata id="metadata7"><dc:title>Icon</dc:title></metadata>
  <sodipodi:namedview id="base" pagecolor="#ffffff" inkscape:zoom="4.0"/>
  <g id="layer1" inkscape:label="Layer 1" inkscape:groupmode="layer">
    <g>
      <circle id="path10" cx="32.000000" cy="32.000000" r="28.4999999" fill="#2783DE" stroke="#FFFFFF" stroke-width="2.0000"/>
      <path id="path12" d="M 20.123456,33.987654 L 28.000001,41.999999 L 44.5,24.25" fill="none" stroke="#ffffff" stroke-width="4.00001"/>
    </g>
    <g></g>
  </g>
</svg>`

function svgOptimizeRun({ svg, precision = 2, removeIds = true, keepTitle = true, output = "preview" }) {
	const source = required(svg, "SVG")
	const result = optimizeSvg(source, { precision, removeIds, keepTitle })
	const dataUri = svgDataUri(result.svg)
	const before = new TextEncoder().encode(source).length
	const after = new TextEncoder().encode(result.svg).length
	const css = `background-image: url("${dataUri}");`
	const download = { filename: "optimized.svg", mime: "image/svg+xml", text: result.svg }
	if (output === "svg") return { type: "text", value: result.svg, download }
	if (output === "datauri") return { type: "text", value: dataUri, download }
	if (output === "css") return { type: "text", value: css, download }
	if (output === "jsx") return { type: "text", value: result.jsx, download: { filename: "Icon.jsx", mime: "text/plain", text: result.jsx } }
	return {
		type: "image",
		value: {
			dataUrl: dataUri,
			width: result.dimensions.width,
			height: result.dimensions.height,
			meta: {
				Before: formatBytes(before),
				After: formatBytes(after),
				Saved: `${before ? round(((before - after) / before) * 100, 1) : 0}%`,
				"Data URI": formatBytes(dataUri.length),
				"Elements removed": String(result.stats.removedElements),
			},
			files: [{ name: "optimized.svg", dataUrl: dataUri }],
		},
		copy: result.svg,
		download,
	}
}

// Palette extraction with median cut. Pure so it can be tested in Node and reused for GIF quantization.

export function medianCut(pixels, maxColors) {
	const count = Math.floor(pixels.length / 3)
	if (!count) return []
	const indices = new Uint32Array(count)
	for (let i = 0; i < count; i++) indices[i] = i * 3
	const boxes = [makeBox(pixels, indices)]
	while (boxes.length < maxColors) {
		let pick = -1
		let bestScore = 0
		boxes.forEach((box, i) => {
			const score = box.range * Math.sqrt(box.indices.length)
			if (box.indices.length > 1 && box.range > 0 && score > bestScore) {
				bestScore = score
				pick = i
			}
		})
		if (pick < 0) break
		const [a, b] = splitBox(pixels, boxes[pick])
		boxes.splice(pick, 1, a, b)
	}
	return boxes.map((box) => averageBox(pixels, box.indices))
}

function makeBox(pixels, indices) {
	const min = [255, 255, 255]
	const max = [0, 0, 0]
	for (const i of indices) {
		for (let c = 0; c < 3; c++) {
			const v = pixels[i + c]
			if (v < min[c]) min[c] = v
			if (v > max[c]) max[c] = v
		}
	}
	const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
	const channel = ranges.indexOf(Math.max(...ranges))
	return { indices, channel, range: ranges[channel] }
}

function splitBox(pixels, box) {
	const { channel } = box
	const sorted = Uint32Array.from(box.indices).sort((a, b) => pixels[a + channel] - pixels[b + channel])
	const value = (k) => pixels[sorted[k] + channel]
	let mid = Math.floor(sorted.length / 2)
	// Splitting inside a run of equal values would average two distinct colours into one muddy swatch.
	const median = value(mid)
	let lo = mid
	while (lo > 0 && value(lo - 1) === median) lo--
	if (lo > 0) mid = lo
	else while (mid < sorted.length - 1 && value(mid) === median) mid++
	return [makeBox(pixels, sorted.subarray(0, mid)), makeBox(pixels, sorted.subarray(mid))]
}

function averageBox(pixels, indices) {
	let r = 0
	let g = 0
	let b = 0
	for (const i of indices) {
		r += pixels[i]
		g += pixels[i + 1]
		b += pixels[i + 2]
	}
	const n = indices.length
	return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), count: n }
}

function oklabDistance(a, b) {
	const x = rgbToOklab(a)
	const y = rgbToOklab(b)
	return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

export function mergeSimilar(colors, threshold = 0.04) {
	const merged = []
	for (const color of [...colors].sort((a, b) => b.count - a.count)) {
		const near = merged.find((m) => oklabDistance(m, color) < threshold)
		if (near) near.count += color.count
		else merged.push({ ...color })
	}
	return merged
}

export function extractPalette(rgba, count = 6, { maxSamples = 40000 } = {}) {
	const pixelCount = Math.floor(rgba.length / 4)
	const stride = Math.max(1, Math.ceil(pixelCount / maxSamples))
	const samples = []
	for (let p = 0; p < pixelCount; p += stride) {
		const i = p * 4
		if (rgba[i + 3] < 125) continue
		samples.push(rgba[i], rgba[i + 1], rgba[i + 2])
	}
	if (!samples.length) throw new ToolError("The image is fully transparent")
	const raw = medianCut(Uint8Array.from(samples), Math.min(count * 2, 64))
	const colors = mergeSimilar(raw).slice(0, count)
	const total = colors.reduce((sum, c) => sum + c.count, 0)
	return colors.map((c, index) => {
		const hex = toHex(c)
		const hsl = rgbToHsl(c)
		return {
			step: index + 1,
			hex,
			rgb: `rgb(${c.r} ${c.g} ${c.b})`,
			hsl: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`,
			percent: round((c.count / total) * 100, 1),
			textColor: contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#2c2c2b") ? "#FFFFFF" : "#2C2C2B",
		}
	})
}

async function decodeToPixels(file, maxSide) {
	if (typeof createImageBitmap !== "function") throw new ToolError("Image palette requires a browser")
	const blob = file.bytes ? new Blob([file.bytes], { type: file.mime }) : await (await fetch(file.dataUrl)).blob()
	const bitmap = await createImageBitmap(blob)
	const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
	const width = Math.max(1, Math.round(bitmap.width * scale))
	const height = Math.max(1, Math.round(bitmap.height * scale))
	const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height })
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	ctx.drawImage(bitmap, 0, 0, width, height)
	bitmap.close?.()
	return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

async function imagePaletteRun({ file, count = 6 }) {
	if (!file || (!file.dataUrl && !file.bytes)) throw new ToolError("Choose an image file")
	if (file.mime && !file.mime.startsWith("image/")) throw new ToolError("Selected file is not an image")
	const { data } = await decodeToPixels(file, 160)
	const palette = extractPalette(data, clamp(Math.round(Number(count)) || 6, 2, 16))
	const css = `:root {\n${palette.map((c) => `  --color-${c.step}: ${c.hex}; /* ${c.percent}% */`).join("\n")}\n}`
	return { type: "json", value: palette, copy: css }
}

export const qrCodeTool = {
	id: "qr-code",
	name: "QR code generator",
	category: "Media",
	roles: ["dev", "qa", "design", "it"],
	description: "Scannable QR codes for text, URLs, Wi-Fi, email, phone or SMS as crisp SVG, with error correction and colours.",
	keywords: ["qr", "qrcode", "barcode", "2d code", "wifi qr", "url to qr", "svg", "scan"],
	inputs: [
		{
			key: "kind",
			label: "Content",
			type: "select",
			options: [
				{ value: "text", label: "Text or URL" },
				{ value: "wifi", label: "Wi-Fi network" },
				{ value: "email", label: "Email" },
				{ value: "phone", label: "Phone number" },
				{ value: "sms", label: "SMS" },
			],
			default: "text",
		},
		{ key: "text", label: "Text or URL", type: "textarea", default: "https://example.com", showIf: { key: "kind", in: ["text"] } },
		{ key: "ssid", label: "Network name (SSID)", type: "text", showIf: { key: "kind", in: ["wifi"] } },
		{ key: "security", label: "Security", type: "select", options: [{ value: "WPA", label: "WPA/WPA2/WPA3" }, { value: "WEP", label: "WEP" }, { value: "nopass", label: "Open (no password)" }], default: "WPA", showIf: { key: "kind", in: ["wifi"] } },
		{ key: "password", label: "Password", type: "text", sensitive: true, showIf: { key: "kind", in: ["wifi"] } },
		{ key: "hidden", label: "Hidden network", type: "checkbox", default: false, showIf: { key: "kind", in: ["wifi"] } },
		{ key: "to", label: "Email address", type: "text", showIf: { key: "kind", in: ["email"] } },
		{ key: "subject", label: "Subject", type: "text", showIf: { key: "kind", in: ["email"] } },
		{ key: "phone", label: "Phone number", type: "text", placeholder: "+1 555 0100", showIf: { key: "kind", in: ["phone", "sms"] } },
		{ key: "body", label: "Message", type: "textarea", showIf: { key: "kind", in: ["email", "sms"] } },
		{
			key: "ecl",
			label: "Error correction",
			type: "select",
			options: [
				{ value: "L", label: "Low (7%), smallest code" },
				{ value: "M", label: "Medium (15%)" },
				{ value: "Q", label: "Quartile (25%)" },
				{ value: "H", label: "High (30%), survives a logo overlay" },
			],
			default: "M",
		},
		{ key: "size", label: "Size (px)", type: "number", default: 256, min: 64, max: 4096 },
		{ key: "margin", label: "Quiet zone (modules)", type: "number", default: 4, min: 0, max: 16 },
		{ key: "foreground", label: "Foreground", type: "color", default: "#000000" },
		{ key: "background", label: "Background", type: "color", default: "#ffffff" },
		{ key: "transparent", label: "Transparent background", type: "checkbox", default: false },
		{ key: "mask", label: "Mask pattern", type: "select", options: ["auto", "0", "1", "2", "3", "4", "5", "6", "7"], default: "auto", help: "Auto picks the mask with the lowest penalty score, as the spec recommends." },
	],
	run: qrRun,
}

export const svgOptimizeTool = {
	id: "svg-optimize",
	name: "SVG optimizer",
	category: "Media",
	roles: ["dev", "design"],
	description: "Strip editor cruft, comments and metadata from SVG, round numbers, and export as SVG, data URI, CSS or JSX.",
	keywords: ["svgo", "minify svg", "compress svg", "data uri", "css background", "jsx", "react svg", "icon", "inkscape", "illustrator"],
	inputs: [
		{ key: "svg", label: "SVG markup", type: "textarea", default: SAMPLE_SVG, upload: { accept: ".svg,image/svg+xml" } },
		{
			key: "output",
			label: "Output",
			type: "select",
			options: [
				{ value: "preview", label: "Preview and size savings" },
				{ value: "svg", label: "Optimized SVG markup" },
				{ value: "datauri", label: "Data URI" },
				{ value: "css", label: "CSS background-image" },
				{ value: "jsx", label: "JSX (React) markup" },
			],
			default: "preview",
		},
		{ key: "precision", label: "Decimal places", type: "number", default: 2, min: 0, max: 8, help: "Lower is smaller; 1 or 2 is usually invisible for icons." },
		{ key: "removeIds", label: "Remove unreferenced IDs", type: "checkbox", default: true },
		{ key: "keepTitle", label: "Keep <title> and <desc> (accessibility)", type: "checkbox", default: true },
	],
	run: svgOptimizeRun,
}

export const imagePaletteTool = {
	id: "image-palette",
	name: "Image colour palette",
	category: "Media",
	roles: ["design", "dev"],
	description: "Extract the dominant colours of an image with their share, as hex values and CSS variables.",
	keywords: ["palette from image", "dominant color", "color extractor", "colour picker", "median cut", "swatches", "brand colors"],
	live: false,
	inputs: [
		{ key: "file", label: "Image", type: "file", accept: "image/*", read: "dataUrl" },
		{ key: "count", label: "Colours", type: "number", default: 6, min: 2, max: 16 },
	],
	run: imagePaletteRun,
}

export const mediaTools = [qrCodeTool, svgOptimizeTool, imagePaletteTool]
