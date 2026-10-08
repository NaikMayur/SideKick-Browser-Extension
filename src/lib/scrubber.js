export function shannonEntropy(text) {
	const value = String(text)
	if (!value) return 0
	const counts = new Map()
	for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
	let entropy = 0
	for (const count of counts.values()) {
		const p = count / value.length
		entropy -= p * Math.log2(p)
	}
	return entropy
}

export function luhnValid(digits) {
	const value = String(digits).replace(/\D/g, "")
	if (value.length < 12 || value.length > 19 || /^(\d)\1+$/.test(value)) return false
	let sum = 0
	let double = false
	for (let i = value.length - 1; i >= 0; i--) {
		let n = value.charCodeAt(i) - 48
		if (double) {
			n *= 2
			if (n > 9) n -= 9
		}
		sum += n
		double = !double
	}
	return sum % 10 === 0
}

const IBAN_LENGTHS = Object.fromEntries(
	"AD24AE23AL28AO25AT20AX18AZ28BA20BE16BF28BG22BH22BI27BJ28BL27BR29BY28CF27CG27CH21CI28CM27CR22CV25CY28CZ24DE22DJ27DK18DO28DZ26EE20EG29ES24FI18FK18FO18FR27GA27GB22GE22GF27GI23GL18GP27GQ27GR27GT28GW25HN28HR21HU28IE22IL23IQ23IR26IS26IT27JO30KM27KW30KZ20LB28LC32LI21LT20LU20LV21LY25MA28MC27MD24ME22MF27MG27MK19ML28MN20MQ27MR27MT31MU30MZ25NC27NE28NI28NL18NO15OM23PF27PK24PL28PM27PS29PT25QA29RE27RO24RS22RU33SA24SC31SD18SE24SI19SK24SM27SN28SO23ST25SV28TD27TF27TG28TL23TN24TR26UA29VA22VG24WF27XK20YE30YT27"
		.match(/[A-Z]{2}\d\d/g)
		.map((entry) => [entry.slice(0, 2), Number(entry.slice(2))]),
)

export function ibanValid(text) {
	const value = String(text).replace(/[\s-]+/g, "").toUpperCase()
	if (IBAN_LENGTHS[value.slice(0, 2)] !== value.length || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value)) return false
	let remainder = 0
	for (const char of value.slice(4) + value.slice(0, 4)) {
		const chunk = char <= "9" ? char : String(char.charCodeAt(0) - 55)
		for (const digit of chunk) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
	}
	return remainder === 1
}

function bech32Valid(address) {
	if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false
	const value = address.toLowerCase()
	const split = value.lastIndexOf("1")
	const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
	const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
	if (split < 1 || split + 7 > value.length || value.length > 90) return false
	const hrp = [...value.slice(0, split)].map((c) => c.charCodeAt(0))
	const values = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)]
	for (const char of value.slice(split + 1)) {
		const index = charset.indexOf(char)
		if (index < 0) return false
		values.push(index)
	}
	let check = 1
	for (const v of values) {
		const top = check >>> 25
		check = ((check & 0x1ffffff) << 5) ^ v
		for (let i = 0; i < 5; i++) if ((top >>> i) & 1) check ^= generator[i]
	}
	return check === 1 || check === 0x2bc830a3
}

function jwtValid(value) {
	try {
		const head = value.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")
		return typeof JSON.parse(atob(head + "===".slice((head.length + 3) % 4))) === "object"
	} catch {
		return false
	}
}

function ipv6Valid(value) {
	if (value.length < 7) return false
	if ((value.match(/[0-9a-f]+/gi) || []).length < 3) return false
	try {
		return new URL(`http://[${value.replace(/\/\d+$/, "").replace(/%.*$/, "")}]/`).hostname.length > 2
	} catch {
		return false
	}
}

