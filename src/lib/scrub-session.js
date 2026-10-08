import { api } from "./browser.js"
import { canonicalValue, existingPlaceholders, findSensitive, maskWith, previewOf, restoreWith } from "./scrubber.js"
import { VAULT_PREFIX, fingerprint, unseal, vaultSet } from "./vault.js"

const INDEX_KEY = "scrub:index"
const VALUE_PREFIX = "scrub/"

function area() {
	return api.session ?? api.storage
}

async function readIndex() {
	const got = await area().get(INDEX_KEY).catch(() => ({}))
	const index = got?.[INDEX_KEY]
	if (!index || typeof index !== "object") return { counters: {}, byHash: {} }
	return { counters: { ...(index.counters ?? {}) }, byHash: { ...(index.byHash ?? {}) } }
}

export async function maskText(text, options = {}) {
	const source = String(text ?? "")
	const findings = findSensitive(source, options)
	if (!findings.length) return { text: source, findings: [], counts: {} }
	const index = await readIndex()
	for (const [type, highest] of Object.entries(existingPlaceholders(source))) index.counters[type] = Math.max(index.counters[type] ?? 0, highest)
	const fresh = {}
	const assigned = new Map()
	const keyOf = (item) => canonicalValue(item.type, item.value)
	for (const item of findings) {
		const key = keyOf(item)
		if (assigned.has(key)) continue
		const hash = await fingerprint(key)
		let placeholder = index.byHash[hash]
		if (!placeholder) {
			index.counters[item.type] = (index.counters[item.type] ?? 0) + 1
			placeholder = `${item.type}_${index.counters[item.type]}`
			index.byHash[hash] = placeholder
			fresh[placeholder] = { type: item.type, value: item.value }
		}
		assigned.set(key, placeholder)
	}
	await Promise.all(Object.entries(fresh).map(([placeholder, entry]) => vaultSet(VALUE_PREFIX + placeholder, entry, { session: true })))
	await area().set({ [INDEX_KEY]: index })
	const counts = {}
	for (const item of findings) counts[item.type] = (counts[item.type] ?? 0) + 1
	return {
		text: maskWith(source, findings, (item) => `[${assigned.get(keyOf(item))}]`),
		findings: findings.map((item) => ({ type: item.type, kind: item.kind, placeholder: assigned.get(keyOf(item)), preview: previewOf(item.value) })),
		counts,
	}
}

async function savedEntries() {
	const all = await area().get(null).catch(() => ({}))
	const prefix = VAULT_PREFIX + VALUE_PREFIX
	const out = {}
	await Promise.all(Object.entries(all ?? {}).filter(([key]) => key.startsWith(prefix)).map(async ([key, envelope]) => {
		const name = key.slice(VAULT_PREFIX.length)
		try {
			const entry = await unseal(name, envelope)
			out[name.slice(VALUE_PREFIX.length)] = entry?.value
		} catch {}
	}))
	return out
}

export async function restoreText(text) {
	const lookup = await savedEntries()
	return restoreWith(text, (key) => lookup[key])
}

export async function savedCount() {
	const all = await area().get(null).catch(() => ({}))
	return Object.keys(all ?? {}).filter((key) => key.startsWith(VAULT_PREFIX + VALUE_PREFIX)).length
}

export async function forgetScrubs() {
	const all = await area().get(null).catch(() => ({}))
	const keys = Object.keys(all ?? {}).filter((key) => key === INDEX_KEY || key.startsWith(VAULT_PREFIX + VALUE_PREFIX))
	if (keys.length) await area().remove(keys)
	return keys.filter((key) => key !== INDEX_KEY).length
}

export function summarizeCounts(counts) {
	const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])
	if (!entries.length) return "Nothing sensitive found"
	const total = entries.reduce((sum, [, n]) => sum + n, 0)
	return `Masked ${total}: ${entries.map(([type, n]) => `${n} ${type.toLowerCase().replace(/_/g, " ")}`).join(", ")}`
}
