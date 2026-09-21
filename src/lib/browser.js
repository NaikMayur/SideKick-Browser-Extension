const globalScope = typeof globalThis !== "undefined" ? globalThis : self

function detectRuntime() {
	if (typeof globalScope.browser !== "undefined" && globalScope.browser?.runtime?.id) {
		return { api: globalScope.browser, flavor: "webextension" }
	}
	if (typeof globalScope.chrome !== "undefined" && globalScope.chrome?.runtime?.id) {
		return { api: globalScope.chrome, flavor: "chromium" }
	}
	return { api: null, flavor: "none" }
}

const { api: raw, flavor } = detectRuntime()

export const isExtension = flavor !== "none"
export const isChromium = flavor === "chromium"

function promisify(fn, thisArg) {
	return (...args) =>
		new Promise((resolve, reject) => {
			try {
				const maybe = fn.call(thisArg, ...args, (result) => {
					const err = raw?.runtime?.lastError
					if (err) reject(new Error(err.message))
					else resolve(result)
				})
				if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject)
			} catch (error) {
				reject(error)
			}
		})
}

function call(path, ...args) {
	if (!raw) return Promise.reject(new Error(`WebExtension API unavailable: ${path}`))
	const parts = path.split(".")
	let target = raw
	for (const part of parts.slice(0, -1)) {
		target = target?.[part]
		if (!target) return Promise.reject(new Error(`Unsupported API: ${path}`))
	}
	const method = target[parts.at(-1)]
	if (typeof method !== "function") return Promise.reject(new Error(`Unsupported API: ${path}`))
	if (flavor === "webextension") {
		try {
			return Promise.resolve(method.apply(target, args))
		} catch (error) {
			return Promise.reject(error)
		}
	}
	return promisify(method, target)(...args)
}

export const api = {
	raw,
	flavor,
	storage: {
		get: (keys) => call("storage.local.get", keys),
		set: (items) => call("storage.local.set", items),
		remove: (keys) => call("storage.local.remove", keys),
		clear: () => call("storage.local.clear"),
	},
	tabs: {
		query: (info) => call("tabs.query", info),
		sendMessage: (tabId, message) => call("tabs.sendMessage", tabId, message),
		create: (info) => call("tabs.create", info),
		update: (tabId, info) => call("tabs.update", tabId, info),
		captureVisibleTab: (opts) => call("tabs.captureVisibleTab", opts),
	},
	runtime: {
		sendMessage: (message) => call("runtime.sendMessage", message),
		getURL: (path) => raw?.runtime?.getURL?.(path) ?? path,
		onMessage: raw?.runtime?.onMessage,
		getManifest: () => raw?.runtime?.getManifest?.() ?? {},
	},
	scripting: {
		executeScript: (details) => call("scripting.executeScript", details),
	},
	cookies: {
		getAll: (details) => call("cookies.getAll", details),
		remove: (details) => call("cookies.remove", details),
	},
	downloads: {
		download: (options) => call("downloads.download", options),
	},
	commands: raw?.commands,
	contextMenus: raw?.contextMenus ?? raw?.menus,
}

export async function activeTab() {
	try {
		const tabs = await api.tabs.query({ active: true, currentWindow: true })
		return tabs?.[0] ?? null
	} catch {
		return null
	}
}

const RESTRICTED_PATTERNS = /^(chrome|chrome-extension|edge|about|brave|opera|vivaldi|moz-extension|file):\/\//

function isRestrictedUrl(url) {
	if (!url) return true
	if (RESTRICTED_PATTERNS.test(url)) return true
	if (url.includes("chromewebstore.google.com")) return true
	if (url.includes("addons.mozilla.org")) return true
	if (url.includes("microsoftedge.microsoft.com/addons")) return true
	return false
}

async function injectContentScript(tabId) {
	try {
		await api.scripting.executeScript({
			target: { tabId },
			files: ["content/content.js"],
		})
		return true
	} catch {
		return false
	}
}

export async function sendToPage(message) {
	const tab = await activeTab()
	if (!tab?.id) return { ok: false, error: "No active tab" }

	if (isRestrictedUrl(tab.url)) {
		return {
			ok: false,
			error: "Sidekick cannot run on browser internal pages (chrome://, edge://, about:) or extension store pages. Open a regular website and try again.",
		}
	}

	try {
		const response = await api.tabs.sendMessage(tab.id, message)
		return response ?? { ok: false, error: "No response from page" }
	} catch (firstError) {
		const isNoReceiver =
			String(firstError?.message).includes("Receiving end does not exist") ||
			String(firstError?.message).includes("Could not establish connection")

		if (!isNoReceiver) {
			return { ok: false, error: `Content script error: ${firstError.message}` }
		}

		const injected = await injectContentScript(tab.id)
		if (!injected) {
			return {
				ok: false,
				error: "Could not inject Sidekick into this page. It may be a restricted or protected page.",
			}
		}

		await new Promise((resolve) => setTimeout(resolve, 150))

		try {
			const response = await api.tabs.sendMessage(tab.id, message)
			return response ?? { ok: false, error: "No response from page" }
		} catch (retryError) {
			return { ok: false, error: `Page not reachable after injection: ${retryError.message}` }
		}
	}
}
