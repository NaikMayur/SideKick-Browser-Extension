import { ToolError, required, round } from "../lib/utils.js"

const STATUS_TABLE = [
	[100, "Continue", "The server got the request headers; the client should send the body."],
	[101, "Switching Protocols", "The server is switching protocols as asked, e.g. to WebSocket."],
	[102, "Processing", "WebDAV: the request is accepted but not finished yet."],
	[103, "Early Hints", "Preload hints (Link headers) sent before the final response."],
	[200, "OK", "The request succeeded."],
	[201, "Created", "A new resource was created; its URL is usually in the Location header."],
	[202, "Accepted", "Accepted for asynchronous processing; the work is not done yet."],
	[203, "Non-Authoritative Information", "A transforming proxy modified the origin's 200 response."],
	[204, "No Content", "Success with no response body."],
	[205, "Reset Content", "Success; the client should reset the form or view."],
	[206, "Partial Content", "Answering a Range request with part of the resource."],
	[207, "Multi-Status", "WebDAV: the body holds several status codes."],
	[208, "Already Reported", "WebDAV: members already listed earlier in the response."],
	[226, "IM Used", "Delta encoding applied to a GET response."],
	[300, "Multiple Choices", "Several representations are available."],
	[301, "Moved Permanently", "Permanent redirect; clients may switch POST to GET. Prefer 308 for APIs."],
	[302, "Found", "Temporary redirect; clients may switch POST to GET. Prefer 307 to keep the method."],
	[303, "See Other", "Redirect to another URL with GET, typically after a POST."],
	[304, "Not Modified", "The cached copy is still valid (conditional GET)."],
	[305, "Use Proxy", "Deprecated; do not use."],
	[307, "Temporary Redirect", "Temporary redirect that keeps the method and body."],
	[308, "Permanent Redirect", "Permanent redirect that keeps the method and body."],
	[400, "Bad Request", "Malformed syntax, invalid framing or validation failure."],
	[401, "Unauthorized", "Missing or invalid authentication; should send WWW-Authenticate."],
	[402, "Payment Required", "Reserved; used ad hoc by some APIs for billing limits."],
	[403, "Forbidden", "Authenticated (or not) but not allowed; re-authenticating will not help."],
	[404, "Not Found", "No resource at this URL (or the server hides that it exists)."],
	[405, "Method Not Allowed", "The method is not supported here; must send an Allow header."],
	[406, "Not Acceptable", "No representation matches the Accept headers."],
	[407, "Proxy Authentication Required", "Authenticate with the proxy first."],
	[408, "Request Timeout", "The server gave up waiting for the request."],
	[409, "Conflict", "Conflicts with the current state, e.g. an edit conflict or duplicate."],
	[410, "Gone", "Permanently removed with no forwarding address."],
	[411, "Length Required", "A Content-Length header is required."],
	[412, "Precondition Failed", "An If-Match / If-Unmodified-Since precondition failed."],
	[413, "Content Too Large", "The request body exceeds the server limit."],
	[414, "URI Too Long", "The URL is longer than the server will process."],
	[415, "Unsupported Media Type", "The Content-Type of the body is not supported."],
	[416, "Range Not Satisfiable", "The requested Range is outside the resource."],
	[417, "Expectation Failed", "The Expect header cannot be met."],
	[418, "I'm a teapot", "April Fools (RFC 2324); sometimes used to refuse bots."],
	[421, "Misdirected Request", "Sent to a server that cannot answer for this origin (HTTP/2 connection reuse)."],
	[422, "Unprocessable Content", "Well formed but semantically invalid, e.g. failed validation."],
	[423, "Locked", "WebDAV: the resource is locked."],
	[424, "Failed Dependency", "WebDAV: an earlier request this depends on failed."],
	[425, "Too Early", "The server will not risk processing a replayable early-data request."],
	[426, "Upgrade Required", "Switch to the protocol named in the Upgrade header."],
	[428, "Precondition Required", "The server requires a conditional request (If-Match) to avoid lost updates."],
	[429, "Too Many Requests", "Rate limited; honour the Retry-After header and back off."],
	[431, "Request Header Fields Too Large", "Headers (often cookies) are too large."],
	[451, "Unavailable For Legal Reasons", "Blocked for legal reasons, e.g. censorship or a court order."],
	[500, "Internal Server Error", "Unhandled server-side error."],
	[501, "Not Implemented", "The server does not support the method or feature."],
	[502, "Bad Gateway", "A gateway or proxy got an invalid response from the upstream server."],
	[503, "Service Unavailable", "Overloaded or down for maintenance; may send Retry-After."],
	[504, "Gateway Timeout", "A gateway or proxy timed out waiting for the upstream server."],
	[505, "HTTP Version Not Supported", "The HTTP version is not supported."],
	[506, "Variant Also Negotiates", "Content negotiation misconfiguration on the server."],
	[507, "Insufficient Storage", "WebDAV: the server cannot store the representation."],
	[508, "Loop Detected", "WebDAV: infinite loop while processing."],
	[510, "Not Extended", "Further extensions to the request are required."],
	[511, "Network Authentication Required", "A captive portal wants you to log in to the network."],
]

