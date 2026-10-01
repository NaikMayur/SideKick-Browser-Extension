import { ToolError, required, safeJsonParse } from "../lib/utils.js"

export function slugify(input) {
	return String(input)
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

export function toCase(input, style) {
	const words = String(input)
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
	if (!words.length) return ""
	const lower = words.map((w) => w.toLowerCase())
	switch (style) {
		case "camel":
			return lower.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("")
		case "pascal":
			return lower.map((w) => w[0].toUpperCase() + w.slice(1)).join("")
		case "snake":
			return lower.join("_")
		case "kebab":
			return lower.join("-")
		case "constant":
			return lower.join("_").toUpperCase()
		case "title":
			return lower.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
		case "sentence":
			return lower.join(" ").replace(/^./, (c) => c.toUpperCase())
		default:
			throw new ToolError(`Unknown case style: ${style}`)
	}
}

export function diffLines(left, right, options = {}) {
	const ignoreWhitespace = options.ignoreWhitespace || "none"
	const ignoreCase = Boolean(options.ignoreCase)

	const normalize = (line) => {
		let s = String(line)
		if (ignoreCase) s = s.toLowerCase()
		if (ignoreWhitespace === "trim") s = s.trim()
		else if (ignoreWhitespace === "all") s = s.replace(/\s+/g, "")
		return s
	}

	const a = String(left).split("\n")
	const b = String(right).split("\n")
	const maxLines = 1500
	const aCapped = a.length > maxLines ? a.slice(0, maxLines) : a
	const bCapped = b.length > maxLines ? b.slice(0, maxLines) : b
	const table = Array.from({ length: aCapped.length + 1 }, () => new Array(bCapped.length + 1).fill(0))
	for (let i = aCapped.length - 1; i >= 0; i -= 1) {
		for (let j = bCapped.length - 1; j >= 0; j -= 1) {
			table[i][j] = normalize(aCapped[i]) === normalize(bCapped[j])
				? table[i + 1][j + 1] + 1
				: Math.max(table[i + 1][j], table[i][j + 1])
		}
	}
	const rows = []
	let i = 0
	let j = 0
	let lineA = 1
	let lineB = 1
	while (i < aCapped.length && j < bCapped.length) {
		if (normalize(aCapped[i]) === normalize(bCapped[j])) {
			rows.push({ op: "=", text: aCapped[i], lineA: lineA++, lineB: lineB++ })
			i += 1
			j += 1
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			rows.push({ op: "-", text: aCapped[i], lineA: lineA++, lineB: null })
			i += 1
		} else {
			rows.push({ op: "+", text: bCapped[j], lineA: null, lineB: lineB++ })
			j += 1
		}
	}
	while (i < aCapped.length) rows.push({ op: "-", text: aCapped[i++], lineA: lineA++, lineB: null })
	while (j < bCapped.length) rows.push({ op: "+", text: bCapped[j++], lineA: null, lineB: lineB++ })
	if (a.length > maxLines || b.length > maxLines) {
		rows.push({ op: "=", text: `… diff truncated at ${maxLines} lines to preserve performance`, lineA: null, lineB: null })
	}
	return rows
}

export function countText(text) {
	const value = text !== null && text !== undefined ? String(text) : ""
	const words = value.trim() ? value.trim().split(/\s+/).length : 0
	const sentences = value.trim() ? (value.match(/[.!?]+(\s|$)/g) || []).length || 1 : 0
	return {
		characters: value.length,
		charactersNoSpaces: value.replace(/\s/g, "").length,
		words,
		lines: value ? value.split("\n").length : 0,
		sentences,
		readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)),
	}
}

const LOREM_WORDS =
	"lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat".split(
		" ",
	)

export function lorem(paragraphs = 2, wordsPerParagraph = 40) {
	const count = Math.min(Math.max(Number(paragraphs) || 1, 1), 20)
	const size = Math.min(Math.max(Number(wordsPerParagraph) || 30, 5), 200)
	const out = []
	let cursor = 0
	for (let p = 0; p < count; p += 1) {
		const words = []
		for (let w = 0; w < size; w += 1) {
			words.push(LOREM_WORDS[cursor % LOREM_WORDS.length])
			cursor += 1
		}
		out.push(words.join(" ").replace(/^./, (c) => c.toUpperCase()) + ".")
	}
	return out.join("\n\n")
}

