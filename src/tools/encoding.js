import { ToolError, escapeHtml, formatBytes, required, safeJsonParse } from "../lib/utils.js"

const PREVIEW_LIMIT = 200000
const TEXT_ACCEPT = ".txt,.md,.json,.csv,.xml,.html,.log,.b64,text/*"

export function requireText(value, label) {
	if (value === undefined || value === null || value === "") throw new ToolError(`${label} is required`)
	return String(value)
}

export function bytesToBase64(bytes) {
	let binary = ""
	const chunk = 0x8000
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
	}
	return btoa(binary)
}

export function toBase64Url(base64) {
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64ToBytes(input, label = "Base64 input") {
	let text = String(input ?? "").trim()
	let mime = ""
	const dataUri = text.match(/^data:([^,]*?)(;base64)?,/i)
	if (dataUri) {
		if (!dataUri[2]) throw new ToolError("This data URI is not Base64 encoded")
		mime = dataUri[1]
		text = text.slice(dataUri[0].length)
	}
	text = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
	const bad = text.match(/[^A-Za-z0-9+/]/)
	if (bad) throw new ToolError(`${label} contains an invalid character "${bad[0]}"`)
	if (text.length % 4 === 1) throw new ToolError(`${label} has an invalid length (a character is missing or extra)`)
	text += "=".repeat((4 - (text.length % 4)) % 4)
	const binary = atob(text)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
	return { bytes, mime }
}

export function decodeUtf8(bytes) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		return null
	}
}

const MAGIC = [
	{ bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png", ext: "png" },
	{ bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg", ext: "jpg" },
	{ bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif", ext: "gif" },
	{ bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf", ext: "pdf" },
	{ bytes: [0x50, 0x4b, 0x03, 0x04], mime: "application/zip", ext: "zip" },
	{ bytes: [0x1f, 0x8b], mime: "application/gzip", ext: "gz" },
]

export function sniffType(bytes) {
	for (const entry of MAGIC) {
		if (entry.bytes.every((byte, index) => bytes[index] === byte)) return entry
	}
	if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
		return { mime: "image/webp", ext: "webp" }
	}
	return { mime: "application/octet-stream", ext: "bin" }
}

function hexPreview(bytes, limit = 64) {
	const shown = [...bytes.subarray(0, limit)].map((b) => b.toString(16).padStart(2, "0"))
	const rows = []
	for (let i = 0; i < shown.length; i += 16) rows.push(shown.slice(i, i + 16).join(" "))
	return rows.join("\n") + (bytes.length > limit ? "\n…" : "")
}

export function largeText(full, filename, mime = "text/plain") {
	const result = { type: "text", value: full, copy: full }
	if (full.length > PREVIEW_LIMIT) {
		result.value = `${full.slice(0, PREVIEW_LIMIT)}\n\n… output is ${full.length.toLocaleString("en-US")} characters; preview truncated. Copy or Save gives the full result.`
		result.download = { filename, mime, text: full }
	}
	return result
}

function encodeFile(file, output) {
	if (!file) throw new ToolError("Choose a file to encode")
	const dataUrl = String(file.dataUrl ?? "")
	if (!dataUrl.startsWith("data:")) throw new ToolError("The file could not be read as a data URL")
	const full = output === "base64" ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl
	const result = largeText(full, `${file.name || "file"}.b64.txt`)
	result.download = { filename: `${file.name || "file"}.b64.txt`, mime: "text/plain", text: full }
	return result
}

function decodeBase64(text) {
	const { bytes, mime } = base64ToBytes(text)
	const decoded = decodeUtf8(bytes)
	if (decoded !== null && !mime.startsWith("image/")) return largeText(decoded, "decoded.txt")
	const type = mime ? { mime, ext: mime.split("/")[1] || "bin" } : sniffType(bytes)
	return {
		type: "text",
		value: `Decoded ${formatBytes(bytes.length)} of binary data (${type.mime}). Use Save to download it.\n\n${hexPreview(bytes)}`,
		copy: hexPreview(bytes, 4096),
		download: { filename: `decoded.${type.ext}`, mime: type.mime, dataUrl: `data:${type.mime};base64,${bytesToBase64(bytes)}` },
	}
}

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }
const LATIN1_NAMES =
	"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
		" ",
	)
LATIN1_NAMES.forEach((name, index) => {
	NAMED_ENTITIES[name] = String.fromCharCode(160 + index)
})
const EXTRA_ENTITIES = {
	OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
	ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211,
	mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
	dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
	lsaquo: 8249, rsaquo: 8250, euro: 8364, trade: 8482, larr: 8592, uarr: 8593, rarr: 8594,
	darr: 8595, harr: 8596, minus: 8722, infin: 8734, ne: 8800, le: 8804, ge: 8805, spades: 9824,
	clubs: 9827, hearts: 9829, diams: 9830, check: 10003,
}
for (const [name, code] of Object.entries(EXTRA_ENTITIES)) NAMED_ENTITIES[name] = String.fromCodePoint(code)

function codePointToString(code) {
	if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�"
	return String.fromCodePoint(code)
}

// Single pass so "&amp;lt;" becomes "&lt;" and is not decoded twice.
export function decodeEntities(text) {
	return String(text).replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
		if (body[0] === "#") {
			const hex = body[1] === "x" || body[1] === "X"
			return codePointToString(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10))
		}
		return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole
	})
}