const UNOFFICIAL_STATUS = [
	[444, "No Response", "nginx: closed the connection without a response."],
	[499, "Client Closed Request", "nginx: the client disconnected before the response."],
	[520, "Web Server Returned an Unknown Error", "Cloudflare: unexpected response from the origin."],
	[521, "Web Server Is Down", "Cloudflare: the origin refused the connection."],
	[522, "Connection Timed Out", "Cloudflare: TCP connection to the origin timed out."],
	[523, "Origin Is Unreachable", "Cloudflare: no route to the origin."],
	[524, "A Timeout Occurred", "Cloudflare: the origin did not answer within 100 seconds."],
	[525, "SSL Handshake Failed", "Cloudflare: TLS handshake with the origin failed."],
	[526, "Invalid SSL Certificate", "Cloudflare: the origin certificate is invalid."],
]

export const HTTP_STATUS = Object.fromEntries(STATUS_TABLE.map(([code, name]) => [code, name]))

const ALL_STATUS = [...STATUS_TABLE.map((row) => [...row, true]), ...UNOFFICIAL_STATUS.map((row) => [...row, false])]

const STATUS_CLASSES = { 1: "1xx Informational", 2: "2xx Success", 3: "3xx Redirection", 4: "4xx Client error", 5: "5xx Server error" }

export function lookupStatus(query) {
	const value = String(query ?? "").trim()
	if (/^\d{3}$/.test(value)) {
		const row = ALL_STATUS.find(([code]) => code === Number(value))
		const klass = STATUS_CLASSES[value[0]] ?? "Non-standard class"
		if (!row) return { code: Number(value), name: "Unknown / non-standard status code", description: `Unregistered code in the ${klass} range.`, klass, standard: false }
		return { code: row[0], name: row[1], description: row[2], klass, standard: row[3] }
	}
	return null
}

function statusRows(rows) {
	return rows.map(([code, name, description, standard]) => [code, name, description, standard ? "IANA" : "unofficial"])
}

function httpStatusRun({ code }) {
	const value = required(code, "Status code").trim()
	const single = lookupStatus(value)
	if (single) {
		const text = `${single.code} ${single.name}\n${single.klass}${single.standard ? "" : " (unofficial)"}\n\n${single.description}`
		return { type: "text", value: text, copy: `${single.code} ${single.name}` }
	}
	const columns = ["Code", "Name", "Meaning", "Source"]
	if (/^[1-5]xx$/i.test(value)) {
		return { type: "table", value: { columns, rows: statusRows(ALL_STATUS.filter(([c]) => String(c)[0] === value[0])) } }
	}
	const needle = value.toLowerCase()
	const matches = ALL_STATUS.filter(([c, name, description]) => `${c} ${name} ${description}`.toLowerCase().includes(needle))
	if (!matches.length) throw new ToolError(`No status code matches "${value}"`)
	return { type: "table", value: { columns, rows: statusRows(matches) } }
}

export const USER_AGENTS = {
	"Chrome (Windows)":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	"Safari (iPhone)":
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
	"Firefox (macOS)":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
	"Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
	"Chrome (Android)":
		"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	"Edge (Windows)":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
	"Samsung Internet (tablet)":
		"Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36",
}