function phoneValid(value) {
	const trimmed = value.trim()
	const digits = trimmed.replace(/\D/g, "")
	if (digits.length < 9 || digits.length > 15) return false
	if (/^(\d)\1+$/.test(digits)) return false
	if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(trimmed)) return false
	return /^\+/.test(trimmed) || /\(\d{2,4}\)/.test(trimmed) || /\d{3}[-. ]\d{3}[-. ]\d{4}/.test(trimmed) || /^\+?\d{1,3}[-. ]\d{2,4}[-. ]\d{3,4}[-. ]?\d{0,4}$/.test(trimmed)
}

const PLACEHOLDER = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_\d+\]/g
const PLACEHOLDER_VALUE = /^\[?[A-Z][A-Z0-9_]*_\d+\]?$/
const DUMMY_VALUE = /^(?:true|false|null|none|nil|undefined|yes|no|on|off|include|omit|same-origin|required|optional|default|enabled|disabled|hidden|visible|text|bearer|basic|localhost|changeme|change_me|changeit|password|passwd|secret|example|redacted|placeholder|dummy|test|demo|sample|string|number|boolean|your[_-]?\w*|xxx\w*|\*+|x+|\.{3}|<[^>]*>|\$\{[^}]*\}|\$\w+|\{\{[^}]*\}\}|%[A-Z_]+%|@[A-Z_]+@|env\.\w+|process\.env\.\w+)$/i

function plausibleSecret(value) {
	if (value.length < 4 || PLACEHOLDER_VALUE.test(value) || DUMMY_VALUE.test(value)) return false
	if (/^(.)\1+$/.test(value)) return false
	if (/^\d{1,9}$/.test(value)) return false
	return true
}

function assignedSecret(value, match, after) {
	const [, , key, sep, quote] = match
	if (!plausibleSecret(value)) return false
	const passwordish = /pass|pwd|secret/i.test(key)
	if (!passwordish && /^[A-Za-z_.-]+$/.test(value)) return false
	if (quote) return true
	if (/^(?:\$|process\.|env\.|os\.|import\.)/.test(value)) return false
	if (sep === ":" || /^[A-Z0-9_.-]+$/.test(key)) return true
	if (after === "(" || after === ".") return false
	if (/^[A-Za-z_$][\w$]*$/.test(value)) return /\d/.test(value) && shannonEntropy(value) >= 3
	return true
}

function emailValid(value) {
	return !/\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|ts|json|map|woff2?)$/i.test(value)
}

function highEntropyToken(value, match) {
	if (value.length < 24 || PLACEHOLDER_VALUE.test(value)) return false
	const before = match.input.slice(Math.max(0, match.index - 8), match.index)
	if (/sha(?:1|256|384|512)-$/i.test(before) || /base64,$/.test(before) || /^sha(?:1|256|384|512)-/i.test(value)) return false
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false
	if (/^[0-9a-f]+$/i.test(value)) return false
	if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false
	if (!(/[a-z]/.test(value) && /[A-Z]/.test(value)) && value.length < 32) return false
	if (/[/\\.]{2}|^https?:|\.(?:js|ts|css|png|jpe?g|svg|html?|json|map)$/i.test(value)) return false
	if (/(?:abcdef|012345|123456|example|sample|xxxxxx|aaaaaa)/i.test(value)) return false
	return shannonEntropy(value) >= Math.min(4.5, Math.log2(value.length) - 0.35)
}