export function encodeEntities(text, nonAscii = false) {
	const escaped = escapeHtml(text)
	if (!nonAscii) return escaped
	let out = ""
	for (const char of escaped) {
		const code = char.codePointAt(0)
		out += code > 126 ? `&#x${code.toString(16).toUpperCase()};` : char
	}
	return out
}

function lenientDecode(text, decoder) {
	return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
		try {
			return decoder(run)
		} catch {
			return run
		}
	})
}

export function urlTransform(text, { mode = "encode", component = true, form = false } = {}) {
	if (mode === "decode") {
		const source = form ? text.replace(/\+/g, " ") : text
		return lenientDecode(source, component ? decodeURIComponent : decodeURI)
	}
	let out
	try {
		out = component ? encodeURIComponent(text) : encodeURI(text)
	} catch {
		throw new ToolError("Text contains an unpaired surrogate character that cannot be percent encoded")
	}
	if (form) out = out.replace(/%20/g, "+")
	return out
}

const JS_ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }

export function decodeJsString(text) {
	return text.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[\s\S])/g, (whole, body, brace, u4, x2) => {
		if (brace) return codePointToString(parseInt(brace, 16))
		if (u4) return String.fromCharCode(parseInt(u4, 16))
		if (x2) return String.fromCharCode(parseInt(x2, 16))
		return Object.hasOwn(JS_ESCAPES, body) ? JS_ESCAPES[body] : body === "\n" ? "" : body
	})
}

export function encodeUnicodeEscapes(text) {
	let out = ""
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i)
		out += code > 126 ? `\\u${code.toString(16).padStart(4, "0")}` : text[i]
	}
	return out
}

const ESCAPE_FORMATS = {
	"url-component": {
		encode: (t) => urlTransform(t, { mode: "encode" }),
		decode: (t) => urlTransform(t, { mode: "decode" }),
	},
	url: {
		encode: (t) => urlTransform(t, { mode: "encode", component: false }),
		decode: (t) => urlTransform(t, { mode: "decode", component: false }),
	},
	form: {
		encode: (t) => urlTransform(t, { mode: "encode", form: true }),
		decode: (t) => urlTransform(t, { mode: "decode", form: true }),
	},
	html: { encode: (t) => encodeEntities(t), decode: decodeEntities },
	"html-all": { encode: (t) => encodeEntities(t, true), decode: decodeEntities },
	js: { encode: (t) => JSON.stringify(t).slice(1, -1).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"), decode: decodeJsString },
	unicode: { encode: encodeUnicodeEscapes, decode: decodeJsString },
}

export function escapeText(text, format = "url-component", mode = "encode") {
	const codec = ESCAPE_FORMATS[format]
	if (!codec) throw new ToolError(`Unknown format: ${format}`)
	return mode === "decode" ? codec.decode(text) : codec.encode(text)
}

const B64URL_DIGEST = (bytes) => toBase64Url(bytesToBase64(bytes))

function base64UrlToBytes(segment, label) {
	return base64ToBytes(segment, label).bytes
}

function decodeJwtSegment(segment, label) {
	if (!segment) throw new ToolError(`JWT ${label} segment is empty`)
	let bytes
	try {
		bytes = base64UrlToBytes(segment, `JWT ${label}`)
	} catch (error) {
		throw new ToolError(`JWT ${label} is not valid base64url: ${error.message}`)
	}
	const text = decodeUtf8(bytes)
	if (text === null) throw new ToolError(`JWT ${label} is not UTF-8 text`)
	return safeJsonParse(text, `JWT ${label}`)
}

export function parseNumericDate(value) {
	if (value === undefined || value === null || value === "") return null
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return null
	const ms = num > 1e11 ? num : num * 1000
	const date = new Date(ms)
	return Number.isNaN(date.getTime()) ? null : date
}

export function formatRelative(date, now = Date.now()) {
	if (!date) return null
	const diff = date.getTime() - now
	const future = diff > 0
	let seconds = Math.floor(Math.abs(diff) / 1000)
	const units = [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]
	const parts = []
	for (const [label, size] of units) {
		if (seconds >= size || (label === "s" && !parts.length)) {
			parts.push(`${Math.floor(seconds / size)}${label}`)
			seconds %= size
		}
		if (parts.length === 2) break
	}
	const text = parts.join(" ")
	return future ? `in ${text}` : `${text} ago`
}

function humanDate(date, now) {
	if (!date) return null
	return `${date.toUTCString()} (${formatRelative(date, now)})`
}

const JWT_ALGS = {
	HS256: { kind: "hmac", hash: "SHA-256" },
	HS384: { kind: "hmac", hash: "SHA-384" },
	HS512: { kind: "hmac", hash: "SHA-512" },
	RS256: { kind: "rsa", hash: "SHA-256" },
	RS384: { kind: "rsa", hash: "SHA-384" },
	RS512: { kind: "rsa", hash: "SHA-512" },
	PS256: { kind: "pss", hash: "SHA-256", salt: 32 },
	PS384: { kind: "pss", hash: "SHA-384", salt: 48 },
	PS512: { kind: "pss", hash: "SHA-512", salt: 64 },
	ES256: { kind: "ec", hash: "SHA-256", curve: "P-256" },
	ES384: { kind: "ec", hash: "SHA-384", curve: "P-384" },
	ES512: { kind: "ec", hash: "SHA-512", curve: "P-521" },
	EdDSA: { kind: "ed" },
}

function pemToBytes(pem) {
	const match = pem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/)
	if (!match) return null
	if (match[1] !== "PUBLIC KEY") {
		throw new ToolError(`Unsupported key type "${match[1]}"; paste a SPKI public key (-----BEGIN PUBLIC KEY-----) or a JWK`)
	}
	return base64ToBytes(match[2], "PEM key").bytes
}