function stripListMarker(line) {
	return line.replace(/^(?:\d+[.)]|[-*•])\s*/, "")
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
		.map((line, index) => `${index + 1}. ${stripListMarker(line)}`)
		.join("\n")
	const envObject = environment && typeof environment === "object" ? environment : { Note: String(environment ?? "") }
	const env = Object.entries(envObject)
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([key, value]) => `- **${key}:** ${typeof value === "object" ? JSON.stringify(value) : value}`)
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

const GHERKIN_KEYWORD = /^(given|when|then|and|but)\s+/i

export function gherkin({ feature = "", scenario = "", given = "", when = "", then = "", tags = "" } = {}) {
	const block = (keyword, text) =>
		String(text)
			.split("\n")
			.map((line) => stripListMarker(line.trim()).replace(GHERKIN_KEYWORD, ""))
			.filter(Boolean)
			.map((line, index) => `    ${index === 0 ? keyword : "And"} ${line}`)
			.join("\n")
	const tagLine = String(tags)
		.split(/[\s,]+/)
		.filter(Boolean)
		.map((tag) => (tag.startsWith("@") ? tag : `@${tag}`))
		.join(" ")
	return [
		`Feature: ${feature || "Untitled feature"}`,
		"",
		...(tagLine ? [`  ${tagLine}`] : []),
		`  Scenario: ${scenario || "Untitled scenario"}`,
		block("Given", given || "a precondition"),
		block("When", when || "an action happens"),
		block("Then", then || "an outcome is verified"),
	].join("\n")
}

// Thresholds are the published Core Web Vitals and Lighthouse boundaries; a value equal to the "good" limit still passes.
const PERF_METRICS = [
	{ key: "lcp", label: "LCP", good: 2500, poor: 4000, unit: "ms", core: true },
	{ key: "cls", label: "CLS", good: 0.1, poor: 0.25, unit: "", core: true, decimals: 3 },
	{ key: "inp", label: "INP", good: 200, poor: 500, unit: "ms", core: true },
	{ key: "fcp", label: "FCP", good: 1800, poor: 3000, unit: "ms" },
	{ key: "ttfb", label: "TTFB", good: 800, poor: 1800, unit: "ms" },
	{ key: "tbt", label: "TBT", good: 200, poor: 600, unit: "ms" },
]

export function perfVerdict(value, good, poor) {
	return value <= good ? "good" : value <= poor ? "needs improvement" : "poor"
}

export function perfBudget(values = {}) {
	const out = {}
	let corePassed = true
	let measured = 0
	for (const metric of PERF_METRICS) {
		const raw = values[metric.key]
		if (raw === undefined || raw === null || raw === "") {
			if (metric.core) throw new ToolError(`${metric.label} is required`)
			continue
		}
		const n = Number(raw)
		if (!Number.isFinite(n) || n < 0) throw new ToolError(`${metric.label} must be a non-negative number`)
		const verdict = perfVerdict(n, metric.good, metric.poor)
		if (metric.core && verdict !== "good") corePassed = false
		measured++
		out[metric.label] = { value: round(n, metric.decimals ?? 2), verdict, good: metric.good, poor: metric.poor, unit: metric.unit }
	}
	out.Overall = {
		value: corePassed ? "Core Web Vitals passed" : "Core Web Vitals failed",
		verdict: corePassed ? "good" : Object.values(out).some((m) => m.verdict === "poor") ? "poor" : "needs improvement",
		measured,
	}
	return out
}

const BOT_PATTERN = /(googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|gptbot|claudebot|facebookexternalhit|twitterbot|slackbot|linkedinbot|ahrefsbot|semrushbot|[a-z]*bot\b|crawler|spider|slurp)(?:[/ ]([\d.]+))?/i

