export class ToolError extends Error {
	constructor(message) {
		super(message)
		this.name = "ToolError"
	}
}

export function assert(condition, message) {
	if (!condition) throw new ToolError(message)
	return true
}

export function required(value, label) {
	if (value === undefined || value === null || String(value).trim() === "") {
		throw new ToolError(`${label} is required`)
	}
	return String(value)
}

export function toBase64(input) {
	const bytes = new TextEncoder().encode(input)
	let binary = ""
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoaSafe(binary)
}

export function fromBase64(input) {
	let normalised = String(input ?? "")
		.trim()
		.replace(/\s+/g, "")
		.replace(/-/g, "+")
		.replace(/_/g, "/")
	while (normalised.length % 4) normalised += "="
	const binary = atobSafe(normalised)
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

function btoaSafe(binary) {
	if (typeof btoa === "function") return btoa(binary)
	return Buffer.from(binary, "binary").toString("base64")
}

function atobSafe(value) {
	try {
		if (typeof atob === "function") return atob(value)
		return Buffer.from(value, "base64").toString("binary")
	} catch {
		throw new ToolError("Input is not valid base64")
	}
}

export function base64UrlDecode(segment) {
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/")
	const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4))
	return fromBase64(padded + pad)
}

export function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value))
}

export function round(value, decimals = 2) {
	const factor = 10 ** decimals
	return Math.round(value * factor) / factor
}

export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

export function unescapeHtml(value) {
	return String(value)
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export function seededRandom(seed) {
	let state = 0
	const text = String(seed ?? "devkit")
	for (let i = 0; i < text.length; i += 1) state = (state * 31 + text.charCodeAt(i)) >>> 0
	if (state === 0) state = 0x9e3779b9
	return () => {
		state ^= state << 13
		state >>>= 0
		state ^= state >> 17
		state ^= state << 5
		state >>>= 0
		return state / 0xffffffff
	}
}

export function pick(random, list) {
	return list[Math.floor(random() * list.length) % list.length]
}

export function safeJsonParse(text, label = "JSON") {
	try {
		return JSON.parse(text)
	} catch (error) {
		throw new ToolError(`Invalid ${label}: ${error.message}`)
	}
}

export function debounce(fn, wait = 150) {
	let timer = null
	return (...args) => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => fn(...args), wait)
	}
}

export function formatBytes(bytes) {
	const units = ["B", "KB", "MB", "GB"]
	const raw = Number(bytes)
	if (Number.isNaN(raw) || raw <= 0) return "0 B"
	let value = raw
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit += 1
	}
	return `${round(value, 2)} ${units[unit]}`
}
