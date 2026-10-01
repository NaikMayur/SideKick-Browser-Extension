import { required, round } from "../lib/utils.js"

export const HTTP_STATUS = {
	200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 301: "Moved Permanently",
	302: "Found", 304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect",
	400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden",
	404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 410: "Gone", 415: "Unsupported Media Type",
	418: "I'm a teapot", 422: "Unprocessable Content", 429: "Too Many Requests",
	500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
	503: "Service Unavailable", 504: "Gateway Timeout",
}

export const DEVICE_PRESETS = [
	{ name: "iPhone SE", width: 375, height: 667, dpr: 2 },
	{ name: "iPhone 15 Pro", width: 393, height: 852, dpr: 3 },
	{ name: "Pixel 8", width: 412, height: 915, dpr: 2.6 },
	{ name: "iPad Mini", width: 768, height: 1024, dpr: 2 },
	{ name: "iPad Pro 12.9", width: 1024, height: 1366, dpr: 2 },
	{ name: "Laptop", width: 1280, height: 800, dpr: 1 },
	{ name: "Desktop HD", width: 1440, height: 900, dpr: 1 },
	{ name: "Desktop FHD", width: 1920, height: 1080, dpr: 1 },
]

export const USER_AGENTS = {
	"Chrome (Windows)":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	"Safari (iPhone)":
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
	"Firefox (macOS)":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
	"Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
}

export function bugReport({
	title = "",
	severity = "Major",
	steps = "",
	expected = "",
	actual = "",
	environment = {},
} = {}) {
	const stepList = String(steps)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "")}`)
		.join("\n")
	const env = Object.entries(environment)
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([key, value]) => `- **${key}:** ${value}`)
		.join("\n")
	return [
		`# ${title || "Untitled bug"}`,
		"",
		`**Severity:** ${severity}`,
		"",
		"## Steps to reproduce",
		stepList || "1. _Add steps_",
		"",
		"## Expected result",
		expected || "_Describe expected behaviour_",
		"",
		"## Actual result",
		actual || "_Describe actual behaviour_",
		"",
		"## Environment",
		env || "- _Captured automatically when run on a page_",
	].join("\n")
}

export function gherkin({ feature = "", scenario = "", given = "", when = "", then = "" } = {}) {
	const block = (keyword, text) =>
		String(text)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line, index) => `    ${index === 0 ? keyword : "And"} ${line}`)
			.join("\n")
	return [
		`Feature: ${feature || "Untitled feature"}`,
		"",
		`  Scenario: ${scenario || "Untitled scenario"}`,
		block("Given", given || "a precondition"),
		block("When", when || "an action happens"),
		block("Then", then || "an outcome is verified"),
	].join("\n")
}

export function testMatrix(devices = DEVICE_PRESETS, browsers = ["Chrome", "Firefox", "Safari", "Edge"]) {
	return devices.flatMap((device) =>
		browsers.map((browser) => ({
			device: device.name,
			viewport: `${device.width}x${device.height}`,
			browser,
			status: "Not run",
		})),
	)
}

