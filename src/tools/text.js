import { ToolError, required, seededRandom } from "../lib/utils.js"

const TEXT_ACCEPT = ".txt,.md,.csv,.json,.xml,.html,.log,.yml,.yaml,.js,.ts,.css,text/*"

export class JsonNumber {
	constructor(raw) {
		this.raw = String(raw)
	}

	toJSON() {
		return Number(this.raw)
	}
}

export class JsonObject {
	constructor(entries = []) {
		this.entries = entries
	}
}

// Keeps number literals verbatim (no precision loss above 2^53) and key order (no integer key hoisting).
// Expects text already validated by JSON.parse.
export function parseJsonPreserving(text) {
	const source = String(text)
	const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
	let pos = 0
	const skip = () => {
		while (pos < source.length && " \t\n\r\uFEFF".includes(source[pos])) pos += 1
	}
	const readString = () => {
		let end = pos + 1
		while (end < source.length && source[end] !== "\"") end += source[end] === "\\" ? 2 : 1
		const raw = source.slice(pos, end + 1)
		pos = end + 1
		return JSON.parse(raw)
	}
	const readValue = () => {
		skip()
		const char = source[pos]
		if (char === "{") return readObject()
		if (char === "[") return readArray()
		if (char === "\"") return readString()
		for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
			if (source.startsWith(word, pos)) {
				pos += word.length
				return value
			}
		}
		numberPattern.lastIndex = pos
		const match = numberPattern.exec(source)
		if (!match) throw new SyntaxError(`Unexpected token at position ${pos}`)
		pos += match[0].length
		return new JsonNumber(match[0])
	}
	const readObject = () => {
		pos += 1
		const entries = []
		const index = new Map()
		skip()
		if (source[pos] === "}") {
			pos += 1
			return new JsonObject(entries)
		}
		for (;;) {
			skip()
			const key = readString()
			skip()
			pos += 1
			const value = readValue()
			if (index.has(key)) entries[index.get(key)][1] = value
			else {
				index.set(key, entries.length)
				entries.push([key, value])
			}
			skip()
			pos += 1
			if (source[pos - 1] === "}") return new JsonObject(entries)
		}
	}
	const readArray = () => {
		pos += 1
		const items = []
		skip()
		if (source[pos] === "]") {
			pos += 1
			return items
		}
		for (;;) {
			items.push(readValue())
			skip()
			pos += 1
			if (source[pos - 1] === "]") return items
		}
	}
	return readValue()
}

export function stringifyJson(node, indent = 2) {
	const unit = typeof indent === "number" ? " ".repeat(indent) : String(indent ?? "")
	const parts = []
	const write = (value, pad) => {
		if (value instanceof JsonNumber) parts.push(value.raw)
		else if (value instanceof JsonObject) writeEntries(value.entries, pad, "{", "}", true)
		else if (Array.isArray(value)) writeEntries(value, pad, "[", "]", false)
		else if (typeof value === "number") parts.push(Number.isFinite(value) ? String(value) : "null")
		else if (value === undefined) parts.push("null")
		else if (value && typeof value === "object") write(fromPlain(value), pad)
		else parts.push(JSON.stringify(value))
	}
	const writeEntries = (list, pad, open, close, keyed) => {
		if (!list.length) {
			parts.push(open + close)
			return
		}
		const inner = pad + unit
		parts.push(open)
		list.forEach((item, index) => {
			if (index) parts.push(",")
			if (unit) parts.push("\n", inner)
			if (keyed) {
				parts.push(JSON.stringify(item[0]), unit ? ": " : ":")
				write(item[1], inner)
			} else write(item, inner)
		})
		if (unit) parts.push("\n", pad)
		parts.push(close)
	}
	write(node, "")
	return parts.join("")
}

export function toPlain(node) {
	if (node instanceof JsonNumber) return Number(node.raw)
	if (node instanceof JsonObject) return Object.fromEntries(node.entries.map(([k, v]) => [k, toPlain(v)]))
	if (Array.isArray(node)) return node.map(toPlain)
	return node
}

export function fromPlain(value) {
	if (Array.isArray(value)) return value.map(fromPlain)
	if (value instanceof JsonObject || value instanceof JsonNumber) return value
	if (value && typeof value === "object") return new JsonObject(Object.entries(value).map(([k, v]) => [k, fromPlain(v)]))
	return value
}

