import { ToolError, pick, seededRandom } from "../lib/utils.js"

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Kai", "Iris", "Omar", "Lena", "Ravi", "Sofía", "Jürgen", "Aiko", "Chloé", "Mateo", "Priya", "Elif", "Tomás", "Nia", "Hugo", "Yara", "Leo", "Amara", "Finn"]
const LAST = ["Patel", "Kim", "Silva", "Okafor", "Novak", "Haddad", "Rossi", "Nguyen", "Weber", "Sharma", "O'Brien", "García", "Tanaka", "Kowalski", "Andersen", "Mensah", "Dubois", "Ivanova", "Moreau", "Costa"]
const DOMAINS = ["example.com", "test.dev", "mail.local", "acme.io", "example.org"]
const PLACES = [
	["Austin", "Texas", "US", "United States", 30.27, -97.74],
	["Berlin", "Berlin", "DE", "Germany", 52.52, 13.4],
	["Pune", "Maharashtra", "IN", "India", 18.52, 73.86],
	["Lisbon", "Lisboa", "PT", "Portugal", 38.72, -9.14],
	["Toronto", "Ontario", "CA", "Canada", 43.65, -79.38],
	["Osaka", "Osaka", "JP", "Japan", 34.69, 135.5],
	["São Paulo", "São Paulo", "BR", "Brazil", -23.55, -46.63],
	["Tallinn", "Harju", "EE", "Estonia", 59.44, 24.75],
	["Lagos", "Lagos", "NG", "Nigeria", 6.52, 3.38],
	["Sydney", "New South Wales", "AU", "Australia", -33.87, 151.21],
	["London", "England", "GB", "United Kingdom", 51.51, -0.13],
	["Mexico City", "CDMX", "MX", "Mexico", 19.43, -99.13],
]
const STREETS = ["Market Street", "Oak Avenue", "Maple Drive", "Harbor Road", "Station Lane", "Park Boulevard", "Mill Street", "Lakeview Terrace", "King Street", "Elm Court"]
const COMPANY_A = ["Acme", "Globex", "Initech", "Umbrella", "Vertex", "Northwind", "Contoso", "Pinnacle", "Bluefin", "Redstone", "Helix", "Quantum"]
const COMPANY_B = ["Labs", "Systems", "Group", "Holdings", "Dynamics", "Partners", "Industries", "Software", "Analytics", "Logistics"]
const JOBS = ["Software Engineer", "QA Engineer", "Product Designer", "Product Manager", "Data Analyst", "DevOps Engineer", "Marketing Lead", "Support Specialist", "Sales Manager", "Security Analyst"]
const DEPARTMENTS = ["Engineering", "Design", "Marketing", "Sales", "Support", "Finance", "Operations", "Legal", "HR"]
const PRODUCT_ADJ = ["Ergonomic", "Wireless", "Compact", "Premium", "Organic", "Smart", "Vintage", "Portable", "Recycled", "Ultra"]
const PRODUCT_MAT = ["Bamboo", "Steel", "Cotton", "Leather", "Ceramic", "Glass", "Wool", "Aluminium"]
const PRODUCT_NOUN = ["Chair", "Headphones", "Backpack", "Lamp", "Mug", "Keyboard", "Bottle", "Notebook", "Speaker", "Jacket", "Watch", "Desk"]
const CATEGORIES = ["Electronics", "Home", "Outdoors", "Clothing", "Books", "Toys", "Beauty", "Sports", "Garden", "Office"]
const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "black", "white", "gray"]
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "BRL"]
const STATUSES = ["active", "pending", "inactive", "archived"]
const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur".split(" ")
const TEST_CARDS = ["4242424242424242", "4000056655665556", "5555555555554444", "2223003122003222", "378282246310005", "6011111111111117"]

export const MOCK_PRESETS = {
	users: [
		"id: id",
		"firstName: firstName",
		"lastName: lastName",
		"email: email",
		"username: username",
		"phone: phone",
		"age: int(18, 75)",
		"role: enum(admin|editor|viewer)",
		"active: bool(70)",
		"address.street: street",
		"address.city: city",
		"address.country: country",
		"createdAt: datetime(2023-01-01, 2026-01-01)",
	],
	products: [
		"id: id",
		"sku: pattern(SKU-####-??)",
		"name: product",
		"category: category",
		"price: price(5, 500)",
		"currency: currency",
		"stock: int(0, 250)",
		"rating: float(1, 5, 1)",
		"color: color",
		"description: sentence",
		"available: bool(85)",
	],
	orders: [
		"id: uuid",
		"orderNumber: pattern(ORD-######)",
		"customer: fullName",
		"email: email",
		"items: int(1, 8)",
		"total: price(10, 2000)",
		"currency: currency",
		"status: enum(pending|paid|shipped|delivered|refunded)",
		"shipping.city: city",
		"shipping.zip: zip",
		"placedAt: datetime(2025-01-01, 2026-10-01)",
	],
	companies: [
		"id: id",
		"name: company",
		"domain: domain",
		"industry: enum(SaaS|Retail|Fintech|Healthcare|Logistics|Media)",
		"employees: int(5, 5000)",
		"founded: int(1980, 2024)",
		"city: city",
		"country: country",
		"contact: fullName",
		"contactEmail: email",
	],
	employees: [
		"id: id",
		"name: fullName",
		"email: email",
		"jobTitle: jobTitle",
		"department: department",
		"salary: int(35000, 180000)",
		"manager?: fullName",
		"startDate: date(2015-01-01, 2026-06-01)",
		"remote: bool(40)",
	],
	addresses: [
		"id: id",
		"street: street",
		"city: city",
		"state: state",
		"zip: zip",
		"country: country",
		"countryCode: countryCode",
		"lat: latitude",
		"lng: longitude",
	],
	blank: [],
}