export const testingTools = [
	{
		id: "http-status",
		name: "HTTP status reference",
		category: "Testing",
		roles: ["qa", "dev", "it"],
		description: "Look up a status code, or list a whole class (4xx, 5xx...).",
		inputs: [{ key: "code", label: "Status code or class", type: "text", default: "429" }],
		run: ({ code }) => {
			const value = required(code, "Status code").trim()
			if (/^[1-5]xx$/i.test(value)) {
				const prefix = value[0]
				const matches = Object.entries(HTTP_STATUS).filter(([key]) => key.startsWith(prefix))
				return { type: "json", value: Object.fromEntries(matches) }
			}
			return { type: "text", value: `${value} — ${HTTP_STATUS[value] ?? "Unknown / non-standard status code"}` }
		},
	},
	{
		id: "bug-report",
		name: "Bug report builder",
		category: "Testing",
		roles: ["qa"],
		description: "Markdown bug template that auto-fills URL, browser, viewport and timestamp from the page.",
		autofill: "environment",
		inputs: [
			{ key: "title", label: "Title", type: "text" },
			{ key: "severity", label: "Severity", type: "select", options: ["Blocker", "Critical", "Major", "Minor", "Trivial"], default: "Major" },
			{ key: "steps", label: "Steps (one per line)", type: "textarea" },
			{ key: "expected", label: "Expected", type: "textarea" },
			{ key: "actual", label: "Actual", type: "textarea" },
		],
		run: (values) => ({ type: "text", value: bugReport(values) }),
	},
	{
		id: "gherkin",
		name: "Test case (Gherkin) writer",
		category: "Testing",
		roles: ["qa"],
		description: "Turn notes into Given/When/Then scenarios ready for Cucumber or a test-case tool.",
		inputs: [
			{ key: "feature", label: "Feature", type: "text" },
			{ key: "scenario", label: "Scenario", type: "text" },
			{ key: "given", label: "Given (one per line)", type: "textarea" },
			{ key: "when", label: "When (one per line)", type: "textarea" },
			{ key: "then", label: "Then (one per line)", type: "textarea" },
		],
		run: (values) => ({ type: "text", value: gherkin(values) }),
	},
	{
		id: "test-matrix",
		name: "Cross-browser test matrix",
		category: "Testing",
		roles: ["qa", "it"],
		description: "Generate a device x browser coverage checklist as CSV for the test plan.",
		inputs: [{ key: "browsers", label: "Browsers", type: "text", default: "Chrome,Firefox,Safari,Edge" }],
		run: ({ browsers = "Chrome,Firefox,Safari,Edge" }) => {
			const list = String(browsers).split(",").map((b) => b.trim()).filter(Boolean)
			return { type: "json", value: testMatrix(DEVICE_PRESETS, list) }
		},
	},
	{
		id: "perf-budget",
		name: "Performance budget check",
		category: "Testing",
		roles: ["dev", "qa"],
		description: "Compare Core Web Vitals against Google thresholds and get a pass/fail verdict.",
		inputs: [
			{ key: "lcp", label: "LCP (ms)", type: "number", default: 2500 },
			{ key: "cls", label: "CLS", type: "number", default: 0.1 },
			{ key: "inp", label: "INP (ms)", type: "number", default: 200 },
		],
		run: ({ lcp = 0, cls = 0, inp = 0 }) => {
			const safeNum = (v) => {
				const n = Number(v)
				return Number.isNaN(n) ? 0 : Math.max(0, n)
			}
			const l = safeNum(lcp)
			const c = safeNum(cls)
			const i = safeNum(inp)
			const verdict = (value, good, poor) => (value <= good ? "good" : value <= poor ? "needs improvement" : "poor")
			return {
				type: "json",
				value: {
					LCP: { value: round(l, 2), verdict: verdict(l, 2500, 4000) },
					CLS: { value: round(c, 3), verdict: verdict(c, 0.1, 0.25) },
					INP: { value: round(i, 2), verdict: verdict(i, 200, 500) },
				},
			}
		},
	},
]

export function parseCookieString(cookieString) {
	if (!cookieString || typeof cookieString !== "string") return []
	return cookieString
		.split(";")
		.map((c) => c.trim())
		.filter(Boolean)
		.map((c) => {
			const eqIdx = c.indexOf("=")
			if (eqIdx === -1) {
				return { name: c, value: "", size: c.length }
			}
			const name = c.slice(0, eqIdx).trim()
			const value = c.slice(eqIdx + 1).trim()
			return { name, value, size: c.length }
		})
}

export function formatStorageSize(bytes) {
	if (!bytes || bytes <= 0) return "0 B"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function getBreakpointBucket(width) {
	const w = Number(width) || 0
	if (w < 480) return "xs (Mobile)"
	if (w < 768) return "sm (Mobile Lg)"
	if (w < 1024) return "md (Tablet)"
	if (w < 1280) return "lg (Laptop)"
	if (w < 1536) return "xl (Desktop)"
	return "2xl (Wide)"
}

export function calculateAspectRatio(width, height) {
	const w = Math.round(Number(width)) || 0
	const h = Math.round(Number(height)) || 0
	if (w <= 0 || h <= 0) return "1:1"
	const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
	const g = gcd(w, h)
	const rw = Math.round(w / g)
	const rh = Math.round(h / g)
	if (rw > 32 || rh > 32) {
		return (w / h).toFixed(2) + ":1"
	}
	return `${rw}:${rh}`
}

export function buildMediaQuery(width, type = "max-width") {
	const w = Math.max(0, Math.round(Number(width) || 0))
	const prop = type === "min-width" ? "min-width" : "max-width"
	return `@media (${prop}: ${w}px)`
}


