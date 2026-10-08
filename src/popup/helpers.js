// Pure popup helpers with no DOM or extension API access, so Node tests can import them.

export const RESULT_TYPES = new Set(["text", "json", "table", "image", "report", "html-preview"])
export const SENSITIVE_PATTERN = /secret|password|token|key|jwt/i
export const DRAFT_MAX_CHARS = 200 * 1024
export const DRAFT_TOOL_LIMIT = 40
export const UPLOAD_WARN_BYTES = 5 * 1024 * 1024
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const SETTINGS_KEYS = ["theme", "role", "pinned", "history", "drafts", "liveRun", "snippets"]

export const CATEGORY_META = {
	AI: { icon: "sparkle", hue: "#a855f7" },
	"On page": { icon: "cursor", hue: "#ff5a1f" },
	Encoding: { icon: "binary", hue: "#8b5cf6" },
	"Text & data": { icon: "file-text", hue: "#14b8a6" },
	Formats: { icon: "code", hue: "#84cc16" },
	API: { icon: "plug", hue: "#38bdf8" },
	Testing: { icon: "flask", hue: "#f5a524" },
	Security: { icon: "shield", hue: "#f43f5e" },
	Design: { icon: "palette", hue: "#ec4899" },
	Media: { icon: "image", hue: "#fb923c" },
	Time: { icon: "clock", hue: "#6366f1" },
}
const FALLBACK_META = { icon: "layers", hue: "#a89f90" }

const TOOL_ICONS = {
	"ai-bug-capture": "bug",
	"privacy-scrubber": "shield",
	"page-to-ai": "file-text",
	"ai-readiness": "search",
	"ai-chat-handoff": "repeat",
	"image-converter": "image",
	"snipping-tool": "scissors",
	"inspect-element": "inspect",
	"edit-mode": "edit",
	"form-filler": "form",
	eyedropper: "pipette",
	"json-format": "braces",
	"text-diff": "diff",
	"jwt-decode": "key",
	"color-report": "palette",
	"contrast-checker": "contrast",
	"tech-stack": "cpu",
	"seo-audit": "globe",
	"a11y-audit": "a11y",
	"page-metrics": "gauge",
	"link-check": "link",
	"measure": "ruler",
	"security-check": "shield",
	"image-audit": "image",
	"grid-overlay": "grid",
	"outline-all": "outline",
	"viewport-resize": "devices",
	"storage-inspector": "database",
	"console-capture": "terminal",
	"font-report": "type",
	base64: "binary",
	"url-encode": "percent",
	uuid: "dice",
	"secret-generator": "lock",
	hash: "hash",
	"json-to-ts": "code",
	"csv-json": "table",
	"query-string": "link",
	"curl-builder": "terminal",
	"color-convert": "droplet",
	palette: "palette",
	"unit-convert": "ruler",
	"type-scale": "type",
	"shadow-generator": "shadow",
	"animation-scanner": "sparkle",
	"event-listener-map": "zap",
	"zindex-scan": "layers",
	"regex-tester": "regex",
	"case-converter": "case",
	"word-count": "align",
	slugify: "link",
	"mock-data": "dice",
	"perf-budget": "gauge",
	timestamp: "clock",
	timezone: "globe",
	cron: "repeat",
	duration: "hourglass",
	"bug-report": "bug",
	"test-matrix": "list-check",
	gherkin: "file-text",
	"http-status": "server",
	"html-entities": "code",
	lorem: "align",
}

const KEYWORD_ICONS = [
	[/qr/, "qr"],
	[/markdown|\bmd\b/, "markdown"],
	[/jwt|token|key/, "key"],
	[/hash|sha|md5|checksum/, "hash"],
	[/regex/, "regex"],
	[/json|yaml|toml|xml/, "braces"],
	[/diff|compare/, "diff"],
	[/image|svg|favicon|png|jpe?g|webp/, "image"],
	[/screenshot|snip|capture/, "camera"],
	[/contrast/, "contrast"],
	[/color|colour|hex/, "droplet"],
	[/palette/, "palette"],
	[/cron|schedule/, "repeat"],
	[/date|calendar/, "calendar"],
	[/time|clock|epoch/, "clock"],
	[/url|link|slug/, "link"],
	[/password|secret|security|csp|header/, "shield"],
	[/perf|budget|speed/, "gauge"],
	[/bug|issue/, "bug"],
	[/test|matrix/, "flask"],
	[/case/, "case"],
	[/text|word|lorem/, "type"],
	[/sql|html|css|code|minif/, "code"],
	[/csv|table/, "table"],
	[/grid/, "grid"],
	[/ruler|unit|measure/, "ruler"],
]

