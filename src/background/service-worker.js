import { api, isExtension } from "../lib/browser.js"

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

async function relayToActiveTab(command, payload = {}) {
	const tabs = await api.tabs.query({ active: true, currentWindow: true })
	const tab = tabs?.[0]
	if (!tab?.id) return { ok: false, error: "No active tab" }
	try {
		return (await api.tabs.sendMessage(tab.id, { type: command, payload })) ?? { ok: true }
	} catch (firstError) {
		const msg = String(firstError?.message)
		if (msg.includes("Receiving end") || msg.includes("Could not establish connection")) {
			try {
				await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] })
				await new Promise((r) => setTimeout(r, 150))
				return (await api.tabs.sendMessage(tab.id, { type: command, payload })) ?? { ok: true }
			} catch (retryError) {
				return { ok: false, error: `Page not reachable: ${retryError.message}` }
			}
		}
		return { ok: false, error: `Page not reachable: ${firstError.message}` }
	}
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
			if (item) return relayToActiveTab(item.command)
			return undefined
		}),
	)

	api.commands?.onCommand?.addListener(safe((command) => relayToActiveTab(command)))

	api.raw.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
		;(async () => {
			try {
				switch (message?.type) {
					case "ping":
						sendResponse({ ok: true, flavor: api.flavor, version: api.runtime.getManifest().version })
						break
					case "relay":
						sendResponse(await relayToActiveTab(message.command, message.payload))
						break
					case "history:add":
						sendResponse({ ok: true, history: await pushHistory(message.entry ?? {}) })
						break
					case "screenshot": {
						const dataUrl = await api.tabs.captureVisibleTab({ format: "png" })
						sendResponse({ ok: true, dataUrl })
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

export { relayToActiveTab, pushHistory }
