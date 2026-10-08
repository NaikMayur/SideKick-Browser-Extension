import { ToolError, required } from "../lib/utils.js"
import { MOCK_TYPES, generateMockRecords, recordsToSql } from "./mock.js"
import { parseJsonWithDiagnostics } from "./text.js"

const TABLE_ROW_LIMIT = 1000
const DELIMITERS = [",", ";", "\t", "|"]

export function resolveDelimiter(delimiter, sample = "") {
	const value = String(delimiter ?? "")
	if (value === "\\t" || value.toLowerCase() === "tab") return "\t"
	if (value && value !== "auto") return value
	return detectDelimiter(sample)
}

// Counts candidates outside quotes on the first lines and prefers the one that appears consistently.
export function detectDelimiter(text) {
	const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 10)
	let best = ","
	let bestScore = 0
	for (const candidate of DELIMITERS) {
		const counts = lines.map((line) => line.replace(/"[^"]*"/g, "").split(candidate).length - 1)
		const first = counts[0] ?? 0
		if (!first) continue
		const consistent = counts.filter((c) => c === first).length
		const score = consistent * 1000 + first
		if (score > bestScore) {
			best = candidate
			bestScore = score
		}
	}
	return best
}

export function parseCsv(text, delimiter = ",") {
	const input = String(text).replace(/^\uFEFF/, "")
	const sep = resolveDelimiter(delimiter, input)
	const rows = []
	let row = []
	let field = ""
	let inQuotes = false
	let quoteLine = 0
	let line = 1
	for (let i = 0; i < input.length; i += 1) {
		const char = input[i]
		if (inQuotes) {
			if (char === "\"") {
				if (input[i + 1] === "\"") {
					field += "\""
					i += 1
				} else inQuotes = false
			} else if (char === "\r" && input[i + 1] === "\n") {
				field += "\n"
				line += 1
				i += 1
			} else {
				if (char === "\n") line += 1
				field += char
			}
			continue
		}
		// A quote only opens a quoted field at the start of a field, so ab"c stays literal.
		if (char === "\"" && field.trim() === "") {
			inQuotes = true
			quoteLine = line
			field = ""
		} else if (input.startsWith(sep, i)) {
			row.push(field)
			field = ""
			i += sep.length - 1
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && input[i + 1] === "\n") i += 1
			row.push(field)
			rows.push(row)
			row = []
			field = ""
			line += 1
		} else field += char
	}
	if (inQuotes) throw new ToolError(`Unterminated quoted field starting on line ${quoteLine}`)
	row.push(field)
	rows.push(row)
	return rows.filter((r) => r.length > 1 || r[0] !== "")
}

export function inferValue(cell) {
	if (cell === "") return null
	if (cell === "true" || cell === "false") return cell === "true"
	if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(cell)) {
		const num = Number(cell)
		if (Number.isFinite(num) && (!/^-?\d+$/.test(cell) || Number.isSafeInteger(num))) return num
	}
	return cell
}

export function uniqueHeaders(header, width) {
	const seen = new Map()
	return Array.from({ length: Math.max(header.length, width) }, (_, index) => {
		const base = String(header[index] ?? "").trim() || `column_${index + 1}`
		const count = seen.get(base) ?? 0
		seen.set(base, count + 1)
		return count ? `${base}_${count + 1}` : base
	})
}

function tableFromCsv(text, delimiter) {
	const rows = parseCsv(text, delimiter)
	if (!rows.length) return { columns: [], body: [] }
	const [header, ...body] = rows
	const width = body.reduce((max, r) => Math.max(max, r.length), header.length)
	return { columns: uniqueHeaders(header, width), body }
}

export function csvToJson(text, delimiter = ",", { inferTypes = false } = {}) {
	const { columns, body } = tableFromCsv(text, delimiter)
	return body.map((cells) =>
		Object.fromEntries(columns.map((key, index) => {
			const cell = cells[index] ?? ""
			return [key, inferTypes ? inferValue(cell) : cell]
		})),
	)
}

export function flattenObject(value, prefix = "", out = {}) {
	for (const [key, child] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length) flattenObject(child, path, out)
		else out[path] = child
	}
	return out
}

