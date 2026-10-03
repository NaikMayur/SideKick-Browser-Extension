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
		captureVisibleTab: (windowIdOrOpts, opts) =>
			typeof windowIdOrOpts === "number"
				? call("tabs.captureVisibleTab", windowIdOrOpts, opts ?? {})
				: call("tabs.captureVisibleTab", windowIdOrOpts ?? {}),
	},
	runtime: {
		sendMessage: (message) => call("runtime.sendMessage", message),
		getURL: (path) => raw?.runtime?.getURL?.(path) ?? path,
		onMessage: raw?.runtime?.onMessage,
		getManifest: () => raw?.runtime?.getManifest?.() ?? {},
	},
	scripting: {
		executeScript: (details) => call("scripting.executeScript", details),
		insertCSS: (details) => call("scripting.insertCSS", details),
	},
	cookies: {
		getAll: (details) => call("cookies.getAll", details),
		remove: (details) => call("cookies.remove", details),
	},
	downloads: {
		download: (options) => call("downloads.download", options),
	},
	windows: {
		getCurrent: (opts) => (opts !== undefined ? call("windows.getCurrent", opts) : call("windows.getCurrent")),
		update: (windowId, updateInfo) => call("windows.update", windowId, updateInfo),
		create: (createData) => call("windows.create", createData),
	},
	commands: raw?.commands,
	contextMenus: raw?.contextMenus ?? raw?.menus,
}

export async function activeTab() {
	try {
		const tabs = await api.tabs.query({ active: true, currentWindow: true })
		const current = tabs?.[0]
		const extPrefix = api.runtime?.getURL ? api.runtime.getURL("") : ""
		if (current && (!extPrefix || !current.url?.startsWith(extPrefix))) {
			return current
		}
		const lastFocused = await api.tabs.query({ active: true, lastFocusedWindow: true })
		if (lastFocused?.[0] && (!extPrefix || !lastFocused[0].url?.startsWith(extPrefix))) {
			return lastFocused[0]
		}
		const allTabs = await api.tabs.query({ active: true })
		const target = allTabs?.find((t) => !extPrefix || !t.url?.startsWith(extPrefix))
		return target ?? current ?? null
	} catch {
		return null
	}
}

const RESTRICTED_PATTERNS = /^(chrome|chrome-extension|edge|about|brave|opera|vivaldi|moz-extension|file):\/\//

export function isRestrictedUrl(url) {
	if (!url) return true
	if (RESTRICTED_PATTERNS.test(url)) return true
	if (url.includes("chromewebstore.google.com")) return true
	if (url.includes("addons.mozilla.org")) return true
	if (url.includes("microsoftedge.microsoft.com/addons")) return true
	return false
}

// Injected on demand when a page tool is used. The only content script declared in the
// manifests is the small main world console buffer.
export const PAGE_INJECTION = Object.freeze({
	js: Object.freeze(["content/content.js"]),
	css: Object.freeze(["content/overlay.css"]),
})

export function isNoReceiverError(error) {
	const text = String(error?.message ?? error)
	return text.includes("Receiving end does not exist") || text.includes("Could not establish connection")
}

export async function ensureInjected(tabId) {
	try {
		await api.scripting.executeScript({ target: { tabId }, files: [...PAGE_INJECTION.js] })
	} catch {
		return false
	}
	try {
		await api.scripting.insertCSS({ target: { tabId }, files: [...PAGE_INJECTION.css] })
	} catch {
		// The overlay lives in a shadow root and the page stylesheet is cosmetic, so keep going.
	}
	return true
}

// With inject false a missing receiver resolves quietly to { ok: false, error: "not-injected" },
// so status queries never inject Sidekick into a page just because the popup opened.
export async function sendToTab(tabId, message, { inject = true } = {}) {
	try {
		const response = await api.tabs.sendMessage(tabId, message)
		return response ?? { ok: false, error: "No response from page" }
	} catch (firstError) {
		if (!isNoReceiverError(firstError)) {
			return { ok: false, error: `Content script error: ${firstError?.message ?? firstError}` }
		}
		if (!inject) return { ok: false, error: "not-injected" }
		if (!(await ensureInjected(tabId))) {
			return {
				ok: false,
				error: "Could not inject Sidekick into this page. It may be a restricted or protected page.",
			}
		}
		for (const wait of [60, 200]) {
			await new Promise((resolve) => setTimeout(resolve, wait))
			try {
				const response = await api.tabs.sendMessage(tabId, message)
				return response ?? { ok: false, error: "No response from page" }
			} catch (retryError) {
				if (wait === 200) return { ok: false, error: `Page not reachable after injection: ${retryError?.message ?? retryError}` }
			}
		}
		return { ok: false, error: "Page not reachable after injection" }
	}
}

export async function sendToPage(message, { inject = true } = {}) {
	const tab = await activeTab()
	if (!tab?.id) return { ok: false, error: "No active tab" }

	if (isRestrictedUrl(tab.url)) {
		if (!inject) return { ok: false, error: "restricted" }
		return {
			ok: false,
			error: "Sidekick cannot run on browser internal pages (chrome://, edge://, about:) or extension store pages. Open a regular website and try again.",
		}
	}
	return sendToTab(tab.id, message, { inject })
}

export async function resizeCurrentWindow(width, height) {
	try {
		if (!isExtension) return { ok: false, error: "No window found (extension runtime unavailable)" }
		const tab = await activeTab()
		let winId = tab?.windowId
		if (!winId && api.windows?.getCurrent) {
			try {
				const cur = await api.windows.getCurrent()
				winId = cur?.id
			} catch {  }
		}
		if (!winId) return { ok: false, error: "No window found to resize" }

		const targetW = Math.max(280, Math.round(Number(width) || 800))
		const targetH = Math.max(200, Math.round(Number(height) || 600))

		try {
			await api.windows.update(winId, { state: "normal", width: targetW, height: targetH })
			return { ok: true, width: targetW, height: targetH }
		} catch {
			try {
				await api.windows.update(winId, { state: "normal" })
			} catch {  }
			await api.windows.update(winId, { width: targetW, height: targetH })
			return { ok: true, width: targetW, height: targetH }
		}
	} catch (err) {
		return { ok: false, error: err?.message || String(err) }
	}
}

