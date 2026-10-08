import { aiTools } from "../tools/ai.js"
import { dataTools } from "../tools/data.js"
import { designTools } from "../tools/design.js"
import { encodingTools } from "../tools/encoding.js"
import { formatTools } from "../tools/formats.js"
import { imageTools } from "../tools/image.js"
import { pageTools } from "../tools/page-actions.js"
import { testingTools } from "../tools/testing.js"
import { textTools } from "../tools/text.js"
import { timeTools } from "../tools/time.js"
import { ToolError } from "./utils.js"

export const TOOL_PRIORITY = [
	"ai-bug-capture",
	"page-to-ai",
	"privacy-scrubber",
	"ai-chat-handoff",
	"inspect-element",
	"snipping-tool",
	"json-format",
	"console-capture",
	"form-filler",
	"a11y-audit",
	"page-metrics",
	"ai-readiness",
	"image-converter",
	"text-diff",
	"jwt-decode",
	"base64",
	"eyedropper",
	"contrast-checker",
	"viewport-resize",
	"mock-data",
	"color-convert",
	"seo-audit",
	"link-check",
	"security-check",
	"regex-tester",
	"timestamp",
	"curl-builder",
	"text-escape",
	"hash",
	"json-yaml",
	"storage-inspector",
	"json-query",
	"csv-json",
	"code-format",
	"image-audit",
	"measure",
	"tech-stack",
	"edit-mode",
	"markdown-preview",
	"query-string",
	"uuid",
	"secret-generator",
	"bug-report",
	"json-to-ts",
	"color-report",
	"font-report",
	"qr-code",
	"svg-optimize",
	"palette",
	"cron",
	"timezone",
	"case-converter",
	"unit-convert",
	"shadow-generator",
	"image-palette",
	"user-agent",
	"line-tools",
	"word-count",
	"type-scale",
	"outline-all",
	"grid-overlay",
	"http-status",
	"number-base",
	"perf-budget",
	"zindex-scan",
	"duration",
	"animation-scanner",
	"lorem",
]

const allTools = [
	...aiTools,
	...imageTools,
	...pageTools,
	...encodingTools,
	...textTools,
	...formatTools,
	...dataTools,
	...designTools,
	...timeTools,
	...testingTools,
]

const priorityRank = new Map(TOOL_PRIORITY.map((id, index) => [id, index]))
export const tools = [...allTools].sort((a, b) => {
	const rankA = priorityRank.has(a.id) ? priorityRank.get(a.id) : 999
	const rankB = priorityRank.has(b.id) ? priorityRank.get(b.id) : 999
	return rankA - rankB
})

export const categories = [...new Set(tools.map((tool) => tool.category))]

export const ROLES = {
	dev: "Developer",
	qa: "Tester / QA",
	design: "UI/UX designer",
	a11y: "Accessibility",
	security: "Security",
	it: "IT / Ops",
}

export function getTool(id) {
	const tool = tools.find((item) => item.id === id)
	if (!tool) throw new ToolError(`Unknown tool: ${id}`)
	return tool
}

const searchText = new Map()

function haystackFor(tool) {
	let text = searchText.get(tool.id)
	if (!text) {
		text = [tool.name, tool.id, tool.category, tool.description, ...(tool.roles ?? []), ...(tool.keywords ?? [])].join(" ").toLowerCase()
		searchText.set(tool.id, text)
	}
	return text
}

function searchScore(tool, parts) {
	const name = `${tool.name} ${tool.id}`.toLowerCase()
	let score = 0
	for (const part of parts) {
		if (name.startsWith(part)) score += 3
		else if (name.includes(part)) score += 2
		else if ((tool.keywords ?? []).some((word) => word.toLowerCase().includes(part))) score += 1
	}
	return score
}

export function searchTools(query, role = "all") {
	const parts = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)
	const matches = tools.filter((tool) => {
		if (role !== "all" && !(tool.roles ?? []).includes(role)) return false
		if (!parts.length) return true
		const haystack = haystackFor(tool)
		return parts.every((part) => haystack.includes(part))
	})
	if (!parts.length) return matches
	const scored = matches.map((tool, index) => ({ tool, index, score: searchScore(tool, parts) }))
	scored.sort((a, b) => b.score - a.score || a.index - b.index)
	return scored.map((entry) => entry.tool)
}

export function optionValue(option) {
	return option && typeof option === "object" ? String(option.value) : String(option)
}

export function coerceValues(tool, rawValues = {}) {
	const values = {}
	for (const input of tool.inputs ?? []) {
		const raw = rawValues[input.key]
		const fallback = input.default
		if (input.type === "number") {
			const empty = raw === "" || raw === undefined || raw === null
			let parsed = empty ? fallback : Number(raw)
			if (parsed !== undefined && Number.isNaN(Number(parsed))) throw new ToolError(`${input.label} must be a number`)
			if (parsed !== undefined) {
				parsed = Number(parsed)
				if (typeof input.min === "number") parsed = Math.max(input.min, parsed)
				if (typeof input.max === "number") parsed = Math.min(input.max, parsed)
			}
			values[input.key] = parsed
		} else if (input.type === "checkbox") {
			values[input.key] = raw === undefined ? Boolean(fallback) : Boolean(raw)
		} else if (input.type === "file") {
			values[input.key] = raw && typeof raw === "object" ? raw : null
		} else if (input.type === "select" && input.options?.length) {
			const allowed = input.options.map(optionValue)
			const value = raw === undefined || raw === "" ? fallback : raw
			values[input.key] = allowed.includes(String(value)) ? String(value) : String(fallback ?? allowed[0])
		} else {
			values[input.key] = raw === undefined || raw === "" ? fallback ?? "" : raw
		}
	}
	return values
}

export async function runTool(id, rawValues = {}) {
	try {
		const tool = getTool(id)
		if (tool.surface === "page") {
			return { ok: false, toolId: id, error: "This tool runs on the page; send its command to the content script instead." }
		}
		const values = coerceValues(tool, rawValues)
		const result = await tool.run(values)
		return { ok: true, toolId: id, ...result }
	} catch (error) {
		return { ok: false, toolId: id, error: error?.message ?? String(error) }
	}
}
