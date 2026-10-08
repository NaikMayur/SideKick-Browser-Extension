import { api } from "./browser.js"

const DB_NAME = "sidekick-vault"
const KEY_STORE = "keys"
const AES_ID = "aes-256-gcm/v1"
const HMAC_ID = "hmac-sha-256/v1"
export const VAULT_PREFIX = "vault:"

const encoder = new TextEncoder()
const decoder = new TextDecoder()
let keysPromise = null

function request(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

function openDb() {
	const req = indexedDB.open(DB_NAME, 1)
	req.onupgradeneeded = () => {
		if (!req.result.objectStoreNames.contains(KEY_STORE)) req.result.createObjectStore(KEY_STORE)
	}
	return request(req)
}

function readKeys(db) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, "readonly")
		const store = tx.objectStore(KEY_STORE)
		const out = {}
		store.get(AES_ID).onsuccess = (event) => (out.aes = event.target.result)
		store.get(HMAC_ID).onsuccess = (event) => (out.hmac = event.target.result)
		tx.oncomplete = () => resolve(out)
		tx.onerror = () => reject(tx.error)
	})
}

function keepFirst(db, candidates) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, "readwrite")
		const store = tx.objectStore(KEY_STORE)
		const out = {}
		for (const [slot, id] of [["aes", AES_ID], ["hmac", HMAC_ID]]) {
			const read = store.get(id)
			read.onsuccess = () => {
				if (read.result) out[slot] = read.result
				else {
					out[slot] = candidates[slot]
					store.put(candidates[slot], id)
				}
			}
		}
		tx.oncomplete = () => resolve(out)
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error)
	})
}

let ephemeral = false

async function freshKeys() {
	return {
		aes: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
		hmac: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
	}
}

async function loadKeys() {
	let db
	try {
		db = await openDb()
	} catch {
		ephemeral = true
		return freshKeys()
	}
	try {
		const existing = await readKeys(db)
		if (existing.aes && existing.hmac) return existing
		return await keepFirst(db, await freshKeys())
	} finally {
		db.close()
	}
}

export function vaultIsEphemeral() {
	return ephemeral
}

function keys() {
	if (!keysPromise) {
		keysPromise = loadKeys().catch((error) => {
			keysPromise = null
			throw error
		})
	}
	return keysPromise
}

function toBase64(bytes) {
	let binary = ""
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary)
}

function fromBase64(text) {
	const binary = atob(text)
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
	return out
}

function context(scope) {
	return encoder.encode(`sidekick/${scope}/v1`)
}

export function isSealed(value) {
	return Boolean(value) && value.v === 1 && value.alg === "A256GCM" && typeof value.iv === "string" && typeof value.ct === "string"
}

export async function seal(scope, value) {
	const { aes } = await keys()
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const plain = encoder.encode(JSON.stringify(value))
	const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context(scope), tagLength: 128 }, aes, plain)
	return { v: 1, alg: "A256GCM", iv: toBase64(iv), ct: toBase64(new Uint8Array(cipher)) }
}

export async function unseal(scope, envelope) {
	if (!isSealed(envelope)) throw new Error("Not an encrypted Sidekick record")
	const { aes } = await keys()
	const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: context(scope), tagLength: 128 }, aes, fromBase64(envelope.ct))
	return JSON.parse(decoder.decode(plain))
}

export async function fingerprint(value) {
	const { hmac } = await keys()
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, encoder.encode(String(value))))
	return toBase64(mac).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function area(session) {
	return session && api.session ? api.session : api.storage
}

export async function vaultSet(name, value, { session = false } = {}) {
	const envelope = await seal(name, value)
	await area(session).set({ [VAULT_PREFIX + name]: envelope })
}

export async function vaultGet(name, { session = false } = {}) {
	const key = VAULT_PREFIX + name
	const got = await area(session).get(key)
	const envelope = got?.[key]
	if (!envelope) return null
	try {
		return await unseal(name, envelope)
	} catch {
		return null
	}
}

export async function vaultRemove(name, { session = false } = {}) {
	await area(session).remove(VAULT_PREFIX + name)
}

export async function vaultDestroy() {
	keysPromise = null
	await new Promise((resolve) => {
		const req = indexedDB.deleteDatabase(DB_NAME)
		req.onsuccess = req.onerror = req.onblocked = () => resolve()
	})
}

export async function readDrafts() {
	const sealed = await vaultGet("drafts")
	if (sealed && typeof sealed === "object") return sealed
	const legacy = (await api.storage.get("drafts").catch(() => ({})))?.drafts
	if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
		await vaultSet("drafts", legacy)
		await api.storage.remove("drafts").catch(() => {})
		return legacy
	}
	return {}
}

export async function writeDrafts(drafts) {
	await vaultSet("drafts", drafts && typeof drafts === "object" ? drafts : {})
}

export async function clearDrafts() {
	await Promise.all([vaultRemove("drafts"), api.storage.remove("drafts").catch(() => {})])
}

export async function wipeEverything() {
	await Promise.all([api.storage.clear().catch(() => {}), api.session?.clear().catch(() => {})])
	await vaultDestroy()
}