export const MOCK_TYPES = [
	"id", "uuid", "firstName", "lastName", "fullName", "email", "username", "password", "phone", "avatar",
	"company", "jobTitle", "department", "street", "city", "state", "zip", "country", "countryCode", "latitude", "longitude",
	"int(min,max)", "float(min,max,decimals)", "price(min,max)", "bool(percentTrue)", "date(from,to)", "datetime(from,to)", "time",
	"enum(a|b|c)", "word", "words(n)", "sentence", "paragraph", "slug", "url", "domain", "ip", "ipv6", "mac",
	"hexColor", "color", "product", "category", "currency", "creditCard", "status",
	"pattern(AB-###-??-**)", "template({firstName} works at {company})", "const(value)", "list(type,n)",
]

function splitArgs(text) {
	const args = []
	let current = ""
	let quote = ""
	let depth = 0
	for (const char of text) {
		if (quote) {
			if (char === quote) quote = ""
			else current += char
		} else if (char === "\"" || char === "'") quote = char
		else if (char === "(") {
			depth += 1
			current += char
		} else if (char === ")") {
			depth -= 1
			current += char
		} else if (char === "," && depth === 0) {
			args.push(current.trim())
			current = ""
		} else current += char
	}
	if (current.trim() || args.length) args.push(current.trim())
	return args
}

function parseSpec(spec, line) {
	const match = String(spec).trim().match(/^([A-Za-z][\w-]*)\s*(?:\(([\s\S]*)\))?$/)
	if (!match) throw new ToolError(`Line ${line}: cannot read type "${spec}"`)
	const name = match[1].toLowerCase()
	if (!GENERATORS[name]) throw new ToolError(`Line ${line}: unknown type "${match[1]}". Known types: ${MOCK_TYPES.join(", ")}`)
	return { name, args: match[2] === undefined ? [] : splitArgs(match[2]), line }
}

export function parseMockSchema(text) {
	const fields = []
	const removed = new Set()
	String(text ?? "").split(/\r?\n/).forEach((raw, index) => {
		const line = raw.trim()
		if (!line || line.startsWith("//")) return
		if (line.startsWith("-")) {
			removed.add(line.slice(1).trim())
			return
		}
		const match = line.match(/^([\w.$-]+)(\?)?\s*:\s*(.+)$/)
		if (!match) throw new ToolError(`Line ${index + 1}: use "field: type", for example "email: email" or "age: int(18, 65)"`)
		const nullable = match[2] ? 0.2 : 0
		fields.push({ key: match[1], nullable, spec: parseSpec(match[3], index + 1) })
	})
	return { fields, removed }
}

function mergeFields(base, extra) {
	const out = base.fields.filter((f) => !extra.removed.has(f.key))
	for (const field of extra.fields) {
		const at = out.findIndex((f) => f.key === field.key)
		if (at >= 0) out[at] = field
		else out.push(field)
	}
	return out
}

function num(value, fallback) {
	const n = Number(value)
	return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback
}

function intBetween(random, min, max) {
	const low = Math.ceil(Math.min(min, max))
	const high = Math.floor(Math.max(min, max))
	return low + Math.floor(random() * (high - low + 1))
}

function timeArg(value, fallback) {
	if (!value) return fallback
	const t = Date.parse(value)
	if (Number.isNaN(t)) throw new ToolError(`"${value}" is not a date; use YYYY-MM-DD`)
	return t
}