export function jsonToCsv(value, delimiter = ",", { flatten = true } = {}) {
	const sep = resolveDelimiter(delimiter === "auto" ? "," : delimiter)
	const list = (Array.isArray(value) ? value : [value]).map((item) => {
		if (item === null || typeof item !== "object" || Array.isArray(item)) return { value: item }
		return flatten ? flattenObject(item) : item
	})
	if (!list.length) return ""
	const keys = [...new Set(list.flatMap((item) => Object.keys(item)))]
	const escape = (cell) => {
		const text = cell === null || cell === undefined ? "" : typeof cell === "object" ? JSON.stringify(cell) : String(cell)
		return text.includes(sep) || /["\n\r]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text
	}
	return [keys.map(escape).join(sep), ...list.map((item) => keys.map((key) => escape(item[key])).join(sep))].join("\n")
}

function csvTableResult(text, delimiter) {
	const { columns, body } = tableFromCsv(text, delimiter)
	const rows = body.slice(0, TABLE_ROW_LIMIT).map((cells) => columns.map((_, i) => cells[i] ?? ""))
	if (body.length > TABLE_ROW_LIMIT) {
		rows.push([`… ${body.length - TABLE_ROW_LIMIT} more rows not shown (Save downloads all rows as JSON)`, ...Array(Math.max(columns.length - 1, 0)).fill("")])
	}
	return {
		type: "table",
		value: { columns, rows },
		download: { filename: "data.json", mime: "application/json", text: JSON.stringify(csvToJson(text, delimiter), null, 2) },
	}
}

export function parseQueryString(url) {
	const text = String(url)
	const queryIndex = text.indexOf("?")
	let query = queryIndex >= 0 ? text.slice(queryIndex + 1) : text
	const hashIndex = query.indexOf("#")
	if (hashIndex >= 0) query = query.slice(0, hashIndex)
	const safeDecode = (str) => {
		try {
			return decodeURIComponent(str.replace(/\+/g, " "))
		} catch {
			return str.replace(/\+/g, " ")
		}
	}
	const params = {}
	for (const pair of query.split("&").filter(Boolean)) {
		const [rawKey, ...rest] = pair.split("=")
		const key = safeDecode(rawKey).trim()
		if (!key) continue
		const val = safeDecode(rest.join("="))
		if (Object.hasOwn(params, key)) params[key] = [].concat(params[key], val)
		else Object.defineProperty(params, key, { value: val, enumerable: true, writable: true, configurable: true })
	}
	return params
}

const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|ref_src|si)$/i

export function inspectUrl(input) {
	const value = required(input, "URL").trim()
	let parsed = null
	let note = null
	try {
		parsed = new URL(value)
	} catch {
		if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(value)) {
			try {
				parsed = new URL(`https://${value}`)
				note = "No scheme given; assumed https://"
			} catch {
				parsed = null
			}
		}
	}
	if (!parsed) return { params: parseQueryString(value), note: "Not an absolute URL" }
	const params = parseQueryString(parsed.search)
	const result = {
		protocol: parsed.protocol,
		host: parsed.host,
		pathname: parsed.pathname,
		hash: parsed.hash,
		params,
		origin: parsed.origin,
		hostname: parsed.hostname,
		port: parsed.port || null,
		search: parsed.search,
		pathSegments: parsed.pathname.split("/").filter(Boolean).map((s) => {
			try {
				return decodeURIComponent(s)
			} catch {
				return s
			}
		}),
		tracking: Object.keys(params).filter((key) => TRACKING.test(key)),
	}
	if (parsed.username) result.username = parsed.username
	if (parsed.password) result.passwordPresent = true
	if (parsed.hash.includes("=")) result.hashParams = parseQueryString(parsed.hash.slice(1))
	if (note) result.note = note
	return result
}

export function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`
}

function psQuote(value) {
	return `'${String(value).replace(/'/g, "''")}'`
}

export function parseHeaderLines(headers) {
	return String(headers ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const index = line.indexOf(":")
			return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : null
		})
		.filter(Boolean)
}