export function categoryMeta(category) {
	return CATEGORY_META[category] ?? FALLBACK_META
}

export function iconForTool(tool) {
	if (!tool) return FALLBACK_META.icon
	if (tool.icon) return tool.icon
	if (TOOL_ICONS[tool.id]) return TOOL_ICONS[tool.id]
	const id = String(tool.id ?? "").toLowerCase()
	const match = KEYWORD_ICONS.find(([pattern]) => pattern.test(id))
	return match ? match[1] : categoryMeta(tool.category).icon
}

export function isPageTool(tool) {
	return tool?.surface === "page"
}

export function filterByTab(list, tab) {
	if (tab === "ai") return list.filter((tool) => tool.category === "AI")
	if (tab === "page") return list.filter(isPageTool)
	if (tab === "utils") return list.filter((tool) => !isPageTool(tool))
	return list
}

export function countByTab(list) {
	const page = list.filter(isPageTool).length
	return { all: list.length, ai: list.filter((tool) => tool.category === "AI").length, page, utils: list.length - page }
}

export function splitPinned(list, pinnedIds) {
	const pinnedSet = new Set(pinnedIds ?? [])
	const pinned = []
	const rest = []
	for (const tool of list) (pinnedSet.has(tool.id) ? pinned : rest).push(tool)
	const order = new Map((pinnedIds ?? []).map((id, index) => [id, index]))
	pinned.sort((a, b) => order.get(a.id) - order.get(b.id))
	return { pinned, rest }
}

export function recentToolIds(history, validIds, limit = 6) {
	const valid = validIds instanceof Set ? validIds : new Set(validIds ?? [])
	const out = []
	for (const entry of Array.isArray(history) ? history : []) {
		const id = entry?.toolId
		if (!id || !valid.has(id) || out.includes(id)) continue
		out.push(id)
		if (out.length >= limit) break
	}
	return out
}

export function wrapIndex(index, delta, length) {
	if (length <= 0) return -1
	return (((index + delta) % length) + length) % length
}

export function isSensitiveInput(input) {
	if (!input) return false
	if (input.sensitive === true) return true
	return SENSITIVE_PATTERN.test(String(input.key ?? "")) || SENSITIVE_PATTERN.test(String(input.label ?? ""))
}

function defaultFor(input) {
	if (input.type === "checkbox") return Boolean(input.default)
	return input.default === undefined ? "" : String(input.default)
}

export function draftableValues(tool, values) {
	const out = {}
	for (const input of tool?.inputs ?? []) {
		if (input.type === "file" || isSensitiveInput(input)) continue
		const value = values?.[input.key]
		if (value === undefined || value === null || typeof value === "object") continue
		if (typeof value === "string" && value.length > DRAFT_MAX_CHARS) continue
		const normalized = input.type === "checkbox" ? Boolean(value) : String(value)
		if (normalized === defaultFor(input)) continue
		out[input.key] = normalized
	}
	return Object.keys(out).length ? out : null
}

export function mergeDraft(drafts, toolId, draft, limit = DRAFT_TOOL_LIMIT) {
	const next = { ...(drafts && typeof drafts === "object" ? drafts : {}) }
	delete next[toolId]
	if (draft) next[toolId] = draft
	const keys = Object.keys(next)
	for (const key of keys.slice(0, Math.max(0, keys.length - limit))) delete next[key]
	return next
}

export function isFieldVisible(input, values, inputs = [], depth = 0) {
	if (!input?.showIf) return true
	if (depth > 8) return false
	const { key, in: allowed = [] } = input.showIf
	const controller = inputs.find((item) => item.key === key)
	if (controller && !isFieldVisible(controller, values, inputs, depth + 1)) return false
	let value = values?.[key]
	if ((value === undefined || value === "") && controller) value = controller.default
	return allowed.map(String).includes(String(value))
}