function importParams(spec) {
	if (spec.kind === "rsa") return { name: "RSASSA-PKCS1-v1_5", hash: spec.hash }
	if (spec.kind === "pss") return { name: "RSA-PSS", hash: spec.hash }
	if (spec.kind === "ec") return { name: "ECDSA", namedCurve: spec.curve }
	return { name: "Ed25519" }
}

function verifyParams(spec) {
	if (spec.kind === "rsa") return { name: "RSASSA-PKCS1-v1_5" }
	if (spec.kind === "pss") return { name: "RSA-PSS", saltLength: spec.salt }
	if (spec.kind === "ec") return { name: "ECDSA", hash: spec.hash }
	return { name: "Ed25519" }
}

async function importVerifyKey(subtle, spec, keyText, keyEncoding) {
	const trimmed = keyText.trim()
	if (spec.kind === "hmac") {
		const raw = keyEncoding === "base64" ? base64ToBytes(trimmed, "Secret").bytes : new TextEncoder().encode(keyText)
		if (!raw.length) throw new ToolError("The HMAC secret is empty")
		return subtle.importKey("raw", raw, { name: "HMAC", hash: spec.hash }, false, ["verify"])
	}
	if (trimmed.startsWith("{")) {
		const jwk = safeJsonParse(trimmed, "JWK")
		return subtle.importKey("jwk", jwk, importParams(spec), false, ["verify"])
	}
	const der = pemToBytes(trimmed)
	if (!der) throw new ToolError("Paste the public key as PEM (-----BEGIN PUBLIC KEY-----) or JWK JSON")
	return subtle.importKey("spki", der, importParams(spec), false, ["verify"])
}

export async function verifyJwtSignature(parts, header, keyText, keyEncoding = "utf8") {
	const algorithm = String(header?.alg ?? "")
	if (!keyText) return { status: "skipped", valid: null, algorithm, message: "Provide a secret or public key to verify the signature" }
	if (/^none$/i.test(algorithm)) return { status: "invalid", valid: false, algorithm, message: "Token is unsigned (alg none)" }
	const spec = JWT_ALGS[algorithm]
	if (!spec) return { status: "unsupported", valid: null, algorithm, message: `Algorithm "${algorithm}" is not supported for verification` }
	if (!parts[2]) return { status: "invalid", valid: false, algorithm, message: "Token has no signature segment" }
	const subtle = globalThis.crypto?.subtle
	if (!subtle) throw new ToolError("WebCrypto is unavailable in this context")
	let key
	try {
		key = await importVerifyKey(subtle, spec, keyText, keyEncoding)
	} catch (error) {
		if (error instanceof ToolError) throw error
		return { status: "unsupported", valid: null, algorithm, message: `Could not import the key: ${error.message}` }
	}
	const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
	const signature = base64UrlToBytes(parts[2], "JWT signature")
	let valid = false
	try {
		valid = spec.kind === "hmac"
			? await subtle.verify("HMAC", key, signature, data)
			: await subtle.verify(verifyParams(spec), key, signature, data)
	} catch (error) {
		return { status: "unsupported", valid: null, algorithm, message: `Verification failed: ${error.message}` }
	}
	return {
		status: valid ? "valid" : "invalid",
		valid,
		algorithm,
		message: valid ? `Signature verified (${algorithm})` : `Signature does NOT match (${algorithm})`,
	}
}

