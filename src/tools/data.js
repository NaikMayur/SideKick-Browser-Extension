import { ToolError, pick, required, safeJsonParse, seededRandom } from "../lib/utils.js"

export function parseCsv(text, delimiter = ",") {
	const rows = []
	let row = []
	let field = ""
	let inQuotes = false
	const input = String(text).replace(/\r\n/g, "\n")
	for (let i = 0; i < input.length; i += 1) {
		const char = input[i]
		if (inQuotes) {
			if (char === '"') {
				if (input[i + 1] === '"') {
					field += '"'
					i += 1
				} else inQuotes = false
			} else field += char
			continue
		}
		if (char === '"') inQuotes = true
		else if (char === delimiter) {
			row.push(field)
			field = ""
		} else if (char === "\n") {
			row.push(field)
			rows.push(row)
			row = []
			field = ""
		} else field += char
	}
	if (inQuotes) throw new ToolError("Unterminated quoted field in CSV")
	row.push(field)
	rows.push(row)
	return rows.filter((r) => r.length > 1 || r[0] !== "")
}

export function csvToJson(text, delimiter = ",") {
	const rows = parseCsv(text, delimiter)
	if (!rows.length) return []
	const [header, ...body] = rows
	return body.map((cells) =>
		Object.fromEntries(header.map((key, index) => [key.trim() || `column_${index + 1}`, cells[index] ?? ""])),
	)
}

export function jsonToCsv(value, delimiter = ",") {
	const list = Array.isArray(value) ? value : [value]
	if (!list.length) return ""
	const keys = [...new Set(list.flatMap((item) => Object.keys(item ?? {})))]
	const escape = (cell) => {
		const text = cell === null || cell === undefined ? "" : typeof cell === "object" ? JSON.stringify(cell) : String(cell)
		return /["\n\r]|,/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text
	}
	return [keys.join(delimiter), ...list.map((item) => keys.map((key) => escape(item?.[key])).join(delimiter))].join("\n")
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
		if (key in params) params[key] = [].concat(params[key], val)
		else params[key] = val
	}
	return params
}

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Kai", "Iris", "Omar", "Lena", "Ravi"]
const LAST = ["Patel", "Kim", "Silva", "Okafor", "Novak", "Haddad", "Rossi", "Nguyen", "Weber", "Sharma"]
const DOMAINS = ["example.com", "test.dev", "mail.local", "acme.io"]
const CITIES = ["Pune", "Berlin", "Austin", "Lisbon", "Toronto", "Osaka"]

export function mockRecords({ count = 10, seed = "devkit" } = {}) {
	const random = seededRandom(seed)
	const total = Math.min(Math.max(Number(count) || 10, 1), 500)
	return Array.from({ length: total }, (_, index) => {
		const first = pick(random, FIRST)
		const last = pick(random, LAST)
		return {
			id: index + 1,
			name: `${first} ${last}`,
			email: `${first.toLowerCase()}.${last.toLowerCase()}@${pick(random, DOMAINS)}`,
			phone: `+1-555-${String(Math.floor(random() * 9000) + 1000)}`,
			city: pick(random, CITIES),
			age: 18 + Math.floor(random() * 50),
			active: random() > 0.35,
			createdAt: new Date(Date.UTC(2024, Math.floor(random() * 12), 1 + Math.floor(random() * 28))).toISOString(),
		}
	})
}

export function buildCurl({ method = "GET", url, headers = "", body = "" }) {
	const target = required(url, "URL")
	const lines = [`curl -X ${String(method).toUpperCase()} '${target}'`]
	for (const line of String(headers).split("\n").map((l) => l.trim()).filter(Boolean)) {
		lines.push(`  -H '${line}'`)
	}
	if (String(body).trim()) lines.push(`  -d '${String(body).replace(/'/g, "'\\''")}'`)
	return lines.join(" \\\n")
}