function sortNode(node) {
	if (Array.isArray(node)) return node.map(sortNode)
	if (node instanceof JsonObject) {
		const entries = node.entries.map(([k, v]) => [k, sortNode(v)])
		entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		return new JsonObject(entries)
	}
	return node
}

function stripNullNodes(node) {
	if (Array.isArray(node)) return node.filter((v) => v !== null).map(stripNullNodes)
	if (node instanceof JsonObject) return new JsonObject(node.entries.filter(([, v]) => v !== null).map(([k, v]) => [k, stripNullNodes(v)]))
	return node
}

export function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeys(value[key])]),
		)
	}
	return value
}

export function removeNulls(value) {
	if (Array.isArray(value)) return value.map(removeNulls).filter((v) => v !== null && v !== undefined)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, v]) => v !== null && v !== undefined)
				.map(([k, v]) => [k, removeNulls(v)]),
		)
	}
	return value
}

export function parseJsonWithDiagnostics(text, label = "JSON") {
	const raw = String(text).replace(/^\uFEFF/, "")
	try {
		return JSON.parse(raw)
	} catch (err) {
		let line = 1
		let column = 1
		const posMatch = err.message.match(/at position (\d+)/i)
		if (posMatch) {
			const pos = Number(posMatch[1])
			for (let i = 0; i < pos && i < raw.length; i += 1) {
				if (raw[i] === "\n") {
					line += 1
					column = 1
				} else column += 1
			}
		}
		const lineMatch = err.message.match(/line (\d+) column (\d+)/i)
		if (lineMatch) {
			line = Number(lineMatch[1])
			column = Number(lineMatch[2])
		}
		const errLine = raw.split("\n")[line - 1] || ""
		const caret = " ".repeat(Math.max(0, column - 1)) + "^"
		throw new ToolError(`Invalid ${label} at line ${line}, column ${column}:\n${errLine}\n${caret}\n(${err.message})`)
	}
}

// Parses for validation and diagnostics first, then reparses preserving numbers and key order.
export function parseJsonNode(text, label = "JSON") {
	const raw = String(text).replace(/^\uFEFF/, "")
	const plain = parseJsonWithDiagnostics(raw, label)
	try {
		return parseJsonPreserving(raw)
	} catch {
		return fromPlain(plain)
	}
}

function unescapeJsonInput(input) {
	const text = input.trim()
	if ((text.startsWith("\"") && text.endsWith("\"")) || text.includes("\\\"")) {
		try {
			const parsed = JSON.parse(text.startsWith("\"") ? text : `"${text}"`)
			if (typeof parsed === "string") return parsed
		} catch {
			return text.replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
		}
	}
	return text
}

export function formatJson(text, mode = "pretty") {
	let input = required(text, "JSON")
	if (mode === "unescape") input = unescapeJsonInput(input)
	let node = parseJsonNode(input)
	if (mode === "minify") return stringifyJson(node, "")
	if (mode === "escape") return JSON.stringify(stringifyJson(node, ""))
	if (mode === "sort-keys") node = sortNode(node)
	else if (mode === "remove-nulls") node = stripNullNodes(node)
	const indent = mode === "pretty-4" ? 4 : mode === "pretty-tab" ? "\t" : 2
	try {
		return stringifyJson(node, indent)
	} catch (error) {
		if (!(error instanceof RangeError)) throw error
		return JSON.stringify(toPlain(node), null, indent)
	}
}