function asciiSlug(text) {
	return String(text).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function identity(ctx) {
	const row = ctx.row
	if (!ctx.person) {
		const first = typeof row.firstName === "string" ? row.firstName : pick(ctx.random, FIRST)
		const last = typeof row.lastName === "string" ? row.lastName : pick(ctx.random, LAST)
		ctx.person = { first, last }
	}
	return ctx.person
}

function place(ctx) {
	if (!ctx.place) ctx.place = pick(ctx.random, PLACES)
	return ctx.place
}

function words(random, count) {
	return Array.from({ length: count }, () => pick(random, WORDS)).join(" ")
}

function sentence(random) {
	const text = words(random, intBetween(random, 6, 14))
	return `${text[0].toUpperCase()}${text.slice(1)}.`
}

function hex(random, length) {
	let out = ""
	for (let i = 0; i < length; i += 1) out += Math.floor(random() * 16).toString(16)
	return out
}

function fillPattern(random, pattern) {
	return String(pattern).replace(/[#?*]/g, (char) => {
		if (char === "#") return String(Math.floor(random() * 10))
		if (char === "?") return String.fromCharCode(65 + Math.floor(random() * 26))
		const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
		return pool[Math.floor(random() * pool.length)]
	})
}

function getPath(object, path) {
	return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), object)
}

const GENERATORS = {
	id: (ctx) => ctx.index + 1,
	uuid: ({ random }) => {
		const h = hex(random, 32)
		return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[Math.floor(random() * 4)]}${h.slice(17, 20)}-${h.slice(20)}`
	},
	firstname: (ctx) => identity(ctx).first,
	lastname: (ctx) => identity(ctx).last,
	fullname: (ctx) => `${identity(ctx).first} ${identity(ctx).last}`,
	name: (ctx) => `${identity(ctx).first} ${identity(ctx).last}`,
	email: (ctx, [domain]) => {
		const { first, last } = identity(ctx)
		return `${asciiSlug(first)}.${asciiSlug(last)}${ctx.index + 1}@${domain || pick(ctx.random, DOMAINS)}`
	},
	username: (ctx) => {
		const { first, last } = identity(ctx)
		return `${asciiSlug(first)}_${asciiSlug(last).slice(0, 4)}${intBetween(ctx.random, 1, 999)}`
	},
	password: ({ random }, [length]) => {
		const pool = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*"
		const size = Math.min(Math.max(num(length, 14), 4), 128)
		return Array.from({ length: size }, () => pool[Math.floor(random() * pool.length)]).join("")
	},
	phone: ({ random }, [format]) => fillPattern(random, format || "+1-555-###-####"),
	avatar: (ctx) => `https://i.pravatar.cc/150?u=${encodeURIComponent(asciiSlug(identity(ctx).first) + (ctx.index + 1))}`,
	company: ({ random }) => `${pick(random, COMPANY_A)} ${pick(random, COMPANY_B)}`,
	jobtitle: ({ random }) => pick(random, JOBS),
	department: ({ random }) => pick(random, DEPARTMENTS),
	street: ({ random }) => `${intBetween(random, 1, 9999)} ${pick(random, STREETS)}`,
	city: (ctx) => place(ctx)[0],
	state: (ctx) => place(ctx)[1],
	countrycode: (ctx) => place(ctx)[2],
	country: (ctx) => place(ctx)[3],
	zip: ({ random }) => fillPattern(random, "#####"),
	latitude: (ctx) => Number((place(ctx)[4] + (ctx.random() - 0.5) * 0.2).toFixed(5)),
	longitude: (ctx) => Number((place(ctx)[5] + (ctx.random() - 0.5) * 0.2).toFixed(5)),
	int: ({ random }, [min, max]) => intBetween(random, num(min, 0), num(max, 1000)),
	float: ({ random }, [min, max, decimals]) => {
		const low = num(min, 0)
		const high = num(max, 1)
		return Number((low + random() * (high - low)).toFixed(Math.min(Math.max(num(decimals, 2), 0), 10)))
	},
	price: ({ random }, [min, max]) => {
		const low = num(min, 1)
		const high = num(max, 1000)
		return Number((low + random() * (high - low)).toFixed(2))
	},
	bool: ({ random }, [percent]) => random() * 100 < num(percent, 50),
	boolean: ({ random }, [percent]) => random() * 100 < num(percent, 50),
	date: ({ random }, [from, to]) => {
		const start = timeArg(from, Date.UTC(2020, 0, 1))
		const end = timeArg(to, Date.UTC(2026, 0, 1))
		return new Date(start + random() * (end - start)).toISOString().slice(0, 10)
	},
	datetime: ({ random }, [from, to]) => {
		const start = timeArg(from, Date.UTC(2020, 0, 1))
		const end = timeArg(to, Date.UTC(2026, 0, 1))
		return new Date(Math.floor((start + random() * (end - start)) / 1000) * 1000).toISOString()
	},
	time: ({ random }) => `${String(intBetween(random, 0, 23)).padStart(2, "0")}:${String(intBetween(random, 0, 59)).padStart(2, "0")}`,
	enum: ({ random }, args) => {
		const options = args.length === 1 ? args[0].split("|") : args
		if (!options.length || !options[0]) throw new ToolError("enum needs options, for example enum(small|medium|large)")
		return pick(random, options.map((o) => o.trim()))
	},
	word: ({ random }) => pick(random, WORDS),
	words: ({ random }, [count]) => words(random, Math.min(Math.max(num(count, 3), 1), 200)),
	sentence: ({ random }) => sentence(random),
	paragraph: ({ random }, [count]) => Array.from({ length: Math.min(Math.max(num(count, 4), 1), 20) }, () => sentence(random)).join(" "),
	slug: ({ random }) => words(random, 3).replace(/ /g, "-"),
	domain: ({ random }) => `${asciiSlug(pick(random, COMPANY_A))}${pick(random, ["", "-labs", "hq", "-app"])}.${pick(random, ["com", "io", "dev", "net", "co"])}`,
	url: (ctx) => `https://${GENERATORS.domain(ctx)}/${GENERATORS.slug(ctx)}`,
	ip: ({ random }) => `${intBetween(random, 11, 223)}.${intBetween(random, 0, 255)}.${intBetween(random, 0, 255)}.${intBetween(random, 1, 254)}`,
	ipv6: ({ random }) => Array.from({ length: 8 }, () => hex(random, 4)).join(":"),
	mac: ({ random }) => Array.from({ length: 6 }, () => hex(random, 2)).join(":"),
	hexcolor: ({ random }) => `#${hex(random, 6)}`,
	color: ({ random }) => pick(random, COLORS),
	product: ({ random }) => `${pick(random, PRODUCT_ADJ)} ${pick(random, PRODUCT_MAT)} ${pick(random, PRODUCT_NOUN)}`,
	category: ({ random }) => pick(random, CATEGORIES),
	currency: ({ random }) => pick(random, CURRENCIES),
	creditcard: ({ random }) => pick(random, TEST_CARDS),
	status: ({ random }) => pick(random, STATUSES),
	pattern: ({ random }, [pattern]) => fillPattern(random, pattern ?? "###"),
	template: (ctx, [template]) => String(template ?? "").replace(/\{([\w.$-]+)\}/g, (m, key) => {
		const value = getPath(ctx.row, key)
		return value === undefined || value === null ? "" : String(value)
	}),
	const: (ctx, [value]) => {
		if (value === undefined) return null
		const n = Number(value)
		if (value !== "" && Number.isFinite(n)) return n
		if (value === "true" || value === "false") return value === "true"
		if (value === "null") return null
		return value
	},
	list: (ctx, [spec, count]) => {
		const inner = parseSpec(spec ?? "word", 0)
		const size = Math.min(Math.max(num(count, 3), 0), 50)
		return Array.from({ length: size }, () => GENERATORS[inner.name](ctx, inner.args))
	},
}