export const dataTools = [
	{
		id: "csv-json",
		name: "CSV ↔ JSON converter",
		category: "Text & data",
		roles: ["dev", "qa", "it"],
		description: "Quote-aware conversion in both directions for fixtures and bug attachments.",
		inputs: [
			{ key: "text", label: "Input", type: "textarea" },
			{ key: "mode", label: "Direction", type: "select", options: ["csv-to-json", "json-to-csv"], default: "csv-to-json" },
			{ key: "delimiter", label: "Delimiter", type: "text", default: "," },
		],
		run: ({ text, mode = "csv-to-json", delimiter = "," }) => {
			const value = required(text, "Input")
			const sep = delimiter || ","
			if (mode === "json-to-csv") return { type: "text", value: jsonToCsv(safeJsonParse(value), sep) }
			return { type: "json", value: csvToJson(value, sep) }
		},
	},
	{
		id: "query-string",
		name: "URL & query inspector",
		category: "Text & data",
		roles: ["dev", "qa"],
		description: "Break a URL into protocol, host, path, params and hash — great for tracking-link QA.",
		inputs: [{ key: "url", label: "URL", type: "textarea", placeholder: "https://site.com/a?b=1&utm_source=x" }],
		run: ({ url }) => {
			const value = required(url, "URL").trim()
			let parsed = null
			try {
				parsed = new URL(value)
			} catch {
				return { type: "json", value: { params: parseQueryString(value), note: "Not an absolute URL" } }
			}
			return {
				type: "json",
				value: {
					protocol: parsed.protocol,
					host: parsed.host,
					pathname: parsed.pathname,
					hash: parsed.hash,
					params: parseQueryString(parsed.search),
				},
			}
		},
	},
	{
		id: "mock-data",
		name: "Mock data generator",
		category: "Testing",
		roles: ["qa", "dev"],
		description: "Deterministic, seedable fake users as JSON or CSV so test runs stay reproducible.",
		inputs: [
			{ key: "count", label: "Rows", type: "number", default: 10 },
			{ key: "seed", label: "Seed", type: "text", default: "devkit" },
			{ key: "format", label: "Format", type: "select", options: ["json", "csv"], default: "json" },
		],
		run: ({ count = 10, seed = "devkit", format = "json" }) => {
			const records = mockRecords({ count, seed })
			if (format === "csv") return { type: "text", value: jsonToCsv(records) }
			return { type: "json", value: records }
		},
	},
	{
		id: "curl-builder",
		name: "cURL / fetch builder",
		category: "API",
		roles: ["dev", "qa"],
		description: "Turn a request definition into a copy-pasteable cURL command and fetch() snippet.",
		inputs: [
			{ key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
			{ key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/v1/users" },
			{ key: "headers", label: "Headers (one per line)", type: "textarea", placeholder: "Content-Type: application/json" },
			{ key: "body", label: "Body", type: "textarea" },
		],
		run: (values) => {
			const curl = buildCurl(values)
			const headerObject = Object.fromEntries(
				String(values.headers ?? "")
					.split("\n")
					.map((line) => line.split(/:(.*)/s))
					.filter((parts) => parts.length > 1 && parts[0].trim())
					.map(([key, val]) => [key.trim(), val.trim()]),
			)
			const fetchSnippet = `await fetch(${JSON.stringify(values.url ?? "")}, ${JSON.stringify(
				{
					method: String(values.method ?? "GET").toUpperCase(),
					headers: headerObject,
					...(String(values.body ?? "").trim() ? { body: String(values.body) } : {}),
				},
				null,
				2,
			)})`
			return { type: "text", value: `${curl}\n\n${fetchSnippet}` }
		},
	},
	{
		id: "json-to-ts",
		name: "JSON to TypeScript",
		category: "Text & data",
		roles: ["dev"],
		description: "Generate clean TypeScript interfaces, type aliases, and enums or unions from JSON.",
		inputs: [
			{ key: "json", label: "JSON input", type: "textarea", default: '{\n  "id": 1,\n  "name": "Alex"\n}', placeholder: '{\n  "id": 1,\n  "name": "Alex"\n}' },
			{ key: "rootName", label: "Root interface name", type: "text", default: "Root" },
			{ key: "declaration", label: "Declaration style", type: "select", options: ["interface", "type"], default: "interface" },
			{ key: "enums", label: "Enum detection", type: "select", options: ["unions", "enum", "none"], default: "unions" },
		],
		run: (values) => {
			const jsonVal = values.json ?? values.text
			const value = required(jsonVal, "JSON input")
			const code = jsonToTypeScript(value, {
				rootName: values.rootName ?? "Root",
				declaration: values.declaration ?? "interface",
				enums: values.enums ?? "unions",
			})
			return { type: "text", value: code }
		},
	},
]

export function jsonToTypeScript(input, { rootName = "Root", declaration = "interface", enums = "unions" } = {}) {
	if (!input || !String(input).trim()) {
		throw new ToolError("JSON input is required")
	}
	let data
	try {
		data = typeof input === "string" ? JSON.parse(input) : input
	} catch (e) {
		throw new ToolError(`Invalid JSON: ${e.message}`)
	}

	const definitions = []
	const enumDefs = []
	const usedNames = new Set()

	function sanitizeName(name) {
		const clean = name
			.replace(/[^a-zA-Z0-9_$]/g, " ")
			.trim()
			.split(/\s+/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join("")
		let candidate = clean || "Type"
		if (/^[0-9]/.test(candidate)) candidate = `T${candidate}`
		let unique = candidate
		let counter = 1
		while (usedNames.has(unique)) {
			unique = `${candidate}${counter++}`
		}
		usedNames.add(unique)
		return unique
	}

	function formatKey(key) {
		return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
	}

	const stringFrequencies = new Map()
	function collectStringStats(obj) {
		if (Array.isArray(obj)) {
			for (const item of obj) collectStringStats(item)
		} else if (obj && typeof obj === "object") {
			for (const [k, v] of Object.entries(obj)) {
				if (typeof v === "string") {
					if (!stringFrequencies.has(k)) stringFrequencies.set(k, new Set())
					stringFrequencies.get(k).add(v)
				} else if (typeof v === "object") {
					collectStringStats(v)
				}
			}
		}
	}
	collectStringStats(data)

	const enumTypes = new Map()
	if (enums !== "none") {
		for (const [k, vals] of stringFrequencies.entries()) {
			if (vals.size >= 2 && vals.size <= 12) {
				const enumName = sanitizeName(k)
				if (enums === "enum") {
					const members = [...vals]
						.map((val) => {
							const memberKey = val.replace(/[^a-zA-Z0-9_$]/g, "_") || "Value"
							const memberPascal = memberKey.charAt(0).toUpperCase() + memberKey.slice(1)
							return `\t${memberPascal} = ${JSON.stringify(val)},`
						})
						.join("\n")
					enumDefs.push(`export enum ${enumName} {\n${members}\n}`)
				} else {
					const unionStr = [...vals].map((v) => JSON.stringify(v)).join(" | ")
					enumDefs.push(`export type ${enumName} = ${unionStr};`)
				}
				enumTypes.set(k, enumName)
			}
		}
	}

	function resolveType(val, parentKey = "") {
		if (val === null) return "null"
		if (val === undefined) return "unknown"
		const t = typeof val
		if (t === "boolean" || t === "number") return t
		if (t === "string") {
			if (enumTypes.has(parentKey)) return enumTypes.get(parentKey)
			return "string"
		}
		if (Array.isArray(val)) {
			if (!val.length) return "any[]"
			const elementTypes = new Set()
			const objectItems = []
			for (const item of val) {
				if (item !== null && typeof item === "object" && !Array.isArray(item)) {
					objectItems.push(item)
				} else {
					elementTypes.add(resolveType(item, parentKey))
				}
			}
			if (objectItems.length) {
				const itemTypeName = sanitizeName(`${parentKey}Item` || "Item")
				generateObjectDefinition(objectItems, itemTypeName)
				elementTypes.add(itemTypeName)
			}
			const joined = [...elementTypes].join(" | ")
			return elementTypes.size > 1 ? `(${joined})[]` : `${joined}[]`
		}
		if (typeof val === "object") {
			const nestedName = sanitizeName(parentKey || "Nested")
			generateObjectDefinition([val], nestedName)
			return nestedName
		}
		return "unknown"
	}

	function generateObjectDefinition(sampleObjects, typeName) {
		const keyMap = new Map()
		const total = sampleObjects.length

		for (const obj of sampleObjects) {
			for (const [k, v] of Object.entries(obj)) {
				if (!keyMap.has(k)) {
					keyMap.set(k, { types: new Set(), count: 0 })
				}
				const entry = keyMap.get(k)
				entry.count++
				entry.types.add(resolveType(v, k))
			}
		}

		const lines = []
		for (const [key, { types, count }] of keyMap.entries()) {
			const optional = count < total ? "?" : ""
			const typeStr = types.size > 0 ? [...types].join(" | ") : "any"
			lines.push(`\t${formatKey(key)}${optional}: ${typeStr};`)
		}

		if (declaration === "type") {
			definitions.push(`export type ${typeName} = {\n${lines.join("\n")}\n};`)
		} else {
			definitions.push(`export interface ${typeName} {\n${lines.join("\n")}\n}`)
		}
	}

	const cleanRootName = sanitizeName(rootName || "Root")
	if (Array.isArray(data)) {
		if (data.length && typeof data[0] === "object" && data[0] !== null) {
			const itemTypeName = sanitizeName(`${cleanRootName}Item`)
			generateObjectDefinition(data, itemTypeName)
			definitions.unshift(`export type ${cleanRootName} = ${itemTypeName}[];`)
		} else {
			const elemType = data.length ? resolveType(data[0], cleanRootName) : "any"
			definitions.unshift(`export type ${cleanRootName} = ${elemType}[];`)
		}
	} else if (typeof data === "object" && data !== null) {
		generateObjectDefinition([data], cleanRootName)
	} else {
		definitions.unshift(`export type ${cleanRootName} = ${data === null ? "null" : typeof data};`)
	}

	const all = [...enumDefs, ...definitions]
	return all.join("\n\n")
}