function splitWords(input) {
	return String(input)
		.replace(/(\p{L})['’](\p{L})/gu, "$1$2")
		.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
		.replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

function capitalize(word) {
	const [first = "", ...rest] = word
	return first.toUpperCase() + rest.join("")
}

const CASE_STYLES = {
	camel: (w) => w.map((x, i) => (i ? capitalize(x) : x)).join(""),
	pascal: (w) => w.map(capitalize).join(""),
	snake: (w) => w.join("_"),
	kebab: (w) => w.join("-"),
	constant: (w) => w.join("_").toUpperCase(),
	title: (w) => w.map(capitalize).join(" "),
	sentence: (w) => capitalize(w.join(" ")),
	dot: (w) => w.join("."),
	path: (w) => w.join("/"),
	lower: (w) => w.join(" "),
	upper: (w) => w.join(" ").toUpperCase(),
}

const CASE_LABELS = {
	camel: "camelCase",
	pascal: "PascalCase",
	snake: "snake_case",
	kebab: "kebab-case",
	constant: "CONSTANT_CASE",
	title: "Title Case",
	sentence: "Sentence case",
	dot: "dot.case",
	path: "path/case",
	lower: "lower case",
	upper: "UPPER CASE",
	slug: "url-safe-slug",
}

export function toCase(input, style) {
	if (style === "slug") return slugify(input)
	const format = CASE_STYLES[style]
	if (!format) throw new ToolError(`Unknown case style: ${style}`)
	const words = splitWords(input).map((w) => w.toLowerCase())
	return words.length ? format(words) : ""
}

function convertLines(text, style) {
	return String(text)
		.split(/\r?\n/)
		.map((line) => toCase(line, style))
		.join("\n")
}

const TRANSLITERATION = {
	ß: "ss", æ: "ae", Æ: "AE", ø: "o", Ø: "O", œ: "oe", Œ: "OE", đ: "d", Đ: "D", ð: "d", Ð: "D", ł: "l", Ł: "L", þ: "th", Þ: "TH", ı: "i",
	а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
	п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e",
	ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
}

function transliterate(text) {
	return [...text].map((char) => {
		const lower = char.toLowerCase()
		if (!Object.hasOwn(TRANSLITERATION, lower) && !Object.hasOwn(TRANSLITERATION, char)) return char
		return TRANSLITERATION[char] ?? TRANSLITERATION[lower]
	}).join("")
}

export function slugify(input, { separator = "-", ascii = true, lowercase = true, maxLength = 0 } = {}) {
	const sep = separator || "-"
	const prepare = (text) => (lowercase ? text.toLowerCase() : text)
	const original = String(input).replace(/&/g, " and ")
	const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const trimEdges = (text) => text.replace(new RegExp(`^(${escapedSep})+|(${escapedSep})+$`, "g"), "")
	let slug = ""
	if (ascii) {
		const folded = transliterate(original.normalize("NFKD").replace(/\p{M}/gu, ""))
		slug = trimEdges(prepare(folded).replace(/[^a-zA-Z0-9]+/g, sep))
	}
	if (!slug) slug = trimEdges(prepare(original.normalize("NFC")).replace(/[^\p{L}\p{N}\p{M}]+/gu, sep))
	const limit = Number(maxLength) || 0
	if (limit > 0 && slug.length > limit) {
		const cut = slug.slice(0, limit)
		const lastSep = cut.lastIndexOf(sep)
		slug = trimEdges(lastSep > limit / 2 ? cut.slice(0, lastSep) : cut)
	}
	return slug
}

const MAX_DIFF_LINES = 50000
const MAX_EDIT_DISTANCE = 2000

export function splitLines(text) {
	return String(text ?? "").split(/\r\n|\r|\n/)
}

// Myers O(ND) diff over integer ids. Returns null when the edit distance exceeds maxD.
function myersOps(a, b, maxD) {
	const n = a.length
	const m = b.length
	const max = n + m
	const offset = max + 1
	const v = new Int32Array(2 * max + 3)
	const trace = []
	for (let d = 0; d <= Math.min(max, maxD); d += 1) {
		trace.push(v.slice(offset - d, offset + d + 1))
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
			let y = x - k
			while (x < n && y < m && a[x] === b[y]) {
				x += 1
				y += 1
			}
			v[offset + k] = x
			if (x >= n && y >= m) return backtrack(trace, n, m)
		}
	}
	return null
}

function backtrack(trace, n, m) {
	const ops = []
	let x = n
	let y = m
	for (let d = trace.length - 1; d >= 0; d -= 1) {
		const snapshot = trace[d]
		const at = (k) => snapshot[k + d]
		const k = x - y
		const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
		const prevX = d === 0 ? 0 : at(prevK)
		const prevY = d === 0 ? 0 : prevX - prevK
		while (x > prevX && y > prevY) {
			ops.push("=")
			x -= 1
			y -= 1
		}
		if (d > 0) ops.push(x === prevX ? "+" : "-")
		x = prevX
		y = prevY
	}
	return ops.reverse()
}

function makeNormalizer({ ignoreWhitespace = "none", ignoreCase = false }) {
	return (line) => {
		let s = line
		if (ignoreCase) s = s.toLowerCase()
		if (ignoreWhitespace === "trim") s = s.trim()
		else if (ignoreWhitespace === "all") s = s.replace(/\s+/g, "")
		return s
	}
}

export function diffLines(left, right, options = {}) {
	const fullA = splitLines(left)
	const fullB = splitLines(right)
	const a = fullA.slice(0, MAX_DIFF_LINES)
	const b = fullB.slice(0, MAX_DIFF_LINES)
	const normalize = makeNormalizer(options)
	const ids = new Map()
	const toId = (line) => {
		const key = normalize(line)
		if (!ids.has(key)) ids.set(key, ids.size)
		return ids.get(key)
	}
	const aIds = Int32Array.from(a, toId)
	const bIds = Int32Array.from(b, toId)
	let start = 0
	while (start < a.length && start < b.length && aIds[start] === bIds[start]) start += 1
	let endA = a.length
	let endB = b.length
	while (endA > start && endB > start && aIds[endA - 1] === bIds[endB - 1]) {
		endA -= 1
		endB -= 1
	}
	let middle = myersOps(aIds.subarray(start, endA), bIds.subarray(start, endB), MAX_EDIT_DISTANCE)
	const approximate = middle === null
	if (approximate) middle = [...Array(endA - start).fill("-"), ...Array(endB - start).fill("+")]
	const ops = [...Array(start).fill("="), ...middle, ...Array(a.length - endA).fill("=")]
	const rows = []
	let i = 0
	let j = 0
	for (const op of ops) {
		if (op === "=") rows.push({ op, text: a[i], lineA: ++i, lineB: ++j })
		else if (op === "-") rows.push({ op, text: a[i], lineA: ++i, lineB: null })
		else rows.push({ op, text: b[j], lineA: null, lineB: ++j })
	}
	if (fullA.length > MAX_DIFF_LINES || fullB.length > MAX_DIFF_LINES) {
		rows.push({ op: "=", text: `… diff truncated at ${MAX_DIFF_LINES} lines to preserve performance`, lineA: null, lineB: null })
	}
	if (approximate) rows.approximate = true
	return rows
}

export function collapseContext(rows, context) {
	if (!Number.isFinite(context) || context < 0) return rows
	const out = []
	let run = []
	const flush = (isStart, isEnd) => {
		const keepHead = isStart ? 0 : context
		const keepTail = isEnd ? 0 : context
		if (run.length > keepHead + keepTail + 1) {
			out.push(...run.slice(0, keepHead))
			out.push({ op: "=", text: `⋯ ${run.length - keepHead - keepTail} unchanged lines`, lineA: null, lineB: null })
			out.push(...run.slice(run.length - keepTail))
		} else out.push(...run)
		run = []
	}
	rows.forEach((row) => {
		if (row.op === "=") run.push(row)
		else {
			flush(out.length === 0, false)
			out.push(row)
		}
	})
	flush(out.length === 0, true)
	return out
}

const SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu

function countGraphemes(text) {
	if (!SEGMENTER) return [...text].length
	let count = 0
	for (const segment of SEGMENTER.segment(text)) if (segment) count += 1
	return count
}

function countWords(text) {
	let words = 0
	const unique = new Set()
	let letters = 0
	for (const token of text.split(/\s+/)) {
		if (!/[\p{L}\p{N}]/u.test(token)) continue
		const cjk = token.match(CJK)?.length ?? 0
		const rest = cjk ? token.replace(CJK, "") : token
		const restIsWord = /[\p{L}\p{N}]/u.test(rest)
		words += cjk + (restIsWord ? 1 : 0)
		const clean = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
		if (clean) unique.add(clean)
		letters += clean.length
	}
	return { words, uniqueWords: unique.size, letters }
}

export function countText(text) {
	const value = text !== null && text !== undefined ? String(text) : ""
	const trimmed = value.trim()
	const { words, uniqueWords, letters } = countWords(value)
	return {
		characters: countGraphemes(value),
		charactersNoSpaces: countGraphemes(value.replace(/\s/g, "")),
		words,
		lines: value ? value.split(/\r\n|\r|\n/).length : 0,
		sentences: trimmed ? (value.match(/[.!?。！？]+(\s|$)/g) || []).length || 1 : 0,
		readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)),
		paragraphs: trimmed ? trimmed.split(/(?:\r?\n\s*){2,}/).length : 0,
		uniqueWords,
		averageWordLength: words ? Math.round((letters / words) * 10) / 10 : 0,
		speakingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 130)),
		bytes: new TextEncoder().encode(value).length,
		codeUnits: value.length,
	}
}

