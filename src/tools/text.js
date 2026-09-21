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

export function diffLines(left, right) {
	const a = String(left).split("\n")
	const b = String(right).split("\n")
	const maxLines = 1500
	const aCapped = a.length > maxLines ? a.slice(0, maxLines) : a
	const bCapped = b.length > maxLines ? b.slice(0, maxLines) : b
	const table = Array.from({ length: aCapped.length + 1 }, () => new Array(bCapped.length + 1).fill(0))
	for (let i = aCapped.length - 1; i >= 0; i -= 1) {
		for (let j = bCapped.length - 1; j >= 0; j -= 1) {
			table[i][j] = aCapped[i] === bCapped[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
		}
	}
	const rows = []
	let i = 0
	let j = 0
	while (i < aCapped.length && j < bCapped.length) {
		if (aCapped[i] === bCapped[j]) {
			rows.push({ op: "=", text: aCapped[i] })
			i += 1
			j += 1
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			rows.push({ op: "-", text: aCapped[i] })
			i += 1
		} else {
			rows.push({ op: "+", text: bCapped[j] })
			j += 1
		}
	}
	while (i < aCapped.length) rows.push({ op: "-", text: aCapped[i++] })
	while (j < bCapped.length) rows.push({ op: "+", text: bCapped[j++] })
	if (a.length > maxLines || b.length > maxLines) {
		rows.push({ op: "=", text: `… diff truncated at ${maxLines} lines to preserve performance` })
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
		description: "Pretty-print, minify and validate JSON with precise error positions.",
		inputs: [
			{ key: "text", label: "JSON", type: "textarea", placeholder: '{"a":1}' },
			{ key: "mode", label: "Mode", type: "select", options: ["pretty", "minify", "sort-keys"], default: "pretty" },
		],
		run: ({ text, mode = "pretty" }) => {
			const parsed = safeJsonParse(required(text, "JSON"))
			if (mode === "minify") return { type: "text", value: JSON.stringify(parsed) }
			const value = mode === "sort-keys" ? sortKeys(parsed) : parsed
			return { type: "text", value: JSON.stringify(value, null, 2) }
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
		],
		run: ({ left = "", right = "" }) => {
			const rows = diffLines(left, right)
			const changed = rows.filter((r) => r.op !== "=").length
			return {
				type: "text",
				value: `${changed} changed line(s)\n\n${rows.map((r) => `${r.op} ${r.text}`).join("\n")}`,
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
