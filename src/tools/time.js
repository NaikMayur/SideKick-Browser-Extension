import { ToolError, required, round } from "../lib/utils.js"

export function parseTimestamp(input) {
	const raw = String(input).trim()
	if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000)
	if (/^\d{13}$/.test(raw)) return new Date(Number(raw))
	if (/^-?\d+$/.test(raw)) {
		const n = Number(raw)
		return new Date(Math.abs(n) < 1e11 ? n * 1000 : n)
	}
	const parsed = new Date(raw)
	if (Number.isNaN(parsed.getTime())) throw new ToolError(`Cannot parse date: ${input}`)
	return parsed
}

export function humanizeDuration(ms) {
	const total = Math.abs(Number(ms) || 0)
	const units = [
		["d", 86400000],
		["h", 3600000],
		["m", 60000],
		["s", 1000],
		["ms", 1],
	]
	let rest = total
	const parts = []
	for (const [label, size] of units) {
		const amount = Math.floor(rest / size)
		if (amount > 0) {
			parts.push(`${amount}${label}`)
			rest -= amount * size
		}
	}
	return parts.length ? parts.join(" ") : "0ms"
}

const CRON_FIELDS = ["minute", "hour", "day of month", "month", "day of week"]

export function describeCron(expression) {
	const parts = String(expression).trim().split(/\s+/)
	if (parts.length !== 5) throw new ToolError("Cron expression must have 5 fields: m h dom mon dow")
	const describeField = (value, index) => {
		if (value === "*") return `every ${CRON_FIELDS[index]}`
		if (/^\*\/(\d+)$/.test(value)) {
			const step = Number(value.split("/")[1])
			if (step <= 0) throw new ToolError(`Invalid cron step "${value}" (${CRON_FIELDS[index]})`)
			return `every ${step} ${CRON_FIELDS[index]}(s)`
		}
		if (/^[\d,\-/]+$/.test(value)) return `${CRON_FIELDS[index]} ${value}`
		throw new ToolError(`Unsupported cron field "${value}" (${CRON_FIELDS[index]})`)
	}
	return parts.map(describeField).join(", ")
}

export const timeTools = [
	{
		id: "timestamp",
		name: "Timestamp converter",
		category: "Time",
		roles: ["dev", "qa", "it"],
		description: "Epoch ↔ ISO ↔ local time, plus relative age. Reads seconds or milliseconds.",
		inputs: [{ key: "value", label: "Timestamp or date", type: "text", placeholder: "1735689600 or 2025-01-01T00:00:00Z" }],
		run: ({ value }) => {
			const date = parseTimestamp(required(value, "Timestamp"))
			const delta = Date.now() - date.getTime()
			return {
				type: "json",
				value: {
					iso: date.toISOString(),
					epochSeconds: Math.floor(date.getTime() / 1000),
					epochMillis: date.getTime(),
					utc: date.toUTCString(),
					local: date.toString(),
					relative: `${humanizeDuration(delta)} ${delta >= 0 ? "ago" : "from now"}`,
				},
			}
		},
	},
	{
		id: "timezone",
		name: "Timezone comparer",
		category: "Time",
		roles: ["it", "qa", "dev"],
		description: "Show one moment across several IANA timezones — useful for release windows and standups.",
		inputs: [
			{ key: "value", label: "Moment", type: "text", placeholder: "2026-01-01T09:00:00Z" },
			{ key: "zones", label: "Timezones (comma separated)", type: "text", default: "UTC,Asia/Kolkata,America/New_York,Europe/London" },
		],
		run: ({ value, zones = "UTC" }) => {
			const date = value ? parseTimestamp(value) : new Date()
			const list = String(zones).split(",").map((z) => z.trim()).filter(Boolean)
			const out = {}
			for (const zone of list) {
				try {
					out[zone] = new Intl.DateTimeFormat("en-GB", {
						timeZone: zone,
						dateStyle: "medium",
						timeStyle: "short",
					}).format(date)
				} catch {
					out[zone] = "Unknown timezone"
				}
			}
			return { type: "json", value: out }
		},
	},
	{
		id: "cron",
		name: "Cron explainer",
		category: "Time",
		roles: ["dev", "it"],
		description: "Plain-English reading of a 5-field cron schedule before you ship it.",
		inputs: [{ key: "expression", label: "Cron", type: "text", default: "*/15 9-17 * * 1-5" }],
		run: ({ expression }) => ({ type: "text", value: describeCron(required(expression, "Cron")) }),
	},
	{
		id: "duration",
		name: "Duration & SLA calculator",
		category: "Time",
		roles: ["qa", "it"],
		description: "Difference between two moments in human units plus raw milliseconds.",
		inputs: [
			{ key: "start", label: "Start", type: "text" },
			{ key: "end", label: "End", type: "text" },
		],
		run: ({ start, end }) => {
			const from = parseTimestamp(required(start, "Start"))
			const to = parseTimestamp(required(end, "End"))
			const ms = to.getTime() - from.getTime()
			return {
				type: "json",
				value: { milliseconds: ms, human: humanizeDuration(ms), hours: round(ms / 3600000, 3), days: round(ms / 86400000, 3) },
			}
		},
	},
]