export function stripHidden(tool, values) {
	const inputs = tool?.inputs ?? []
	const out = { ...values }
	for (const input of inputs) {
		if (!isFieldVisible(input, values, inputs)) delete out[input.key]
	}
	return out
}

export function isLiveEligible(tool, liveSetting = true) {
	if (!tool || liveSetting === false) return false
	if (isPageTool(tool) || tool.autofill) return false
	const inputs = tool.inputs ?? []
	if (!inputs.length || inputs.some((input) => input.type === "file")) return false
	if (tool.live === true) return true
	if (tool.live === false || tool.async) return false
	return true
}

export function formatBytes(bytes) {
	const value = Number(bytes)
	if (!Number.isFinite(value) || value <= 0) return "0 B"
	const units = ["B", "KB", "MB", "GB"]
	let size = value
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return `${unit === 0 ? size : size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`
}

export function isDataUrl(value) {
	return typeof value === "string" && /^data:[^,]*,/.test(value)
}

export function mimeFromDataUrl(dataUrl) {
	const match = /^data:([^;,]+)/.exec(String(dataUrl ?? ""))
	return match ? match[1] : "application/octet-stream"
}

export function stripDataUrls(value, depth = 0) {
	if (isDataUrl(value) && value.length > 120) {
		const approx = Math.round((value.length - value.indexOf(",") - 1) * 0.75)
		return `${value.slice(0, value.indexOf(",") + 1)}… (${formatBytes(approx)} omitted)`
	}
	if (depth > 20 || value === null || typeof value !== "object") return value
	if (Array.isArray(value)) return value.map((item) => stripDataUrls(item, depth + 1))
	if (ArrayBuffer.isView(value)) return `<${value.length ?? value.byteLength} bytes>`
	const out = {}
	for (const [key, item] of Object.entries(value)) {
		if (typeof Blob !== "undefined" && item instanceof Blob) out[key] = `<Blob ${formatBytes(item.size)}>`
		else out[key] = stripDataUrls(item, depth + 1)
	}
	return out
}

export function csvCell(value) {
	if (value === null || value === undefined) return ""
	const text = typeof value === "object" ? JSON.stringify(value) : String(value)
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text
}

export function tableToCsv(table) {
	const columns = Array.isArray(table?.columns) ? table.columns : []
	const rows = Array.isArray(table?.rows) ? table.rows : []
	const lines = []
	if (columns.length) lines.push(columns.map(csvCell).join(","))
	for (const row of rows) lines.push((Array.isArray(row) ? row : [row]).map(csvCell).join(","))
	return lines.join("\n")
}

export function compareCells(a, b) {
	const numA = typeof a === "number" ? a : Number(a)
	const numB = typeof b === "number" ? b : Number(b)
	const bothNumeric = a !== "" && b !== "" && a !== null && b !== null && Number.isFinite(numA) && Number.isFinite(numB)
	if (bothNumeric) return numA - numB
	return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" })
}

export function sortRows(rows, columnIndex, direction = 1) {
	return [...rows].sort((rowA, rowB) => compareCells(rowA?.[columnIndex], rowB?.[columnIndex]) * direction)
}

function reportToText(value) {
	const lines = []
	for (const pill of value?.summary ?? []) lines.push(`${pill.label}: ${pill.value}`)
	for (const section of value?.sections ?? []) {
		lines.push("", `## ${section.title}`)
		for (const item of section.items ?? []) {
			const tone = item.tone ? `[${item.tone}] ` : ""
			lines.push(`- ${tone}${item.label ?? ""}${item.detail ? ` — ${item.detail}` : ""}${item.selector ? ` (${item.selector})` : ""}`)
		}
	}
	return lines.join("\n").trim()
}

function imageToText(value) {
	const lines = [`${value?.width ?? "?"} × ${value?.height ?? "?"} px`]
	for (const [label, item] of Object.entries(value?.meta ?? {})) lines.push(`${label}: ${item}`)
	return lines.join("\n")
}

export function jsonText(value) {
	if (typeof value === "string") return value
	try {
		return JSON.stringify(stripDataUrls(value), null, 2) ?? String(value)
	} catch {
		return String(value)
	}
}