function requestParts({ method = "GET", url, headers = "", body = "" }) {
	return {
		method: String(method || "GET").toUpperCase(),
		url: required(url, "URL").trim(),
		headers: parseHeaderLines(headers),
		body: String(body ?? "").trim() ? String(body) : "",
	}
}

export function buildCurl(values) {
	const req = requestParts(values)
	const first = ["curl"]
	if (req.method === "HEAD") first.push("--head")
	else if (req.method !== "GET" || req.body) first.push("-X", req.method)
	first.push(shellQuote(req.url))
	const lines = [first.join(" ")]
	for (const [key, val] of req.headers) lines.push(`  -H ${shellQuote(`${key}: ${val}`)}`)
	// Using the data raw flag keeps a body that starts with @ from being read as a file name.
	if (req.body) lines.push(`  --data-raw ${shellQuote(req.body)}`)
	return lines.join(" \\\n")
}

function buildFetch(req) {
	const init = { method: req.method, headers: Object.fromEntries(req.headers) }
	if (req.body) init.body = req.body
	return `await fetch(${JSON.stringify(req.url)}, ${JSON.stringify(init, null, 2)})`
}

function buildPython(req) {
	const args = [JSON.stringify(req.method), JSON.stringify(req.url)]
	if (req.headers.length) args.push(`headers=${JSON.stringify(Object.fromEntries(req.headers))}`)
	if (req.body) args.push(`data=${JSON.stringify(req.body)}`)
	return `import requests\n\nresponse = requests.request(${args.join(", ")})\nprint(response.status_code, response.text)`
}

function buildPowerShell(req) {
	const parts = [`Invoke-RestMethod -Method ${req.method[0]}${req.method.slice(1).toLowerCase()} -Uri ${psQuote(req.url)}`]
	const headers = req.headers.filter(([key]) => key.toLowerCase() !== "content-type")
	const contentType = req.headers.find(([key]) => key.toLowerCase() === "content-type")
	if (headers.length) parts.push(`-Headers @{ ${headers.map(([k, v]) => `${psQuote(k)} = ${psQuote(v)}`).join("; ")} }`)
	if (contentType) parts.push(`-ContentType ${psQuote(contentType[1])}`)
	if (req.body) parts.push(`-Body ${psQuote(req.body)}`)
	return parts.join(" `\n  ")
}

export function buildSnippets(values, target = "curl-fetch") {
	const req = requestParts(values)
	const builders = {
		curl: () => buildCurl(values),
		fetch: () => buildFetch(req),
		python: () => buildPython(req),
		powershell: () => buildPowerShell(req),
	}
	if (target === "curl-fetch") return `${builders.curl()}\n\n${builders.fetch()}`
	const build = builders[target]
	if (!build) throw new ToolError(`Unknown target: ${target}`)
	return build()
}

const DATA_ACCEPT = ".csv,.tsv,.json,.txt,text/*,application/json"

