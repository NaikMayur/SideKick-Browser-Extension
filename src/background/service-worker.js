import { api, isExtension, isRestrictedUrl, sendToTab } from "../lib/browser.js"

const MENU_ITEMS = [
	{ id: "sidekick-inspect", title: "Sidekick: inspect element", command: "toggle-inspect" },
	{ id: "sidekick-grid", title: "Sidekick: toggle layout grid", command: "toggle-grid" },
	{ id: "sidekick-a11y", title: "Sidekick: run accessibility audit", command: "audit-a11y" },
	{ id: "sidekick-bug", title: "Sidekick: capture bug context", command: "capture-context" },
]

function safe(fn) {
	return (...args) => {
		try {
			const out = fn(...args)
			if (out && typeof out.catch === "function") out.catch((error) => console.warn("[Sidekick]", error))
			return out
		} catch (error) {
			console.warn("[Sidekick]", error)
			return undefined
		}
	}
}

function installMenus() {
	const menus = api.contextMenus
	if (!menus?.create) return
	menus.removeAll?.(() => {
		for (const item of MENU_ITEMS) {
			try {
				menus.create({ id: item.id, title: item.title, contexts: ["page", "selection", "image", "link"] })
			} catch (error) {
				console.warn("[Sidekick] menu", error)
			}
		}
	})
}

async function pushHistory(entry) {
	const { history = [] } = await api.storage.get("history")
	const next = [{ ...entry, at: new Date().toISOString() }, ...history].slice(0, 100)
	await api.storage.set({ history: next })
	return next
}

async function relayToActiveTab(command, payload = {}, tabId = null) {
	let id = tabId
	if (!id) {
		const tabs = await api.tabs.query({ active: true, currentWindow: true })
		const tab = tabs?.[0]
		if (!tab?.id) return { ok: false, error: "No active tab" }
		if (isRestrictedUrl(tab.url)) return { ok: false, error: "Sidekick cannot run on this page" }
		id = tab.id
	}
	return (await sendToTab(id, { type: command, payload })) ?? { ok: true }
}

// captureVisibleTab is rate limited (about 2 calls per second on Chromium); every capture is queued here.
const CAPTURE_GAP_MS = 550
let captureQueue = Promise.resolve()
let lastCaptureAt = 0

function captureTab(windowId) {
	const run = async () => {
		for (let attempt = 0; attempt < 4; attempt++) {
			const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now()
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
			lastCaptureAt = Date.now()
			try {
				return await api.tabs.captureVisibleTab(typeof windowId === "number" ? windowId : undefined, { format: "png" })
			} catch (error) {
				if (!/MAX_CAPTURE|quota|rate/i.test(String(error?.message)) || attempt === 3) throw error
				await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
			}
		}
		throw new Error("Screenshot failed")
	}
	const next = captureQueue.then(run, run)
	captureQueue = next.catch(() => {})
	return next
}

const LINK_LIMIT = 300
const LINK_CONCURRENCY = 6
const LINK_TIMEOUT_MS = 8000

async function timedFetch(url, init, timeoutMs = LINK_TIMEOUT_MS) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "follow" })
	} finally {
		clearTimeout(timer)
	}
}

async function discardBody(res) {
	try {
		await res.body?.cancel()
	} catch {}
}

function linkResult(url, res, method, started) {
	return {
		url,
		ok: res.ok,
		status: res.status,
		statusText: res.statusText,
		redirected: res.redirected,
		finalUrl: res.redirected ? res.url : undefined,
		method,
		ms: Date.now() - started,
	}
}

async function checkOneLink(url, pageOrigin) {
	let origin = ""
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { url, ok: null, status: null, error: "unsupported scheme" }
		origin = parsed.origin
	} catch {
		return { url, ok: false, status: null, error: "invalid URL" }
	}
	// Only send cookies to the page's own origin.
	const credentials = origin === pageOrigin ? "include" : "omit"
	const started = Date.now()
	try {
		const head = await timedFetch(url, { method: "HEAD", credentials })
		if (![400, 403, 405, 501].includes(head.status)) return linkResult(url, head, "HEAD", started)
	} catch (error) {
		if (error?.name === "AbortError") return { url, ok: false, status: null, error: "timeout", method: "HEAD", ms: Date.now() - started }
	}
	try {
		const res = await timedFetch(url, { method: "GET", credentials })
		await discardBody(res)
		return linkResult(url, res, "GET", started)
	} catch (error) {
		return {
			url,
			ok: false,
			status: null,
			error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
			method: "GET",
			ms: Date.now() - started,
		}
	}
}

async function checkLinks(urls, pageUrl) {
	let pageOrigin = ""
	try {
		pageOrigin = new URL(pageUrl).origin
	} catch {}
	const list = Array.isArray(urls) ? urls.filter((u) => typeof u === "string") : []
	const unique = [...new Set(list)].slice(0, LINK_LIMIT)
	const results = new Array(unique.length)
	let cursor = 0
	const worker = async () => {
		while (cursor < unique.length) {
			const index = cursor++
			results[index] = await checkOneLink(unique[index], pageOrigin)
		}
	}
	await Promise.all(Array.from({ length: Math.min(LINK_CONCURRENCY, unique.length) }, worker))
	return { results, checked: unique.length, truncated: new Set(list).size > unique.length }
}