const LOREM_WORDS =
	"lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(
		" ",
	)

function loremSentence(random, words) {
	const list = Array.from({ length: words }, () => LOREM_WORDS[Math.floor(random() * LOREM_WORDS.length) % LOREM_WORDS.length])
	if (words > 8) list[Math.floor(words / 2) - 1] += ","
	return capitalize(list.join(" ")) + "."
}

export function lorem(paragraphs = 2, wordsPerParagraph = 40, { unit = "paragraphs", classic = true, html = false } = {}) {
	const random = seededRandom("lorem")
	const count = Math.min(Math.max(Math.floor(Number(paragraphs)) || 1, 1), unit === "words" ? 5000 : 200)
	const sentenceLength = () => 6 + Math.floor(random() * 9)
	const opening = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
	if (unit === "words") {
		const words = Array.from({ length: count }, (_, i) => (classic && i < 5 ? LOREM_WORDS[i] : LOREM_WORDS[Math.floor(random() * LOREM_WORDS.length) % LOREM_WORDS.length]))
		return capitalize(words.join(" ")) + "."
	}
	if (unit === "sentences") {
		const sentences = Array.from({ length: count }, (_, i) => (classic && i === 0 ? opening : loremSentence(random, sentenceLength())))
		return sentences.join(" ")
	}
	const size = Math.min(Math.max(Math.floor(Number(wordsPerParagraph)) || 30, 5), 500)
	const out = []
	for (let p = 0; p < count; p += 1) {
		const sentences = p === 0 && classic ? [opening] : []
		let used = sentences.length ? 8 : 0
		while (used < size) {
			const length = Math.min(sentenceLength(), size - used)
			sentences.push(loremSentence(random, Math.max(length, 3)))
			used += Math.max(length, 3)
		}
		out.push(sentences.join(" "))
	}
	return html ? out.map((p) => `<p>${p}</p>`).join("\n") : out.join("\n\n")
}