function claimWarnings(payload, dates, now) {
	const warnings = []
	for (const claim of ["exp", "iat", "nbf"]) {
		const raw = payload[claim]
		if (raw === undefined) continue
		if (typeof raw !== "number") warnings.push(`"${claim}" should be a NumericDate (seconds since epoch), got ${JSON.stringify(raw)}`)
		else if (raw > 1e11) warnings.push(`"${claim}" looks like milliseconds; JWT dates are in seconds`)
	}
	if (dates.exp === null) warnings.push("No expiration claim (exp) present; token does not expire")
	else if (dates.exp.getTime() < now) warnings.push(`Token expired ${formatRelative(dates.exp, now)} (${dates.exp.toISOString()})`)
	if (dates.nbf && dates.nbf.getTime() > now) warnings.push(`Token not active yet (not valid before ${formatRelative(dates.nbf, now)})`)
	if (dates.iat && dates.iat.getTime() > now + 60000) warnings.push(`Issued in the future (${formatRelative(dates.iat, now)}); check clock skew`)
	return warnings
}

export async function decodeJwt(token, { key = "", keyEncoding = "utf8", now = Date.now() } = {}) {
	const value = required(token, "JWT").trim().replace(/^Bearer\s+/i, "")
	const parts = value.split(".")
	if (parts.length === 5) throw new ToolError("This is an encrypted JWE (5 segments); its payload cannot be decoded without the decryption key")
	if (parts.length < 2 || parts.length > 3) throw new ToolError(`A JWT has 3 dot separated segments (header.payload.signature); found ${parts.length}`)
	const header = decodeJwtSegment(parts[0], "header")
	const payload = decodeJwtSegment(parts[1], "payload")
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ToolError("JWT payload must be a JSON object")
	const dates = { exp: parseNumericDate(payload.exp), iat: parseNumericDate(payload.iat), nbf: parseNumericDate(payload.nbf) }
	const warnings = []
	if (/^none$/i.test(String(header?.alg ?? ""))) warnings.push("High security risk: Algorithm is set to 'none' (unsigned token)")
	warnings.push(...claimWarnings(payload, dates, now))
	if (parts.length < 3 || !parts[2]) warnings.push("No cryptographic signature segment present")
	const signature = await verifyJwtSignature(parts, header, key, keyEncoding)
	if (signature.valid === false) warnings.unshift(`Signature check failed: ${signature.message}`)
	if (/^HS/.test(signature.algorithm) && /BEGIN PUBLIC KEY/.test(key)) {
		warnings.push("HMAC verified with a public key: this is the classic algorithm confusion attack pattern")
	}
	const expired = dates.exp ? dates.exp.getTime() < now : null
	return {
		header,
		payload,
		signaturePresent: parts.length === 3 && parts[2].length > 0,
		signatureVerified: signature.valid,
		signature,
		expiresAt: dates.exp ? dates.exp.toISOString() : null,
		expired,
		issuedAt: dates.iat ? dates.iat.toISOString() : null,
		notBefore: dates.nbf ? dates.nbf.toISOString() : null,
		relativeExpiry: formatRelative(dates.exp, now),
		relativeIssued: formatRelative(dates.iat, now),
		dates: { exp: humanDate(dates.exp, now), iat: humanDate(dates.iat, now), nbf: humanDate(dates.nbf, now) },
		lifetime: dates.exp && dates.iat ? formatRelative(dates.exp, dates.iat.getTime()).replace(/^in /, "") : null,
		warnings,
		rawParts: { header: parts[0], payload: parts[1], signature: parts[2] || "" },
	}
}

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

function md5Round(i, b, c, d) {
	if (i < 16) return [(b & c) | (~b & d), i]
	if (i < 32) return [(d & b) | (~d & c), (5 * i + 1) % 16]
	if (i < 48) return [b ^ c ^ d, (3 * i + 5) % 16]
	return [c ^ (b | ~d), (7 * i) % 16]
}

export function md5(input) {
	const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input))
	const length = bytes.length
	const total = (((length + 8) >>> 6) + 1) * 64
	const padded = new Uint8Array(total)
	padded.set(bytes)
	padded[length] = 0x80
	const view = new DataView(padded.buffer)
	view.setUint32(total - 8, (length * 8) >>> 0, true)
	view.setUint32(total - 4, Math.floor(length / 2 ** 29), true)
	const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
	const words = new Uint32Array(16)
	for (let offset = 0; offset < total; offset += 64) {
		for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true)
		let [a, b, c, d] = state
		for (let i = 0; i < 64; i += 1) {
			const [f, g] = md5Round(i, b, c, d)
			const sum = (f + a + MD5_K[i] + words[g]) | 0
			const shift = MD5_S[(i >> 4) * 4 + (i % 4)]
			a = d
			d = c
			c = b
			b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
		}
		state[0] = (state[0] + a) | 0
		state[1] = (state[1] + b) | 0
		state[2] = (state[2] + c) | 0
		state[3] = (state[3] + d) | 0
	}
	const out = new Uint8Array(16)
	const outView = new DataView(out.buffer)
	state.forEach((word, index) => outView.setUint32(index * 4, word >>> 0, true))
	return out
}

function hmacMd5(keyBytes, data) {
	let key = keyBytes.length > 64 ? md5(keyBytes) : keyBytes
	const block = new Uint8Array(64)
	block.set(key)
	key = block
	const inner = new Uint8Array(64 + data.length)
	const outer = new Uint8Array(64 + 16)
	for (let i = 0; i < 64; i += 1) {
		inner[i] = key[i] ^ 0x36
		outer[i] = key[i] ^ 0x5c
	}
	inner.set(data, 64)
	outer.set(md5(inner), 64)
	return md5(outer)
}