export function resultToText(result) {
	if (!result) return ""
	const { type, value } = result
	if (type === "text") return value === undefined || value === null ? "" : String(value)
	if (type === "table") return tableToCsv(value)
	if (type === "image") return imageToText(value)
	if (type === "report") return reportToText(value)
	if (type === "html-preview") return String(value?.source ?? value?.html ?? "")
	return jsonText(value)
}

export function copyTextFor(result) {
	if (typeof result?.copy === "string") return result.copy
	return resultToText(result)
}

const MIME_EXTENSIONS = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/bmp": "bmp",
	"image/svg+xml": "svg",
	"image/x-icon": "ico",
	"image/vnd.microsoft.icon": "ico",
	"image/avif": "avif",
	"application/pdf": "pdf",
	"application/json": "json",
	"text/csv": "csv",
	"text/html": "html",
	"text/plain": "txt",
	"text/markdown": "md",
}

export function extensionForMime(mime) {
	return MIME_EXTENSIONS[String(mime ?? "").toLowerCase()] ?? "bin"
}

export function downloadSpec(result, toolId = "output") {
	if (!result) return null
	const base = `sidekick-${toolId}`
	if (result.download && typeof result.download === "object") {
		const mime = result.download.mime ?? (result.download.dataUrl ? mimeFromDataUrl(result.download.dataUrl) : "text/plain")
		return { filename: result.download.filename ?? `${base}.${extensionForMime(mime)}`, mime, ...result.download }
	}
	const { type, value } = result
	if (type === "image" && isDataUrl(value?.dataUrl)) {
		const mime = mimeFromDataUrl(value.dataUrl)
		return { filename: `${base}.${extensionForMime(mime)}`, mime, dataUrl: value.dataUrl }
	}
	if (type === "table") return { filename: `${base}.csv`, mime: "text/csv", text: tableToCsv(value) }
	if (type === "html-preview") return { filename: `${base}.html`, mime: "text/html", text: String(value?.html ?? value?.source ?? "") }
	if (type === "text") return { filename: `${base}.txt`, mime: "text/plain", text: resultToText(result) }
	if (type === "report") return { filename: `${base}.txt`, mime: "text/plain", text: resultToText(result) }
	return { filename: `${base}.json`, mime: "application/json", text: jsonText(value) }
}

export function isContractResult(data) {
	return Boolean(data && typeof data === "object" && !Array.isArray(data) && RESULT_TYPES.has(data.type) && "value" in data)
}

export function normalizeResult(data) {
	if (isContractResult(data)) {
		const { type, value, copy, download, meta, note } = data
		return { type, value, copy, download, meta, note }
	}
	if (data === undefined || data === null) return { type: "text", value: "Done", legacy: true }
	if (typeof data === "string") return { type: "text", value: data, legacy: true }
	return { type: "json", value: data, legacy: true }
}

export function restrictedHint(message) {
	const text = String(message ?? "")
	if (/internal pages|extension store|restricted|protected page|cannot be scripted|cannot access/i.test(text)) {
		return "Browsers block extensions on internal pages (chrome://, edge://, about:) and web stores. Switch to a regular website tab, then run the tool again."
	}
	if (/no active tab/i.test(text)) return "Sidekick could not find an active tab. Focus a browser tab with a website and try again."
	if (/not reachable|no response|receiving end|could not establish/i.test(text)) {
		return "The page did not answer. Reload the tab so Sidekick can attach, then run again."
	}
	return ""
}

function isStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
}

const SETTING_VALIDATORS = {
	theme: (value) => ["system", "light", "dark"].includes(value),
	role: (value) => typeof value === "string" && value.length < 40,
	pinned: isStringArray,
	history: (value) => Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.toolId === "string"),
	drafts: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
	liveRun: (value) => typeof value === "boolean",
	snippets: Array.isArray,
}

export function validateSettings(input) {
	const errors = []
	const values = {}
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { ok: false, values, errors: ["Expected a JSON object"] }
	}
	for (const [key, value] of Object.entries(input)) {
		const check = SETTING_VALIDATORS[key]
		if (!check) {
			errors.push(`Ignored unknown key "${key}"`)
			continue
		}
		if (check(value)) values[key] = value
		else errors.push(`Invalid value for "${key}"`)
	}
	return { ok: Object.keys(values).length > 0, values, errors }
}