function cryptoShuffle(list) {
	const out = [...list]
	const pool = new Uint32Array(1)
	for (let i = out.length - 1; i > 0; i -= 1) {
		const limit = 2 ** 32 - (2 ** 32 % (i + 1))
		let value
		do {
			globalThis.crypto.getRandomValues(pool)
			value = pool[0]
		} while (value >= limit)
		const j = value % (i + 1)
		const swap = out[i]
		out[i] = out[j]
		out[j] = swap
	}
	return out
}

export function lineOperation(text, operation, { ignoreCase = false, trim = false } = {}) {
	let lines = splitLines(text)
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
	if (trim) lines = lines.map((l) => l.trim())
	const key = (line) => (ignoreCase ? line.toLowerCase() : line)
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: ignoreCase ? "base" : "variant" })
	const counts = () => {
		const map = new Map()
		for (const line of lines) {
			const entry = map.get(key(line)) ?? { line, count: 0 }
			entry.count += 1
			map.set(key(line), entry)
		}
		return [...map.values()]
	}
	switch (operation) {
		case "sort":
			return lines.sort((a, b) => collator.compare(a, b))
		case "sort-desc":
			return lines.sort((a, b) => collator.compare(b, a))
		case "length":
			return lines.sort((a, b) => a.length - b.length || collator.compare(a, b))
		case "unique": {
			const seen = new Set()
			return lines.filter((line) => !seen.has(key(line)) && seen.add(key(line)))
		}
		case "duplicates":
			return counts().filter((e) => e.count > 1).map((e) => e.line)
		case "remove-empty":
			return lines.filter((line) => line.trim())
		case "trim":
			return lines.map((line) => line.trim())
		case "reverse":
			return lines.reverse()
		case "shuffle":
			return cryptoShuffle(lines)
		case "number": {
			const width = String(lines.length).length
			return lines.map((line, i) => `${String(i + 1).padStart(width, " ")}  ${line}`)
		}
		case "count":
			return counts().sort((a, b) => b.count - a.count || collator.compare(a.line, b.line))
		default:
			throw new ToolError(`Unknown operation: ${operation}`)
	}
}

