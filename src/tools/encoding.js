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
		description: "Decode header and payload, show expiry status. Signature is never sent anywhere.",
		inputs: [{ key: "token", label: "JWT", type: "textarea", placeholder: "eyJhbGciOi..." }],
		run: ({ token }) => {
			const value = required(token, "JWT").trim()
			const parts = value.split(".")
			if (parts.length < 2) throw new ToolError("A JWT needs at least header.payload")
			const header = safeJsonParse(base64UrlDecode(parts[0]), "JWT header")
			const payload = safeJsonParse(base64UrlDecode(parts[1]), "JWT payload")
			let expiresAt = null
			let expired = null
			if (payload.exp !== undefined && payload.exp !== null) {
				const expNum = Number(payload.exp)
				if (!Number.isNaN(expNum) && expNum > 0) {
					const expMs = expNum > 1e11 ? expNum : expNum * 1000
					const expDate = new Date(expMs)
					if (!Number.isNaN(expDate.getTime())) {
						expiresAt = expDate.toISOString()
						expired = expDate.getTime() < Date.now()
					}
				}
			}
			return {
				type: "json",
				value: {
					header,
					payload,
					signaturePresent: parts.length === 3 && parts[2].length > 0,
					expiresAt,
					expired,
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
