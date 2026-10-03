import { ToolError, required, round } from "../lib/utils.js"

const UNIT_FACTORS = { s: 1000, ms: 1, us: 0.001, ns: 0.000001 }
const UNIT_LABELS = { s: "seconds", ms: "milliseconds", us: "microseconds", ns: "nanoseconds" }

// Seconds stop being plausible around 1e11 (year 5138), which is where millisecond values start.
export function detectEpochUnit(number) {
	const abs = Math.abs(number)
	if (abs < 1e11) return "s"
	if (abs < 1e14) return "ms"
	if (abs < 1e17) return "us"
	return "ns"
}

function validDate(date, input) {
	if (Number.isNaN(date.getTime())) throw new ToolError(`Cannot parse date: ${input}`)
	return date
}

export function parseMoment(input, unit = "auto") {
	const raw = String(input ?? "").trim()
	if (!raw || raw.toLowerCase() === "now") return { date: new Date(), unit: "now" }
	if (/^[-+]?\d+(\.\d+)?$/.test(raw)) {
		const n = Number(raw)
		const chosen = unit && unit !== "auto" ? unit : detectEpochUnit(n)
		const factor = UNIT_FACTORS[chosen]
		if (!factor) throw new ToolError(`Unknown unit: ${unit}`)
		return { date: validDate(new Date(Math.round(n * factor)), input), unit: chosen }
	}
	return { date: validDate(new Date(raw), input), unit: "date" }
}

export function parseTimestamp(input, unit = "auto") {
	return parseMoment(input, unit).date
}

const DURATION_UNITS = [
	["d", 86400000],
	["h", 3600000],
	["m", 60000],
	["s", 1000],
	["ms", 1],
]

export function humanizeDuration(ms, maxParts = Infinity) {
	const value = Number(ms) || 0
	let rest = Math.abs(value)
	const parts = []
	for (const [label, size] of DURATION_UNITS) {
		if (parts.length >= maxParts) break
		const amount = Math.floor(rest / size)
		if (amount > 0) {
			parts.push(`${amount}${label}`)
			rest -= amount * size
		}
	}
	if (!parts.length) return "0ms"
	return `${value < 0 ? "-" : ""}${parts.join(" ")}`
}

export function relativeTo(date, now = Date.now()) {
	const delta = now - date.getTime()
	if (Math.abs(delta) < 1000) return "just now"
	return `${humanizeDuration(Math.abs(delta), 2)} ${delta >= 0 ? "ago" : "from now"}`
}

export function isoWeek(date) {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
	const day = d.getUTCDay() || 7
	d.setUTCDate(d.getUTCDate() + 4 - day)
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
	const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

const partsCache = new Map()

function zoneFormatter(zone) {
	let formatter = partsCache.get(zone)
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		})
		partsCache.set(zone, formatter)
	}
	return formatter
}

export function resolveZone(zone) {
	const value = String(zone ?? "").trim()
	if (!value || value.toLowerCase() === "local") return Intl.DateTimeFormat().resolvedOptions().timeZone
	if (/^utc$|^gmt$|^z$/i.test(value)) return "UTC"
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
	} catch {
		throw new ToolError(`Unknown timezone: ${value}`)
	}
}

export function zoneOffsetMinutes(date, zone) {
	const parts = {}
	for (const part of zoneFormatter(zone).formatToParts(date)) parts[part.type] = part.value
	const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
	return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

// The second offset lookup corrects guesses that land on the other side of a DST transition.
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, zone) {
	const guess = Date.UTC(year, month - 1, day, hour, minute, second)
	const first = zoneOffsetMinutes(new Date(guess), zone)
	let instant = guess - first * 60000
	const second2 = zoneOffsetMinutes(new Date(instant), zone)
	if (second2 !== first) instant = guess - second2 * 60000
	return new Date(instant)
}

