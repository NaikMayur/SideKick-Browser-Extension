import {
	ToolError,
	base64UrlDecode,
	escapeHtml,
	fromBase64,
	required,
	safeJsonParse,
	toBase64,
	unescapeHtml,
} from "../lib/utils.js"

export const encodingTools = [
	{
		id: "base64",
		name: "Base64 encode / decode",
		category: "Encoding",
		roles: ["dev", "qa"],
		description: "Unicode-safe Base64 conversion for payloads, basic-auth headers and data URIs.",
		inputs: [
			{ key: "text", label: "Text", type: "textarea", placeholder: "Hello world" },
			{ key: "mode", label: "Mode", type: "select", options: ["encode", "decode"], default: "encode" },
		],
		run: ({ text, mode = "encode" }) => {
			const value = required(text, "Text")
			return { type: "text", value: mode === "decode" ? fromBase64(value) : toBase64(value) }
		},
	},
	{
		id: "url-encode",
		name: "URL encode / decode",
		category: "Encoding",
		roles: ["dev", "qa"],
		description: "Percent-encode or decode query parameters and path segments.",
		inputs: [
			{ key: "text", label: "Text", type: "textarea" },
			{ key: "mode", label: "Mode", type: "select", options: ["encode", "decode"], default: "encode" },
			{ key: "component", label: "Component only", type: "checkbox", default: true },
		],
		run: ({ text, mode = "encode", component = true }) => {
			const value = required(text, "Text")
			try {
				if (mode === "decode") {
					return { type: "text", value: component ? decodeURIComponent(value) : decodeURI(value) }
				}
				return { type: "text", value: component ? encodeURIComponent(value) : encodeURI(value) }
			} catch (error) {
				throw new ToolError(`Malformed URI sequence: ${error.message}`)
			}
		},
	},
	{
		id: "html-entities",
		name: "HTML entity escape / unescape",
		category: "Encoding",
		roles: ["dev", "qa", "design"],
		description: "Escape user content before rendering, or read escaped markup from logs.",
		inputs: [
			{ key: "text", label: "Text", type: "textarea" },
			{ key: "mode", label: "Mode", type: "select", options: ["escape", "unescape"], default: "escape" },
		],
		run: ({ text, mode = "escape" }) => {
			const value = required(text, "Text")
			return { type: "text", value: mode === "escape" ? escapeHtml(value) : unescapeHtml(value) }
		},
	},
	{
		id: "jwt-decode",
		name: "JWT decoder",
		category: "Encoding",
		roles: ["dev", "qa", "security"],
		description: "Decode header, payload and claims, verify expiration and detect security risks.",
		inputs: [{ key: "token", label: "JWT", type: "textarea", placeholder: "eyJhbGciOi..." }],
		run: ({ token }) => {
			const value = required(token, "JWT").trim()
			const parts = value.split(".")
			if (parts.length < 2) throw new ToolError("A JWT needs at least header.payload")
			const header = safeJsonParse(base64UrlDecode(parts[0]), "JWT header")
			const payload = safeJsonParse(base64UrlDecode(parts[1]), "JWT payload")

			const parseDate = (val) => {
				if (val === undefined || val === null) return null
				const num = Number(val)
				if (Number.isNaN(num) || num <= 0) return null
				const ms = num > 1e11 ? num : num * 1000
				const d = new Date(ms)
				return Number.isNaN(d.getTime()) ? null : d
			}

			const formatRelative = (d) => {
				if (!d) return null
				const diffMs = d.getTime() - Date.now()
				const isFuture = diffMs > 0
				const sec = Math.floor(Math.abs(diffMs) / 1000)
				if (sec < 60) return isFuture ? `in ${sec}s` : `${sec}s ago`
				const min = Math.floor(sec / 60)
				if (min < 60) return isFuture ? `in ${min}m` : `${min}m ago`
				const hr = Math.floor(min / 60)
				if (hr < 24) return isFuture ? `in ${hr}h` : `${hr}h ago`
				const days = Math.floor(hr / 24)
				return isFuture ? `in ${days}d` : `${days}d ago`
			}

			const expDate = parseDate(payload.exp)
			const iatDate = parseDate(payload.iat)
			const nbfDate = parseDate(payload.nbf)

			const expiresAt = expDate ? expDate.toISOString() : null
			const expired = expDate ? expDate.getTime() < Date.now() : null
			const issuedAt = iatDate ? iatDate.toISOString() : null
			const notBefore = nbfDate ? nbfDate.toISOString() : null

			const warnings = []
			if (header.alg === "none" || header.alg === "NONE") {
				warnings.push("High security risk: Algorithm is set to 'none' (unsigned token)")
			}
			if (!payload.exp) {
				warnings.push("No expiration claim (exp) present; token does not expire")
			} else if (expired) {
				warnings.push(`Token expired ${formatRelative(expDate)} (${expiresAt})`)
			}
			if (nbfDate && nbfDate.getTime() > Date.now()) {
				warnings.push(`Token not active yet (not valid before ${formatRelative(nbfDate)})`)
			}
			if (parts.length < 3 || !parts[2]) {
				warnings.push("No cryptographic signature segment present")
			}

			return {
				type: "json",
				value: {
					header,
					payload,
					signaturePresent: parts.length === 3 && parts[2].length > 0,
					expiresAt,
					expired,
					issuedAt,
					notBefore,
					relativeExpiry: formatRelative(expDate),
					relativeIssued: formatRelative(iatDate),
					warnings,
					rawParts: {
						header: parts[0],
						payload: parts[1],
						signature: parts[2] || "",
					},
				},
			}
		},
	},
	{
		id: "hash",
		name: "Hash generator (SHA-1/256/384/512)",
		category: "Encoding",
		roles: ["dev", "security"],
		description: "WebCrypto hashes for checksums, cache keys and integrity comparisons.",
		async: true,
		inputs: [
			{ key: "text", label: "Text", type: "textarea" },
			{
				key: "algorithm",
				label: "Algorithm",
				type: "select",
				options: ["SHA-256", "SHA-1", "SHA-384", "SHA-512"],
				default: "SHA-256",
			},
		],
		run: async ({ text, algorithm = "SHA-256" }) => {
			const value = required(text, "Text")
			const subtle = globalThis.crypto?.subtle
			if (!subtle) throw new ToolError("WebCrypto is unavailable in this context")
			const digest = await subtle.digest(algorithm, new TextEncoder().encode(value))
			const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
			return { type: "text", value: hex }
		},
	},
	{
		id: "uuid",
		name: "UUID / ULID-style ID generator",
		category: "Encoding",
		roles: ["dev", "qa"],
		description: "Generate RFC 4122 v4 UUIDs or sortable time-prefixed IDs for test fixtures.",
		inputs: [
			{ key: "count", label: "How many", type: "number", default: 5, min: 1, max: 100 },
			{ key: "kind", label: "Kind", type: "select", options: ["uuid-v4", "sortable"], default: "uuid-v4" },
		],
		run: ({ count = 5, kind = "uuid-v4" }) => {
			const total = Math.min(Math.max(Number(count) || 1, 1), 100)
			const ids = Array.from({ length: total }, () =>
				kind === "sortable" ? sortableId() : uuidV4(),
			)
			return { type: "text", value: ids.join("\n") }
		},
	},
	{
		id: "secret-generator",
		name: "Password / API key generator",
		category: "Encoding",
		roles: ["dev", "qa", "security", "it"],
		description: "Cryptographically random secrets with configurable length and alphabet.",
		inputs: [
			{ key: "length", label: "Length", type: "number", default: 24, min: 8, max: 128 },
			{ key: "symbols", label: "Include symbols", type: "checkbox", default: true },
		],
		run: ({ length = 24, symbols = true }) => {
			const size = Math.min(Math.max(Number(length) || 24, 8), 128)
			const alphabet =
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
				(symbols ? "!@#$%^&*()-_=+[]{}?" : "")
			const alphabetLength = alphabet.length
			const maxValidByte = 256 - (256 % alphabetLength)
			let secret = ""
			while (secret.length < size) {
				const batch = new Uint8Array((size - secret.length) * 2)
				globalThis.crypto.getRandomValues(batch)
				for (let i = 0; i < batch.length && secret.length < size; i++) {
					if (batch[i] < maxValidByte) {
						secret += alphabet[batch[i] % alphabetLength]
					}
				}
			}
			return { type: "text", value: secret }
		},
	},
]

export function uuidV4() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sortableId(now = Date.now()) {
	const time = now.toString(36).padStart(9, "0")
	const bytes = new Uint8Array(8)
	globalThis.crypto.getRandomValues(bytes)
	const tail = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("")
	return `${time}${tail}`.toUpperCase()
}