const SECRET_RULES = [
	{ type: "PRIVATE_KEY", re: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]{0,12000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----|(?:[\s\\]*n?[A-Za-z0-9+/=]{8,})+)/gi, rank: 1 },
	{ type: "AWS_KEY", re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g, rank: 1 },
	{ type: "AWS_SECRET", re: /aws.{0,20}?(?:key|pwd|pw|password|pass|token|secret).{0,20}?["']?([0-9a-zA-Z/+]{40})(?![0-9a-zA-Z/+])/gid, group: 1, rank: 1 },
	{ type: "GITHUB_TOKEN", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,255}\b/g, rank: 1 },
	{ type: "GITLAB_TOKEN", re: /\b(?:glpat-[\w-]{20,300}(?:\.[0-9a-z]{9})?|glptt-[0-9a-f]{40}|gl(?:dt|ft|rt|soat|ffct)-[\w-]{20}|glimt-[\w-]{25}|glagent-[\w-]{50}|gloas-[\w-]{64}|GR1348941[\w-]{20})\b/g, rank: 1 },
	{ type: "SLACK_TOKEN", re: /\b(?:xox[abeoprs]|xapp)-(?:\d-)?(?:[a-zA-Z0-9]{1,40}-)+[a-zA-Z0-9]{1,40}\b/g, rank: 1 },
	{ type: "SLACK_WEBHOOK", re: /(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/_-]{20,}/g, rank: 1 },
	{ type: "DISCORD_WEBHOOK", re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g, rank: 1 },
	{ type: "STRIPE_KEY", re: /\b(?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99}(?![a-zA-Z0-9])|\bwhsec_[A-Za-z0-9]{24,}\b/g, rank: 1 },
	{ type: "GOOGLE_API_KEY", re: /\bAIza[\w-]{35}(?![\w-])/g, rank: 1 },
	{ type: "GOOGLE_SECRET", re: /\b(?:GOCSPX-[\w-]{28}|ya29\.[\w-]{20,1024})(?![\w-])/g, rank: 1 },
	{ type: "OPENAI_KEY", re: /\bsk-(?:(?:proj|svcacct|service|admin)-[\w-]+|[a-zA-Z0-9]+)T3BlbkFJ[\w-]+\b|\bsk-(?:proj|svcacct|admin)-[\w-]{40,}/g, rank: 1 },
	{ type: "ANTHROPIC_KEY", re: /\bsk-ant-(?:admin01|api03)-[\w-]{93}AA(?![\w-])|\bsk-ant-[a-z]+\d{2}-[\w-]{40,}/g, rank: 1 },
	{ type: "HUGGINGFACE_TOKEN", re: /\b(?:hf_|api_org_)[a-zA-Z0-9]{34}\b/g, rank: 1 },
	{ type: "NPM_TOKEN", re: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, rank: 1 },
	{ type: "PYPI_TOKEN", re: /pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/g, rank: 1 },
	{ type: "SENDGRID_KEY", re: /\bSG\.[\w-]{20,24}\.[\w-]{39,50}\b/g, rank: 1 },
	{ type: "TWILIO_KEY", re: /\b(?:AC[0-9a-f]{32}|SK[0-9a-fA-F]{32})\b/g, rank: 2 },
	{ type: "MAILCHIMP_KEY", re: /\b[0-9a-f]{32}-us\d{1,2}\b/g, rank: 1 },
	{ type: "MAILGUN_KEY", re: /\b(?:key-[a-z0-9]{32}|pubkey-[a-f0-9]{32})\b/g, rank: 2 },
	{ type: "SHOPIFY_TOKEN", re: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g, rank: 1 },
	{ type: "TELEGRAM_TOKEN", re: /\b\d{5,16}:AA[\w-]{32,33}(?![\w-])/g, rank: 1 },
	{ type: "DISCORD_TOKEN", re: /\b[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,38}\b/g, rank: 2 },
	{ type: "AZURE_KEY", re: /(?:AccountKey|SharedAccessKey|SharedSecretValue)\s*=\s*([a-zA-Z0-9/+]{20,100}={0,3})(?![a-zA-Z0-9/+=])/gid, group: 1, rank: 1 },
	{ type: "AZURE_SECRET", re: /(?:^|[\\'"`\s>=:(,)])([a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{31,34})(?=$|[\\'"`\s<),])/gd, group: 1, rank: 1 },
	{ type: "SAS_SIGNATURE", re: /[?&]sig=([A-Za-z0-9%+/=]{30,})/gid, group: 1, rank: 2 },
	{ type: "JWT", re: /\bey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/\\_-]{17,}\.(?:[a-zA-Z0-9/\\_-]{10,}={0,2})?/g, rank: 2, validate: jwtValid },
	{ type: "AUTH_HEADER", re: /\b(?:proxy-)?authorization["']?(?::\s+|\s*.{1,5}\s*)["']?(?:basic|bearer|token|digest|apikey)\s+([\w.~+/-]{6,}=*)/gid, group: 1, rank: 2 },
	{ type: "COOKIE", re: /^[ \t]*(?:set-)?cookie\s*:\s*(.+)$/gimd, group: 1, rank: 2 },
	{ type: "URL_PASSWORD", re: /:\/\/[^:/?#[\]@!$&'()*+,;=\s]{1,128}:([^:/?#[\]@!$&'()*+,;=\s]{1,256})@/gd, group: 1, rank: 2 },
	{ type: "URL_SECRET", re: /[?&#](?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|client_secret|password|passwd|pwd|auth|session|sessionid|sid|code|signature)=([^&#\s"'<>]{6,})/gid, group: 1, rank: 3, validate: plausibleSecret },
	{ type: "PASSWORD", re: /(["']?)\b([\w.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?|auth[_-]?key|session[_-]?(?:id|key|token)|signing[_-]?key|encryption[_-]?key)[\w.-]*)\b\1\s*(=|:|=>|:=)\s*(["'`]?)([^\s"'`,;<>{}()[\]]{4,128})/gid, group: 5, rank: 4, validate: assignedSecret },
]

const PII_RULES = [
	{ type: "EMAIL", re: /\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}\b/g, rank: 3, validate: emailValid },
	{ type: "CARD", re: /\b(?:\d[ -]?){11,18}\d\b/g, rank: 3, validate: (v) => luhnValid(v) && /^(?:4|5[1-5]|2[2-7]|3[47]|3[0689]|6(?:011|5|4[4-9]|22)|35|62)/.test(v.replace(/\D/g, "")) },
	{ type: "IBAN", re: /(?<![A-Z0-9])[A-Z]{2}[0-9]{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,3})?(?![A-Z0-9])/g, rank: 3, validate: ibanValid },
	{ type: "SSN", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, rank: 3 },
	{ type: "PHONE", re: /(?<![\w.+/-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,3}(?![\w-]|\.\d)/g, rank: 4, validate: phoneValid },
	{ type: "IPV4", re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[0-2]?\d|3[0-2]))?\b(?!\.\d)/g, rank: 4, validate: (v) => !/^(?:0\.0\.0\.0|127\.0\.0\.1|255\.255\.255\.\d+)$/.test(v) },
	{ type: "IPV6", re: /(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?::[0-9A-Fa-f]{1,4}){1,7}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|:(?::[0-9A-Fa-f]{1,4}){1,6})(?:%[0-9a-zA-Z]+)?(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?(?![\w:]|\.\d)/g, rank: 4, validate: ipv6Valid },
	{ type: "MAC", re: /\b[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b|\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b/g, rank: 4, validate: (v) => !/^(?:ff[:.-]?){5}ff$|^(?:00[:.-]?){5}00$/i.test(v.replace(/\./g, "")) },
	{ type: "WALLET", re: /(?<![A-Za-z0-9])bc1[a-zA-HJ-NP-Z0-9]{25,59}(?![A-Za-z0-9])/g, rank: 4, validate: bech32Valid },
	{ type: "WALLET", re: /\b0x[a-fA-F0-9]{40}\b/g, rank: 4 },
]

const ENTROPY_RULE = { type: "SECRET", re: /[A-Za-z0-9+/_=-]{24,}/g, rank: 5, validate: highEntropyToken }

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function customRules(terms) {
	const list = (Array.isArray(terms) ? terms : String(terms ?? "").split(/[\n,]/))
		.map((term) => term.trim())
		.filter((term) => term.length >= 2)
		.slice(0, 200)
	if (!list.length) return []
	const body = [...new Set(list)].sort((a, b) => b.length - a.length).map((term) => `${/^\w/.test(term) ? "\\b" : ""}${escapeRegExp(term)}${/\w$/.test(term) ? "\\b" : ""}`).join("|")
	return [{ type: "TERM", re: new RegExp(body, "giu"), rank: 0 }]
}

function collect(text, rules, kind, out) {
	for (const rule of rules) {
		rule.re.lastIndex = 0
		for (const match of text.matchAll(rule.re)) {
			let value = match[0]
			let start = match.index
			if (rule.group) {
				const span = match.indices?.[rule.group]
				if (!span) continue
				;[start] = span
				value = match[rule.group]
			}
			if (rule.type !== "PRIVATE_KEY") value = value.replace(/[.,;:!?)]+$/, "")
			if (!value || (rule.validate && !rule.validate(value, match, text[start + value.length]))) continue
			out.push({ type: rule.type, kind, start, end: start + value.length, value, rank: rule.rank })
		}
	}
}

export const MAX_SCRUB_CHARS = 2_000_000

export function findSensitive(text, { secrets = true, pii = true, entropy = true, terms = [] } = {}) {
	const source = String(text ?? "").slice(0, MAX_SCRUB_CHARS)
	const found = []
	for (const m of source.matchAll(PLACEHOLDER)) found.push({ type: "KEEP", kind: "keep", start: m.index, end: m.index + m[0].length, value: m[0], rank: -1 })
	collect(source, customRules(terms), "custom", found)
	if (secrets) collect(source, SECRET_RULES, "secrets", found)
	if (pii) collect(source, PII_RULES, "pii", found)
	if (secrets && entropy) collect(source, [ENTROPY_RULE], "secrets", found)
	const better = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.end - a.start > b.end - b.start)
	found.sort((a, b) => a.rank - b.rank || b.end - b.start - (a.end - a.start) || a.start - b.start)
	const kept = []
	for (const item of found) {
		if (kept.some((other) => item.start < other.end && other.start < item.end && !better(item, other))) continue
		kept.push(item)
	}
	return kept.filter((item) => item.kind !== "keep").sort((a, b) => a.start - b.start)
}

export function canonicalValue(type, value) {
	const text = String(value)
	if (type === "EMAIL") return text.toLowerCase()
	if (type === "CARD" || type === "PHONE" || type === "SSN") return text.replace(/[^\d+]/g, "")
	if (type === "IBAN") return text.replace(/[\s-]+/g, "").toUpperCase()
	if (type === "MAC" || type === "IPV6" || type === "TERM") return text.toLowerCase()
	return text
}

export function existingPlaceholders(text) {
	const highest = {}
	for (const m of String(text ?? "").matchAll(/\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_(\d+)\]/g)) {
		highest[m[1]] = Math.max(highest[m[1]] ?? 0, Number(m[2]))
	}
	return highest
}

export function maskWith(text, findings, placeholderFor) {
	const source = String(text ?? "")
	let out = ""
	let cursor = 0
	for (const item of findings) {
		if (item.start < cursor) continue
		out += source.slice(cursor, item.start) + placeholderFor(item)
		cursor = item.end
	}
	return out + source.slice(cursor)
}

const BRACKETED = /\\?\[\s*([A-Za-z][A-Za-z0-9]*(?:(?:\\?_|[ -])[A-Za-z0-9]+)*)\s*\\?\]/g
const BARE = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9]*(?:\\?_[A-Za-z0-9]+)*\\?_\d+)(?![A-Za-z0-9_])/g

function canonicalKey(raw) {
	return raw.replace(/\\/g, "").replace(/[\s-]+/g, "_").toUpperCase()
}

export function restoreWith(text, lookup) {
	let restored = 0
	const missing = new Set()
	const swap = (match, raw, bracketed) => {
		const key = canonicalKey(raw)
		if (!/_\d+$/.test(key)) return match
		const value = lookup(key)
		if (value === undefined || value === null) {
			if (bracketed) missing.add(key)
			return match
		}
		restored++
		return value
	}
	const out = String(text ?? "")
		.replace(BRACKETED, (match, raw) => swap(match, raw, true))
		.replace(BARE, (match, raw) => swap(match, raw, false))
	return { text: out, restored, missing: [...missing] }
}

export function previewOf(value) {
	const text = String(value)
	if (text.length <= 6) return "•".repeat(text.length)
	return `${text.slice(0, 2)}${"•".repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`
}

export const AI_NOTE = "Note: bracketed tokens such as [EMAIL_1] stand in for redacted values. Keep them exactly as written in your reply."