const MAX_MATCHES_STORED = 500
const MAX_MATCHES_COUNTED = 100000
const RISKY_LENGTH = 1000

// Heuristic for catastrophic backtracking: a quantified group whose body is itself quantified, such as (a+)+ or (\w+\s?)+.
export function isRiskyPattern(source) {
	return /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/.test(source)
}

export function parsePatternInput(pattern, flags) {
	const literal = String(pattern).match(/^\/([\s\S]+)\/([a-z]*)$/)
	const source = literal ? literal[1] : String(pattern)
	const rawFlags = `${literal ? literal[2] : ""}${String(flags ?? "")}`.replace(/\s+/g, "")
	const unknown = rawFlags.match(/[^dgimsuyv]/)
	if (unknown) throw new ToolError(`Unknown regex flag "${unknown[0]}" (valid: d g i m s u v y)`)
	return { source, flags: [...new Set(rawFlags)].join("") }
}

function buildRegex(source, flags) {
	try {
		return new RegExp(source, flags)
	} catch (error) {
		throw new ToolError(`Invalid regex: ${error.message}`)
	}
}

export function testRegex({ pattern, flags = "g", text = "", replace = "", allowRisky = false }) {
	const parsed = parsePatternInput(required(pattern, "Pattern"), flags)
	const sample = String(text ?? "")
	const warnings = []
	if (isRiskyPattern(parsed.source)) {
		if (sample.length > RISKY_LENGTH && !allowRisky) {
			throw new ToolError(
				"This pattern nests quantifiers (like (a+)+), which can freeze the browser on long text through catastrophic backtracking. Simplify it or tick \"Run risky patterns anyway\".",
			)
		}
		warnings.push("Nested quantifiers detected: this pattern may backtrack catastrophically on some inputs")
	}
	const globalFlags = parsed.flags.includes("g") ? parsed.flags : `${parsed.flags}g`
	const regex = buildRegex(parsed.source, globalFlags)
	const started = performance.now()
	const matches = []
	let count = 0
	let line = 1
	let lineStart = 0
	let scanned = 0
	for (const match of sample.matchAll(regex)) {
		count += 1
		if (matches.length < MAX_MATCHES_STORED) {
			for (; scanned < match.index; scanned += 1) {
				if (sample[scanned] === "\n") {
					line += 1
					lineStart = scanned + 1
				}
			}
			const entry = { match: match[0], index: match.index, groups: match.slice(1), line, column: match.index - lineStart + 1 }
			if (match.groups) entry.named = { ...match.groups }
			matches.push(entry)
		}
		if (count >= MAX_MATCHES_COUNTED) break
	}
	const value = {
		count,
		matches,
		truncated: count > matches.length,
		flags: globalFlags,
		timeMs: Math.round((performance.now() - started) * 100) / 100,
		warnings,
	}
	if (count >= MAX_MATCHES_COUNTED) warnings.push(`Stopped counting at ${MAX_MATCHES_COUNTED} matches`)
	if (replace !== "" && replace !== undefined && replace !== null) {
		value.replaced = sample.replace(buildRegex(parsed.source, parsed.flags), String(replace))
	}
	return value
}