export async function digestBytes(algorithm, data, key = "") {
	const keyBytes = new TextEncoder().encode(key)
	if (algorithm === "MD5") return key ? hmacMd5(keyBytes, data) : md5(data)
	const subtle = globalThis.crypto?.subtle
	if (!subtle) throw new ToolError("WebCrypto is unavailable in this context")
	if (!key) return new Uint8Array(await subtle.digest(algorithm, data))
	const cryptoKey = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: algorithm }, false, ["sign"])
	return new Uint8Array(await subtle.sign("HMAC", cryptoKey, data))
}

export function toHex(bytes) {
	let out = ""
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0")
	return out
}

function formatDigest(bytes, algorithm, encoding) {
	if (encoding === "base64") return bytesToBase64(bytes)
	if (encoding === "HEX") return toHex(bytes).toUpperCase()
	if (encoding === "sri") {
		if (!/^SHA-(256|384|512)$/.test(algorithm)) throw new ToolError("SRI integrity strings need SHA-256, SHA-384 or SHA-512")
		return `${algorithm.replace("-", "").toLowerCase()}-${bytesToBase64(bytes)}`
	}
	return toHex(bytes)
}

function digestMatches(bytes, expected) {
	const clean = expected.trim().replace(/^(sha(256|384|512)|md5|sha1)[-:]/i, "").replace(/\s+/g, "")
	if (!clean) return null
	return clean.toLowerCase() === toHex(bytes) || clean === bytesToBase64(bytes) || clean === B64URL_DIGEST(bytes)
}

function hashSourceBytes(source, text, file) {
	if (source !== "file") return new TextEncoder().encode(requireText(text, "Text"))
	if (!file) throw new ToolError("Choose a file to hash")
	if (file.bytes) return file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes)
	if (file.dataUrl) return base64ToBytes(file.dataUrl, "File").bytes
	if (typeof file.text === "string") return new TextEncoder().encode(file.text)
	throw new ToolError("The file could not be read")
}

const HASH_ALGORITHMS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"]

export async function runHash({ source = "text", text, file, algorithm = "SHA-256", key = "", encoding = "hex", expected = "" }) {
	const data = hashSourceBytes(source, text, file)
	const list = algorithm === "all" ? HASH_ALGORITHMS : [algorithm]
	if (!HASH_ALGORITHMS.includes(list[0])) throw new ToolError(`Unknown algorithm: ${algorithm}`)
	const label = key ? "HMAC-" : ""
	const results = []
	for (const name of list) {
		const bytes = await digestBytes(name, data, key)
		const enc = encoding === "sri" && !/^SHA-(256|384|512)$/.test(name) ? "hex" : encoding
		results.push({ name, bytes, text: formatDigest(bytes, name, list.length > 1 ? enc : encoding) })
	}
	const lines = list.length === 1 ? [results[0].text] : results.map((r) => `${label}${r.name}: ${r.text}`)
	const notes = []
	if (source === "file") notes.push(`File: ${file.name || "file"} (${formatBytes(data.length)})`)
	if (String(expected ?? "").trim()) {
		const match = results.find((r) => digestMatches(r.bytes, String(expected)))
		notes.push(match ? `✓ Matches the expected value (${label}${match.name})` : "✗ Does NOT match the expected value")
	}
	const digest = lines.join("\n")
	return { type: "text", value: notes.length ? `${digest}\n\n${notes.join("\n")}` : digest, copy: digest }
}

function formatUuid(bytes) {
	const hex = toHex(bytes)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidV4() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return formatUuid(bytes)
}