export const dataTools = [
	{
		id: "csv-json",
		name: "CSV ↔ JSON converter",
		category: "Text & data",
		roles: ["dev", "qa", "it"],
		description: "Quote aware CSV/TSV ⇄ JSON conversion with delimiter detection, type inference and a table preview.",
		keywords: ["csv", "tsv", "excel", "spreadsheet", "convert", "table", "json to csv", "preview"],
		live: true,
		inputs: [
			{ key: "text", label: "Input", type: "textarea", upload: { accept: DATA_ACCEPT } },
			{
				key: "mode",
				label: "Direction",
				type: "select",
				options: [
					{ value: "csv-to-json", label: "CSV → JSON" },
					{ value: "json-to-csv", label: "JSON → CSV" },
					{ value: "csv-table", label: "CSV → table preview" },
				],
				default: "csv-to-json",
			},
			{
				key: "delimiter",
				label: "Delimiter",
				type: "select",
				options: [
					{ value: "auto", label: "Auto detect" },
					{ value: ",", label: "Comma (,)" },
					{ value: ";", label: "Semicolon (;)" },
					{ value: "\t", label: "Tab" },
					{ value: "|", label: "Pipe (|)" },
				],
				default: "auto",
				help: "JSON → CSV uses a comma when set to auto.",
			},
			{ key: "inferTypes", label: "Convert numbers, booleans and empty cells", type: "checkbox", default: false, showIf: { key: "mode", in: ["csv-to-json"] } },
			{ key: "flatten", label: "Flatten nested objects (a.b columns)", type: "checkbox", default: true, showIf: { key: "mode", in: ["json-to-csv"] } },
		],
		run: ({ text, mode = "csv-to-json", delimiter = "auto", inferTypes = false, flatten = true }) => {
			const value = required(text, "Input")
			if (mode === "json-to-csv") {
				const csv = jsonToCsv(parseJsonWithDiagnostics(value), delimiter, { flatten })
				return { type: "text", value: csv, download: { filename: "data.csv", mime: "text/csv", text: csv } }
			}
			if (mode === "csv-table") return csvTableResult(value, delimiter)
			return { type: "json", value: csvToJson(value, delimiter, { inferTypes }) }
		},
	},
	{
		id: "query-string",
		name: "URL & query inspector",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Break a URL into protocol, host, path, params and hash, and flag tracking parameters.",
		keywords: ["url", "query", "params", "utm", "tracking", "parse url", "querystring"],
		live: true,
		inputs: [{ key: "url", label: "URL", type: "textarea", placeholder: "https://site.com/a?b=1&utm_source=x" }],
		run: ({ url }) => ({ type: "json", value: inspectUrl(url) }),
	},
	{
		id: "mock-data",
		name: "Mock data generator",
		category: "Testing",
		roles: ["qa", "dev"],
		description: "Seedable fake data from presets or your own schema: 50+ field types, nested objects, nullable fields, templates and patterns. Exports JSON, NDJSON, CSV, SQL or a table.",
		keywords: ["fake", "fixtures", "seed", "test data", "dummy users", "faker", "schema", "sql insert", "products", "orders"],
		live: true,
		inputs: [
			{
				key: "preset",
				label: "Preset",
				type: "select",
				options: [
					{ value: "users", label: "Users" },
					{ value: "products", label: "Products" },
					{ value: "orders", label: "Orders" },
					{ value: "companies", label: "Companies" },
					{ value: "employees", label: "Employees" },
					{ value: "addresses", label: "Addresses" },
					{ value: "blank", label: "Blank (schema only)" },
				],
				default: "users",
			},
			{
				key: "schema",
				label: "Custom fields",
				type: "textarea",
				placeholder: "plan: enum(free|pro|team)\nscore: float(0, 100, 1)\nbio?: sentence\nslug: template({firstName}-{id})\ntags: list(word, 3)\n-age",
				help: `One "field: type" per line. Adds to the preset, replaces a field with the same name, "-field" removes one, "field?:" is sometimes null, "a.b:" nests. Types: ${MOCK_TYPES.join(", ")}. Pattern: # digit, ? letter, * either.`,
			},
			{ key: "count", label: "Rows", type: "number", default: 10, min: 1, max: 5000 },
			{ key: "seed", label: "Seed", type: "text", default: "sidekick", help: "The same seed and schema always produce the same rows." },
			{
				key: "format",
				label: "Format",
				type: "select",
				options: [
					{ value: "json", label: "JSON" },
					{ value: "ndjson", label: "NDJSON (one per line)" },
					{ value: "csv", label: "CSV" },
					{ value: "sql", label: "SQL INSERT" },
					{ value: "table", label: "Table" },
				],
				default: "json",
			},
			{ key: "table", label: "SQL table name", type: "text", default: "mock_data", showIf: { key: "format", in: ["sql"] } },
		],
		run: ({ preset = "users", schema = "", count = 10, seed = "sidekick", format = "json", table = "mock_data" }) => {
			const records = generateMockRecords({ preset, schema, count, seed })
			if (format === "csv") {
				const csv = jsonToCsv(records)
				return { type: "text", value: csv, download: { filename: "mock-data.csv", mime: "text/csv", text: csv } }
			}
			if (format === "ndjson") {
				const text = records.map((r) => JSON.stringify(r)).join("\n")
				return { type: "text", value: text, download: { filename: "mock-data.ndjson", mime: "application/x-ndjson", text } }
			}
			if (format === "sql") {
				const sql = recordsToSql(records, (r) => flattenObject(r), table)
				return { type: "text", value: sql, download: { filename: "mock-data.sql", mime: "text/plain", text: sql } }
			}
			if (format === "table") {
				const flat = records.map((r) => flattenObject(r))
				const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))]
				const cell = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v)
				return {
					type: "table",
					value: { columns, rows: flat.slice(0, TABLE_ROW_LIMIT).map((r) => columns.map((c) => cell(r[c]))) },
					download: { filename: "mock-data.json", mime: "application/json", text: JSON.stringify(records, null, 2) },
				}
			}
			return { type: "json", value: records }
		},
	},
	{
		id: "curl-builder",
		name: "cURL / fetch builder",
		category: "API",
		roles: ["dev", "qa"],
		description: "Turn a request definition into safely quoted cURL, fetch(), Python requests or PowerShell snippets.",
		keywords: ["curl", "fetch", "http request", "api", "python requests", "powershell", "invoke-restmethod", "snippet"],
		live: true,
		inputs: [
			{ key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], default: "GET" },
			{ key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/v1/users" },
			{ key: "headers", label: "Headers (one per line)", type: "textarea", placeholder: "Content-Type: application/json", help: "Name: value per line; lines without a colon are ignored." },
			{ key: "body", label: "Body", type: "textarea" },
			{
				key: "target",
				label: "Output",
				type: "select",
				options: [
					{ value: "curl-fetch", label: "cURL + fetch" },
					{ value: "curl", label: "cURL (bash, zsh, Git Bash)" },
					{ value: "fetch", label: "JavaScript fetch" },
					{ value: "python", label: "Python requests" },
					{ value: "powershell", label: "PowerShell" },
				],
				default: "curl-fetch",
			},
		],
		run: (values) => ({ type: "text", value: buildSnippets(values, values.target ?? "curl-fetch") }),
	},
	{
		id: "json-to-ts",
		name: "JSON to TypeScript",
		category: "Text & data",
		roles: ["dev"],
		description: "Generate TypeScript interfaces or type aliases from sample JSON, merging array items and detecting string unions.",
		keywords: ["typescript", "interface", "types", "ts", "codegen", "schema", "quicktype"],
		live: true,
		inputs: [
			{ key: "json", label: "JSON input", type: "textarea", default: "{\n  \"id\": 1,\n  \"name\": \"Alex\"\n}", placeholder: "{\n  \"id\": 1,\n  \"name\": \"Alex\"\n}", upload: { accept: ".json,application/json,text/*" } },
			{ key: "rootName", label: "Root type name", type: "text", default: "Root" },
			{ key: "declaration", label: "Declaration style", type: "select", options: [{ value: "interface", label: "interface" }, { value: "type", label: "type alias" }], default: "interface" },
			{
				key: "enums",
				label: "Repeated string values",
				type: "select",
				options: [
					{ value: "unions", label: "String literal unions" },
					{ value: "enum", label: "enum declarations" },
					{ value: "none", label: "Plain string" },
				],
				default: "unions",
				help: "Only fields whose values repeat across samples become unions.",
			},
		],
		run: (values) => {
			const value = required(values.json ?? values.text, "JSON input")
			const code = jsonToTypeScript(value, {
				rootName: values.rootName || "Root",
				declaration: values.declaration ?? "interface",
				enums: values.enums ?? "unions",
			})
			return { type: "text", value: code, download: { filename: `${values.rootName || "Root"}.ts`, mime: "text/plain", text: code } }
		},
	},
]

