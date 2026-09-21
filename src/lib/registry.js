import { dataTools } from "../tools/data.js"
import { designTools } from "../tools/design.js"
import { encodingTools } from "../tools/encoding.js"
import { pageTools } from "../tools/page-actions.js"
import { testingTools } from "../tools/testing.js"
import { textTools } from "../tools/text.js"
import { timeTools } from "../tools/time.js"
import { ToolError } from "./utils.js"

export const tools = [
	...encodingTools,
	...textTools,
	...dataTools,
	...designTools,
	...timeTools,
	...testingTools,
	...pageTools,
]

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