export function uuidV7(now = Date.now()) {
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	let time = now
	for (let i = 5; i >= 0; i -= 1) {
		bytes[i] = time % 256
		time = Math.floor(time / 256)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x70
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return formatUuid(bytes)
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ulid(now = Date.now()) {
	let time = now
	let head = ""
	for (let i = 0; i < 10; i += 1) {
		head = CROCKFORD[time % 32] + head
		time = Math.floor(time / 32)
	}
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	return head + [...bytes].map((b) => CROCKFORD[b & 31]).join("")
}

export function sortableId(now = Date.now()) {
	const time = now.toString(36).padStart(9, "0")
	const bytes = new Uint8Array(8)
	globalThis.crypto.getRandomValues(bytes)
	const tail = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("")
	return `${time}${tail}`.toUpperCase()
}

const ID_MAKERS = { "uuid-v4": uuidV4, "uuid-v7": uuidV7, ulid, sortable: sortableId }

export function generateIds(count, kind) {
	const make = ID_MAKERS[kind] ?? uuidV4
	const total = Math.min(Math.max(Math.floor(Number(count)) || 1, 1), 1000)
	const ids = Array.from({ length: total }, () => make())
	// Ids from the same millisecond have random tails, so sort to keep a batch in creation order semantics.
	if (kind !== "uuid-v4") ids.sort()
	return ids
}

function createRandomIndex() {
	const pool = new Uint32Array(256)
	let cursor = pool.length
	return (n) => {
		const limit = 2 ** 32 - (2 ** 32 % n)
		for (;;) {
			if (cursor >= pool.length) {
				globalThis.crypto.getRandomValues(pool)
				cursor = 0
			}
			const value = pool[cursor]
			cursor += 1
			if (value < limit) return value % n
		}
	}
}

const CHARSETS = {
	upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	lower: "abcdefghijklmnopqrstuvwxyz",
	digits: "0123456789",
	symbols: "!@#$%^&*()-_=+[]{}?",
}
const AMBIGUOUS = /[Il1O0o]/g

function passwordClasses(symbols, excludeAmbiguous) {
	const classes = [CHARSETS.upper, CHARSETS.lower, CHARSETS.digits]
	if (symbols) classes.push(CHARSETS.symbols)
	return excludeAmbiguous ? classes.map((set) => set.replace(AMBIGUOUS, "")) : classes
}

// Every character is drawn uniformly with rejection sampling; whole passwords missing a class are redrawn,
// which keeps the result uniform over all passwords that satisfy the policy.
export function generateSecret({ kind = "password", length = 24, symbols = true, excludeAmbiguous = false } = {}, randomIndex = createRandomIndex()) {
	const size = Math.min(Math.max(Math.floor(Number(length)) || 24, 4), 256)
	const alphabets = {
		hex: ["0123456789abcdef"],
		base64url: [`${CHARSETS.upper}${CHARSETS.lower}${CHARSETS.digits}-_`],
		pin: [CHARSETS.digits],
	}
	const classes = alphabets[kind] ?? passwordClasses(symbols, excludeAmbiguous)
	const alphabet = classes.join("")
	const enforce = kind === "password" && size >= classes.length
	for (let attempt = 0; attempt < 1000; attempt += 1) {
		let secret = ""
		for (let i = 0; i < size; i += 1) secret += alphabet[randomIndex(alphabet.length)]
		if (!enforce || classes.every((set) => [...set].some((char) => secret.includes(char)))) {
			return { secret, bits: Math.floor(size * Math.log2(alphabet.length)) }
		}
	}
	throw new ToolError("Could not generate a secret that satisfies the character rules")
}

export function convertNumberBase(input, from = "auto") {
	let text = required(input, "Number").trim().replace(/[_\s,]/g, "")
	const negative = text.startsWith("-")
	if (negative || text.startsWith("+")) text = text.slice(1)
	let base = from === "auto" ? 10 : Number(from)
	const prefix = text.match(/^0([xob])/i)
	if (prefix && (from === "auto" || base === { x: 16, o: 8, b: 2 }[prefix[1].toLowerCase()])) {
		base = { x: 16, o: 8, b: 2 }[prefix[1].toLowerCase()]
		text = text.slice(2)
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, base)
	if (!text || [...text.toLowerCase()].some((char) => !digits.includes(char))) {
		throw new ToolError(`"${input}" is not a valid base ${base} integer`)
	}
	let value = 0n
	for (const char of text.toLowerCase()) value = value * BigInt(base) + BigInt(digits.indexOf(char))
	if (negative) value = -value
	const sign = value < 0n ? "-" : ""
	const abs = value < 0n ? -value : value
	const group = (s, size) => s.replace(new RegExp(`\\B(?=(.{${size}})+$)`, "g"), " ")
	return [
		["Decimal", value.toString()],
		["Hexadecimal", `${sign}0x${abs.toString(16).toUpperCase()}`],
		["Octal", `${sign}0o${abs.toString(8)}`],
		["Binary", `${sign}0b${group(abs.toString(2), 4)}`],
		["Base 36", `${sign}${abs.toString(36)}`],
		["Bits needed", String(abs === 0n ? 1 : abs.toString(2).length)],
	]
}

const ENCODE_DECODE = [
	{ value: "encode", label: "Encode text" },
	{ value: "decode", label: "Decode" },
]

export const encodingTools = [
	{
		id: "base64",
		name: "Base64 encode / decode",
		category: "Encoding",
		roles: ["dev", "qa"],
		description: "Unicode safe Base64 for text, files and data URIs; decodes binary payloads to downloadable files.",
		keywords: ["b64", "atob", "btoa", "data uri", "data url", "basic auth", "file to base64", "base64url"],
		live: true,
		inputs: [
			{ key: "mode", label: "Mode", type: "select", options: [...ENCODE_DECODE, { value: "file", label: "Encode a file" }], default: "encode" },
			{ key: "text", label: "Text", type: "textarea", placeholder: "Hello world", upload: { accept: TEXT_ACCEPT }, showIf: { key: "mode", in: ["encode", "decode"] }, help: "Decode accepts standard or URL safe Base64, with or without padding, or a full data: URI." },
			{ key: "urlSafe", label: "URL safe alphabet (no padding)", type: "checkbox", default: false, showIf: { key: "mode", in: ["encode"] } },
			{ key: "file", label: "File", type: "file", read: "dataUrl", accept: "*/*", showIf: { key: "mode", in: ["file"] } },
			{ key: "output", label: "Output", type: "select", options: [{ value: "data-uri", label: "Data URI (data:…;base64,…)" }, { value: "base64", label: "Plain Base64" }], default: "data-uri", showIf: { key: "mode", in: ["file"] } },
		],
		run: ({ text, mode = "encode", urlSafe = false, file = null, output = "data-uri" }) => {
			if (mode === "file") return encodeFile(file, output)
			if (mode === "decode") return decodeBase64(required(text, "Base64 text"))
			const encoded = bytesToBase64(new TextEncoder().encode(requireText(text, "Text")))
			return largeText(urlSafe ? toBase64Url(encoded) : encoded, "encoded.b64.txt")
		},
	},
	{
		id: "text-escape",
		name: "URL / HTML / JS escape",
		category: "Encoding",
		roles: ["dev", "qa", "security", "design"],
		description: "Percent encode URLs and form data, escape HTML entities, or escape JS/JSON strings and Unicode, in either direction.",
		keywords: ["url encode", "percent", "urlencode", "encodeURIComponent", "html entities", "&amp;", "nbsp", "xss", "escape", "unescape", "string literal", "\\u", "unicode escape", "form encoding"],
		live: true,
		inputs: [
			{ key: "text", label: "Text", type: "textarea" },
			{
				key: "format",
				label: "Format",
				type: "select",
				options: [
					{ value: "url-component", label: "URL component (query value, path segment)" },
					{ value: "url", label: "Full URL (keeps / ? & =)" },
					{ value: "form", label: "Form data (space as +)" },
					{ value: "html", label: "HTML entities" },
					{ value: "html-all", label: "HTML entities + non ASCII" },
					{ value: "js", label: "JS / JSON string literal" },
					{ value: "unicode", label: "Unicode \\uXXXX escapes" },
				],
				default: "url-component",
			},
			{ key: "mode", label: "Direction", type: "select", options: [{ value: "encode", label: "Encode / escape" }, { value: "decode", label: "Decode / unescape" }], default: "encode", help: "Decoding is lenient: malformed sequences are left as they are." },
		],
		run: ({ text, format = "url-component", mode = "encode" }) => ({
			type: "text",
			value: escapeText(requireText(text, "Text"), format, mode),
		}),
	},
	{
		id: "jwt-decode",
		name: "JWT decoder",
		category: "Encoding",
		roles: ["dev", "qa", "security"],
		description: "Decode header and claims, show human readable dates, check expiry and optionally verify the signature.",
		keywords: ["jwt", "jws", "token", "bearer", "claims", "oauth", "verify", "hs256", "rs256", "signature"],
		live: true,
		inputs: [
			{ key: "token", label: "JWT", type: "textarea", placeholder: "eyJhbGciOi...", sensitive: true, help: "A leading \"Bearer \" is ignored. Decoding happens locally." },
			{ key: "key", label: "Secret or public key (optional)", type: "textarea", sensitive: true, placeholder: "HS*: shared secret · RS*/PS*/ES*: -----BEGIN PUBLIC KEY----- or JWK", help: "Leave empty to only decode. With a key the signature is verified locally with WebCrypto." },
			{ key: "keyEncoding", label: "HMAC secret format", type: "select", options: [{ value: "utf8", label: "Plain text" }, { value: "base64", label: "Base64 / base64url" }], default: "utf8" },
		],
		run: async ({ token, key = "", keyEncoding = "utf8" }) => ({
			type: "json",
			value: await decodeJwt(token, { key: String(key ?? ""), keyEncoding }),
		}),
	},
	{
		id: "hash",
		name: "Hash & HMAC generator",
		category: "Encoding",
		roles: ["dev", "security", "it"],
		description: "MD5, SHA-1/256/384/512 and HMAC for text or files; compare against a published checksum or build SRI strings.",
		keywords: ["checksum", "sha256", "sha1", "md5", "hmac", "digest", "integrity", "sri", "verify download", "file hash"],
		async: true,
		live: true,
		inputs: [
			{ key: "source", label: "Input", type: "select", options: [{ value: "text", label: "Text" }, { value: "file", label: "File (checksum)" }], default: "text" },
			{ key: "text", label: "Text", type: "textarea", showIf: { key: "source", in: ["text"] }, help: "Hashed as UTF-8. To checksum a file byte for byte, switch Input to File." },
			{ key: "file", label: "File", type: "file", read: "bytes", accept: "*/*", showIf: { key: "source", in: ["file"] } },
			{
				key: "algorithm",
				label: "Algorithm",
				type: "select",
				options: [
					{ value: "SHA-256", label: "SHA-256" },
					{ value: "SHA-1", label: "SHA-1" },
					{ value: "SHA-384", label: "SHA-384" },
					{ value: "SHA-512", label: "SHA-512" },
					{ value: "MD5", label: "MD5 (legacy checksums only)" },
					{ value: "all", label: "All algorithms" },
				],
				default: "SHA-256",
			},
			{ key: "key", label: "HMAC key (optional)", type: "text", sensitive: true, help: "When set, computes HMAC with the selected hash instead of a plain digest." },
			{
				key: "encoding",
				label: "Output",
				type: "select",
				options: [
					{ value: "hex", label: "Hex (lowercase)" },
					{ value: "HEX", label: "Hex (uppercase)" },
					{ value: "base64", label: "Base64" },
					{ value: "sri", label: "SRI integrity (sha384-…)" },
				],
				default: "hex",
			},
			{ key: "expected", label: "Compare with (optional)", type: "text", placeholder: "Paste a published checksum", help: "Hex, Base64 or SRI form; shows whether the digest matches." },
		],
		run: runHash,
	},
	{
		id: "uuid",
		name: "UUID / ULID generator",
		category: "Encoding",
		roles: ["dev", "qa"],
		description: "Random v4 UUIDs, time ordered v7 UUIDs and ULIDs for test fixtures and database keys.",
		keywords: ["guid", "uuid", "ulid", "v4", "v7", "unique id", "random id"],
		inputs: [
			{ key: "count", label: "How many", type: "number", default: 5, min: 1, max: 1000 },
			{
				key: "kind",
				label: "Kind",
				type: "select",
				options: [
					{ value: "uuid-v4", label: "UUID v4 (random)" },
					{ value: "uuid-v7", label: "UUID v7 (time ordered)" },
					{ value: "ulid", label: "ULID" },
					{ value: "sortable", label: "Sortable base36 (legacy)" },
				],
				default: "uuid-v4",
			},
			{ key: "uppercase", label: "Uppercase", type: "checkbox", default: false },
		],
		run: ({ count = 5, kind = "uuid-v4", uppercase = false }) => {
			const text = generateIds(count, kind).join("\n")
			return { type: "text", value: uppercase ? text.toUpperCase() : text }
		},
	},
	{
		id: "secret-generator",
		name: "Password / API key generator",
		category: "Encoding",
		roles: ["dev", "qa", "security", "it"],
		description: "Unbiased cryptographically random passwords, hex keys, tokens and PINs with entropy estimate.",
		keywords: ["password", "passphrase", "api key", "token", "random", "secret", "pin", "entropy"],
		inputs: [
			{
				key: "kind",
				label: "Kind",
				type: "select",
				options: [
					{ value: "password", label: "Password" },
					{ value: "hex", label: "Hex key" },
					{ value: "base64url", label: "URL safe token" },
					{ value: "pin", label: "Numeric PIN" },
				],
				default: "password",
			},
			{ key: "length", label: "Length (characters)", type: "number", default: 24, min: 4, max: 256 },
			{ key: "symbols", label: "Include symbols", type: "checkbox", default: true, showIf: { key: "kind", in: ["password"] } },
			{ key: "excludeAmbiguous", label: "Avoid look alikes (I l 1 O 0 o)", type: "checkbox", default: false, showIf: { key: "kind", in: ["password"] } },
			{ key: "count", label: "How many", type: "number", default: 1, min: 1, max: 50 },
		],
		run: ({ kind = "password", length = 24, symbols = true, excludeAmbiguous = false, count = 1 }) => {
			const randomIndex = createRandomIndex()
			const total = Math.min(Math.max(Math.floor(Number(count)) || 1, 1), 50)
			const results = Array.from({ length: total }, () => generateSecret({ kind, length, symbols, excludeAmbiguous }, randomIndex))
			const secrets = results.map((r) => r.secret).join("\n")
			return { type: "text", value: `${secrets}\n\n≈ ${results[0].bits} bits of entropy each`, copy: secrets }
		},
	},
	{
		id: "number-base",
		name: "Number base converter",
		category: "Encoding",
		roles: ["dev", "qa", "security"],
		description: "Convert integers of any size between decimal, hex, octal, binary and base 36.",
		keywords: ["hex", "binary", "octal", "decimal", "radix", "base", "bigint", "0x"],
		live: true,
		inputs: [
			{ key: "value", label: "Number", type: "text", placeholder: "0xFF, 0b1010, 255", help: "Prefixes 0x, 0o and 0b are detected automatically; underscores and spaces are ignored." },
			{
				key: "from",
				label: "Input base",
				type: "select",
				options: [
					{ value: "auto", label: "Auto (decimal or prefix)" },
					{ value: "2", label: "Binary (2)" },
					{ value: "8", label: "Octal (8)" },
					{ value: "10", label: "Decimal (10)" },
					{ value: "16", label: "Hexadecimal (16)" },
					{ value: "36", label: "Base 36" },
				],
				default: "auto",
			},
		],
		run: ({ value, from = "auto" }) => {
			const rows = convertNumberBase(value, from)
			return { type: "table", value: { columns: ["Base", "Value"], rows }, copy: rows.map(([k, v]) => `${k}: ${v}`).join("\n") }
		},
	},
]