function pascalName(name) {
	const clean = String(name)
		.replace(/[^a-zA-Z0-9_$]/g, " ")
		.trim()
		.split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join("")
	const candidate = clean || "Type"
	return /^[0-9]/.test(candidate) ? `T${candidate}` : candidate
}

function singular(name) {
	if (/ies$/i.test(name)) return name.replace(/ies$/i, "y")
	if (/(ss|us)$/i.test(name)) return name
	if (/s$/i.test(name) && name.length > 3) return name.slice(0, -1)
	return `${name}Item`
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function jsonToTypeScript(input, { rootName = "Root", declaration = "interface", enums = "unions" } = {}) {
	if (input === undefined || input === null || !String(input).trim()) throw new ToolError("JSON input is required")
	const data = typeof input === "string" ? parseJsonWithDiagnostics(input) : input
	const usedNames = new Set()
	const definitions = []
	const enumDefs = []
	const unionByKey = new Map()

	const uniqueName = (name) => {
		const base = pascalName(name)
		let unique = base
		let counter = 2
		while (usedNames.has(unique)) unique = `${base}${counter++}`
		usedNames.add(unique)
		return unique
	}
	const formatKey = (key) => (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key))

	// A string field becomes a union only when its values repeat, so free text like names stays string.
	const stringUnion = (key, values) => {
		if (enums === "none" || !key) return null
		const distinct = [...new Set(values)]
		if (distinct.length < 2 || distinct.length > 12 || values.length <= distinct.length) return null
		if (distinct.some((v) => v.length > 40 || /\s{2,}|^\d{4}-\d\d-\d\d/.test(v))) return null
		const signature = distinct.slice().sort().join("\u0000")
		const known = unionByKey.get(key)
		if (known && known.signature === signature) return known.name
		const name = uniqueName(key)
		unionByKey.set(key, { name, signature })
		if (enums === "enum") {
			const memberNames = new Set()
			const members = distinct.map((val) => {
				let member = pascalName(val.replace(/[^a-zA-Z0-9_$]+/g, " ")) || "Value"
				if (/^[0-9]/.test(member)) member = `_${member}`
				let candidate = member
				let n = 2
				while (memberNames.has(candidate)) candidate = `${member}${n++}`
				memberNames.add(candidate)
				return `\t${candidate} = ${JSON.stringify(val)},`
			})
			enumDefs.push(`export enum ${name} {\n${members.join("\n")}\n}`)
		} else enumDefs.push(`export type ${name} = ${distinct.map((v) => JSON.stringify(v)).join(" | ")};`)
		return name
	}

	const typeOfValues = (values, key, nameHint) => {
		const types = []
		const add = (t) => {
			if (!types.includes(t)) types.push(t)
		}
		const strings = values.filter((v) => typeof v === "string")
		const objects = values.filter(isPlainObject)
		const arrays = values.filter(Array.isArray)
		if (strings.length) add(stringUnion(key, strings) ?? "string")
		for (const v of values) {
			if (typeof v === "number" || typeof v === "boolean") add(typeof v)
		}
		if (objects.length) add(defineObject(objects, nameHint))
		if (arrays.length) {
			const items = arrays.flat()
			if (!items.length) add("unknown[]")
			else {
				const inner = typeOfValues(items, key, singular(nameHint))
				add(inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`)
			}
		}
		if (values.some((v) => v === null)) add("null")
		return types.length ? types.join(" | ") : "unknown"
	}

	const defineObject = (samples, nameHint) => {
		const name = uniqueName(nameHint)
		const keys = new Map()
		for (const sample of samples) {
			for (const [key, value] of Object.entries(sample)) {
				if (!keys.has(key)) keys.set(key, [])
				keys.get(key).push(value)
			}
		}
		const lines = []
		const slot = definitions.length
		definitions.push(null)
		for (const [key, values] of keys) {
			const optional = values.length < samples.length ? "?" : ""
			lines.push(`\t${formatKey(key)}${optional}: ${typeOfValues(values, key, key)};`)
		}
		definitions[slot] = declaration === "type" ? `export type ${name} = {\n${lines.join("\n")}\n};` : `export interface ${name} {\n${lines.join("\n")}\n}`
		return name
	}

	const root = pascalName(rootName || "Root")
	if (isPlainObject(data)) defineObject([data], root)
	else {
		usedNames.add(root)
		const slot = definitions.length
		definitions.push(null)
		definitions[slot] = `export type ${root} = ${typeOfValues([data], "", root)};`
	}
	return [...enumDefs, ...definitions].join("\n\n")
}