function setPath(object, path, value) {
	const keys = path.split(".")
	let target = object
	for (const key of keys.slice(0, -1)) {
		if (!target[key] || typeof target[key] !== "object") target[key] = {}
		target = target[key]
	}
	target[keys[keys.length - 1]] = value
}

export function generateMockRecords({ preset = "users", schema = "", count = 10, seed = "sidekick" } = {}) {
	const base = { fields: (MOCK_PRESETS[preset] ?? MOCK_PRESETS.users).map((line) => parseMockSchema(line).fields[0] ?? null).filter(Boolean), removed: new Set() }
	const fields = mergeFields(base, parseMockSchema(schema))
	if (!fields.length) throw new ToolError("No fields to generate. Add lines like \"name: fullName\" or pick a preset")
	const random = seededRandom(seed)
	const total = Math.min(Math.max(Math.floor(Number(count)) || 10, 1), 5000)
	return Array.from({ length: total }, (_, index) => {
		const row = {}
		const ctx = { random, index, row, person: null, place: null }
		for (const field of fields) {
			const value = field.nullable && random() < field.nullable ? null : GENERATORS[field.spec.name](ctx, field.spec.args)
			setPath(row, field.key, value)
		}
		return row
	})
}

function sqlValue(value) {
	if (value === null || value === undefined) return "NULL"
	if (typeof value === "number") return String(value)
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
	if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`
	return `'${String(value).replace(/'/g, "''")}'`
}

export function recordsToSql(records, flat, table = "mock_data") {
	const name = String(table || "mock_data").replace(/[^\w.]/g, "_")
	const rows = records.map((r) => flat(r))
	const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
	const quoted = columns.map((c) => `"${c.replace(/\./g, "_")}"`).join(", ")
	const chunks = []
	for (let i = 0; i < rows.length; i += 500) {
		const values = rows.slice(i, i + 500).map((r) => `  (${columns.map((c) => sqlValue(r[c])).join(", ")})`).join(",\n")
		chunks.push(`INSERT INTO ${name} (${quoted}) VALUES\n${values};`)
	}
	return chunks.join("\n\n")
}
