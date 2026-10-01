import { dataTools } from "../tools/data.js"
import { designTools } from "../tools/design.js"
import { encodingTools } from "../tools/encoding.js"
import { imageTools } from "../tools/image.js"
import { pageTools } from "../tools/page-actions.js"
import { testingTools } from "../tools/testing.js"
import { textTools } from "../tools/text.js"
import { timeTools } from "../tools/time.js"
import { ToolError } from "./utils.js"

export const TOOL_PRIORITY = [
	"image-converter",
	"snipping-tool",
	"inspect-element",
	"edit-mode",
	"form-filler",
	"eyedropper",
	"json-format",
	"text-diff",
	"jwt-decode",
	"color-report",
	"contrast-checker",
	"tech-stack",
	"seo-audit",
	"a11y-audit",
	"page-metrics",
	"link-check",
	"grid-overlay",
	"outline-all",
	"viewport-resize",
	"storage-inspector",
	"console-capture",
	"font-report",
	"base64",
	"url-encode",
	"uuid",
	"secret-generator",
	"hash",
	"json-to-ts",
	"csv-json",
	"query-string",
	"curl-builder",
	"color-convert",
	"palette",
	"unit-convert",
	"type-scale",
	"shadow-generator",
	"animation-scanner",
	"event-listener-map",
	"zindex-scan",
	"regex-tester",
	"case-converter",
	"word-count",
	"slugify",
	"mock-data",
	"perf-budget",
	"timestamp",
	"timezone",
	"cron",
	"duration",
	"bug-report",
	"test-matrix",
	"gherkin",
	"http-status",
	"html-entities",
	"lorem",
]

const allTools = [
	...imageTools,
	...pageTools,
	...encodingTools,
	...textTools,
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

export function searchTools(query, role = "all") {
	const term = String(query ?? "").trim().toLowerCase()
	return tools.filter((tool) => {
		const roleOk = role === "all" || (tool.roles ?? []).includes(role)
		if (!roleOk) return false
		if (!term) return true
		const haystack = `${tool.name} ${tool.description} ${tool.category} ${(tool.roles ?? []).join(" ")} ${tool.id}`.toLowerCase()
		return term.split(/\s+/).every((part) => haystack.includes(part))
	})
}

export function coerceValues(tool, rawValues = {}) {
	const values = {}
	for (const input of tool.inputs ?? []) {
		const raw = rawValues[input.key]
		const fallback = input.default
		if (input.type === "number") {
			const parsed = raw === "" || raw === undefined || raw === null ? fallback : Number(raw)
			if (parsed !== undefined && Number.isNaN(Number(parsed))) throw new ToolError(`${input.label} must be a number`)
			values[input.key] = parsed
		} else if (input.type === "checkbox") {
			values[input.key] = raw === undefined ? Boolean(fallback) : Boolean(raw)
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