export const textTools = [
	{
		id: "json-format",
		name: "JSON formatter & validator",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Pretty print, minify, sort keys, strip nulls and validate JSON with precise error positions; big numbers and key order are preserved.",
		keywords: ["prettify", "beautify", "lint", "validate", "minify", "json", "sort keys", "escape", "unescape"],
		live: true,
		inputs: [
			{ key: "text", label: "JSON", type: "textarea", placeholder: "{\"a\":1}", upload: { accept: ".json,.geojson,.har,application/json,text/*" } },
			{
				key: "mode",
				label: "Mode",
				type: "select",
				options: [
					{ value: "pretty", label: "Pretty (2 spaces)" },
					{ value: "pretty-4", label: "Pretty (4 spaces)" },
					{ value: "pretty-tab", label: "Pretty (tabs)" },
					{ value: "minify", label: "Minify" },
					{ value: "sort-keys", label: "Sort keys" },
					{ value: "remove-nulls", label: "Remove nulls" },
					{ value: "unescape", label: "Unescape a JSON string" },
					{ value: "escape", label: "Escape as a JSON string" },
				],
				default: "pretty",
			},
		],
		run: ({ text, mode = "pretty" }) => ({ type: "text", value: formatJson(text, mode) }),
	},
	{
		id: "case-converter",
		name: "Case converter",
		category: "Text & data",
		roles: ["dev", "design"],
		description: "camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, URL slugs and more; one line at a time, Unicode aware.",
		keywords: ["camel", "snake", "kebab", "pascal", "title case", "uppercase", "lowercase", "identifier", "rename", "slug", "slugify", "permalink", "transliterate"],
		live: true,
		inputs: [
			{ key: "text", label: "Text", type: "textarea", help: "Each line is converted separately. Slugs fold accents and transliterate Cyrillic." },
			{
				key: "style",
				label: "Style",
				type: "select",
				options: [...Object.entries(CASE_LABELS).map(([value, label]) => ({ value, label })), { value: "all", label: "All styles" }],
				default: "camel",
			},
		],
		run: ({ text, style = "camel" }) => {
			const value = required(text, "Text")
			if (style !== "all") return { type: "text", value: convertLines(value, style) }
			const rows = Object.entries(CASE_LABELS).map(([key, label]) => [label, convertLines(value, key)])
			return { type: "table", value: { columns: ["Style", "Result"], rows }, copy: rows.map((r) => r[1]).join("\n") }
		},
	},
	{
		id: "regex-tester",
		name: "Regex tester",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Test a pattern against sample text, list every match with line, column and capture groups, and preview replacements.",
		keywords: ["regexp", "regular expression", "pattern", "match", "replace", "capture group"],
		live: true,
		inputs: [
			{ key: "pattern", label: "Pattern", type: "text", placeholder: "\\b\\w+@\\w+\\.\\w+\\b", help: "A /pattern/flags literal is accepted too." },
			{ key: "flags", label: "Flags", type: "text", default: "g", help: "d g i m s u v y. g is always applied when listing matches." },
			{ key: "text", label: "Sample text", type: "textarea", upload: { accept: TEXT_ACCEPT } },
			{ key: "replace", label: "Replace with (optional)", type: "text", placeholder: "$1, $<name>, $&", help: "Shows the replaced text; without the g flag only the first match is replaced." },
			{ key: "allowRisky", label: "Run risky patterns anyway", type: "checkbox", default: false, help: "Patterns like (a+)+ can hang the popup on long input." },
		],
		run: (values) => ({ type: "json", value: testRegex(values) }),
	},
	{
		id: "text-diff",
		name: "Text diff",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Fast line by line diff for API responses, configs and expected vs actual test output.",
		keywords: ["compare", "diff", "difference", "changes", "expected actual", "merge"],
		live: true,
		inputs: [
			{ key: "left", label: "Expected", type: "textarea", upload: { accept: TEXT_ACCEPT } },
			{ key: "right", label: "Actual", type: "textarea", upload: { accept: TEXT_ACCEPT } },
			{
				key: "whitespace",
				label: "Whitespace",
				type: "select",
				options: [
					{ value: "keep", label: "Compare exactly" },
					{ value: "trim", label: "Ignore leading/trailing" },
					{ value: "ignore-all", label: "Ignore all whitespace" },
				],
				default: "keep",
			},
			{ key: "ignoreCase", label: "Ignore case", type: "select", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }], default: "no" },
			{
				key: "context",
				label: "Unchanged lines",
				type: "select",
				options: [
					{ value: "all", label: "Show all" },
					{ value: "3", label: "3 lines of context" },
					{ value: "10", label: "10 lines of context" },
				],
				default: "all",
			},
		],
		run: ({ left = "", right = "", whitespace = "keep", ignoreCase = "no", context = "all" }) => {
			let rows = diffLines(left, right, {
				ignoreWhitespace: whitespace === "trim" ? "trim" : whitespace === "ignore-all" ? "all" : "none",
				ignoreCase: ignoreCase === "yes" || ignoreCase === true,
			})
			const added = rows.filter((r) => r.op === "+").length
			const deleted = rows.filter((r) => r.op === "-").length
			const notes = []
			if (rows.approximate) notes.push("very different inputs, diff is approximate")
			let window = context === "all" ? -1 : Number(context)
			if (window < 0 && rows.length > 5000) {
				window = 3
				notes.push("large diff, unchanged lines collapsed")
			}
			if (window >= 0) rows = collapseContext(rows, window)
			if (!added && !deleted) notes.push("texts are identical")
			const summary = `${added + deleted} changed line(s) (+${added}, -${deleted})${notes.length ? ` · ${notes.join(" · ")}` : ""}`
			return { type: "text", value: `${summary}\n\n${rows.map((r) => `${r.op} ${r.text}`).join("\n")}` }
		},
	},
	{
		id: "word-count",
		name: "Text statistics",
		category: "Text & data",
		roles: ["design", "dev", "it"],
		description: "Characters (emoji aware), words (CJK aware), lines, sentences, bytes and reading time for copy reviews.",
		keywords: ["word count", "character count", "length", "reading time", "bytes", "count"],
		live: true,
		inputs: [{ key: "text", label: "Text", type: "textarea", upload: { accept: TEXT_ACCEPT } }],
		run: ({ text = "" }) => ({ type: "json", value: countText(text) }),
	},
	{
		id: "line-tools",
		name: "Line tools",
		category: "Text & data",
		roles: ["dev", "qa", "it", "design"],
		description: "Sort, dedupe, count, shuffle, number or clean up lists one line at a time.",
		keywords: ["sort lines", "unique", "dedupe", "duplicates", "shuffle", "reverse", "remove empty", "frequency", "list"],
		live: true,
		inputs: [
			{ key: "text", label: "Lines", type: "textarea", upload: { accept: TEXT_ACCEPT } },
			{
				key: "operation",
				label: "Operation",
				type: "select",
				options: [
					{ value: "sort", label: "Sort A → Z (natural)" },
					{ value: "sort-desc", label: "Sort Z → A" },
					{ value: "length", label: "Sort by length" },
					{ value: "unique", label: "Remove duplicates" },
					{ value: "duplicates", label: "Show only duplicates" },
					{ value: "count", label: "Count occurrences" },
					{ value: "remove-empty", label: "Remove empty lines" },
					{ value: "trim", label: "Trim each line" },
					{ value: "reverse", label: "Reverse order" },
					{ value: "shuffle", label: "Shuffle" },
					{ value: "number", label: "Number lines" },
				],
				default: "sort",
			},
			{ key: "ignoreCase", label: "Ignore case", type: "checkbox", default: false },
			{ key: "trim", label: "Trim lines first", type: "checkbox", default: false },
		],
		run: ({ text, operation = "sort", ignoreCase = false, trim = false }) => {
			const result = lineOperation(requiredLines(text), operation, { ignoreCase, trim })
			if (operation === "count") {
				const rows = result.map((e) => [e.line, e.count])
				return { type: "table", value: { columns: ["Line", "Count"], rows }, copy: rows.map(([l, c]) => `${c}\t${l}`).join("\n") }
			}
			return { type: "text", value: result.join("\n") }
		},
	},
	{
		id: "lorem",
		name: "Lorem ipsum generator",
		category: "Text & data",
		roles: ["design", "qa"],
		description: "Placeholder paragraphs, sentences or words for layout stress tests.",
		keywords: ["placeholder", "dummy text", "filler", "lipsum"],
		live: true,
		inputs: [
			{ key: "unit", label: "Generate", type: "select", options: [{ value: "paragraphs", label: "Paragraphs" }, { value: "sentences", label: "Sentences" }, { value: "words", label: "Words" }], default: "paragraphs" },
			{ key: "paragraphs", label: "How many", type: "number", default: 2, min: 1, max: 5000 },
			{ key: "words", label: "Words per paragraph", type: "number", default: 40, min: 5, max: 500, showIf: { key: "unit", in: ["paragraphs"] } },
			{ key: "classic", label: "Start with \"Lorem ipsum…\"", type: "checkbox", default: true },
			{ key: "html", label: "Wrap paragraphs in <p>", type: "checkbox", default: false, showIf: { key: "unit", in: ["paragraphs"] } },
		],
		run: ({ paragraphs = 2, words = 40, unit = "paragraphs", classic = true, html = false }) => ({
			type: "text",
			value: lorem(paragraphs, words, { unit, classic, html }),
		}),
	},
]

function requiredLines(text) {
	if (text === undefined || text === null || text === "") throw new ToolError("Lines are required")
	return String(text)
}