export const textTools = [
	{
		id: "json-format",
		name: "JSON formatter & validator",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Pretty-print, minify, sort keys, strip nulls and validate JSON with precise error positions.",
		inputs: [
			{ key: "text", label: "JSON", type: "textarea", placeholder: '{"a":1}' },
			{
				key: "mode",
				label: "Mode",
				type: "select",
				options: ["pretty", "pretty-4", "pretty-tab", "minify", "sort-keys", "remove-nulls", "unescape"],
				default: "pretty",
			},
		],
		run: ({ text, mode = "pretty" }) => {
			let inputStr = required(text, "JSON")
			if (mode === "unescape") {
				if ((inputStr.startsWith('"') && inputStr.endsWith('"')) || inputStr.includes('\\"')) {
					try {
						inputStr = JSON.parse(inputStr)
					} catch {
						inputStr = inputStr.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
					}
				}
			}
			const parsed = parseJsonWithDiagnostics(inputStr)
			if (mode === "minify") return { type: "text", value: JSON.stringify(parsed) }
			let value = parsed
			if (mode === "sort-keys") value = sortKeys(parsed)
			else if (mode === "remove-nulls") value = removeNulls(parsed)

			const indent = mode === "pretty-4" ? 4 : mode === "pretty-tab" ? "\t" : 2
			return { type: "text", value: JSON.stringify(value, null, indent) }
		},
	},
	{
		id: "case-converter",
		name: "Case converter",
		category: "Text & data",
		roles: ["dev", "design"],
		description: "camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title and Sentence case.",
		inputs: [
			{ key: "text", label: "Text", type: "textarea" },
			{
				key: "style",
				label: "Style",
				type: "select",
				options: ["camel", "pascal", "snake", "kebab", "constant", "title", "sentence"],
				default: "camel",
			},
		],
		run: ({ text, style = "camel" }) => ({ type: "text", value: toCase(required(text, "Text"), style) }),
	},
	{
		id: "slugify",
		name: "Slug generator",
		category: "Text & data",
		roles: ["dev", "design"],
		description: "URL-safe slugs with accent folding — handy for routes, anchors and test IDs.",
		inputs: [{ key: "text", label: "Text", type: "text" }],
		run: ({ text }) => ({ type: "text", value: slugify(required(text, "Text")) }),
	},
	{
		id: "regex-tester",
		name: "Regex tester",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Test a pattern against sample text and list every match with capture groups.",
		inputs: [
			{ key: "pattern", label: "Pattern", type: "text", placeholder: "\\b\\w+@\\w+\\.\\w+\\b" },
			{ key: "flags", label: "Flags", type: "text", default: "g" },
			{ key: "text", label: "Sample text", type: "textarea" },
		],
		run: ({ pattern, flags = "g", text }) => {
			const source = required(pattern, "Pattern")
			const sample = String(text ?? "")
			let regex
			try {
				regex = new RegExp(source, flags.includes("g") ? flags : `${flags}g`)
			} catch (error) {
				throw new ToolError(`Invalid regex: ${error.message}`)
			}
			const matches = []
			let guard = 0
			for (const match of sample.matchAll(regex)) {
				matches.push({ match: match[0], index: match.index, groups: match.slice(1) })
				guard += 1
				if (guard >= 500) break
			}
			return { type: "json", value: { count: matches.length, matches } }
		},
	},
	{
		id: "text-diff",
		name: "Text diff",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Line-by-line diff for API responses, configs and expected-vs-actual test output.",
		inputs: [
			{ key: "left", label: "Expected", type: "textarea" },
			{ key: "right", label: "Actual", type: "textarea" },
			{
				key: "whitespace",
				label: "Whitespace",
				type: "select",
				options: ["keep", "trim", "ignore-all"],
				default: "keep",
			},
			{
				key: "ignoreCase",
				label: "Ignore case",
				type: "select",
				options: ["no", "yes"],
				default: "no",
			},
		],
		run: ({ left = "", right = "", whitespace = "keep", ignoreCase = "no" }) => {
			const rows = diffLines(left, right, {
				ignoreWhitespace: whitespace === "trim" ? "trim" : whitespace === "ignore-all" ? "all" : "none",
				ignoreCase: ignoreCase === "yes" || ignoreCase === true,
			})
			const added = rows.filter((r) => r.op === "+").length
			const deleted = rows.filter((r) => r.op === "-").length
			const changed = added + deleted
			return {
				type: "text",
				value: `${changed} changed line(s) (+${added}, -${deleted})\n\n${rows.map((r) => `${r.op} ${r.text}`).join("\n")}`,
			}
		},
	},
	{
		id: "word-count",
		name: "Text statistics",
		category: "Text & data",
		roles: ["design", "dev", "it"],
		description: "Characters, words, lines, sentences and reading time for copy reviews.",
		inputs: [{ key: "text", label: "Text", type: "textarea" }],
		run: ({ text = "" }) => ({ type: "json", value: countText(text) }),
	},
	{
		id: "lorem",
		name: "Lorem ipsum generator",
		category: "Text & data",
		roles: ["design", "qa"],
		description: "Placeholder copy for layout stress tests.",
		inputs: [
			{ key: "paragraphs", label: "Paragraphs", type: "number", default: 2 },
			{ key: "words", label: "Words per paragraph", type: "number", default: 40 },
		],
		run: ({ paragraphs = 2, words = 40 }) => ({ type: "text", value: lorem(paragraphs, words) }),
	},
]

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
	try {
		return JSON.parse(text)
	} catch (err) {
		const raw = String(text)
		let line = 1
		let column = 1
		const posMatch = err.message.match(/at position (\d+)/i)
		if (posMatch) {
			const pos = Number(posMatch[1])
			line = 1
			column = 1
			for (let i = 0; i < pos && i < raw.length; i++) {
				if (raw[i] === "\n") {
					line++
					column = 1
				} else {
					column++
				}
			}
		}
		const lineMatch = err.message.match(/line (\d+) column (\d+)/i)
		if (lineMatch) {
			line = Number(lineMatch[1])
			column = Number(lineMatch[2])
		}
		const lines = raw.split("\n")
		const errLine = lines[line - 1] || ""
		const caret = " ".repeat(Math.max(0, column - 1)) + "^"
		throw new ToolError(`Invalid ${label} at line ${line}, column ${column}:\n${errLine}\n${caret}\n(${err.message})`)
	}
}