// Order matters: most Chromium browsers also contain "Chrome/" and "Safari/", so the specific tokens are checked first.
const BROWSER_RULES = [
	[/HeadlessChrome\/([\d.]+)/, "Headless Chrome"],
	[/EdgiOS\/([\d.]+)/, "Microsoft Edge"],
	[/EdgA?\/([\d.]+)/, "Microsoft Edge"],
	[/Edge\/([\d.]+)/, "Microsoft Edge (Legacy)"],
	[/OPiOS\/([\d.]+)/, "Opera"],
	[/OPR\/([\d.]+)/, "Opera"],
	[/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
	[/UCBrowser\/([\d.]+)/, "UC Browser"],
	[/YaBrowser\/([\d.]+)/, "Yandex Browser"],
	[/Vivaldi\/([\d.]+)/, "Vivaldi"],
	[/FxiOS\/([\d.]+)/, "Firefox"],
	[/CriOS\/([\d.]+)/, "Chrome"],
	[/Instagram ([\d.]+)/, "Instagram in-app"],
	[/FBAV\/([\d.]+)/, "Facebook in-app"],
	[/Firefox\/([\d.]+)/, "Firefox"],
	[/MSIE ([\d.]+)/, "Internet Explorer"],
	[/Trident\/.*rv:([\d.]+)/, "Internet Explorer"],
	[/; wv\).*Chrome\/([\d.]+)/, "Android WebView"],
	[/Chrome\/([\d.]+)/, "Chrome"],
	[/Version\/([\d.]+).*Safari\//, "Safari"],
	[/Safari\/([\d.]+)/, "Safari"],
]

const WINDOWS_VERSIONS = { "10.0": "10 or 11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.1": "XP" }

function detectBrowser(ua) {
	for (const [pattern, name] of BROWSER_RULES) {
		const match = ua.match(pattern)
		if (match) return { name, version: match[1] }
	}
	return { name: "Unknown", version: "" }
}

function detectOs(ua) {
	let m = ua.match(/Windows Phone(?: OS)? ([\d.]+)/)
	if (m) return { name: "Windows Phone", version: m[1] }
	m = ua.match(/Windows NT ([\d.]+)/)
	if (m) return { name: "Windows", version: WINDOWS_VERSIONS[m[1]] ?? m[1] }
	m = ua.match(/(iPhone|iPod|iPad).*? OS ([\d_]+)/)
	if (m) return { name: m[1] === "iPad" ? "iPadOS" : "iOS", version: m[2].replace(/_/g, ".") }
	m = ua.match(/Android ([\d.]+)/)
	if (m) return { name: "Android", version: m[1] }
	m = ua.match(/CrOS \S+ ([\d.]+)/)
	if (m) return { name: "ChromeOS", version: m[1] }
	m = ua.match(/Mac OS X ([\d_.]+)/)
	if (m) return { name: "macOS", version: m[1].replace(/_/g, ".") }
	if (/Ubuntu/.test(ua)) return { name: "Ubuntu", version: "" }
	if (/Fedora/.test(ua)) return { name: "Fedora", version: "" }
	if (/Linux/.test(ua)) return { name: "Linux", version: "" }
	return { name: "Unknown", version: "" }
}

function detectEngine(ua, browser, os) {
	if (os.name === "iOS" || os.name === "iPadOS") return "WebKit (all iOS browsers must use WebKit)"
	if (/Trident\//.test(ua) || browser.name === "Internet Explorer") return "Trident"
	if (browser.name === "Microsoft Edge (Legacy)") return "EdgeHTML"
	if (/Gecko\/\d/.test(ua) && /Firefox\//.test(ua)) return "Gecko"
	if (/Chrome\//.test(ua)) return "Blink"
	if (/AppleWebKit\//.test(ua)) return "WebKit"
	if (/Presto\//.test(ua)) return "Presto"
	return "Unknown"
}

function detectDevice(ua, os, isBot) {
	if (isBot) return "bot"
	if (/SmartTV|SMART-TV|Tizen.+TV|Web0S|AppleTV|CrKey|Roku|BRAVIA/i.test(ua)) return "tv"
	if (/PlayStation|Xbox|Nintendo/i.test(ua)) return "console"
	if (/iPad|Tablet/i.test(ua) || (os.name === "Android" && !/Mobile/.test(ua))) return "tablet"
	if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) return "mobile"
	return "desktop"
}

function androidModel(ua) {
	const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?\)/)
	return m ? m[1].trim() : ""
}

export function parseUserAgent(input) {
	const ua = String(input ?? "").trim()
	const bot = ua.match(BOT_PATTERN)
	const browser = detectBrowser(ua)
	const os = detectOs(ua)
	const device = detectDevice(ua, os, Boolean(bot))
	const notes = []
	if (os.name === "Windows" && os.version === "10 or 11") notes.push("Windows 11 still reports Windows NT 10.0; use Client Hints (Sec-CH-UA-Platform-Version ≥ 13) to tell them apart.")
	if (os.name === "macOS" && /^10[._]15[._]7$/.test(os.version)) notes.push("Chrome and Safari freeze the macOS version at 10.15.7; the real version is only available via Client Hints.")
	const model = os.name === "Android" ? androidModel(ua) : ""
	if (model === "K") notes.push("Reduced user agent: Chrome hides the Android version and model (\"Android 10; K\").")
	if (/Chrome\/\d+\.0\.0\.0/.test(ua)) notes.push("Chrome reduces the version to MAJOR.0.0.0; request Sec-CH-UA-Full-Version-List for the full version.")
	if (os.name === "macOS" && device === "desktop" && /Version\/[\d.]+.*Safari/.test(ua) && !/Chrome/.test(ua)) notes.push("iPads in desktop mode send a macOS Safari user agent; check navigator.maxTouchPoints > 1 to detect them.")
	return {
		browser: { name: bot ? bot[1] : browser.name, version: bot ? bot[2] ?? "" : browser.version, major: (bot ? bot[2] ?? "" : browser.version).split(".")[0] },
		engine: detectEngine(ua, browser, os),
		os,
		device: { type: device, model: model === "K" ? "" : model },
		isBot: Boolean(bot),
		notes,
		ua,
	}
}

async function clientHints() {
	const data = typeof navigator !== "undefined" ? navigator.userAgentData : undefined
	if (!data) return null
	const hints = { brands: (data.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(", "), mobile: data.mobile, platform: data.platform }
	try {
		const high = await data.getHighEntropyValues(["platformVersion", "architecture", "model", "fullVersionList"])
		hints.platformVersion = high.platformVersion
		hints.architecture = high.architecture
		if (high.model) hints.model = high.model
		if (data.platform === "Windows" && high.platformVersion) hints.windows = Number(high.platformVersion.split(".")[0]) >= 13 ? "Windows 11" : "Windows 10"
	} catch {
		hints.highEntropy = "unavailable"
	}
	return hints
}

async function userAgentRun({ source = "current", ua = "" }) {
	let text = ""
	if (source === "custom") text = required(ua, "User agent")
	else if (source === "current") text = typeof navigator !== "undefined" ? navigator.userAgent ?? "" : ""
	else text = USER_AGENTS[source] ?? ""
	if (!text) throw new ToolError("No user agent available; paste one instead")
	const parsed = parseUserAgent(text)
	const rows = [
		["Browser", `${parsed.browser.name} ${parsed.browser.version}`.trim()],
		["Engine", parsed.engine],
		["OS", `${parsed.os.name} ${parsed.os.version}`.trim()],
		["Device", parsed.device.model ? `${parsed.device.type} (${parsed.device.model})` : parsed.device.type],
		["Bot", parsed.isBot ? "yes" : "no"],
	]
	if (source === "current") {
		const hints = await clientHints()
		if (hints) {
			parsed.clientHints = hints
			rows.push(["Client Hints brands", hints.brands])
			rows.push(["Client Hints platform", `${hints.platform}${hints.platformVersion ? ` ${hints.platformVersion}` : ""}${hints.windows ? ` (${hints.windows})` : ""}`])
			rows.push(["Client Hints mobile", hints.mobile ? "yes" : "no"])
		}
	}
	for (const note of parsed.notes) rows.push(["Note", note])
	rows.push(["User agent", text])
	return { type: "table", value: { columns: ["Property", "Value"], rows }, copy: JSON.stringify(parsed, null, 2) }
}

export const testingTools = [
	{
		id: "http-status",
		name: "HTTP status reference",
		category: "Testing",
		roles: ["qa", "dev", "it"],
		description: "Look up a status code, list a class (4xx, 5xx…) or search by name, including common nginx and Cloudflare codes.",
		keywords: ["status code", "404", "500", "429", "redirect", "response code", "rfc 9110", "cloudflare 52x"],
		inputs: [{ key: "code", label: "Status code, class or search", type: "text", default: "429", placeholder: "404, 5xx or timeout" }],
		run: httpStatusRun,
	},
	{
		id: "bug-report",
		name: "Bug report & test case writer",
		category: "Testing",
		roles: ["qa"],
		description: "Markdown bug report that auto-fills URL, browser, viewport and time from the page, or a Gherkin Given/When/Then scenario.",
		keywords: ["issue", "defect", "jira", "github issue", "template", "steps to reproduce", "gherkin", "bdd", "cucumber", "given when then", "test case", "feature file"],
		autofill: "environment",
		inputs: [
			{ key: "kind", label: "Write", type: "select", options: [{ value: "bug", label: "Bug report (Markdown)" }, { value: "gherkin", label: "Test case (Gherkin)" }], default: "bug" },
			{ key: "title", label: "Title", type: "text", showIf: { key: "kind", in: ["bug"] } },
			{ key: "severity", label: "Severity", type: "select", options: ["Blocker", "Critical", "Major", "Minor", "Trivial"], default: "Major", showIf: { key: "kind", in: ["bug"] } },
			{ key: "steps", label: "Steps (one per line)", type: "textarea", showIf: { key: "kind", in: ["bug"] } },
			{ key: "expected", label: "Expected", type: "textarea", showIf: { key: "kind", in: ["bug"] } },
			{ key: "actual", label: "Actual", type: "textarea", showIf: { key: "kind", in: ["bug"] } },
			{ key: "feature", label: "Feature", type: "text", showIf: { key: "kind", in: ["gherkin"] } },
			{ key: "scenario", label: "Scenario", type: "text", showIf: { key: "kind", in: ["gherkin"] } },
			{ key: "tags", label: "Tags", type: "text", placeholder: "smoke, regression", showIf: { key: "kind", in: ["gherkin"] } },
			{ key: "given", label: "Given (one per line)", type: "textarea", showIf: { key: "kind", in: ["gherkin"] } },
			{ key: "when", label: "When (one per line)", type: "textarea", showIf: { key: "kind", in: ["gherkin"] } },
			{ key: "then", label: "Then (one per line)", type: "textarea", showIf: { key: "kind", in: ["gherkin"] } },
		],
		run: (values) => {
			if (values.kind === "gherkin") {
				const text = gherkin(values)
				return { type: "text", value: text, download: { filename: "scenario.feature", mime: "text/plain", text } }
			}
			const markdown = bugReport(values)
			return { type: "text", value: markdown, download: { filename: "bug-report.md", mime: "text/markdown", text: markdown } }
		},
	},
	{
		id: "perf-budget",
		name: "Performance budget check",
		category: "Testing",
		roles: ["dev", "qa"],
		description: "Compare Core Web Vitals (plus optional FCP, TTFB, TBT) against Google thresholds and get a pass/fail verdict.",
		keywords: ["core web vitals", "lcp", "cls", "inp", "fcp", "ttfb", "tbt", "lighthouse", "page speed"],
		inputs: [
			{ key: "lcp", label: "LCP (ms)", type: "number", default: 2500, min: 0 },
			{ key: "cls", label: "CLS", type: "number", default: 0.1, min: 0, step: 0.01 },
			{ key: "inp", label: "INP (ms)", type: "number", default: 200, min: 0 },
			{ key: "fcp", label: "FCP (ms, optional)", type: "number", min: 0 },
			{ key: "ttfb", label: "TTFB (ms, optional)", type: "number", min: 0 },
			{ key: "tbt", label: "TBT (ms, optional, lab only)", type: "number", min: 0, help: "Lab proxy for INP from Lighthouse." },
		],
		run: (values) => ({ type: "json", value: perfBudget(values) }),
	},
	{
		id: "user-agent",
		name: "User agent parser",
		category: "Testing",
		roles: ["qa", "dev", "it"],
		description: "Break a user agent string into browser, engine, OS and device type, with Client Hints for the current browser.",
		keywords: ["ua", "user-agent", "browser detection", "client hints", "sec-ch-ua", "bot", "device"],
		inputs: [
			{
				key: "source",
				label: "User agent",
				type: "select",
				options: [
					{ value: "current", label: "This browser" },
					{ value: "custom", label: "Paste a string…" },
					...Object.keys(USER_AGENTS).map((name) => ({ value: name, label: `Sample: ${name}` })),
				],
				default: "current",
			},
			{ key: "ua", label: "User agent string", type: "textarea", placeholder: "Mozilla/5.0 (…)", showIf: { key: "source", in: ["custom"] } },
		],
		run: userAgentRun,
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