export function formatOffset(minutes) {
	if (minutes === 0) return "UTC"
	const sign = minutes < 0 ? "-" : "+"
	const abs = Math.abs(minutes)
	const h = Math.floor(abs / 60)
	const m = abs % 60
	return `UTC${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

export function parseMomentInZone(input, sourceZone) {
	const raw = String(input ?? "").trim()
	const wall = raw.match(WALL_CLOCK)
	if (wall && sourceZone) {
		const [, year, month, day, hour = "0", minute = "0", second = "0"] = wall
		const parts = { year: +year, month: +month, day: +day, hour: +hour, minute: +minute, second: +second }
		return zonedTimeToUtc(parts, resolveZone(sourceZone))
	}
	return parseTimestamp(raw)
}

export function formatInZone(date, zone, hour12 = false) {
	const text = new Intl.DateTimeFormat("en-GB", {
		timeZone: zone,
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12,
	}).format(date)
	return `${text} (${formatOffset(zoneOffsetMinutes(date, zone))})`
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const CRON_SPECS = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day of month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12, names: MONTH_NAMES, offset: 1 },
	{ name: "day of week", min: 0, max: 7, names: DAY_NAMES, offset: 0 },
]

export const CRON_MACROS = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
}

function cronNumber(token, spec) {
	const upper = token.toUpperCase()
	if (spec.names) {
		const index = spec.names.indexOf(upper)
		if (index >= 0) return index + spec.offset
	}
	if (!/^\d+$/.test(token)) throw new ToolError(`Invalid value "${token}" in ${spec.name}`)
	const n = Number(token)
	if (n < spec.min || n > spec.max) throw new ToolError(`${spec.name} value ${n} is out of range ${spec.min}-${spec.max}`)
	return n
}

function parseCronPart(part, spec, values) {
	if (/#|^\d*L$|^LW$|^\d+W$/i.test(part)) throw new ToolError(`Quartz-style "${part}" (L, W, #) is not supported in standard cron`)
	const [rangeText, stepText] = part.split("/")
	const step = stepText === undefined ? 1 : Number(stepText)
	if (!Number.isInteger(step) || step <= 0) throw new ToolError(`Invalid step "/${stepText}" in ${spec.name}`)
	let start
	let end
	if (rangeText === "*" || rangeText === "?") {
		start = spec.min
		end = spec.name === "day of week" ? 6 : spec.max
	} else if (rangeText.includes("-")) {
		const [a, b] = rangeText.split("-")
		start = cronNumber(a, spec)
		end = cronNumber(b, spec)
		if (start > end) throw new ToolError(`Range ${rangeText} in ${spec.name} runs backwards`)
	} else {
		start = cronNumber(rangeText, spec)
		end = stepText === undefined ? start : spec.max
	}
	for (let v = start; v <= end; v += step) values.add(spec.name === "day of week" && v === 7 ? 0 : v)
}

function parseCronField(text, spec) {
	const values = new Set()
	for (const part of text.split(",")) {
		if (!part) throw new ToolError(`Empty list item in ${spec.name}`)
		parseCronPart(part, spec, values)
	}
	return { text, star: text.startsWith("*") || text === "?", values: [...values].sort((a, b) => a - b) }
}

export function parseCron(expression) {
	let text = String(expression ?? "").trim()
	const macro = CRON_MACROS[text.toLowerCase()]
	if (text.toLowerCase() === "@reboot") throw new ToolError("@reboot runs once at startup; it has no schedule to compute")
	if (macro) text = macro
	const parts = text.split(/\s+/)
	if (parts.length !== 5) throw new ToolError("Cron expression must have 5 fields: minute hour day-of-month month day-of-week")
	const [minute, hour, dom, month, dow] = parts.map((part, i) => parseCronField(part, CRON_SPECS[i]))
	return { expression: text, macro: macro ? String(expression).trim() : null, minute, hour, dom, month, dow }
}

function getters(utc) {
	return utc
		? { min: (d) => d.getUTCMinutes(), hour: (d) => d.getUTCHours(), day: (d) => d.getUTCDate(), month: (d) => d.getUTCMonth() + 1, dow: (d) => d.getUTCDay(), year: (d) => d.getUTCFullYear() }
		: { min: (d) => d.getMinutes(), hour: (d) => d.getHours(), day: (d) => d.getDate(), month: (d) => d.getMonth() + 1, dow: (d) => d.getDay(), year: (d) => d.getFullYear() }
}

function dayMatches(cron, date, get) {
	const domOk = cron.dom.values.includes(get.day(date))
	const dowOk = cron.dow.values.includes(get.dow(date))
	if (cron.dom.star || cron.dow.star) return domOk && dowOk
	return domOk || dowOk
}

function startOfNextDay(date, utc) {
	if (utc) return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

function startOfNextMonth(date, utc) {
	if (utc) return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
	return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

// Vixie cron: when both day fields are restricted a day matches if EITHER does; a field that starts with a star counts as unrestricted.
export function nextCronRuns(expression, { from = new Date(), count = 5, utc = false } = {}) {
	const cron = typeof expression === "string" ? parseCron(expression) : expression
	const get = getters(utc)
	const runs = []
	let t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000)
	const lastYear = get.year(from) + 8
	for (let guard = 0; guard < 100000 && runs.length < count; guard++) {
		if (get.year(t) > lastYear) break
		if (!cron.month.values.includes(get.month(t))) {
			t = startOfNextMonth(t, utc)
			continue
		}
		if (!dayMatches(cron, t, get)) {
			t = startOfNextDay(t, utc)
			continue
		}
		if (!cron.hour.values.includes(get.hour(t))) {
			t = new Date(t.getTime() + (60 - get.min(t)) * 60000)
			continue
		}
		const minute = get.min(t)
		const nextMinute = cron.minute.values.find((m) => m >= minute)
		if (nextMinute === undefined) {
			t = new Date(t.getTime() + (60 - minute) * 60000)
			continue
		}
		if (nextMinute > minute) {
			t = new Date(t.getTime() + (nextMinute - minute) * 60000)
			continue
		}
		runs.push(new Date(t))
		t = new Date(t.getTime() + 60000)
	}
	return runs
}

function joinList(items) {
	if (items.length <= 1) return items.join("")
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

function describeTokens(field, label) {
	return joinList(
		field.text.split(",").map((part) => {
			const [range, step] = part.split("/")
			const names = range.split("-").map(label)
			const span = range === "*" ? "" : names.join(" through ")
			if (step) return span ? `every ${step}${ordinal(step)} from ${span}` : `every ${step}${ordinal(step)}`
			return span
		}),
	)
}

function ordinal(n) {
	const v = Number(n) % 100
	if (v >= 11 && v <= 13) return "th"
	return { 1: "st", 2: "nd", 3: "rd" }[v % 10] ?? "th"
}

const pad2 = (n) => String(n).padStart(2, "0")

function simpleList(field) {
	return !field.star && /^[\d,]+$/.test(field.text)
}

function nameOf(spec, token) {
	const n = cronNumber(token, spec)
	if (spec.name === "month") return MONTH_LONG[n - 1]
	if (spec.name === "day of week") return DAY_LONG[n % 7]
	return String(n)
}

function describeTime(cron) {
	const { minute, hour } = cron
	if (simpleList(minute) && simpleList(hour) && minute.values.length * hour.values.length <= 6) {
		const times = hour.values.flatMap((h) => minute.values.map((m) => `${pad2(h)}:${pad2(m)}`))
		return `At ${joinList(times)}`
	}
	let text
	if (minute.text === "*") text = "Every minute"
	else if (/^\*\/\d+$/.test(minute.text)) text = `Every ${minute.text.slice(2)} minutes`
	else text = `At minute ${describeTokens(minute, (t) => t)}`
	if (hour.text === "*") return text
	if (/^\*\/\d+$/.test(hour.text)) return `${text}, every ${hour.text.slice(2)} hours`
	if (/^\d+-\d+$/.test(hour.text)) return `${text}, between ${pad2(hour.values[0])}:00 and ${pad2(hour.values.at(-1))}:59`
	return `${text}, during hour ${describeTokens(hour, (t) => t)}`
}

export function describeCron(expression) {
	const cron = typeof expression === "string" ? parseCron(expression) : expression
	const parts = [describeTime(cron)]
	const domText = cron.dom.text === "*" ? "" : `on day-of-month ${describeTokens(cron.dom, (t) => t)}`
	const dowText = cron.dow.text === "*" || cron.dow.text === "?" ? "" : `on ${describeTokens(cron.dow, (t) => nameOf(CRON_SPECS[4], t))}`
	if (domText && dowText) parts.push(cron.dom.star || cron.dow.star ? `${domText} and ${dowText}` : `${domText} or ${dowText}`)
	else if (domText || dowText) parts.push(domText || dowText)
	if (cron.month.text !== "*") parts.push(`in ${describeTokens(cron.month, (t) => nameOf(CRON_SPECS[3], t))}`)
	return parts.join(", ")
}

function cronReport({ expression, count = 5, timezone = "local" }) {
	const cron = parseCron(required(expression, "Cron"))
	const utc = timezone === "utc"
	const description = describeCron(cron)
	const runs = nextCronRuns(cron, { count: Math.min(Math.max(Number(count) || 5, 1), 50), utc })
	const zoneLabel = utc ? "UTC" : `Local (${resolveZone("local")})`
	const format = (date) => (utc ? date.toISOString().replace(".000Z", "Z") : formatInZone(date, resolveZone("local")))
	const notes = []
	if (cron.macro) notes.push({ label: "Macro", detail: `${cron.macro} = ${cron.expression}`, tone: "info" })
	if (!cron.dom.star && !cron.dow.star && cron.dom.text !== "?" && cron.dow.text !== "?") {
		notes.push({ label: "Day matching uses OR", detail: "Both day-of-month and day-of-week are restricted, so cron runs when EITHER matches.", tone: "warn" })
	}
	if (!runs.length) notes.push({ label: "Never runs", detail: "No matching time in the next 8 years (e.g. 30 February).", tone: "bad" })
	const fieldItems = CRON_SPECS.map((spec, i) => {
		const field = [cron.minute, cron.hour, cron.dom, cron.month, cron.dow][i]
		return { label: `${spec.name}: ${field.text}`, detail: field.star && !field.text.includes("/") ? "any" : field.values.join(", "), tone: "info" }
	})
	return {
		type: "report",
		value: {
			summary: [
				{ label: "Schedule", value: description, tone: runs.length ? "good" : "bad" },
				{ label: "Timezone", value: zoneLabel, tone: "info" },
				{ label: "Next run", value: runs[0] ? format(runs[0]) : "never", tone: runs.length ? "info" : "bad" },
			],
			sections: [
				{ title: `Next ${runs.length} run${runs.length === 1 ? "" : "s"}`, items: runs.map((run) => ({ label: format(run), detail: relativeTo(run), tone: "info" })) },
				{ title: "Fields", items: fieldItems },
				...(notes.length ? [{ title: "Notes", items: notes }] : []),
			],
		},
		copy: [`${cron.expression} — ${description}`, ...runs.map(format)].join("\n"),
	}
}

const DURATION_TOKEN_MS = { w: 604800000, d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 }

export function parseDuration(input) {
	const text = String(input ?? "").trim()
	if (!text) throw new ToolError("Duration is required")
	const iso = text.match(/^([-+])?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
	if (iso && text.length > 1) {
		const sign = iso[1] === "-" ? -1 : 1
		const n = (i) => Number(iso[i] ?? 0)
		return { years: sign * n(2) || 0, months: sign * n(3) || 0, ms: sign * (n(4) * 604800000 + n(5) * 86400000 + n(6) * 3600000 + n(7) * 60000 + n(8) * 1000) }
	}
	const sign = text.startsWith("-") ? -1 : 1
	const body = text.replace(/^[-+]/, "")
	const tokens = [...body.matchAll(/(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s|milliseconds?|ms)(?![a-z])/gi)]
	const words = body.match(/\d+(?:\.\d+)?\s*[a-z]+/gi) ?? []
	const leftover = body.replace(/\d+(?:\.\d+)?\s*[a-z]+/gi, "").replace(/[\s,]|and/gi, "")
	if (!tokens.length || tokens.length !== words.length || leftover !== "") {
		throw new ToolError(`Cannot parse duration "${text}" — try "1d 2h 30m" or ISO 8601 like "P1DT2H"`)
	}
	const out = { years: 0, months: 0, ms: 0 }
	for (const [, amount, rawUnit] of tokens) {
		const unit = rawUnit.toLowerCase()
		const n = Number(amount)
		if (/^(y|yrs?|years?)$/.test(unit)) out.years += n
		else if (/^(mo|months?)$/.test(unit)) out.months += n
		else if (/^(w|weeks?)$/.test(unit)) out.ms += n * DURATION_TOKEN_MS.w
		else if (/^(d|days?)$/.test(unit)) out.ms += n * DURATION_TOKEN_MS.d
		else if (/^(h|hrs?|hours?)$/.test(unit)) out.ms += n * DURATION_TOKEN_MS.h
		else if (/^(ms|milliseconds?)$/.test(unit)) out.ms += n
		else if (/^(m|mins?|minutes?)$/.test(unit)) out.ms += n * DURATION_TOKEN_MS.m
		else out.ms += n * DURATION_TOKEN_MS.s
	}
	return { years: sign * out.years || 0, months: sign * out.months || 0, ms: sign * out.ms || 0 }
}

export function addDuration(date, { years = 0, months = 0, ms = 0 }) {
	const d = new Date(date.getTime())
	const totalMonths = Math.trunc(years * 12 + months)
	if (totalMonths) {
		const day = d.getUTCDate()
		d.setUTCDate(1)
		d.setUTCMonth(d.getUTCMonth() + totalMonths)
		const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
		d.setUTCDate(Math.min(day, lastDay))
	}
	return new Date(d.getTime() + ms)
}

// Counts weekdays from the start day up to but not including the end day, using UTC calendar days.
export function businessDaysBetween(start, end) {
	const sign = end >= start ? 1 : -1
	const [a, b] = sign > 0 ? [start, end] : [end, start]
	const dayA = Math.floor(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) / 86400000)
	const dayB = Math.floor(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) / 86400000)
	const total = dayB - dayA
	const weeks = Math.floor(total / 7)
	let count = weeks * 5
	for (let d = dayA + weeks * 7; d < dayB; d++) {
		const weekday = (d + 4) % 7
		if (weekday !== 0 && weekday !== 6) count++
	}
	return sign * count
}

export function calendarDiff(start, end) {
	const sign = end >= start ? 1 : -1
	const [a, b] = sign > 0 ? [start, end] : [end, start]
	let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
	if (addDuration(a, { months }) > b) months--
	const anchor = addDuration(a, { months })
	let rest = b.getTime() - anchor.getTime()
	const take = (size) => {
		const amount = Math.floor(rest / size)
		rest -= amount * size
		return amount
	}
	return { sign, years: Math.floor(months / 12), months: months % 12, days: take(86400000), hours: take(3600000), minutes: take(60000), seconds: take(1000), ms: rest }
}

export function toIsoDuration(diff) {
	const date = `${diff.years ? `${diff.years}Y` : ""}${diff.months ? `${diff.months}M` : ""}${diff.days ? `${diff.days}D` : ""}`
	const secs = diff.seconds + diff.ms / 1000
	const time = `${diff.hours ? `${diff.hours}H` : ""}${diff.minutes ? `${diff.minutes}M` : ""}${secs ? `${round(secs, 3)}S` : ""}`
	const body = `${date}${time ? `T${time}` : ""}` || "T0S"
	return `${diff.sign < 0 ? "-" : ""}P${body}`
}

function startOfToday() {
	const now = new Date()
	return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function durationRun({ mode = "between", start, end, amount }) {
	const from = start ? parseTimestamp(start) : startOfToday()
	if (mode === "add") {
		const parsed = parseDuration(amount || "1d")
		const result = addDuration(from, parsed)
		return {
			type: "json",
			value: { start: from.toISOString(), add: String(amount || "1d"), result: result.toISOString(), resultLocal: result.toString(), resultEpochSeconds: Math.floor(result.getTime() / 1000), relative: relativeTo(result) },
			copy: result.toISOString(),
		}
	}
	const to = end ? parseTimestamp(end) : new Date()
	const ms = to.getTime() - from.getTime()
	const diff = calendarDiff(from, to)
	return {
		type: "json",
		value: {
			start: from.toISOString(),
			end: to.toISOString(),
			milliseconds: ms,
			human: humanizeDuration(ms),
			calendar: `${diff.sign < 0 ? "-" : ""}${diff.years}y ${diff.months}mo ${diff.days}d ${diff.hours}h ${diff.minutes}m ${diff.seconds}s`,
			iso8601: toIsoDuration(diff),
			seconds: round(ms / 1000, 3),
			minutes: round(ms / 60000, 3),
			hours: round(ms / 3600000, 3),
			days: round(ms / 86400000, 3),
			weeks: round(ms / 604800000, 3),
			businessDays: businessDaysBetween(from, to),
		},
		copy: humanizeDuration(ms),
	}
}

export const timeTools = [
	{
		id: "timestamp",
		name: "Timestamp converter",
		category: "Time",
		roles: ["dev", "qa", "it"],
		description: "Epoch ↔ ISO ↔ local time with relative age. Auto-detects seconds, milliseconds, microseconds and nanoseconds.",
		keywords: ["epoch", "unix time", "unix timestamp", "iso 8601", "date", "milliseconds", "seconds", "utc", "now", "iso week"],
		inputs: [
			{ key: "value", label: "Timestamp or date", type: "text", placeholder: "1735689600, 1735689600000 or 2025-01-01T00:00:00Z", help: "Leave empty (or type now) for the current time." },
			{
				key: "unit",
				label: "Epoch unit",
				type: "select",
				options: [
					{ value: "auto", label: "Auto-detect by size" },
					{ value: "s", label: "Seconds" },
					{ value: "ms", label: "Milliseconds" },
					{ value: "us", label: "Microseconds" },
					{ value: "ns", label: "Nanoseconds" },
				],
				default: "auto",
			},
		],
		run: ({ value, unit = "auto" }) => {
			const { date, unit: detected } = parseMoment(value, unit)
			const ms = date.getTime()
			return {
				type: "json",
				value: {
					iso: date.toISOString(),
					epochSeconds: Math.floor(ms / 1000),
					epochMillis: ms,
					utc: date.toUTCString(),
					local: date.toString(),
					relative: relativeTo(date),
					detectedUnit: UNIT_LABELS[detected] ?? detected,
					weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(date),
					isoWeek: isoWeek(date),
					epochMicros: `${ms}000`,
				},
				copy: date.toISOString(),
			}
		},
	},
	{
		id: "timezone",
		name: "Timezone comparer",
		category: "Time",
		roles: ["it", "qa", "dev"],
		description: "Show one moment across IANA time zones with DST-correct UTC offsets — for release windows and standups.",
		keywords: ["time zone", "tz", "iana", "utc offset", "dst", "world clock", "meeting planner", "convert time"],
		inputs: [
			{ key: "value", label: "Moment", type: "text", placeholder: "2026-01-01 09:00 or 2026-01-01T09:00:00Z", help: "Empty = now. A date/time without an offset is read in the source zone." },
			{ key: "source", label: "Source zone", type: "text", default: "local", placeholder: "local, UTC, America/New_York" },
			{ key: "zones", label: "Timezones (comma separated)", type: "text", default: "UTC,Asia/Kolkata,America/New_York,Europe/London" },
			{ key: "hour12", label: "12-hour clock", type: "checkbox", default: false },
		],
		run: ({ value, source = "local", zones = "UTC", hour12 = false }) => {
			const date = value ? parseMomentInZone(value, source || "local") : new Date()
			const list = String(zones || "UTC").split(",").map((z) => z.trim()).filter(Boolean)
			const out = {}
			for (const zone of list) {
				try {
					out[zone] = formatInZone(date, resolveZone(zone), Boolean(hour12))
				} catch {
					out[zone] = "Unknown timezone"
				}
			}
			return { type: "json", value: out, copy: Object.entries(out).map(([zone, time]) => `${zone}: ${time}`).join("\n") }
		},
	},
	{
		id: "cron",
		name: "Cron explainer",
		category: "Time",
		roles: ["dev", "it"],
		description: "Plain-English reading of a 5-field cron schedule plus its next run times.",
		keywords: ["crontab", "schedule", "next run", "cron expression", "@daily", "job", "scheduler"],
		inputs: [
			{ key: "expression", label: "Cron", type: "text", default: "*/15 9-17 * * 1-5", help: "minute hour day-of-month month day-of-week. Supports lists, ranges, steps, JAN–DEC, SUN–SAT and @daily-style macros." },
			{ key: "count", label: "Next runs to show", type: "number", default: 5, min: 1, max: 50 },
			{ key: "timezone", label: "Evaluate in", type: "select", options: [{ value: "local", label: "Local time" }, { value: "utc", label: "UTC" }], default: "local" },
		],
		run: cronReport,
	},
	{
		id: "duration",
		name: "Duration & SLA calculator",
		category: "Time",
		roles: ["qa", "it"],
		description: "Difference between two moments (calendar, ISO 8601, business days), or add a duration to a date.",
		keywords: ["time difference", "date diff", "sla", "business days", "working days", "add days", "iso 8601 duration", "elapsed"],
		inputs: [
			{ key: "mode", label: "Mode", type: "select", options: [{ value: "between", label: "Time between two moments" }, { value: "add", label: "Add a duration to a moment" }], default: "between" },
			{ key: "start", label: "Start", type: "text", placeholder: "2026-01-01T09:00:00Z or epoch", help: "Empty = start of today." },
			{ key: "end", label: "End", type: "text", placeholder: "Empty = now", showIf: { key: "mode", in: ["between"] } },
			{ key: "amount", label: "Duration to add", type: "text", default: "3d 4h", placeholder: "1w 2d 3h, -90m, 1mo or P1DT2H", showIf: { key: "mode", in: ["add"] } },
		],
		run: durationRun,
	},
]