const SECURITY_HEADERS = [
	"content-security-policy",
	"content-security-policy-report-only",
	"strict-transport-security",
	"x-content-type-options",
	"x-frame-options",
	"referrer-policy",
	"permissions-policy",
	"cross-origin-opener-policy",
	"cross-origin-embedder-policy",
	"cross-origin-resource-policy",
	"x-xss-protection",
	"server",
	"x-powered-by",
	"access-control-allow-origin",
]

async function securityCheck(pageUrl) {
	const out = { url: pageUrl ?? null, status: null, finalUrl: null, headers: {}, cookies: [], error: null }
	let parsed
	try {
		parsed = new URL(pageUrl)
	} catch {
		return { ...out, error: "invalid URL" }
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ...out, error: "unsupported scheme" }
	try {
		const res = await timedFetch(pageUrl, { method: "GET", credentials: "include" }, 12000)
		out.status = res.status
		out.finalUrl = res.url
		for (const name of SECURITY_HEADERS) {
			const value = res.headers.get(name)
			if (value !== null) out.headers[name] = value.slice(0, 4000)
		}
		await discardBody(res)
	} catch (error) {
		out.error = error?.name === "AbortError" ? "timeout" : String(error?.message ?? error)
	}
	try {
		const cookies = await api.cookies.getAll({ url: pageUrl })
		out.cookies = (cookies ?? []).slice(0, 200).map((c) => ({
			name: c.name,
			domain: c.domain,
			path: c.path,
			secure: Boolean(c.secure),
			httpOnly: Boolean(c.httpOnly),
			sameSite: c.sameSite ?? "unspecified",
			session: Boolean(c.session),
			hostOnly: Boolean(c.hostOnly),
		}))
	} catch {}
	return out
}

if (isExtension) {
	api.raw.runtime.onInstalled?.addListener(
		safe(async (details) => {
			installMenus()
			const defaults = { theme: "system", role: "all", snippets: [], history: [], pinned: [] }
			const current = await api.storage.get(Object.keys(defaults))
			const missing = Object.fromEntries(
				Object.entries(defaults).filter(([key]) => current[key] === undefined),
			)
			if (Object.keys(missing).length) await api.storage.set(missing)
			if (details?.reason === "install") {
				try {
					await api.tabs.create({ url: api.runtime.getURL("options/options.html#welcome") })
				} catch {}
			}
		}),
	)

	api.contextMenus?.onClicked?.addListener(
		safe((info) => {
			const item = MENU_ITEMS.find((entry) => entry.id === info.menuItemId)
			if (item) return relayToActiveTab(item.command, { source: "menu" })
			return undefined
		}),
	)

	api.commands?.onCommand?.addListener(safe((command) => relayToActiveTab(command, { source: "shortcut" })))

	api.raw.runtime.onMessage?.addListener((message, sender, sendResponse) => {
		;(async () => {
			try {
				switch (message?.type) {
					case "ping":
						sendResponse({ ok: true, flavor: api.flavor, version: api.runtime.getManifest().version })
						break
					case "relay":
						sendResponse(await relayToActiveTab(message.command, message.payload, message.tabId ?? null))
						break
					case "history:add":
						sendResponse({ ok: true, history: await pushHistory(message.entry ?? {}) })
						break
					case "screenshot": {
						const dataUrl = await captureTab(sender?.tab?.windowId)
						sendResponse({ ok: true, dataUrl })
						break
					}
					case "links:check": {
						sendResponse({ ok: true, ...(await checkLinks(message.urls, message.pageUrl ?? sender?.tab?.url ?? "")) })
						break
					}
					case "security:check": {
						sendResponse({ ok: true, data: await securityCheck(message.url ?? sender?.tab?.url) })
						break
					}
					case "cookies:list": {
						const cookies = await api.cookies.getAll({ url: message.url })
						sendResponse({ ok: true, cookies })
						break
					}
					case "open-sidepanel": {
						try {
							if (api.raw.sidePanel?.open) {
								const tabs = await api.tabs.query({ active: true, currentWindow: true })
								const tab = tabs?.[0]
								if (tab?.windowId) {
									await api.raw.sidePanel.open({ windowId: tab.windowId })
									sendResponse({ ok: true })
									break
								}
							}
							sendResponse({ ok: false, error: "Side panel API not supported in this browser environment." })
						} catch (spError) {
							sendResponse({ ok: false, error: spError.message })
						}
						break
					}
					default:
						sendResponse({ ok: false, error: `Unknown message: ${message?.type}` })
				}
			} catch (error) {
				sendResponse({ ok: false, error: error?.message ?? String(error) })
			}
		})()
		return true
	})

	try {
		api.raw.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
	} catch {}

	api.raw.action?.onClicked?.addListener(
		safe(async (tab) => {
			if (api.raw.sidePanel?.open && tab?.windowId) {
				await api.raw.sidePanel.open({ windowId: tab.windowId })
			}
		}),
	)
}

export { relayToActiveTab, pushHistory, checkLinks, securityCheck }
