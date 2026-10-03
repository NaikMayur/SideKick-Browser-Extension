
;(() => {
	const runtime = typeof browser !== "undefined" && browser.runtime ? browser : chrome

	// One core object per page. After an extension reload/update the old isolated-world script
	// keeps running but its runtime is invalidated (runtime.id throws or is undefined). A fresh
	// injection detects that, tears the dead instance down and replaces it.
	const CORE_KEY = "__sidekickCore"
	const previousCore = window[CORE_KEY]
	if (previousCore) {
		let previousAlive = false
		try {
			previousAlive = Boolean(previousCore.alive?.())
		} catch {}
		if (previousAlive) return
		try {
			previousCore.teardown?.()
		} catch {}
	}
	try {
		delete window.__devkitLoaded
	} catch {}

	const CORE_TOKEN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
	const coreTeardowns = []
	const core = {
		token: CORE_TOKEN,
		alive() {
			try {
				return Boolean(runtime?.runtime?.id)
			} catch {
				return false
			}
		},
		teardown() {},
	}
	window[CORE_KEY] = core

	const state = { inspect: false, grid: false, outline: false, edit: false, viewport: false, deviceFrame: null, measure: false }
	const LOG_CAP = 200
	const logBuffer = new Array(LOG_CAP)
	let logCount = 0
	let logHead = 0
	let highlight = null
	let hud = null
	let badge = null
	let deviceSimulator = null

	// Fallback capture in the isolated world (only window errors are visible here). The real
	// console buffer lives in content/main-world.js, which runs in the page's MAIN world.
	const onIsolatedError = (event) => push("error", `${event.message} @ ${event.filename}:${event.lineno}`)
	const onIsolatedRejection = (event) => push("rejection", stringify(event.reason))
	window.addEventListener("error", onIsolatedError)
	window.addEventListener("unhandledrejection", onIsolatedRejection)
	coreTeardowns.push(() => {
		window.removeEventListener("error", onIsolatedError)
		window.removeEventListener("unhandledrejection", onIsolatedRejection)
	})

	function push(level, message) {
		logBuffer[logHead] = { level, message: String(message).slice(0, 600), at: new Date().toISOString() }
		logHead = (logHead + 1) % LOG_CAP
		if (logCount < LOG_CAP) logCount++
	}

	function mainWorldCall(requestType, responseType, detail, target = document) {
		let result = null
		const onResult = (event) => {
			result = event.detail
		}
		document.addEventListener(responseType, onResult)
		try {
			target.dispatchEvent(new CustomEvent(requestType, { detail: JSON.stringify(detail ?? {}), bubbles: false }))
		} catch {
		} finally {
			document.removeEventListener(responseType, onResult)
		}
		if (typeof result !== "string") return null
		try {
			return JSON.parse(result)
		} catch {
			return null
		}
	}

	function probeMain(request, target = document) {
		return mainWorldCall("sidekick:probe", "sidekick:probe-result", request, target)
	}

	function readMainConsole(limit) {
		const response = mainWorldCall("sidekick:console-request", "sidekick:console-response", { limit })
		return response && Array.isArray(response.logs) ? response : null
	}

	function getRecentLogs(limit = 100) {
		const main = readMainConsole(limit)
		if (main) return main.logs.filter(Boolean)
		const res = []
		const count = Math.min(limit, logCount)
		const start = (logHead - count + LOG_CAP) % LOG_CAP
		for (let i = 0; i < count; i++) {
			res.push(logBuffer[(start + i) % LOG_CAP])
		}
		return res
	}

	function countConsoleErrors() {
		const main = readMainConsole(1)
		if (main) return main.errors ?? 0
		let count = 0
		for (let i = 0; i < logCount; i++) {
			if (logBuffer[i] && logBuffer[i].level !== "warn") count++
		}
		return count
	}

	function sendRuntime(message) {
		try {
			const pending = runtime.runtime.sendMessage(message)
			if (pending && typeof pending.then === "function") {
				return pending.then(
					(response) => response ?? { ok: false, error: "No response" },
					(error) => ({ ok: false, error: error?.message ?? String(error) }),
				)
			}
		} catch (error) {
			return Promise.resolve({ ok: false, error: error?.message ?? String(error) })
		}
		return Promise.resolve({ ok: false, error: "Messaging unavailable" })
	}

	function stringify(value) {
		if (value instanceof Error) return `${value.name}: ${value.message}`
		if (typeof value === "object") {
			try {
				return JSON.stringify(value)
			} catch {
				return String(value)
			}
		}
		return String(value)
	}

	const SVG_NS = "http://www.w3.org/2000/svg"
	const HOST_ID = "sidekick-overlay-host"
	const LEGACY_HOST_ID = "devkit-shadow-host"

	// Small stroke icons (24px grid). Paths only, so no markup strings ever reach innerHTML.
	const ICONS = {
		close: "M18 6 6 18M6 6l12 12",
		check: "M20 6 9 17l-5-5",
		copy: "M9 9h11v11H9zM5 15H4V4h11v1",
		minus: "M5 12h14",
		plus: "M12 5v14M5 12h14",
		ruler: "M3 17 17 3l4 4L7 21zM7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2",
		type: "M4 7V4h16v3M9 20h6M12 4v16",
		grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
		edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
		duplicate: "M8 8h12v12H8zM4 16V4h12",
		up: "m18 15-6-6-6 6",
		down: "m6 9 6 6 6-6",
		parent: "M14 9 9 4 4 9M20 20h-7a4 4 0 0 1-4-4V4",
		child: "m10 15 5 5 5-5M4 4h7a4 4 0 0 1 4 4v12",
		reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
		trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
		phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
		laptop: "M4 5h16v11H4zM2 20h20",
		monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
		rotate: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
		info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
		scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
		camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
		alert: "M12 3 2 21h20zM12 9v5M12 17h.01",
		pipette: "m2 22 1-1h3l9-9M3 21v-3l9-9M15 6l3-3 3 3-3 3M12 9l3 3",
		crosshair: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM22 12h-4M6 12H2M12 6V2M12 22v-4",
		code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
		palette: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1 3.7A1.5 1.5 0 0 1 12 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01",
		target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
		layers: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
		file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
		sparkle: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z",
		move: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
		grid: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
		eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
	}

	function icon(name, size = 14) {
		const svg = document.createElementNS(SVG_NS, "svg")
		svg.setAttribute("viewBox", "0 0 24 24")
		svg.setAttribute("width", String(size))
		svg.setAttribute("height", String(size))
		svg.setAttribute("fill", "none")
		svg.setAttribute("stroke", "currentColor")
		svg.setAttribute("stroke-width", "2")
		svg.setAttribute("stroke-linecap", "round")
		svg.setAttribute("stroke-linejoin", "round")
		svg.setAttribute("aria-hidden", "true")
		svg.setAttribute("class", "sk-icon")
		const path = document.createElementNS(SVG_NS, "path")
		path.setAttribute("d", ICONS[name] ?? ICONS.info)
		svg.appendChild(path)
		return svg
	}

	function setButtonContent(button, iconName, text) {
		button.textContent = ""
		if (iconName) button.appendChild(icon(iconName, 13))
		if (text) {
			const label = document.createElement("span")
			label.textContent = text
			button.appendChild(label)
		}
		return button
	}

	function el(tag, className) {
		const node = document.createElement(tag)
		if (className) node.className = className
		node.classList.add("dk-root")
		return node
	}

	function skButton(iconName, text, title, variant = "") {
		const button = el("button", `sk-btn${variant ? ` sk-btn-${variant}` : ""}`)
		button.type = "button"
		if (title) button.title = title
		return setButtonContent(button, iconName, text)
	}

	let shadowHost = null
	let shadowRoot = null
	let styledRoot = null

	function removeLegacyHosts() {
		for (const id of [LEGACY_HOST_ID, HOST_ID]) {
			const stale = document.getElementById(id)
			if (stale && stale !== shadowHost && stale.dataset?.sidekickCore !== CORE_TOKEN) stale.remove()
		}
	}

	function getShadowRoot() {
		if (!shadowHost || !shadowHost.isConnected) {
			removeLegacyHosts()
			shadowHost = document.createElement("div")
			shadowHost.id = HOST_ID
			shadowHost.dataset.sidekickCore = CORE_TOKEN
			shadowHost.classList.add("dk-root")
			shadowHost.style.cssText = "all: initial !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; pointer-events: none !important; border: none !important; margin: 0 !important; padding: 0 !important; display: block !important; overflow: visible !important; contain: layout style !important;"
			;(document.documentElement || document.body).appendChild(shadowHost)
			try {
				shadowRoot = shadowHost.attachShadow({ mode: "closed" })
			} catch {
				shadowRoot = shadowHost
			}
			styledRoot = null
		}
		ensureStyles()
		return shadowRoot
	}

	function isDevKitNode(node) {
		if (!node) return false
		if (node === shadowHost || node === shadowRoot) return true
		if (shadowHost && typeof node.nodeType === "number" && shadowHost.contains(node)) return true
		if (shadowRoot && typeof node.getRootNode === "function" && node.getRootNode() === shadowRoot) return true
		const id = typeof node.id === "string" ? node.id : ""
		return id === HOST_ID || id === LEGACY_HOST_ID
	}

	function isDevKitEvent(event) {
		if (!event) return false
		try {
			const path = typeof event.composedPath === "function" ? event.composedPath() : []
			for (const item of path) {
				if (isDevKitNode(item)) return true
			}
			const target = event.target instanceof Element ? event.target : event.target?.parentElement
			if (isDevKitNode(target)) return true
		} catch {}
		return false
	}

	// Page-level rules (outline-all, filled fields, overflow culprits) live in content/overlay.css,
	// which the extension inserts with scripting.insertCSS. If that failed, fall back to a <style>.
	function ensurePageStyles() {
		try {
			if (getComputedStyle(document.documentElement).getPropertyValue("--sidekick-page-css").trim()) return
		} catch {}
		if (document.getElementById("sidekick-page-styles")) return
		const pageStyle = document.createElement("style")
		pageStyle.id = "sidekick-page-styles"
		pageStyle.textContent = `
			.dk-field-filled { outline: 2px solid #14b8a6 !important; outline-offset: 1px !important; }
			.dk-outline-all body *:not(#${HOST_ID}) { outline: 1px solid rgba(255, 90, 31, 0.45) !important; }
			.dk-overflow-culprit { outline: 2px dashed #ff4d4d !important; outline-offset: 1px !important; box-shadow: 0 0 10px rgba(255, 77, 77, 0.6) !important; }
		`
		;(document.head || document.documentElement).appendChild(pageStyle)
		coreTeardowns.push(() => pageStyle.remove())
	}

	const OVERLAY_CSS = `
		:host {
			all: initial !important;
			position: fixed !important;
			inset: 0 !important;
			width: 100vw !important;
			height: 100vh !important;
			z-index: 2147483647 !important;
			pointer-events: none !important;
			display: block !important;
			overflow: visible !important;
		}
		:host, .dk-root {
			--sk-ink: #17140f;
			--sk-ink-2: #221e18;
			--sk-ink-3: #2e2820;
			--sk-line: rgba(243, 236, 224, 0.12);
			--sk-line-strong: rgba(243, 236, 224, 0.22);
			--sk-text: #f3ece0;
			--sk-muted: #b3a894;
			--sk-dim: #857a68;
			--sk-accent: #ff5a1f;
			--sk-accent-soft: rgba(255, 90, 31, 0.16);
			--sk-teal: #14b8a6;
			--sk-teal-soft: rgba(20, 184, 166, 0.16);
			--sk-warn: #f5b13d;
			--sk-bad: #ff4d4d;
			--sk-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
			--sk-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		}
		*, *::before, *::after {
			box-sizing: border-box;
			font-family: var(--sk-sans);
		}
		.sk-icon { flex: none; display: inline-block; vertical-align: -2px; }
		button { font: inherit; }
		.sk-btn {
			display: inline-flex; align-items: center; gap: 5px;
			background: var(--sk-ink-3); color: var(--sk-text);
			border: 1px solid var(--sk-line-strong); border-radius: 10px;
			padding: 5px 10px; font-size: 11.5px; font-weight: 600; line-height: 1.2;
			cursor: pointer; white-space: nowrap; pointer-events: auto;
		}
		.sk-btn:hover { border-color: var(--sk-accent); color: #fff; }
		.sk-btn:focus-visible { outline: 2px solid var(--sk-accent); outline-offset: 1px; }
		.sk-btn-accent { background: var(--sk-accent); border-color: var(--sk-accent); color: #1a0d05; }
		.sk-btn-accent:hover { color: #1a0d05; filter: brightness(1.08); }
		.sk-btn-ghost { background: transparent; }
		.sk-btn-danger { color: #ffb3a3; border-color: rgba(255, 77, 77, 0.45); background: rgba(255, 77, 77, 0.12); }
		.sk-btn-danger:hover { border-color: var(--sk-bad); color: #fff; }
		.sk-btn-icon { padding: 5px; }
		.dk-snip-overlay {
			position: fixed; inset: 0; width: 100vw; height: 100vh;
			z-index: 2147483646; pointer-events: auto; cursor: crosshair;
			background: rgba(10, 8, 5, 0.32); outline: none; user-select: none; -webkit-user-select: none;
		}
		.dk-snip-region {
			position: fixed; z-index: 2147483647;
			border: 2px solid var(--sk-accent); background: rgba(255, 90, 31, 0.08);
			box-shadow: 0 0 0 9999px rgba(10, 8, 5, 0.45); pointer-events: none;
		}
		.dk-snip-dims {
			position: absolute; bottom: -26px; left: 50%; transform: translateX(-50%);
			background: var(--sk-ink); color: var(--sk-text); padding: 2px 8px; border-radius: 10px;
			font-size: 11px; font-family: var(--sk-mono); white-space: nowrap; pointer-events: none;
		}
		.dk-cta-esc-badge {
			background: var(--sk-ink-3); color: var(--sk-text); border: 1px solid var(--sk-line-strong);
			border-radius: 6px; padding: 1px 6px; font-size: 11px; font-family: var(--sk-mono); font-weight: 700;
			cursor: pointer; display: inline-block; margin: 0 3px; line-height: 1.3; vertical-align: baseline;
		}
		.dk-cta-esc-badge:hover { border-color: var(--sk-accent); color: #fff; }
		.dk-highlight {
			position: fixed; z-index: 2147483645; pointer-events: none;
			border: 1.5px solid var(--sk-accent); background: rgba(255, 90, 31, 0.08); border-radius: 3px;
		}
		.dk-hud {
			position: fixed; z-index: 2147483646; bottom: 20px; right: 20px;
			width: 360px; max-width: calc(100vw - 32px); max-height: 75vh; overflow: auto;
			background: var(--sk-ink); color: var(--sk-text);
			border: 1px solid var(--sk-line-strong); border-radius: 12px; padding: 12px 14px;
			font-size: 12px; box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55); pointer-events: auto;
		}
		.dk-floating-cta-bar {
			position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
			z-index: 2147483647; pointer-events: auto; width: max-content; max-width: calc(100vw - 32px);
			animation: dkFadeUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		}
		@keyframes dkFadeUp {
			from { opacity: 0; transform: translate(-50%, 12px); }
			to { opacity: 1; transform: translate(-50%, 0); }
		}
		.dk-cta-pill {
			display: flex; align-items: center; gap: 10px;
			background: var(--sk-ink); color: var(--sk-text);
			border: 1px solid var(--sk-line-strong); border-radius: 12px;
			padding: 6px 6px 6px 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
			font-size: 12.5px; line-height: 1.2; white-space: nowrap; overflow-x: auto; max-width: calc(100vw - 32px);
		}
		.dk-cta-dot {
			width: 8px; height: 8px; border-radius: 50%; background: var(--sk-accent);
			box-shadow: 0 0 0 3px var(--sk-accent-soft); flex-shrink: 0;
		}
		.dk-cta-title { font-weight: 700; color: var(--sk-text); white-space: nowrap; }
		.dk-cta-info { color: var(--sk-muted); font-size: 12px; white-space: nowrap; border-left: 1px solid var(--sk-line); padding-left: 10px; }
		.dk-cta-close-btn { margin-left: 2px; }
		.dk-grid {
			position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483644; pointer-events: none;
			background-image: linear-gradient(to right, rgba(255, 90, 31, 0.16) 1px, transparent 1px),
				linear-gradient(to bottom, rgba(20, 184, 166, 0.14) 1px, transparent 1px);
			background-size: 8px 8px, 8px 8px;
		}
		.dk-grid-12col {
			position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483644; pointer-events: none;
			display: flex; justify-content: center; padding: 0 24px;
		}
		.dk-grid-12col-inner { width: 100%; max-width: 1280px; height: 100%; display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
		.dk-grid-12col-col { background: rgba(255, 90, 31, 0.07); border-left: 1px solid rgba(255, 90, 31, 0.3); border-right: 1px solid rgba(255, 90, 31, 0.3); height: 100%; }
		.dk-drawer-overlay {
			position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483640;
			background: rgba(10, 8, 5, 0.45); pointer-events: auto;
		}
		.dk-drawer-panel {
			position: fixed; top: 0; right: 0; bottom: 0; width: 520px; max-width: 92vw; height: 100vh;
			z-index: 2147483645; background: var(--sk-ink); color: var(--sk-text);
			border-left: 1px solid var(--sk-line-strong); box-shadow: -16px 0 44px rgba(0, 0, 0, 0.55);
			display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
		}
		.dk-badge {
			position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
			pointer-events: auto;
		}
		.dk-pulse-box {
			position: fixed; z-index: 2147483646; pointer-events: none;
			border: 2px solid var(--sk-accent); background: rgba(255, 90, 31, 0.12); border-radius: 4px;
			box-shadow: 0 0 0 4px rgba(255, 90, 31, 0.18);
			animation: skFlash 0.9s ease-in-out 3;
		}
		.dk-pulse-label {
			position: absolute; top: -24px; left: -2px; max-width: 420px; overflow: hidden; text-overflow: ellipsis;
			background: var(--sk-accent); color: #1a0d05; font: 700 11px/1.5 var(--sk-mono);
			padding: 1px 8px; border-radius: 6px; white-space: nowrap;
		}
		@keyframes skFlash { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
		.sk-measure-svg { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483645; overflow: visible; }
		.sk-measure-label {
			position: fixed; z-index: 2147483646; pointer-events: none; transform: translate(-50%, -50%);
			background: var(--sk-accent); color: #1a0d05; font: 700 11px/1.4 var(--sk-mono);
			padding: 1px 6px; border-radius: 6px; white-space: nowrap;
		}
		.sk-measure-label.sk-size { background: var(--sk-ink); color: var(--sk-text); border: 1px solid var(--sk-line-strong); transform: translate(-50%, 0); }
		.sk-measure-label.sk-anchor { background: var(--sk-teal); color: #031512; }
		.sk-report { display: grid; gap: 8px; }
		.sk-report-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
		.sk-report-row b { font: 700 12px var(--sk-mono); }
		.sk-tone-good { color: var(--sk-teal); }
		.sk-tone-warn { color: var(--sk-warn); }
		.sk-tone-bad { color: var(--sk-bad); }
		.sk-tone-info { color: var(--sk-muted); }
		.dk-edit-toolbar { pointer-events: auto; }
		.dk-edit-handle {
			position: absolute; width: 8px; height: 8px; background: var(--sk-text);
			border: 2px solid var(--sk-accent); border-radius: 2px; pointer-events: none;
		}
		.dk-edit-handle-tl { top: -5px; left: -5px; }
		.dk-edit-handle-tr { top: -5px; right: -5px; }
		.dk-edit-handle-bl { bottom: -5px; left: -5px; }
		.dk-edit-handle-br { bottom: -5px; right: -5px; }
		@keyframes dkPulse {
			0%, 100% { opacity: 0.95; }
			50% { opacity: 0.5; }
		}
	`

	function ensureStyles() {
		const root = shadowRoot
		if (!root || styledRoot === root) return
		styledRoot = root
		try {
			if (root !== shadowHost && "adoptedStyleSheets" in root && typeof CSSStyleSheet === "function") {
				const sheet = new CSSStyleSheet()
				sheet.replaceSync(OVERLAY_CSS)
				root.adoptedStyleSheets = [sheet]
				return
			}
		} catch {}
		const styleEl = document.createElement("style")
		styleEl.textContent = OVERLAY_CSS
		root.appendChild(styleEl)
	}


	function rafThrottle(fn) {
		let frame = 0
		let lastArgs = null
		const wrapped = (...args) => {
			lastArgs = args
			if (frame) return
			frame = requestAnimationFrame(() => {
				frame = 0
				const pending = lastArgs
				lastArgs = null
				if (pending) fn(...pending)
			})
		}
		wrapped.cancel = () => {
			if (frame) cancelAnimationFrame(frame)
			frame = 0
			lastArgs = null
		}
		return wrapped
	}

	// Walk a capped list of elements with a time budget so whole-page scans never stall the page.
	function scanElements(selector, visit, { limit = 5000, ms = 350, root = document } = {}) {
		let list
		try {
			list = root.querySelectorAll(selector)
		} catch {
			return { scanned: 0, total: 0, truncated: false }
		}
		const deadline = performance.now() + ms
		let i = 0
		for (; i < list.length && i < limit; i++) {
			if ((i & 63) === 63 && performance.now() > deadline) break
			if (visit(list[i], i) === false) {
				i++
				break
			}
		}
		return { scanned: i, total: list.length, truncated: i < list.length }
	}

	function hasOwnText(node) {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === 3 && child.data.trim()) return true
		}
		return false
	}

	function isRendered(node) {
		return node.getClientRects().length > 0
	}

	const activeCleanups = new Map()
	function registerCleanup(name, fn) {
		activeCleanups.set(name, fn)
	}
	function runCleanup(name) {
		const fn = activeCleanups.get(name)
		activeCleanups.delete(name)
		try {
			fn?.()
		} catch {}
	}

	function report(summary, sections) {
		return { type: "report", value: { summary, sections: sections.filter((section) => section.items.length) } }
	}

	// Resolves selectors produced by cssPath, including " >>> " hops into open shadow roots.
	function queryDeep(selector) {
		const hops = String(selector).split(" >>> ")
		let scope = document
		let found = null
		for (let i = 0; i < hops.length; i++) {
			found = scope.querySelector(hops[i])
			if (!found) return null
			if (i < hops.length - 1) {
				scope = found.shadowRoot
				if (!scope) return null
			}
		}
		return found
	}

	function showHud(title, body, actionLabel, action) {
		const root = getShadowRoot()
		if (!hud || !hud.isConnected) {
			hud = el("div", "dk-hud")
			root.appendChild(hud)
		}
		hud.textContent = ""
		hud.style.cssText = ""
		const heading = el("h4")
		heading.textContent = title
		heading.style.cssText = "margin: 0 0 8px 0 !important; font-size: 11px !important; color: #ff8a5c !important; text-transform: uppercase !important; letter-spacing: 0.08em !important; font-weight: 700 !important;"
		hud.appendChild(heading)

		if (body instanceof Node) {
			hud.appendChild(body)
		} else {
			const pre = el("div")
			pre.style.cssText = "white-space: pre-wrap !important; word-break: break-word !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 11.5px !important; line-height: 1.45 !important; color: #f3ece0 !important;"
			pre.textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2)
			hud.appendChild(pre)
		}

		const actionsRow = el("div")
		actionsRow.style.cssText = "display: flex !important; gap: 8px !important; margin-top: 10px !important; justify-content: flex-end !important;"
		if (actionLabel && action) {
			const extra = skButton("copy", actionLabel, actionLabel)
			extra.addEventListener("click", action)
			actionsRow.appendChild(extra)
		}
		const close = skButton("close", "Close", "Close", "ghost")
		close.addEventListener("click", hideHud)
		actionsRow.appendChild(close)
		hud.appendChild(actionsRow)
	}

	function hideHud() {
		if (hud?.parentNode) hud.parentNode.removeChild(hud)
		hud = null
	}

	// Compact on-page summary for reports triggered from the context menu or a shortcut.
	function showReportHud(title, rows, copyText) {
		const list = el("div", "sk-report")
		for (const row of rows) {
			const line = el("div", "sk-report-row")
			const label = el("span")
			label.textContent = row.label
			const value = el("b", `sk-tone-${row.tone ?? "info"}`)
			value.textContent = String(row.value)
			line.append(label, value)
			list.appendChild(line)
		}
		showHud(title, list, copyText ? "Copy JSON" : null, copyText ? () => copy(copyText) : null)
	}

	let floatingCta = null
	let floatingCtaClose = null

	function appendCtaInfo(infoEl, info, onClose) {
		infoEl.textContent = ""
		if (typeof info === "string" && info.includes("Esc to cancel")) {
			const parts = info.split("Esc to cancel")
			if (parts[0]) infoEl.appendChild(document.createTextNode(parts[0]))
			const escBadge = el("button", "dk-cta-esc-badge")
			escBadge.type = "button"
			escBadge.textContent = "Esc"
			escBadge.title = "Click or press Esc to cancel"
			escBadge.addEventListener("click", (e) => {
				e.preventDefault()
				e.stopPropagation()
				if (typeof onClose === "function") onClose()
				else if (typeof activeSnipCancel === "function") activeSnipCancel()
				hideFloatingCta()
			})
			infoEl.appendChild(escBadge)
			infoEl.appendChild(document.createTextNode(" to cancel" + (parts[1] || "")))
		} else {
			infoEl.textContent = info || "Active"
		}
	}

	function showFloatingCta(title, info, onClose, extraActions = null) {
		hideFloatingCta()
		const root = getShadowRoot()
		floatingCta = el("div", "dk-floating-cta-bar")
		floatingCtaClose = onClose
		const pill = el("div", "dk-cta-pill")
		const dot = el("span", "dk-cta-dot")
		const titleEl = el("span", "dk-cta-title")
		titleEl.textContent = String(title).replace(/^Sidekick:\s*/, "")
		const infoEl = el("span", "dk-cta-info")
		appendCtaInfo(infoEl, info, onClose)
		pill.append(dot, titleEl, infoEl)

		const actionButtons = []
		if (Array.isArray(extraActions)) {
			for (const action of extraActions) {
				const actionBtn = skButton(action.icon ?? null, action.label, action.title || action.label)
				actionBtn.classList.add("dk-cta-action-btn")
				actionBtn.addEventListener("click", (e) => {
					e.preventDefault()
					e.stopPropagation()
					action.action?.()
				})
				actionButtons.push(actionBtn)
				pill.appendChild(actionBtn)
			}
		}

		let isMinimized = false
		const minBtn = skButton("minus", null, "Minimize bar", "ghost")
		minBtn.classList.add("sk-btn-icon")
		const closeBtn = skButton("close", "Close", "Stop and close this tool (Esc)", "danger")
		closeBtn.classList.add("dk-cta-close-btn")
		minBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			isMinimized = !isMinimized
			const display = isMinimized ? "none" : ""
			infoEl.style.display = display
			for (const b of actionButtons) b.style.display = display
			closeBtn.style.display = display
			setButtonContent(minBtn, isMinimized ? "plus" : "minus", null)
			minBtn.title = isMinimized ? "Expand bar" : "Minimize bar"
		})
		closeBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			if (typeof onClose === "function") onClose()
			hideFloatingCta()
		})
		pill.append(minBtn, closeBtn)

		floatingCta.appendChild(pill)
		root.appendChild(floatingCta)
	}

	function updateFloatingCta(title, info, onClose) {
		if (!floatingCta) return
		const titleEl = floatingCta.querySelector(".dk-cta-title")
		const infoEl = floatingCta.querySelector(".dk-cta-info")
		if (titleEl && title) titleEl.textContent = String(title).replace(/^Sidekick:\s*/, "")
		if (infoEl && info) appendCtaInfo(infoEl, info, onClose ?? floatingCtaClose)
	}

	function hideFloatingCta() {
		if (floatingCta?.parentNode) floatingCta.parentNode.removeChild(floatingCta)
		floatingCta = null
		floatingCtaClose = null
	}

	// Scroll an element into view and flash an outline that follows it while the page scrolls.
	function highlightElement(payload) {
		const selector = payload?.selector
		if (!selector) return { ok: false, error: "No selector provided" }
		let target
		try {
			target = queryDeep(selector)
		} catch (e) {
			return { ok: false, error: `Invalid selector: ${e.message}` }
		}
		if (!target) return { ok: false, error: `Element not found on page: ${selector}` }
		runCleanup("highlight-element")
		try {
			target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
		} catch {
			target.scrollIntoView()
		}
		const root = getShadowRoot()
		const box = el("div", "dk-pulse-box")
		const label = el("div", "dk-pulse-label")
		label.textContent = selector.length > 70 ? `${selector.slice(0, 67)}...` : selector
		box.appendChild(label)
		root.appendChild(box)
		let frame = 0
		const follow = () => {
			const rect = target.getBoundingClientRect()
			box.style.top = `${Math.round(rect.top - 4)}px`
			box.style.left = `${Math.round(rect.left - 4)}px`
			box.style.width = `${Math.round(rect.width + 8)}px`
			box.style.height = `${Math.round(rect.height + 8)}px`
			box.style.display = rect.width || rect.height ? "block" : "none"
			frame = requestAnimationFrame(follow)
		}
		follow()
		const timer = setTimeout(() => runCleanup("highlight-element"), 3500)
		registerCleanup("highlight-element", () => {
			cancelAnimationFrame(frame)
			clearTimeout(timer)
			box.remove()
		})
		const rect = target.getBoundingClientRect()
		return { ok: true, data: { found: true, visible: rect.width > 0 && rect.height > 0 } }
	}

	function cssPathLocal(node) {
		if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
			try {
				if ((node.getRootNode?.() ?? document).querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) return `#${CSS.escape(node.id)}`
			} catch {}
		}
		const parts = []
		let current = node
		while (current && current.nodeType === 1 && parts.length < 6) {
			if (parts.length && current.id && /^[A-Za-z][\w-]*$/.test(current.id)) {
				parts.unshift(`#${CSS.escape(current.id)}`)
				break
			}
			let part = current.tagName.toLowerCase()
			const classes = [...current.classList].filter((c) => !/^(dk-|sk-)/.test(c) && !/[:[\]/]/.test(c)).slice(0, 2)
			if (classes.length) part += `.${classes.map((c) => CSS.escape(c)).join(".")}`
			const parent = current.parentElement
			if (parent) {
				let index = 0
				let twins = 0
				for (const child of parent.children) {
					if (child.tagName === current.tagName) {
						twins++
						if (child === current) index = twins
					}
				}
				if (twins > 1) part += `:nth-of-type(${index})`
			}
			parts.unshift(part)
			current = parent
		}
		return parts.join(" > ")
	}

	// Selector for a node; nodes inside open shadow roots get "host >>> inner" segments.
	function cssPath(node) {
		if (!(node instanceof Element)) return ""
		const segments = []
		let current = node
		for (let depth = 0; current && depth < 5; depth++) {
			segments.unshift(cssPathLocal(current))
			const root = current.getRootNode?.()
			if (root && root !== document && root.host) current = root.host
			else break
		}
		return segments.join(" >>> ")
	}

	function toHex(color) {
		const match = String(color).match(/rgba?\(([^)]+)\)/)
		if (!match) return color
		const [r, g, b] = match[1].split(/[,\s/]+/).map(Number)
		const part = (n) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, "0")
		return `#${part(r)}${part(g)}${part(b)}`
	}

	function luminance(color) {
		const match = String(color).match(/rgba?\(([^)]+)\)/)
		if (!match) return null
		const [r, g, b] = match[1].split(/[,\s/]+/).map(Number)
		const ch = (v) => {
			const s = (v || 0) / 255
			return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
		}
		return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
	}

	function contrast(fg, bg) {
		const a = luminance(fg)
		const b = luminance(bg)
		if (a === null || b === null) return null
		const [hi, lo] = a > b ? [a, b] : [b, a]
		return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
	}

	function effectiveBackground(node) {
		let current = node
		while (current && current !== document.documentElement) {
			const bg = getComputedStyle(current).backgroundColor
			if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg
			current = current.parentElement
		}
		return "rgb(255, 255, 255)"
	}

	function getAnimations(node) {
		const anims = []
		try {
			if (typeof node.getAnimations === "function") {
				for (const anim of node.getAnimations()) {
					anims.push({
						name: anim.animationName || anim.id || "(unnamed)",
						state: anim.playState,
						duration: anim.effect?.getTiming?.()?.duration ?? null,
						iterations: anim.effect?.getTiming?.()?.iterations ?? null,
						easing: anim.effect?.getTiming?.()?.easing ?? null,
						type: anim instanceof CSSAnimation ? "css" : anim instanceof CSSTransition ? "css-transition" : "js",
					})
				}
			}
		} catch {  }
		return anims
	}

	function getInlineListeners(node) {
		const found = new Set()
		for (const attr of node.attributes) {
			if (/^on[a-z]+$/.test(attr.name)) found.add(attr.name.slice(2))
		}
		// Property handlers and React props live in the page world; addEventListener ones stay invisible.
		for (const handler of probeMain({ node: true }, node)?.node?.handlers ?? []) found.add(handler)
		return [...found]
	}

	function getFrameworkBindings(node) {
		const bindings = []
		const probed = probeMain({ node: true }, node)?.node
		for (const name of probed?.frameworks ?? []) bindings.push(`${name} component`)
		if (!bindings.length) {
			for (const key of Object.keys(node)) {
				if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
					bindings.push("React component")
					break
				}
			}
		}
		const ngAttrs = [...node.attributes].filter((a) => a.name.startsWith("_ng") || a.name.startsWith("ng-"))
		if (ngAttrs.length && !bindings.includes("Angular component")) bindings.push("Angular binding")
		if ([...node.classList].some((c) => /^svelte-/.test(c)) && !bindings.includes("Svelte component")) bindings.push("Svelte component")
		if (node.hasAttribute("data-v-app") || [...node.attributes].some((a) => a.name.startsWith("data-v-"))) {
			if (!bindings.includes("Vue component")) bindings.push("Vue scoped styles")
		}
		return bindings
	}

	function getDataAttrs(node) {
		const data = {}
		for (const attr of node.attributes) {
			if (attr.name.startsWith("data-")) data[attr.name] = attr.value.slice(0, 200)
		}
		return data
	}

	function getAriaAttrs(node) {
		const aria = {}
		for (const attr of node.attributes) {
			if (attr.name.startsWith("aria-") || attr.name === "role") aria[attr.name] = attr.value
		}
		return aria
	}

	function getMediaInfo(node) {
		const tag = node.tagName.toLowerCase()
		if (tag === "img") {
			return {
				type: "image",
				src: node.currentSrc || node.src,
				alt: node.alt ?? null,
				naturalSize: `${node.naturalWidth}x${node.naturalHeight}`,
				loading: node.loading,
				srcset: node.srcset || null,
				decoded: node.complete,
			}
		}
		if (tag === "video" || tag === "audio") {
			return {
				type: tag,
				src: node.currentSrc || node.src,
				duration: node.duration,
				paused: node.paused,
				muted: node.muted,
				autoplay: node.autoplay,
				loop: node.loop,
			}
		}
		return null
	}

	let inspectedNode = null
	let componentBoundary = null
	let lastHoverTarget = null

	function placeHighlight(rect) {
		if (!highlight || !highlight.isConnected) {
			highlight = el("div", "dk-highlight")
			getShadowRoot().appendChild(highlight)
		}
		highlight.style.cssText = `display: block; top: ${Math.round(rect.top)}px; left: ${Math.round(rect.left)}px; width: ${Math.max(2, Math.round(rect.width))}px; height: ${Math.max(2, Math.round(rect.height))}px;`
	}

	const renderInspectHover = rafThrottle((node, clientX, clientY) => {
		if (!state.inspect && !deepInspectPending) return
		if (!node?.isConnected) return
		try {
			// Reads first, then writes, once per animation frame at most.
			const rect = node.getBoundingClientRect()
			const sameTarget = node === lastHoverTarget
			let info = null
			if (!sameTarget) {
				const style = getComputedStyle(node)
				const bg = effectiveBackground(node)
				const contrastRatio = contrast(style.color, bg)
				const contrastNum = contrastRatio ?? 0
				info = {
					tag: node.tagName.toLowerCase(),
					id: node.id,
					classes: [...node.classList].slice(0, 3),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
					font: (style.fontFamily || "sans-serif").split(",")[0].replace(/['"]/g, ""),
					fontSize: style.fontSize,
					fontWeight: style.fontWeight,
					color: toHex(style.color),
					colorRaw: style.color,
					bg: toHex(bg),
					bgRaw: bg,
					contrast: contrastRatio,
					aaPass: contrastNum >= 4.5,
					aaaPass: contrastNum >= 7,
					display: style.display,
					position: style.position,
					margin: { top: style.marginTop, right: style.marginRight, bottom: style.marginBottom, left: style.marginLeft },
					padding: { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft },
					border: { top: style.borderTopWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth, left: style.borderLeftWidth },
					borderColor: toHex(style.borderTopColor),
					borderStyle: style.borderTopStyle,
					zIndex: style.zIndex,
				}
			}
			placeHighlight(rect)
			if (info) {
				lastHoverTarget = node
				showVisualHud(node, info, { clientX, clientY })
			} else if (hud) {
				positionHud({ clientX, clientY }, hud)
			}
		} catch {}
	})

	function onMove(event) {
		if (!state.inspect && !deepInspectPending) return
		if (isDevKitEvent(event)) {
			if (highlight?.parentNode) highlight.style.display = "none"
			return
		}
		const node = event.target
		if (!(node instanceof Element)) return
		renderInspectHover(node, event.clientX, event.clientY)
	}

	function showVisualHud(node, info, event) {
		if (!hud || !hud.isConnected) {
			hud = el("div", "dk-hud")
			getShadowRoot().appendChild(hud)
		}
		hud.textContent = ""
		hud.style.maxWidth = "400px"

		const tagRow = el("div")
		tagRow.style.cssText = "display: flex !important; align-items: center !important; gap: 6px !important; margin-bottom: 8px !important; flex-wrap: wrap !important;"
		const semanticTags = new Set(["nav", "header", "footer", "main", "aside", "article", "section", "form", "button", "a", "dialog", "details", "figure", "table"])
		const isSemanticTag = semanticTags.has(info.tag)
		const tagPill = el("span")
		tagPill.textContent = `<${info.tag}>`
		tagPill.style.cssText = `display: inline-block !important; padding: 2px 8px !important; border-radius: 6px !important; font-size: 11px !important; font-weight: 700 !important; font-family: ui-monospace, monospace !important; background: ${isSemanticTag ? "rgba(20, 184, 166, 0.2)" : "rgba(179, 168, 148, 0.2)"} !important; color: ${isSemanticTag ? "#2dd4bf" : "#b3a894"} !important; border: 1px solid ${isSemanticTag ? "rgba(20, 184, 166, 0.3)" : "rgba(179, 168, 148, 0.2)"} !important;`
		tagRow.appendChild(tagPill)
		if (info.id) {
			const idPill = el("span")
			idPill.textContent = `#${info.id}`
			idPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 6px !important; font-size: 10px !important; font-weight: 600 !important; font-family: ui-monospace, monospace !important; background: rgba(20, 184, 166, 0.2) !important; color: #2dd4bf !important;"
			tagRow.appendChild(idPill)
		}
		if (info.classes.length) {
			const clsPill = el("span")
			clsPill.textContent = `.${info.classes.join(".")}`
			clsPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 6px !important; font-size: 10px !important; font-family: ui-monospace, monospace !important; color: #857a68 !important; max-width: 160px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;"
			tagRow.appendChild(clsPill)
		}
		const layoutPill = el("span")
		layoutPill.textContent = info.display
		layoutPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 6px !important; font-size: 10px !important; font-weight: 600 !important; background: rgba(255, 90, 31, 0.15) !important; color: #ff8a5c !important;"
		tagRow.appendChild(layoutPill)
		if (info.position !== "static") {
			const posPill = el("span")
			posPill.textContent = info.position
			posPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 6px !important; font-size: 10px !important; background: rgba(245, 177, 61, 0.15) !important; color: #f5b13d !important;"
			tagRow.appendChild(posPill)
		}
		hud.appendChild(tagRow)

		const boxWrap = el("div")
		boxWrap.style.cssText = "margin: 6px 0 !important; display: flex !important; justify-content: center !important;"
		const boxDiagram = buildBoxModelDiagram(info)
		boxWrap.appendChild(boxDiagram)
		hud.appendChild(boxWrap)

		const metricsRow = el("div")
		metricsRow.style.cssText = "display: flex !important; flex-wrap: wrap !important; gap: 6px !important; margin-top: 6px !important;"

		addMetricChip(metricsRow, "ruler", `${info.width} × ${info.height}`)

		addMetricChip(metricsRow, "type", `${info.font} ${info.fontSize} w${info.fontWeight}`)

		const colorChip = el("div")
		colorChip.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 6px !important; background: rgba(243,236,224,0.06) !important; font-size: 10px !important; color: #b3a894 !important;"
		const colorSwatch = el("span")
		colorSwatch.style.cssText = `width: 12px !important; height: 12px !important; border-radius: 3px !important; background: ${info.color} !important; border: 1px solid rgba(243,236,224,0.2) !important; flex-shrink: 0 !important;`
		const colorText = el("span")
		colorText.textContent = info.color
		colorText.style.cssText = "font-family: ui-monospace, monospace !important; font-size: 10px !important;"
		colorChip.append(colorSwatch, colorText)
		metricsRow.appendChild(colorChip)

		const bgChip = el("div")
		bgChip.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 6px !important; background: rgba(243,236,224,0.06) !important; font-size: 10px !important; color: #b3a894 !important;"
		const bgSwatch = el("span")
		bgSwatch.style.cssText = `width: 12px !important; height: 12px !important; border-radius: 3px !important; background: ${info.bg} !important; border: 1px solid rgba(243,236,224,0.2) !important; flex-shrink: 0 !important;`
		const bgText = el("span")
		bgText.textContent = `bg:${info.bg}`
		bgText.style.cssText = "font-family: ui-monospace, monospace !important; font-size: 10px !important;"
		bgChip.append(bgSwatch, bgText)
		metricsRow.appendChild(bgChip)

		if (info.contrast !== null && info.contrast !== undefined) {
			const contrastChip = el("div")
			const passLevel = info.aaaPass ? "AAA" : info.aaPass ? "AA" : "Fail"
			const passColor = info.aaaPass ? "#2dd4bf" : info.aaPass ? "#f5b13d" : "#ff6b6b"
			const passBg = info.aaaPass ? "rgba(20, 184, 166,0.15)" : info.aaPass ? "rgba(245, 177, 61,0.15)" : "rgba(255, 107, 107,0.15)"
			contrastChip.style.cssText = `display: flex !important; align-items: center !important; gap: 3px !important; padding: 2px 6px !important; border-radius: 6px !important; background: ${passBg} !important; font-size: 10px !important; font-weight: 600 !important; color: ${passColor} !important;`
			contrastChip.textContent = `${info.contrast}:1 ${passLevel}`
			metricsRow.appendChild(contrastChip)
		}

		hud.appendChild(metricsRow)

		positionHud(event, hud)
	}

	function addMetricChip(parent, iconName, text) {
		const chip = el("div")
		chip.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 6px !important; background: rgba(243,236,224,0.06) !important; font-size: 10px !important; color: #b3a894 !important; white-space: nowrap !important; font-family: ui-monospace, monospace !important;"
		chip.appendChild(icon(iconName, 11))
		const label = el("span")
		label.textContent = text
		chip.appendChild(label)
		parent.appendChild(chip)
	}

	function buildBoxModelDiagram(info) {
		const wrap = el("div")
		wrap.style.cssText = "position: relative !important; width: 240px !important; height: 150px !important; font-family: ui-monospace, monospace !important; font-size: 9px !important; color: #f3ece0 !important;"

		const marginBox = el("div")
		marginBox.style.cssText = "position: absolute !important; inset: 0 !important; background: rgba(255, 138, 92, 0.15) !important; border: 1px dashed rgba(255, 138, 92, 0.5) !important; border-radius: 6px !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important;"

		addBoxLabel(marginBox, "top", info.margin.top, "#ff8a5c")
		addBoxLabel(marginBox, "right", info.margin.right, "#ff8a5c")
		addBoxLabel(marginBox, "bottom", info.margin.bottom, "#ff8a5c")
		addBoxLabel(marginBox, "left", info.margin.left, "#ff8a5c")

		const borderBox = el("div")
		borderBox.style.cssText = "position: absolute !important; inset: 18px !important; background: rgba(245, 177, 61, 0.12) !important; border: 1px solid rgba(245, 177, 61, 0.5) !important; border-radius: 3px !important;"
		addBoxLabel(borderBox, "top", info.border.top, "#f5b13d")
		addBoxLabel(borderBox, "right", info.border.right, "#f5b13d")
		addBoxLabel(borderBox, "bottom", info.border.bottom, "#f5b13d")
		addBoxLabel(borderBox, "left", info.border.left, "#f5b13d")

		const paddingBox = el("div")
		paddingBox.style.cssText = "position: absolute !important; inset: 32px !important; background: rgba(20, 184, 166, 0.12) !important; border: 1px solid rgba(20, 184, 166, 0.4) !important; border-radius: 2px !important;"
		addBoxLabel(paddingBox, "top", info.padding.top, "#2dd4bf")
		addBoxLabel(paddingBox, "right", info.padding.right, "#2dd4bf")
		addBoxLabel(paddingBox, "bottom", info.padding.bottom, "#2dd4bf")
		addBoxLabel(paddingBox, "left", info.padding.left, "#2dd4bf")

		const contentBox = el("div")
		contentBox.style.cssText = "position: absolute !important; inset: 46px !important; background: rgba(255, 90, 31, 0.2) !important; border: 1px solid rgba(255, 90, 31, 0.5) !important; border-radius: 2px !important; display: flex !important; align-items: center !important; justify-content: center !important;"
		const contentLabel = el("span")
		contentLabel.textContent = `${info.width} × ${info.height}`
		contentLabel.style.cssText = "font-size: 10px !important; color: #ffb08a !important; font-weight: 600 !important;"
		contentBox.appendChild(contentLabel)

		const marLabel = el("span")
		marLabel.textContent = "margin"
		marLabel.style.cssText = "position: absolute !important; top: 2px !important; left: 4px !important; font-size: 8px !important; color: #ff8a5c !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
		marginBox.appendChild(marLabel)

		const borLabel = el("span")
		borLabel.textContent = "border"
		borLabel.style.cssText = "position: absolute !important; top: 2px !important; left: 4px !important; font-size: 8px !important; color: #f5b13d !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
		borderBox.appendChild(borLabel)

		const padLabel = el("span")
		padLabel.textContent = "padding"
		padLabel.style.cssText = "position: absolute !important; top: 1px !important; left: 3px !important; font-size: 8px !important; color: #2dd4bf !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
		paddingBox.appendChild(padLabel)

		marginBox.appendChild(borderBox)
		borderBox.appendChild(paddingBox)
		paddingBox.appendChild(contentBox)
		wrap.appendChild(marginBox)
		return wrap
	}

	function addBoxLabel(parent, position, value, color) {
		const v = (value || "0").replace("px", "")
		if (v === "0") return
		const lbl = el("span")
		lbl.textContent = v
		lbl.style.cssText = `position: absolute !important; font-size: 9px !important; font-weight: 600 !important; color: ${color} !important;`
		if (position === "top") lbl.style.cssText += "top: 3px !important; left: 50% !important; transform: translateX(-50%) !important;"
		if (position === "bottom") lbl.style.cssText += "bottom: 3px !important; left: 50% !important; transform: translateX(-50%) !important;"
		if (position === "left") lbl.style.cssText += "left: 3px !important; top: 50% !important; transform: translateY(-50%) !important;"
		if (position === "right") lbl.style.cssText += "right: 3px !important; top: 50% !important; transform: translateY(-50%) !important;"
		parent.appendChild(lbl)
	}

	function positionHud(event, hudEl) {
		if (!event || !hudEl) return
		const vh = window.innerHeight
		const vw = window.innerWidth
		const hudRect = hudEl.getBoundingClientRect()
		const hudH = hudRect.height || 250
		const hudW = hudRect.width || 400

		const inBottomHalf = event.clientY > vh / 2
		const inRightHalf = event.clientX > vw / 2

		hudEl.style.bottom = inBottomHalf ? "" : "20px"
		hudEl.style.top = inBottomHalf ? "20px" : ""
		hudEl.style.right = inRightHalf ? "" : "20px"
		hudEl.style.left = inRightHalf ? "20px" : ""
	}

	function onClickInspect(event) {
		if (!state.inspect) return
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element)) return
		if (isDevKitNode(node)) return
		event.preventDefault()
		event.stopPropagation()

		inspectedNode = node
		componentBoundary = node

		showInspectorDrawer(node)
		updateFloatingCta("Sidekick: Element Inspector", `Inspected: <${node.tagName.toLowerCase()}> — [ ] to expand • click another or close`)
	}

	function extractCleanHtml(node) {
		if (!node) return ""
		const clone = node.cloneNode(true)

		const walk = (el) => {
			if (!(el instanceof Element)) return
			const removeAttrs = []
			for (const attr of el.attributes) {
				const n = attr.name

				if (n.startsWith("data-") && n !== "data-testid") removeAttrs.push(n)

				if (n.startsWith("__react") || n.startsWith("_ng") || n.startsWith("ng-") || n.startsWith("_v-")) removeAttrs.push(n)

				if (n === "style") removeAttrs.push(n)

				if (/^(jsaction|jscontroller|jsmodel|jsname|nonce|data-n-head|data-hid)$/.test(n)) removeAttrs.push(n)
			}
			for (const a of removeAttrs) el.removeAttribute(a)

			if (el.hasAttribute("class") && !el.className.trim()) el.removeAttribute("class")

			if (el.hasAttribute("class")) {
				const classes = [...el.classList].filter((c) => {
					if (/^[a-z]{5,8}$/.test(c) && /[0-9]/.test(c)) return false
					if (c.startsWith("svelte-")) return false
					if (/^(css|sc|emotion)-/.test(c)) return false
					return true
				})
				if (classes.length) el.className = classes.join(" ")
				else el.removeAttribute("class")
			}
			for (const child of el.children) walk(child)
		}
		walk(clone)

		const html = formatHtml(clone.outerHTML.slice(0, 200000))
		return html.length > 120000 ? `${html.slice(0, 120000)}\n<!-- truncated by Sidekick -->` : html
	}

	function formatHtml(html) {
		const lines = []
		let indent = 0
		const tokens = html.replace(/>\s+</g, "><").replace(/></g, ">\n<").split("\n")
		for (const token of tokens) {
			const trimmed = token.trim()
			if (!trimmed) continue
			if (trimmed.startsWith("</")) indent = Math.max(0, indent - 1)
			lines.push("\t".repeat(indent) + trimmed)
			if (trimmed.startsWith("<") && !trimmed.startsWith("</") && !trimmed.endsWith("/>") && !/^<(img|input|br|hr|meta|link|source|track|wbr|col|embed|area|base|param)\b/i.test(trimmed)) {
				indent++
			}
		}
		return lines.join("\n")
	}

	function extractCleanCss(node) {
		if (!node) return ""
		const rules = {}
		const processed = new Set()
		let visited = 0

		// Cap the subtree walk: a click on <body> would otherwise read styles of thousands of nodes.
		const processNode = (el, depth) => {
			if (!(el instanceof Element) || depth > 6 || visited++ > 150) return
			const tag = el.tagName.toLowerCase()
			const cls = el.className ? `.${[...el.classList].slice(0, 2).join(".")}` : ""
			const selector = depth === 0 ? `.component` : `${cls || tag}`
			const style = getComputedStyle(el)
			const styles = {}

			const props = [
				"display", "position", "top", "right", "bottom", "left",
				"width", "height", "min-width", "min-height", "max-width", "max-height",
				"margin-top", "margin-right", "margin-bottom", "margin-left",
				"padding-top", "padding-right", "padding-bottom", "padding-left",
				"border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
				"border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
				"border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
				"border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
				"background-color", "background-image",
				"color", "font-family", "font-size", "font-weight", "font-style",
				"line-height", "letter-spacing", "text-align", "text-decoration", "text-transform",
				"flex-direction", "flex-wrap", "justify-content", "align-items", "gap",
				"grid-template-columns", "grid-template-rows",
				"opacity", "z-index", "cursor", "overflow",
				"box-shadow", "text-shadow", "box-sizing",
			]

			for (const prop of props) {
				const val = style.getPropertyValue(prop)
				if (!val) continue
				if (isDefaultCssValue(prop, val)) continue
				styles[prop] = val
			}

			const collapsed = collapseStyleLonghands(styles)

			const key = JSON.stringify(collapsed)
			if (!processed.has(key) && Object.keys(collapsed).length > 0) {
				processed.add(key)
				rules[selector] = collapsed
			}

			for (const child of [...el.children].slice(0, 20)) {
				processNode(child, depth + 1)
			}
		}

		processNode(node, 0)

		const blocks = []
		for (const [sel, props] of Object.entries(rules)) {
			const entries = Object.entries(props).map(([p, v]) => `\t${p}: ${v};`).join("\n")
			blocks.push(`${sel} {\n${entries}\n}`)
		}
		return blocks.join("\n\n")
	}

	function isDefaultCssValue(prop, val) {
		const defaults = {
			"display": "block", "position": "static", "float": "none",
			"top": "auto", "right": "auto", "bottom": "auto", "left": "auto",
			"width": "auto", "height": "auto", "min-width": "auto", "min-height": "auto",
			"max-width": "none", "max-height": "none",
			"margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px",
			"padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
			"border-top-width": "0px", "border-right-width": "0px", "border-bottom-width": "0px", "border-left-width": "0px",
			"border-top-style": "none", "border-right-style": "none", "border-bottom-style": "none", "border-left-style": "none",
			"border-top-left-radius": "0px", "border-top-right-radius": "0px", "border-bottom-right-radius": "0px", "border-bottom-left-radius": "0px",
			"background-color": "rgba(0, 0, 0, 0)", "background-image": "none",
			"font-style": "normal", "text-decoration": "none", "text-transform": "none",
			"letter-spacing": "normal", "text-align": "start",
			"flex-direction": "row", "flex-wrap": "nowrap",
			"justify-content": "normal", "align-items": "normal",
			"gap": "normal", "grid-template-columns": "none", "grid-template-rows": "none",
			"opacity": "1", "z-index": "auto", "cursor": "auto",
			"overflow": "visible", "box-shadow": "none", "text-shadow": "none",
			"box-sizing": "content-box",
		}

		if (prop === "background-color" && /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(val)) return true
		if (prop === "border-top-color" || prop === "border-right-color" || prop === "border-bottom-color" || prop === "border-left-color") {

			return false
		}
		return defaults[prop] === val
	}

	function collapseStyleLonghands(styles) {
		const result = { ...styles }
		const groups = [
			{ shorthand: "margin", sides: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
			{ shorthand: "padding", sides: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
			{ shorthand: "border-width", sides: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"] },
			{ shorthand: "border-style", sides: ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"] },
			{ shorthand: "border-color", sides: ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"] },
			{ shorthand: "border-radius", sides: ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"] },
		]
		for (const { shorthand, sides } of groups) {
			const values = sides.map((s) => result[s]).filter(Boolean)
			if (values.length !== sides.length) continue
			const allSame = values.every((v) => v === values[0])
			if (allSame) {
				result[shorthand] = values[0]
			} else {
				result[shorthand] = values.join(" ")
			}
			for (const side of sides) delete result[side]
		}

		if (result["border-width"] && result["border-style"] && result["border-style"] !== "none" && result["border-color"]) {
			result["border"] = `${result["border-width"]} ${result["border-style"]} ${result["border-color"]}`
			delete result["border-width"]
			delete result["border-style"]
			delete result["border-color"]
		}
		return result
	}

	function cssToTailwindInline(styles) {
		const classes = []
		const px = { "0px": "0", "1px": "px", "2px": "0.5", "4px": "1", "8px": "2", "12px": "3", "16px": "4", "20px": "5", "24px": "6", "32px": "8", "40px": "10", "48px": "12", "64px": "16", "80px": "20", "96px": "24" }
		const fs = { "12px": "text-xs", "14px": "text-sm", "16px": "text-base", "18px": "text-lg", "20px": "text-xl", "24px": "text-2xl", "30px": "text-3xl", "36px": "text-4xl", "48px": "text-5xl" }
		const fw = { "100": "font-thin", "200": "font-extralight", "300": "font-light", "400": "font-normal", "500": "font-medium", "600": "font-semibold", "700": "font-bold", "800": "font-extrabold", "900": "font-black" }
		const disp = { "block": "block", "flex": "flex", "grid": "grid", "inline-block": "inline-block", "inline": "inline", "none": "hidden", "inline-flex": "inline-flex" }
		const pos = { "relative": "relative", "absolute": "absolute", "fixed": "fixed", "sticky": "sticky" }
		if (styles.display && disp[styles.display]) classes.push(disp[styles.display])
		if (styles.position && pos[styles.position]) classes.push(pos[styles.position])
		if (styles["flex-direction"] === "column") classes.push("flex-col")
		if (styles["justify-content"] === "center") classes.push("justify-center")
		if (styles["justify-content"] === "space-between") classes.push("justify-between")
		if (styles["align-items"] === "center") classes.push("items-center")
		if (styles.gap && px[styles.gap]) classes.push(`gap-${px[styles.gap]}`)
		if (styles.margin && px[styles.margin]) classes.push(`m-${px[styles.margin]}`)
		if (styles.padding && px[styles.padding]) classes.push(`p-${px[styles.padding]}`)
		if (styles.width === "100%") classes.push("w-full")
		if (styles.height === "100%") classes.push("h-full")
		if (styles["font-size"] && fs[styles["font-size"]]) classes.push(fs[styles["font-size"]])
		if (styles["font-weight"] && fw[styles["font-weight"]]) classes.push(fw[styles["font-weight"]])
		if (styles["text-align"] === "center") classes.push("text-center")
		if (styles["text-transform"] === "uppercase") classes.push("uppercase")
		if (styles["border-radius"] === "9999px") classes.push("rounded-full")
		else if (styles["border-radius"] && px[styles["border-radius"]]) classes.push(`rounded-${px[styles["border-radius"]]}`)
		if (styles.overflow === "hidden") classes.push("overflow-hidden")
		if (styles.cursor === "pointer") classes.push("cursor-pointer")
		return classes
	}

	function htmlToJsxInline(html) {
		return html
			.replace(/\bclass="/g, 'className="')
			.replace(/\bfor="/g, 'htmlFor="')
			.replace(/<(img|input|br|hr|meta|link|source|track|wbr|col|embed|area|base|param)([^>]*?)(?<!\/)>/gi, "<$1$2 />")
			.replace(/\btabindex="/g, 'tabIndex="')
	}

	function generateAiPromptInline(html, css, node) {
		const tag = node?.tagName?.toLowerCase() || "div"
		const rect = node?.getBoundingClientRect?.() || {}
		const style = node ? getComputedStyle(node) : {}
		const dims = rect.width ? `${Math.round(rect.width)} × ${Math.round(rect.height)} px` : "unknown"
		const font = style.fontFamily ? `${(style.fontFamily || "").split(",")[0].replace(/['"]/g, "")} ${style.fontSize}` : ""
		return [
			"Recreate this component exactly. Here is the extracted markup and styles:",
			"",
			`## Component: <${tag}>`,
			`- Dimensions: ${dims}`,
			font ? `- Typography: ${font} w${style.fontWeight}` : "",
			`- Color: ${toHex(style.color || "rgb(0,0,0)")} on ${toHex(effectiveBackground(node) || "rgb(255,255,255)")}`,
			"",
			"## HTML",
			"```html",
			html,
			"```",
			"",
			"## CSS",
			"```css",
			css,
			"```",
			"",
			"Please recreate this component using [React/Vue/Svelte/HTML]. Preserve the exact visual appearance, spacing, typography, and colors.",
		].filter(Boolean).join("\n")
	}

	let inspectorDrawer = null
	let inspectorOverlay = null

	function showInspectorDrawer(node) {
		hideInspectorDrawer()
		hideHud()
		ensureStyles()
		inspectedNode = node

		const cleanHtml = extractCleanHtml(node)
		const cleanCss = extractCleanCss(node)
		const data = deepInspectElement(node)
		const selector = cssPath(node)

		inspectorOverlay = el("div", "dk-drawer-overlay dk-root")
		inspectorOverlay.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			hideInspectorDrawer()
		})
		getShadowRoot().appendChild(inspectorOverlay)

		inspectorDrawer = el("div", "dk-drawer-panel dk-root")
		inspectorDrawer.style.cssText += "font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important; color: #f3ece0 !important;"
		getShadowRoot().appendChild(inspectorDrawer)

		const header = el("div")
		header.style.cssText = "display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 16px 20px !important; border-bottom: 1px solid rgba(243,236,224,0.08) !important; flex-shrink: 0 !important;"
		const titleArea = el("div")
		const title = el("h3")
		title.textContent = "Element Inspector"
		title.style.cssText = "margin: 0 !important; font-size: 15px !important; font-weight: 700 !important; color: #f3ece0 !important;"
		const subtitle = el("div")
		subtitle.textContent = `<${node.tagName.toLowerCase()}>${node.id ? "#" + node.id : ""} — ${selector.slice(0, 50)}`
		subtitle.style.cssText = "margin-top: 3px !important; font-size: 11px !important; color: #857a68 !important; font-family: ui-monospace, monospace !important;"
		titleArea.append(title, subtitle)
		const closeBtn = el("button")
		closeBtn.appendChild(icon("close", 14))
		closeBtn.title = "Close inspector"
		closeBtn.type = "button"
		closeBtn.style.cssText = "background: rgba(243,236,224,0.06) !important; color: #b3a894 !important; border: 1px solid rgba(243,236,224,0.1) !important; border-radius: 6px !important; width: 32px !important; height: 32px !important; font-size: 14px !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;"
		closeBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			hideInspectorDrawer()
		})
		header.append(titleArea, closeBtn)
		inspectorDrawer.appendChild(header)

		const tabBar = el("div")
		tabBar.style.cssText = "display: flex !important; gap: 0 !important; padding: 0 20px !important; border-bottom: 1px solid rgba(243,236,224,0.08) !important; flex-shrink: 0 !important;"
		const tabs = ["HTML", "CSS", "Copy", "Box Model", "Data"]
		const tabPanels = []
		const tabBtns = []
		for (const tabName of tabs) {
			const btn = el("button")
			btn.type = "button"
			btn.textContent = tabName
			btn.style.cssText = "padding: 10px 14px !important; font-size: 12px !important; font-weight: 600 !important; background: none !important; border: none !important; border-bottom: 2px solid transparent !important; color: #857a68 !important; cursor: pointer !important; transition: all 0.15s !important;"
			tabBtns.push(btn)
			tabBar.appendChild(btn)
		}
		inspectorDrawer.appendChild(tabBar)

		const contentArea = el("div")
		contentArea.style.cssText = "flex: 1 !important; overflow-y: auto !important; padding: 16px 20px !important;"
		inspectorDrawer.appendChild(contentArea)

		const htmlPanel = buildCodePanel("html", cleanHtml)
		tabPanels.push(htmlPanel)

		const cssPanel = buildCodePanel("css", cleanCss)
		tabPanels.push(cssPanel)

		const copyPanel = buildCopyPanel(cleanHtml, cleanCss, node)
		tabPanels.push(copyPanel)

		const boxPanel = buildBoxModelPanel(data)
		tabPanels.push(boxPanel)

		const dataPanel = buildCodePanel("json", JSON.stringify(data, null, 2))
		tabPanels.push(dataPanel)

		for (const p of tabPanels) contentArea.appendChild(p)
		switchTab(0)

		function switchTab(idx) {
			tabBtns.forEach((btn, i) => {
				btn.style.borderBottomColor = i === idx ? "#ff5a1f" : "transparent"
				btn.style.color = i === idx ? "#f3ece0" : "#857a68"
			})
			tabPanels.forEach((panel, i) => {
				panel.style.display = i === idx ? "block" : "none"
			})
		}

		tabBtns.forEach((btn, i) => btn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			switchTab(i)
		}))
	}

	function hideInspectorDrawer() {
		if (inspectorDrawer?.parentNode) inspectorDrawer.parentNode.removeChild(inspectorDrawer)
		inspectorDrawer = null
		if (inspectorOverlay?.parentNode) inspectorOverlay.parentNode.removeChild(inspectorOverlay)
		inspectorOverlay = null
	}

	function buildCodePanel(lang, code) {
		const panel = el("div")
		const toolbar = el("div")
		toolbar.style.cssText = "display: flex !important; justify-content: space-between !important; align-items: center !important; margin-bottom: 10px !important;"
		const langLabel = el("span")
		langLabel.textContent = lang.toUpperCase()
		langLabel.style.cssText = "font-size: 11px !important; font-weight: 700 !important; color: #ff8a5c !important; text-transform: uppercase !important; letter-spacing: 0.05em !important;"
		const copyBtn = el("button")
		copyBtn.type = "button"
		setButtonContent(copyBtn, "copy", "Copy")
		copyBtn.style.cssText = "background: rgba(255, 90, 31, 0.15) !important; color: #ffb08a !important; border: 1px solid rgba(255, 90, 31, 0.3) !important; border-radius: 6px !important; padding: 5px 12px !important; font-size: 11px !important; cursor: pointer !important; font-weight: 600 !important;"
		copyBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			copy(code)
			setButtonContent(copyBtn, "check", "Copied")
			setTimeout(() => setButtonContent(copyBtn, "copy", "Copy"), 1500)
		})
		toolbar.append(langLabel, copyBtn)
		panel.appendChild(toolbar)

		const pre = el("pre")
		pre.style.cssText = "background: rgba(0,0,0,0.3) !important; border: 1px solid rgba(243,236,224,0.06) !important; border-radius: 8px !important; padding: 14px 16px !important; font-size: 12px !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; line-height: 1.5 !important; overflow-x: auto !important; white-space: pre-wrap !important; word-break: break-word !important; color: #f3ece0 !important; max-height: 500px !important;"
		pre.textContent = code
		panel.appendChild(pre)
		return panel
	}

	function buildCopyPanel(cleanHtml, cleanCss, node) {
		const panel = el("div")
		const desc = el("p")
		desc.textContent = "One-click copy in multiple formats. Click any button to copy to clipboard."
		desc.style.cssText = "font-size: 12px !important; color: #857a68 !important; margin: 0 0 14px 0 !important;"
		panel.appendChild(desc)

		const htmlCss = `<!-- Component extracted by Sidekick -->\n<style>\n${cleanCss}\n</style>\n\n${cleanHtml}`
		addCopyButton(panel, "file", "HTML + CSS (self-contained)", htmlCss, "Complete snippet ready to paste into a new HTML file")

		const computed = node ? getComputedStyle(node) : null
		const twClasses = cssToTailwindInline(computed ? Object.fromEntries(
			["display", "position", "flex-direction", "justify-content", "align-items", "gap",
			"margin", "padding", "width", "height", "font-size", "font-weight",
			"text-align", "text-transform", "border-radius", "overflow", "cursor"]
			.map((p) => [p, computed.getPropertyValue(p)])
			.filter(([, v]) => v)
		) : {})
		addCopyButton(panel, "palette", "Tailwind classes", twClasses.join(" "), "Mapped Tailwind v3 utility classes for this element")

		const cssVars = extractCssVarsFromNode(node)
		addCopyButton(panel, "target", "CSS variables / tokens", cssVars, "Design tokens extracted as CSS custom properties")

		const jsxCode = htmlToJsxInline(cleanHtml)
		const jsxFull = `function Component() {\n\treturn (\n${jsxCode.split("\n").map((l) => "\t\t" + l).join("\n")}\n\t)\n}`
		addCopyButton(panel, "code", "React / JSX skeleton", jsxFull, "JSX component skeleton with className, self-closing tags")

		const vueSfc = `<template>\n${cleanHtml.split("\n").map((l) => "\t" + l).join("\n")}\n</template>\n\n<script setup>\n</script>\n\n<style scoped>\n${cleanCss}\n</style>`
		addCopyButton(panel, "layers", "Vue SFC skeleton", vueSfc, "Single-file component for Vue 3 with scoped styles")

		const aiPrompt = generateAiPromptInline(cleanHtml, cleanCss, node)
		addCopyButton(panel, "sparkle", "AI-ready prompt", aiPrompt, "Structured prompt for ChatGPT/Claude/Copilot to recreate this component")

		return panel
	}

	function addCopyButton(parent, iconName, label, content, description) {
		const card = el("div")
		card.style.cssText = "background: rgba(243,236,224,0.03) !important; border: 1px solid rgba(243,236,224,0.06) !important; border-radius: 8px !important; padding: 12px 14px !important; margin-bottom: 8px !important; cursor: pointer !important; transition: all 0.15s !important;"
		card.addEventListener("mouseenter", () => { card.style.borderColor = "rgba(255, 90, 31,0.4)" })
		card.addEventListener("mouseleave", () => { card.style.borderColor = "rgba(243,236,224,0.06)" })
		const row = el("div")
		row.style.cssText = "display: flex !important; justify-content: space-between !important; align-items: center !important;"
		const labelEl = el("span")
		labelEl.style.cssText = "display: inline-flex !important; align-items: center !important; gap: 8px !important; font-size: 13px !important; font-weight: 600 !important; color: #f3ece0 !important;"
		labelEl.appendChild(icon(iconName, 14))
		labelEl.appendChild(document.createTextNode(label))
		const badge = el("span")
		badge.textContent = "Copy"
		badge.style.cssText = "font-size: 10px !important; font-weight: 600 !important; padding: 3px 8px !important; border-radius: 6px !important; background: rgba(255, 90, 31,0.15) !important; color: #ff8a5c !important;"
		row.append(labelEl, badge)
		const descEl = el("div")
		descEl.textContent = description
		descEl.style.cssText = "font-size: 11px !important; color: #857a68 !important; margin-top: 4px !important;"
		card.append(row, descEl)
		card.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			copy(content)
			badge.textContent = "Copied"
			badge.style.color = "#2dd4bf"
			badge.style.background = "rgba(20, 184, 166,0.15)"
			setTimeout(() => {
				badge.textContent = "Copy"
				badge.style.color = "#ff8a5c"
				badge.style.background = "rgba(255, 90, 31,0.15)"
			}, 1500)
		})
		parent.appendChild(card)
	}

	function extractCssVarsFromNode(node) {
		if (!node) return ":root {\n}"
		const style = getComputedStyle(node)
		const bg = effectiveBackground(node)
		const lines = [":root {"]
		lines.push(`\t--color-text: ${toHex(style.color)};`)
		lines.push(`\t--color-bg: ${toHex(bg)};`)
		if (style.borderTopColor && style.borderTopStyle !== "none") {
			lines.push(`\t--color-border: ${toHex(style.borderTopColor)};`)
		}
		lines.push(`\t--font-family: ${style.fontFamily};`)
		lines.push(`\t--font-size: ${style.fontSize};`)
		lines.push(`\t--font-weight: ${style.fontWeight};`)
		lines.push(`\t--line-height: ${style.lineHeight};`)
		if (style.padding !== "0px") lines.push(`\t--spacing-padding: ${style.padding};`)
		if (style.margin !== "0px") lines.push(`\t--spacing-margin: ${style.margin};`)
		if (style.borderRadius && style.borderRadius !== "0px") lines.push(`\t--radius: ${style.borderRadius};`)
		if (style.boxShadow && style.boxShadow !== "none") lines.push(`\t--shadow: ${style.boxShadow};`)
		lines.push("}")
		return lines.join("\n")
	}

	function buildBoxModelPanel(data) {
		const panel = el("div")
		const info = {
			width: data?.dimensions?.width ?? 0,
			height: data?.dimensions?.height ?? 0,
			margin: data?.boxModel?.margin ?? {},
			padding: data?.boxModel?.padding ?? {},
			border: data?.boxModel?.border ?? {},
		}

		const title = el("h4")
		title.textContent = "Box Model"
		title.style.cssText = "margin: 0 0 12px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f3ece0 !important;"
		panel.appendChild(title)

		const diagram = buildBoxModelDiagram(info)
		diagram.style.cssText += "width: 320px !important; height: 200px !important; margin: 0 auto !important;"
		panel.appendChild(diagram)

		if (data?.typography) {
			const typTitle = el("h4")
			typTitle.textContent = "Typography"
			typTitle.style.cssText = "margin: 20px 0 8px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f3ece0 !important;"
			panel.appendChild(typTitle)
			const typGrid = el("div")
			typGrid.style.cssText = "display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px !important;"
			for (const [key, value] of Object.entries(data.typography)) {
				if (!value || value === "normal" || value === "none") continue
				const cell = el("div")
				cell.style.cssText = "display: flex !important; justify-content: space-between !important; padding: 4px 8px !important; background: rgba(243,236,224,0.03) !important; border-radius: 6px !important; font-size: 11px !important;"
				const k = el("span")
				k.textContent = key.replace(/([A-Z])/g, "-$1").toLowerCase()
				k.style.cssText = "color: #857a68 !important;"
				const v = el("span")
				v.textContent = String(value).slice(0, 30)
				v.style.cssText = "color: #f3ece0 !important; font-family: ui-monospace, monospace !important; font-size: 10px !important;"
				cell.append(k, v)
				typGrid.appendChild(cell)
			}
			panel.appendChild(typGrid)
		}

		if (data?.colors) {
			const colTitle = el("h4")
			colTitle.textContent = "Colors & Contrast"
			colTitle.style.cssText = "margin: 20px 0 8px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f3ece0 !important;"
			panel.appendChild(colTitle)
			const colGrid = el("div")
			colGrid.style.cssText = "display: flex !important; gap: 8px !important; flex-wrap: wrap !important;"
			for (const [key, value] of Object.entries(data.colors)) {
				if (!value || key === "contrast") continue
				const swatch = el("div")
				swatch.style.cssText = `display: flex !important; align-items: center !important; gap: 6px !important; padding: 6px 10px !important; background: rgba(243,236,224,0.03) !important; border-radius: 6px !important; cursor: pointer !important;`
				const dot = el("span")
				dot.style.cssText = `width: 16px !important; height: 16px !important; border-radius: 6px !important; background: ${value} !important; border: 1px solid rgba(243,236,224,0.15) !important; flex-shrink: 0 !important;`
				const info2 = el("div")
				const label = el("div")
				label.textContent = key
				label.style.cssText = "font-size: 10px !important; color: #857a68 !important;"
				const val = el("div")
				val.textContent = value
				val.style.cssText = "font-size: 11px !important; font-family: ui-monospace, monospace !important; color: #f3ece0 !important;"
				info2.append(label, val)
				swatch.append(dot, info2)
				swatch.addEventListener("click", (e) => {
					e.preventDefault()
					e.stopPropagation()
					copy(value)
					updateFloatingCta("Sidekick: Inspector", `Copied ${value}`)
				})
				colGrid.appendChild(swatch)
			}
			if (data.colors.contrast) {
				const contrastBadge = el("div")
				const ratio = data.colors.contrast
				const pass = ratio >= 4.5
				contrastBadge.textContent = `Contrast ${ratio}:1 · AA ${pass ? "pass" : "fail"}`
				contrastBadge.style.cssText = `padding: 6px 12px !important; border-radius: 6px !important; font-size: 12px !important; font-weight: 600 !important; background: ${pass ? "rgba(20, 184, 166,0.12)" : "rgba(255, 107, 107,0.12)"} !important; color: ${pass ? "#2dd4bf" : "#ff6b6b"} !important;`
				colGrid.appendChild(contrastBadge)
			}
			panel.appendChild(colGrid)
		}

		return panel
	}

	function expandComponentBoundary() {
		if (!inspectedNode) return
		const current = componentBoundary || inspectedNode
		const parent = current.parentElement
		if (!parent || parent === document.body || parent === document.documentElement) return

		componentBoundary = parent

		const rect = componentBoundary.getBoundingClientRect()
		if (highlight) {
			highlight.style.top = `${Math.round(rect.top)}px`
			highlight.style.left = `${Math.round(rect.left)}px`
			highlight.style.width = `${Math.max(2, Math.round(rect.width))}px`
			highlight.style.height = `${Math.max(2, Math.round(rect.height))}px`
			highlight.style.setProperty("border", "2px dashed #f5b13d", "important")
			highlight.style.setProperty("background", "rgba(245, 177, 61, 0.08)", "important")
		}

		if (inspectorDrawer) showInspectorDrawer(componentBoundary)
		updateFloatingCta("Sidekick: Inspector", `Expanded to <${componentBoundary.tagName.toLowerCase()}> — [ ] to adjust`)
	}

	function contractComponentBoundary() {
		if (!inspectedNode || !componentBoundary) return
		if (componentBoundary === inspectedNode) return

		const original = inspectedNode
		componentBoundary = original
		const rect = componentBoundary.getBoundingClientRect()
		if (highlight) {
			highlight.style.top = `${Math.round(rect.top)}px`
			highlight.style.left = `${Math.round(rect.left)}px`
			highlight.style.width = `${Math.max(2, Math.round(rect.width))}px`
			highlight.style.height = `${Math.max(2, Math.round(rect.height))}px`
			highlight.style.setProperty("border", "1.5px solid #ff5a1f", "important")
			highlight.style.setProperty("background", "rgba(255, 90, 31, 0.08)", "important")
		}
		if (inspectorDrawer) showInspectorDrawer(componentBoundary)
		updateFloatingCta("Sidekick: Inspector", `Contracted to <${componentBoundary.tagName.toLowerCase()}>`)
	}

	// Measure tool: hover shows the element size, click pins an anchor, then hovering another
	// element shows the pixel gaps between them (like holding Alt in Figma). Esc unpins, then exits.
	const measure = { anchor: null, hover: null, layer: null, svg: null, labels: [] }

	function measureLayer() {
		if (!measure.layer || !measure.layer.isConnected) {
			measure.layer = el("div", "sk-measure-layer")
			measure.svg = document.createElementNS(SVG_NS, "svg")
			measure.svg.setAttribute("class", "sk-measure-svg")
			measure.layer.appendChild(measure.svg)
			getShadowRoot().appendChild(measure.layer)
		}
		return measure.layer
	}

	function svgEl(name, attrs) {
		const node = document.createElementNS(SVG_NS, name)
		for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
		measure.svg.appendChild(node)
		return node
	}

	function measureLabel(text, x, y, variant = "") {
		const label = el("div", `sk-measure-label${variant ? ` ${variant}` : ""}`)
		label.textContent = text
		label.style.left = `${Math.round(x)}px`
		label.style.top = `${Math.round(y)}px`
		measure.layer.appendChild(label)
	}

	function fmtPx(value) {
		const rounded = Math.round(value * 10) / 10
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
	}

	function drawGap(x1, y1, x2, y2) {
		const length = Math.abs(x2 - x1) + Math.abs(y2 - y1)
		if (length < 0.5) return
		svgEl("line", { x1, y1, x2, y2, stroke: "#ff5a1f", "stroke-width": 1.5 })
		const vertical = x1 === x2
		const cap = 4
		if (vertical) {
			svgEl("line", { x1: x1 - cap, y1, x2: x1 + cap, y2: y1, stroke: "#ff5a1f", "stroke-width": 1.5 })
			svgEl("line", { x1: x2 - cap, y1: y2, x2: x2 + cap, y2, stroke: "#ff5a1f", "stroke-width": 1.5 })
		} else {
			svgEl("line", { x1, y1: y1 - cap, x2: x1, y2: y1 + cap, stroke: "#ff5a1f", "stroke-width": 1.5 })
			svgEl("line", { x1: x2, y1: y2 - cap, x2, y2: y2 + cap, stroke: "#ff5a1f", "stroke-width": 1.5 })
		}
		measureLabel(fmtPx(length), (x1 + x2) / 2, (y1 + y2) / 2)
	}

	function guide(x1, y1, x2, y2) {
		svgEl("line", { x1, y1, x2, y2, stroke: "#ff5a1f", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0.7 })
	}

	function outlineRect(rect, color, dashed = false) {
		svgEl("rect", {
			x: rect.left,
			y: rect.top,
			width: Math.max(0, rect.width),
			height: Math.max(0, rect.height),
			fill: "none",
			stroke: color,
			"stroke-width": 1.5,
			...(dashed ? { "stroke-dasharray": "4 3" } : {}),
		})
	}

	function contains(outer, inner) {
		return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom
	}

	function drawDistances(a, b) {
		if (contains(a, b) || contains(b, a)) {
			const outer = contains(a, b) ? a : b
			const inner = outer === a ? b : a
			const cx = inner.left + inner.width / 2
			const cy = inner.top + inner.height / 2
			drawGap(cx, outer.top, cx, inner.top)
			drawGap(cx, inner.bottom, cx, outer.bottom)
			drawGap(outer.left, cy, inner.left, cy)
			drawGap(inner.right, cy, outer.right, cy)
			return
		}
		const overlapTop = Math.max(a.top, b.top)
		const overlapBottom = Math.min(a.bottom, b.bottom)
		const overlapLeft = Math.max(a.left, b.left)
		const overlapRight = Math.min(a.right, b.right)
		if (b.left >= a.right || a.left >= b.right) {
			const [x1, x2] = b.left >= a.right ? [a.right, b.left] : [b.right, a.left]
			const y = overlapBottom > overlapTop ? (overlapTop + overlapBottom) / 2 : b.top + b.height / 2
			drawGap(x1, y, x2, y)
			if (!(overlapBottom > overlapTop)) {
				const edgeX = b.left >= a.right ? a.right : a.left
				guide(edgeX, a.top + a.height / 2, edgeX, y)
			}
		}
		if (b.top >= a.bottom || a.top >= b.bottom) {
			const [y1, y2] = b.top >= a.bottom ? [a.bottom, b.top] : [b.bottom, a.top]
			const x = overlapRight > overlapLeft ? (overlapLeft + overlapRight) / 2 : b.left + b.width / 2
			drawGap(x, y1, x, y2)
			if (!(overlapRight > overlapLeft)) {
				const edgeY = b.top >= a.bottom ? a.bottom : a.top
				guide(a.left + a.width / 2, edgeY, x, edgeY)
			}
		}
	}

	function renderMeasure() {
		if (!state.measure) return
		measureLayer()
		const hoverRect = measure.hover?.isConnected ? measure.hover.getBoundingClientRect() : null
		const anchorRect = measure.anchor?.isConnected ? measure.anchor.getBoundingClientRect() : null
		measure.svg.textContent = ""
		for (const label of measure.layer.querySelectorAll(".sk-measure-label")) label.remove()
		if (anchorRect) {
			outlineRect(anchorRect, "#14b8a6")
			measureLabel(`${fmtPx(anchorRect.width)} × ${fmtPx(anchorRect.height)}`, anchorRect.left + anchorRect.width / 2, anchorRect.bottom + 4, "sk-size sk-anchor")
		}
		if (hoverRect && measure.hover !== measure.anchor) {
			outlineRect(hoverRect, "#ff5a1f", Boolean(anchorRect))
			if (anchorRect) drawDistances(anchorRect, hoverRect)
			else measureLabel(`${fmtPx(hoverRect.width)} × ${fmtPx(hoverRect.height)}`, hoverRect.left + hoverRect.width / 2, hoverRect.bottom + 4, "sk-size")
		}
	}

	const scheduleMeasure = rafThrottle(renderMeasure)

	function onMeasureMove(event) {
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element) || node === measure.hover) return
		measure.hover = node
		scheduleMeasure()
	}

	function onMeasureClick(event) {
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element)) return
		event.preventDefault()
		event.stopPropagation()
		measure.anchor = measure.anchor === node ? null : node
		updateFloatingCta(
			"Sidekick: Measure",
			measure.anchor
				? `Pinned <${node.tagName.toLowerCase()}>, hover another element for distances · Esc to unpin`
				: "Hover to see sizes · Click to pin an element · Esc to exit",
		)
		scheduleMeasure()
	}

	function onMeasureKey(event) {
		if (event.key !== "Escape") return
		event.preventDefault()
		event.stopPropagation()
		if (measure.anchor) {
			measure.anchor = null
			updateFloatingCta("Sidekick: Measure", "Hover to see sizes · Click to pin an element · Esc to exit")
			scheduleMeasure()
		} else {
			toggleMeasure(false)
		}
	}

	function swallowPointer(event) {
		if (!isDevKitEvent(event)) {
			event.preventDefault()
			event.stopPropagation()
		}
	}

	function toggleMeasure(on) {
		const next = on ?? !state.measure
		if (next === state.measure) return state.measure
		state.measure = next
		if (next) {
			measure.anchor = null
			measure.hover = null
			document.addEventListener("mouseover", onMeasureMove, true)
			document.addEventListener("click", onMeasureClick, true)
			document.addEventListener("mousedown", swallowPointer, true)
			document.addEventListener("keydown", onMeasureKey, true)
			window.addEventListener("scroll", scheduleMeasure, true)
			window.addEventListener("resize", scheduleMeasure)
			showFloatingCta("Sidekick: Measure", "Hover to see sizes · Click to pin an element · Esc to exit", () => toggleMeasure(false))
			registerCleanup("measure", () => toggleMeasure(false))
		} else {
			document.removeEventListener("mouseover", onMeasureMove, true)
			document.removeEventListener("click", onMeasureClick, true)
			document.removeEventListener("mousedown", swallowPointer, true)
			document.removeEventListener("keydown", onMeasureKey, true)
			window.removeEventListener("scroll", scheduleMeasure, true)
			window.removeEventListener("resize", scheduleMeasure)
			scheduleMeasure.cancel()
			measure.layer?.remove()
			measure.layer = null
			measure.svg = null
			measure.anchor = null
			measure.hover = null
			activeCleanups.delete("measure")
			hideFloatingCta()
		}
		return state.measure
	}

	function onInspectKeyDown(event) {
		if (!state.inspect) return
		const activeTag = document.activeElement?.tagName?.toLowerCase()
		if (activeTag === "input" || activeTag === "textarea" || document.activeElement?.isContentEditable) return

		if (event.key === "[") {
			event.preventDefault()
			contractComponentBoundary()
		} else if (event.key === "]") {
			event.preventDefault()
			expandComponentBoundary()
		} else if (event.key === "x" || event.key === "X") {
			event.preventDefault()
			toggleOutline()
		} else if (event.key === "m" || event.key === "M") {
			event.preventDefault()
			setInspect(false)
			toggleMeasure(true)
		} else if (event.key === "Escape") {
			if (inspectorDrawer) {
				hideInspectorDrawer()
			}
		}
	}

	function setInspect(on) {
		state.inspect = on ?? !state.inspect
		if (state.inspect) {
			ensureStyles()
			document.addEventListener("mousemove", onMove, true)
			document.addEventListener("click", onClickInspect, true)
			document.addEventListener("keydown", onInspectKeyDown, true)
			showFloatingCta("Sidekick: Element Inspector", "Hover to preview · Click for full report · [ ] expand/contract · M measure · X outlines", () => setInspect(false))
			registerCleanup("inspect", () => setInspect(false))
		} else {
			document.removeEventListener("mousemove", onMove, true)
			document.removeEventListener("click", onClickInspect, true)
			document.removeEventListener("keydown", onInspectKeyDown, true)
			renderInspectHover.cancel()
			lastHoverTarget = null
			if (highlight?.parentNode) highlight.parentNode.removeChild(highlight)
			highlight = null
			inspectedNode = null
			componentBoundary = null
			activeCleanups.delete("inspect")
			hideHud()
			hideInspectorDrawer()
			hideFloatingCta()
		}
		return state.inspect
	}

	function copy(text) {
		try {
			navigator.clipboard?.writeText(text)
		} catch {

		}
	}

	let gridKeyHandler = null
	function toggleGrid(switchMode = false) {
		if (switchMode && state.grid) {
			state.gridMode = state.gridMode === "12col" ? "8px" : "12col"
		} else {
			state.grid = !state.grid
			if (state.grid && !state.gridMode) state.gridMode = "8px"
		}

		let grid = getShadowRoot()?.querySelector?.(".dk-grid, .dk-grid-12col")
		if (grid) grid.remove()

		if (state.grid) {
			ensureStyles()
			if (state.gridMode === "12col") {
				grid = el("div", "dk-grid-12col")
				const inner = el("div", "dk-grid-12col-inner")
				for (let i = 0; i < 12; i++) {
					inner.appendChild(el("div", "dk-grid-12col-col"))
				}
				grid.appendChild(inner)
			} else {
				grid = el("div", "dk-grid")
			}
			getShadowRoot().appendChild(grid)

			if (!gridKeyHandler) {
				gridKeyHandler = (e) => {
					if ((e.key === "g" || e.key === "G") && !e.ctrlKey && !e.metaKey && !e.altKey && !isDevKitEvent(e)) {
						const tag = document.activeElement?.tagName?.toLowerCase()
						if (tag !== "input" && tag !== "textarea" && !document.activeElement?.isContentEditable) {
							e.preventDefault()
							toggleGrid(true)
						}
					}
				}
				window.addEventListener("keydown", gridKeyHandler, true)
			}

			const label = state.gridMode === "12col" ? "12-Col Responsive Guide" : "8px Baseline Grid"
			showFloatingCta(
				"Sidekick: Layout Grid",
				`${label} active · Press G to toggle mode`,
				() => toggleGrid(false)
			)
		} else {
			if (gridKeyHandler) {
				window.removeEventListener("keydown", gridKeyHandler, true)
				gridKeyHandler = null
			}
			hideFloatingCta()
		}
		return state.grid
	}

	let outlineCulprits = []
	function toggleOutline() {
		state.outline = !state.outline
		document.documentElement.classList.toggle("dk-outline-all", state.outline)
		if (state.outline) {
			ensurePageStyles()
			const docWidth = document.documentElement.clientWidth || window.innerWidth
			const culprits = []
			const scan = scanElements("body *", (node) => {
				const rect = node.getBoundingClientRect()
				if (rect.width > 0 && rect.height > 0 && (rect.right > docWidth + 2 || rect.left < -2)) culprits.push(node)
			}, { limit: 8000, ms: 300 })
			// Class writes happen after every read so the scan never forces a style recalc per element.
			for (const node of culprits) node.classList.add("dk-overflow-culprit")
			outlineCulprits = culprits
			const scanned = scan.truncated ? ` (first ${scan.scanned} of ${scan.total} elements)` : ""
			const msg = culprits.length > 0
				? `All elements outlined · ${culprits.length} horizontal overflow culprit${culprits.length === 1 ? "" : "s"} marked${scanned}`
				: `All elements outlined · No horizontal overflow detected${scanned}`
			showFloatingCta("Sidekick: CSS Outlines", msg, () => {
				if (state.outline) toggleOutline()
			})
			registerCleanup("outline", () => {
				if (state.outline) toggleOutline()
			})
		} else {
			for (const node of outlineCulprits) node.classList.remove("dk-overflow-culprit")
			outlineCulprits = []
			activeCleanups.delete("outline")
			hideFloatingCta()
		}
		return state.outline
	}

	let editSelectedElement = null
	let editHighlightBox = null
	let editHoverBox = null
	let editToolbar = null
	let isEditDragging = false
	let dragStartX = 0
	let dragStartY = 0
	let origDx = 0
	let origDy = 0
	let activeEditableNode = null

	function findComponentContainer(node) {
		let cur = node
		while (cur && cur !== document.body && cur !== document.documentElement) {
			const tag = cur.tagName.toLowerCase()
			if (["section", "article", "header", "footer", "nav", "aside", "main", "form"].includes(tag)) {
				return cur
			}
			const cls = typeof cur.className === "string" ? cur.className.toLowerCase() : ""
			if (cls.includes("card") || cls.includes("container") || cls.includes("wrapper") || cls.includes("hero") || cls.includes("block") || cls.includes("item") || cls.includes("panel") || cls.includes("box")) {
				return cur
			}
			cur = cur.parentElement
		}
		return node
	}

	function getAncestorChain(node, maxDepth = 4) {
		const chain = []
		let cur = node
		while (cur && cur !== document.body && cur !== document.documentElement && chain.length < maxDepth) {
			chain.unshift(cur)
			cur = cur.parentElement
		}
		return chain
	}

	function startElementDrag(e) {
		if (!editSelectedElement) return
		isEditDragging = true
		dragStartX = e.clientX
		dragStartY = e.clientY
		origDx = parseFloat(editSelectedElement.dataset.dkDx || "0")
		origDy = parseFloat(editSelectedElement.dataset.dkDy || "0")
		if (editSelectedElement.dataset.dkOrigTransform === undefined) {
			editSelectedElement.dataset.dkOrigTransform = editSelectedElement.style.transform || ""
		}
		if (editHighlightBox) {
			editHighlightBox.classList.add("dk-dragging")
			editHighlightBox.style.cursor = "grabbing"
		}
		window.addEventListener("mousemove", onWindowMouseMove, true)
		window.addEventListener("mouseup", onWindowMouseUp, true)
	}

	function onWindowMouseMove(e) {
		if (!isEditDragging || !editSelectedElement) return
		e.preventDefault()
		const deltaX = e.clientX - dragStartX
		const deltaY = e.clientY - dragStartY
		const dx = Math.round(origDx + deltaX)
		const dy = Math.round(origDy + deltaY)
		editSelectedElement.dataset.dkDx = String(dx)
		editSelectedElement.dataset.dkDy = String(dy)
		const base = editSelectedElement.dataset.dkOrigTransform || ""
		editSelectedElement.style.transform = `${base} translate(${dx}px, ${dy}px)`.trim()
		scheduleEditPosition()
		updateFloatingCta("Sidekick: Design & Move", `Offset: X ${dx >= 0 ? "+" : ""}${dx}px, Y ${dy >= 0 ? "+" : ""}${dy}px · Drag to move · Esc to deselect`)
	}

	function onWindowMouseUp() {
		if (!isEditDragging) return
		window.removeEventListener("mousemove", onWindowMouseMove, true)
		window.removeEventListener("mouseup", onWindowMouseUp, true)
		setTimeout(() => {
			isEditDragging = false
		}, 60)
		if (editHighlightBox) {
			editHighlightBox.classList.remove("dk-dragging")
			editHighlightBox.style.cursor = "grab"
		}
		updateEditOverlay()
		if (editSelectedElement) {
			const dx = editSelectedElement.dataset.dkDx || 0
			const dy = editSelectedElement.dataset.dkDy || 0
			updateFloatingCta("Sidekick: Design & Move", `Offset: X ${dx >= 0 ? "+" : ""}${dx}px, Y ${dy >= 0 ? "+" : ""}${dy}px · Drag to move · Esc to deselect`)
		}
	}

	function enableTextEdit(node) {
		if (!node) return
		let target = node
		if (!["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "button", "em", "strong", "b", "i", "label", "li", "td", "th"].includes(target.tagName.toLowerCase())) {
			const textChild = target.querySelector("h1, h2, h3, h4, h5, h6, p, span, a, button, em, strong, li")
			if (textChild) target = textChild
		}
		if (activeEditableNode && activeEditableNode !== target) {
			activeEditableNode.removeAttribute("contenteditable")
		}
		activeEditableNode = target
		target.setAttribute("contenteditable", "true")
		target.focus()
		try {
			const range = document.createRange()
			range.selectNodeContents(target)
			const sel = window.getSelection()
			sel.removeAllRanges()
			sel.addRange(range)
		} catch {}

		updateFloatingCta("Sidekick: Text Editing", `Editing <${target.tagName.toLowerCase()}> text · Press Esc or Enter to finish`)
		const finishEdit = () => {
			target.removeAttribute("contenteditable")
			target.removeEventListener("blur", onBlur)
			target.removeEventListener("keydown", onKey)
			if (activeEditableNode === target) activeEditableNode = null
			updateFloatingCta("Sidekick: Design & Move Mode", "Figma Mode active · Drag any element to move · Double-click to edit text")
			updateEditOverlay()
		}
		const onBlur = () => finishEdit()
		const onKey = (e) => {
			if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault()
				target.blur()
			}
		}
		target.addEventListener("blur", onBlur)
		target.addEventListener("keydown", onKey)
	}

	function updateEditOverlay() {
		if (!state.edit || !editSelectedElement || !document.contains(editSelectedElement)) {
			clearEditSelection()
			return
		}
		ensureStyles()
		const rect = editSelectedElement.getBoundingClientRect()
		if (rect.width === 0 && rect.height === 0) return

		if (!editHighlightBox) {
			editHighlightBox = el("div", "dk-edit-selected")
			for (const corner of ["tl", "tr", "bl", "br"]) editHighlightBox.appendChild(el("div", `dk-edit-handle dk-edit-handle-${corner}`))
			editHighlightBox.addEventListener("mousedown", (e) => {
				e.preventDefault()
				e.stopPropagation()
				startElementDrag(e)
			})
			editHighlightBox.addEventListener("dblclick", (e) => {
				e.preventDefault()
				e.stopPropagation()
				editHighlightBox.style.display = "none"
				const under = document.elementFromPoint(e.clientX, e.clientY)
				editHighlightBox.style.display = "block"
				const target = under && !isDevKitNode(under) && under !== document.body && under !== document.documentElement ? under : editSelectedElement
				if (target) {
					selectEditElement(target)
					enableTextEdit(target)
				}
			})
			getShadowRoot().appendChild(editHighlightBox)
		}
		editHighlightBox.style.cssText = `position: fixed !important; top: ${rect.top}px !important; left: ${rect.left}px !important; width: ${rect.width}px !important; height: ${rect.height}px !important; z-index: 2147483645 !important; pointer-events: auto !important; border: 2px solid #ff5a1f !important; background: rgba(255, 90, 31, 0.12) !important; border-radius: 2px !important; box-shadow: 0 0 0 1px rgba(243, 236, 224, 0.9), 0 0 20px rgba(255, 90, 31, 0.5) !important; cursor: grab !important; box-sizing: border-box !important; display: block !important;`

		if (!editToolbar) {
			editToolbar = el("div", "dk-edit-toolbar")
			getShadowRoot().appendChild(editToolbar)
		}
		const topPos = Math.max(8, rect.top - 48)
		const leftPos = Math.max(8, Math.min(window.innerWidth - 520, rect.left))
		editToolbar.style.cssText = `position: fixed !important; top: ${topPos}px !important; left: ${leftPos}px !important; z-index: 2147483646 !important; display: flex !important; align-items: center !important; gap: 4px !important; background: #17140f !important; background: rgba(23, 20, 15, 0.98) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1.5px solid #ff5a1f !important; border-radius: 8px !important; padding: 5px 8px !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 15px rgba(255, 90, 31, 0.3) !important; font-size: 11.5px !important; pointer-events: auto !important; white-space: nowrap !important; max-width: 95vw !important; overflow-x: auto !important;`

		editToolbar.textContent = ""

		function makeEditBtn(iconName, text, title, onClick, isDragGrip = false, isDelete = false) {
			const btn = el("button", "dk-edit-btn" + (isDragGrip ? " dk-drag-grip" : "") + (isDelete ? " dk-delete" : ""))
			btn.type = "button"
			setButtonContent(btn, iconName, text)
			btn.title = title
			const bg = isDelete ? "rgba(255, 77, 77, 0.2)" : isDragGrip ? "rgba(255, 90, 31, 0.25)" : "rgba(243, 236, 224, 0.1)"
			const color = isDelete ? "#ffb3a3" : isDragGrip ? "#ffb08a" : "#f3ece0"
			const border = isDelete ? "1px solid rgba(255, 77, 77, 0.4)" : isDragGrip ? "1px solid rgba(255, 90, 31, 0.5)" : "1px solid rgba(243, 236, 224, 0.2)"
			btn.style.cssText = `background: ${bg} !important; color: ${color} !important; border: ${border} !important; border-radius: 6px !important; padding: 4px 8px !important; font-size: 11px !important; cursor: ${isDragGrip ? "grab" : "pointer"} !important; font-weight: 600 !important; display: inline-flex !important; align-items: center !important; gap: 3px !important; user-select: none !important; line-height: 1.2 !important; white-space: nowrap !important;`
			btn.addEventListener("mousedown", (e) => {
				if (isDragGrip) {
					e.preventDefault()
					e.stopPropagation()
					startElementDrag(e)
				} else {
					e.stopPropagation()
				}
			})
			if (!isDragGrip) {
				btn.addEventListener("click", (e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick?.(e)
				})
			}
			return btn
		}

		const chain = getAncestorChain(editSelectedElement)
		if (chain.length > 1) {
			const breadcrumbWrap = el("div", "dk-edit-breadcrumbs")
			breadcrumbWrap.style.cssText = "display: inline-flex !important; align-items: center !important; gap: 2px !important; margin-right: 4px !important; padding-right: 6px !important; border-right: 1px solid rgba(243, 236, 224, 0.15) !important;"
			chain.forEach((anc, idx) => {
				const isCurrent = anc === editSelectedElement
				const ancTag = anc.tagName.toLowerCase()
				const ancCls = typeof anc.className === "string" && anc.classList.length ? `.${anc.classList[0]}` : ""
				const crumbBtn = el("button", "dk-crumb-btn")
				crumbBtn.type = "button"
				crumbBtn.title = `Select <${ancTag}${ancCls}>`
				crumbBtn.textContent = `<${ancTag}${ancCls}>`
				crumbBtn.style.cssText = `background: ${isCurrent ? "rgba(255, 90, 31, 0.3)" : "rgba(243, 236, 224, 0.06)"} !important; color: ${isCurrent ? "#ffb08a" : "#b3a894"} !important; border: 1px solid ${isCurrent ? "#ff5a1f" : "rgba(243, 236, 224, 0.1)"} !important; border-radius: 3px !important; padding: 2px 6px !important; font-size: 10.5px !important; font-family: ui-monospace, monospace !important; cursor: pointer !important; font-weight: ${isCurrent ? "700" : "500"} !important;`
				crumbBtn.addEventListener("click", (e) => {
					e.preventDefault()
					e.stopPropagation()
					selectEditElement(anc)
				})
				breadcrumbWrap.appendChild(crumbBtn)
				if (idx < chain.length - 1) {
					const sep = el("span", "")
					sep.textContent = "›"
					sep.style.cssText = "color: #857a68 !important; font-size: 11px !important; margin: 0 1px !important;"
					breadcrumbWrap.appendChild(sep)
				}
			})
			editToolbar.appendChild(breadcrumbWrap)
		} else {
			const tagLabel = el("span", "dk-edit-tag-label")
			tagLabel.style.cssText = "color: #ff8a5c !important; font-weight: 700 !important; font-size: 11px !important; text-transform: uppercase !important; padding: 2px 6px !important; font-family: ui-monospace, SFMono-Regular, monospace !important; letter-spacing: 0.3px !important; white-space: nowrap !important;"
			const idStr = editSelectedElement.id ? `#${editSelectedElement.id}` : ""
			const classStr = typeof editSelectedElement.className === "string" && editSelectedElement.classList.length ? `.${editSelectedElement.classList[0]}` : ""
			tagLabel.textContent = `<${editSelectedElement.tagName.toLowerCase()}${idStr || classStr}>`
			editToolbar.appendChild(tagLabel)
		}

		if (editSelectedElement.parentElement && editSelectedElement.parentElement !== document.body && editSelectedElement.parentElement !== document.documentElement) {
			const parentTag = editSelectedElement.parentElement.tagName.toLowerCase()
			const parentBtn = makeEditBtn("parent", `Parent (${parentTag})`, "Select parent container div/section", () => {
				selectEditElement(editSelectedElement.parentElement)
			})
			editToolbar.appendChild(parentBtn)
		}

		if (editSelectedElement.firstElementChild) {
			const childBtn = makeEditBtn("child", "Child", "Select first child element inside this container", () => {
				selectEditElement(editSelectedElement.firstElementChild)
			})
			editToolbar.appendChild(childBtn)
		}

		const gripBtn = makeEditBtn("grip", "Drag", "Click & hold to drag element anywhere on page", null, true)
		editToolbar.appendChild(gripBtn)

		const editTextBtn = makeEditBtn("edit", "Edit", "Edit copy/text directly (or double click element)", () => {
			enableTextEdit(editSelectedElement)
		})
		editToolbar.appendChild(editTextBtn)

		const dupBtn = makeEditBtn("duplicate", "Duplicate", "Duplicate component block", () => {
			if (editSelectedElement?.parentNode) {
				const clone = editSelectedElement.cloneNode(true)
				delete clone.dataset.dkDx
				delete clone.dataset.dkDy
				delete clone.dataset.dkOrigTransform
				editSelectedElement.after(clone)
				selectEditElement(clone)
				updateFloatingCta("Sidekick: Design & Move", "Element duplicated · Drag to position")
			}
		})
		editToolbar.appendChild(dupBtn)

		const moveUpBtn = makeEditBtn("up", "Up", "Move element before previous sibling in DOM", () => {
			if (editSelectedElement?.previousElementSibling) {
				editSelectedElement.parentNode.insertBefore(editSelectedElement, editSelectedElement.previousElementSibling)
				updateEditOverlay()
				updateFloatingCta("Sidekick: Design & Move", "Element moved up")
			}
		})
		editToolbar.appendChild(moveUpBtn)

		const moveDownBtn = makeEditBtn("down", "Down", "Move element after next sibling in DOM", () => {
			if (editSelectedElement?.nextElementSibling) {
				editSelectedElement.parentNode.insertBefore(editSelectedElement.nextElementSibling, editSelectedElement)
				updateEditOverlay()
				updateFloatingCta("Sidekick: Design & Move", "Element moved down")
			}
		})
		editToolbar.appendChild(moveDownBtn)

		const resetBtn = makeEditBtn("reset", "Reset", "Reset moved position to original (0, 0)", () => {
			if (editSelectedElement) {
				const orig = editSelectedElement.dataset.dkOrigTransform
				if (orig !== undefined) {
					editSelectedElement.style.transform = orig
					delete editSelectedElement.dataset.dkOrigTransform
				} else {
					editSelectedElement.style.transform = ""
				}
				delete editSelectedElement.dataset.dkDx
				delete editSelectedElement.dataset.dkDy
				updateEditOverlay()
				updateFloatingCta("Sidekick: Design & Move", "Position reset to original")
			}
		})
		editToolbar.appendChild(resetBtn)

		const delBtn = makeEditBtn("trash", null, "Delete element (or press Del key)", () => {
			const target = editSelectedElement
			clearEditSelection()
			target?.remove()
			updateFloatingCta("Sidekick: Design & Move", "Element deleted")
		}, false, true)
		editToolbar.appendChild(delBtn)
	}

	function selectEditElement(node, isAltContainer = false) {
		let target = node
		if (isAltContainer && target) {
			target = findComponentContainer(target)
		}
		if (!target || isDevKitNode(target) || target === document.body || target === document.documentElement) return
		editSelectedElement = target
		if (editHoverBox) editHoverBox.style.display = "none"
		updateEditOverlay()
		const dx = editSelectedElement.dataset.dkDx || "0"
		const dy = editSelectedElement.dataset.dkDy || "0"
		updateFloatingCta(
			"Sidekick: Design & Move Mode",
			`Selected <${target.tagName.toLowerCase()}> (X: ${dx}px, Y: ${dy}px) · Drag to move · Parent selects the container · Double-click to edit text`
		)
	}

	function clearEditSelection() {
		if (activeEditableNode) {
			activeEditableNode.removeAttribute("contenteditable")
			activeEditableNode = null
		}
		if (editSelectedElement) {
			editSelectedElement = null
		}
		if (editHighlightBox?.parentNode) editHighlightBox.parentNode.removeChild(editHighlightBox)
		editHighlightBox = null
		if (editToolbar?.parentNode) editToolbar.parentNode.removeChild(editToolbar)
		editToolbar = null
		if (editHoverBox?.parentNode) editHoverBox.parentNode.removeChild(editHoverBox)
		editHoverBox = null
	}

	function resetAllMovedElements() {
		const moved = document.querySelectorAll("[data-dk-dx], [data-dk-orig-transform]")
		moved.forEach((el) => {
			const orig = el.dataset.dkOrigTransform
			if (orig !== undefined) {
				el.style.transform = orig
				delete el.dataset.dkOrigTransform
			} else {
				el.style.transform = ""
			}
			delete el.dataset.dkDx
			delete el.dataset.dkDy
		})
		updateEditOverlay()
		return moved.length
	}

	function onEditMouseOver(e) {
		if (!state.edit || isEditDragging) return
		if (isDevKitEvent(e)) return
		const target = e.target
		if (!target || isDevKitNode(target) || target === document.body || target === document.documentElement) {
			if (editHoverBox) editHoverBox.style.display = "none"
			return
		}
		if (target === editSelectedElement) {
			if (editHoverBox) editHoverBox.style.display = "none"
			return
		}
		ensureStyles()
		if (!editHoverBox) {
			editHoverBox = el("div", "dk-edit-hover-box")
			editHoverBox.style.cssText = "position: fixed !important; z-index: 2147483643 !important; pointer-events: none !important; border: 2px dashed #ff5a1f !important; background: rgba(255, 90, 31, 0.08) !important; border-radius: 3px !important; transition: none !important; box-sizing: border-box !important;"
			const badge = el("div", "dk-hover-badge")
			badge.style.cssText = "position: absolute !important; top: -20px !important; left: -2px !important; background: #ff5a1f !important; color: #ffffff !important; font-size: 10.5px !important; font-family: ui-monospace, monospace !important; font-weight: 700 !important; padding: 1px 6px !important; border-radius: 3px !important; pointer-events: none !important; white-space: nowrap !important; line-height: 1.4 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;"
			editHoverBox.appendChild(badge)
			getShadowRoot().appendChild(editHoverBox)
		}
		const rect = target.getBoundingClientRect()
		if (rect.width === 0 && rect.height === 0) return
		editHoverBox.style.top = `${rect.top}px`
		editHoverBox.style.left = `${rect.left}px`
		editHoverBox.style.width = `${rect.width}px`
		editHoverBox.style.height = `${rect.height}px`
		const badge = editHoverBox.querySelector(".dk-hover-badge")
		if (badge) {
			const tag = target.tagName.toLowerCase()
			const cls = typeof target.className === "string" && target.classList.length ? `.${target.classList[0]}` : ""
			badge.textContent = `<${tag}${cls}> ${Math.round(rect.width)}×${Math.round(rect.height)}`
		}
		editHoverBox.style.display = "block"
	}

	function onEditMouseOut(e) {
		if (isDevKitEvent(e)) return
		if (editHoverBox) editHoverBox.style.display = "none"
	}

	function onEditMouseDown(e) {
		if (!state.edit) return
		if (isDevKitEvent(e)) return
		const target = e.target
		if (!target) return
		if (target.isContentEditable || activeEditableNode?.contains(target)) return
		if (target === document.body || target === document.documentElement) {
			clearEditSelection()
			return
		}

		e.preventDefault()

		if (!editSelectedElement || (editSelectedElement !== target && !editSelectedElement.contains(target))) {
			selectEditElement(target, e.altKey || e.shiftKey)
		}

		startElementDrag(e)
	}

	function onEditClick(e) {
		if (!state.edit) return
		if (isDevKitEvent(e)) return
		e.preventDefault()
		e.stopPropagation()
	}

	function onEditDblClick(e) {
		if (!state.edit) return
		if (isDevKitEvent(e)) return
		const target = e.target
		if (!target || isDevKitNode(target) || target === document.body || target === document.documentElement) return
		e.preventDefault()
		e.stopPropagation()
		selectEditElement(target)
		enableTextEdit(target)
	}

	function onEditKeyDown(e) {
		if (!state.edit || !editSelectedElement) return
		if (e.target.isContentEditable) return
		const activeTag = document.activeElement?.tagName?.toLowerCase()
		if (activeTag === "input" || activeTag === "textarea") return

		const step = e.shiftKey ? 10 : 1
		if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
			e.preventDefault()
			let dx = parseFloat(editSelectedElement.dataset.dkDx || "0")
			let dy = parseFloat(editSelectedElement.dataset.dkDy || "0")
			if (editSelectedElement.dataset.dkOrigTransform === undefined) {
				editSelectedElement.dataset.dkOrigTransform = editSelectedElement.style.transform || ""
			}
			if (e.key === "ArrowUp") dy -= step
			if (e.key === "ArrowDown") dy += step
			if (e.key === "ArrowLeft") dx -= step
			if (e.key === "ArrowRight") dx += step
			editSelectedElement.dataset.dkDx = String(dx)
			editSelectedElement.dataset.dkDy = String(dy)
			const base = editSelectedElement.dataset.dkOrigTransform || ""
			editSelectedElement.style.transform = `${base} translate(${dx}px, ${dy}px)`.trim()
			updateEditOverlay()
			updateFloatingCta("Sidekick: Design & Move", `Nudged element (${e.key.replace("Arrow", "")} ${step}px) · X ${dx}px, Y ${dy}px`)
		} else if ((e.key === "Delete" || e.key === "Backspace") && !e.target.isContentEditable) {
			e.preventDefault()
			const target = editSelectedElement
			clearEditSelection()
			target?.remove()
			updateFloatingCta("Sidekick: Design & Move", "Element deleted")
		} else if (e.key === "Escape") {
			clearEditSelection()
		}
	}

	function positionEditOverlay() {
		if (!state.edit || !editSelectedElement?.isConnected) return
		const rect = editSelectedElement.getBoundingClientRect()
		const toolbarWidth = editToolbar?.offsetWidth || 520
		if (editHighlightBox) {
			editHighlightBox.style.setProperty("top", `${rect.top}px`, "important")
			editHighlightBox.style.setProperty("left", `${rect.left}px`, "important")
			editHighlightBox.style.setProperty("width", `${rect.width}px`, "important")
			editHighlightBox.style.setProperty("height", `${rect.height}px`, "important")
		}
		if (editToolbar) {
			editToolbar.style.setProperty("top", `${Math.max(8, rect.top - 48)}px`, "important")
			editToolbar.style.setProperty("left", `${Math.max(8, Math.min(window.innerWidth - toolbarWidth - 8, rect.left))}px`, "important")
		}
	}

	const scheduleEditPosition = rafThrottle(positionEditOverlay)

	function onEditScroll() {
		if (state.edit && editSelectedElement) scheduleEditPosition()
	}

	function toggleEdit() {
		state.edit = !state.edit
		if (state.edit) {
			document.addEventListener("mouseover", onEditMouseOver, true)
			document.addEventListener("mouseout", onEditMouseOut, true)
			document.addEventListener("click", onEditClick, true)
			document.addEventListener("dblclick", onEditDblClick, true)
			document.addEventListener("mousedown", onEditMouseDown, true)
			document.addEventListener("keydown", onEditKeyDown, true)
			window.addEventListener("scroll", onEditScroll, true)
			window.addEventListener("resize", onEditScroll, true)
			showFloatingCta(
				"Sidekick: Design & Move Mode",
				"Figma Mode active · Click any element · Parent selects containers · Drag to move · Esc deselects",
				() => toggleEdit()
			)
			registerCleanup("edit", () => {
				if (state.edit) toggleEdit()
			})
		} else {
			scheduleEditPosition.cancel()
			activeCleanups.delete("edit")
			document.removeEventListener("mouseover", onEditMouseOver, true)
			document.removeEventListener("mouseout", onEditMouseOut, true)
			document.removeEventListener("click", onEditClick, true)
			document.removeEventListener("dblclick", onEditDblClick, true)
			document.removeEventListener("mousedown", onEditMouseDown, true)
			document.removeEventListener("keydown", onEditKeyDown, true)
			window.removeEventListener("mousemove", onWindowMouseMove, true)
			window.removeEventListener("mouseup", onWindowMouseUp, true)
			window.removeEventListener("scroll", onEditScroll, true)
			window.removeEventListener("resize", onEditScroll, true)
			clearEditSelection()
			hideFloatingCta()
		}
		return state.edit
	}

	function toggleViewport() {
		state.viewport = !state.viewport
		document.querySelectorAll(".dk-badge").forEach((b) => b.remove())
		getShadowRoot()?.querySelectorAll?.(".dk-badge")?.forEach((b) => b.remove())
		badge = null

		if (!state.viewport) {
			window.removeEventListener("resize", onViewportResize)
			onViewportResize.cancel()
			hideFloatingCta()
			try {
				runtime.runtime.sendMessage({
					type: "devkit:viewport-update",
					payload: { enabled: false },
				}).catch(() => {})
			} catch {}
			return false
		}
		ensureStyles()
		badge = el("div", "dk-badge")
		getShadowRoot().appendChild(badge)
		paintBadge()
		window.addEventListener("resize", onViewportResize)
		showFloatingCta(
			"Sidekick: Viewport Sizer",
			"Live viewport HUD active · Resize browser window to test breakpoints",
			() => toggleViewport(),
			[
				{
					icon: "phone",
					label: "Simulate device",
					title: "Open the in-page device simulator",
					action: () => toggleDeviceFrame({ width: 390, height: 844, label: "iPhone 14" }),
				},
			]
		)
		return true
	}

	const onViewportResize = rafThrottle(() => paintBadge())

	function bucket(width) {
		if (width < 480) return "xs (mobile)"
		if (width < 768) return "sm"
		if (width < 1024) return "md (tablet)"
		if (width < 1280) return "lg"
		return "xl (desktop)"
	}

	function paintBadge() {
		if (!badge) return
		badge.textContent = ""
		badge.style.cssText = "position: fixed !important; top: 16px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 2147483647 !important; display: inline-flex !important; align-items: center !important; gap: 10px !important; background: #17140f !important; background: rgba(23, 20, 15, 0.96) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1.5px solid #ff5a1f !important; border-radius: 12px !important; padding: 8px 18px !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 90, 31, 0.4) !important; font-size: 13px !important; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important; color: #ffffff !important; pointer-events: auto !important; line-height: 1 !important; white-space: nowrap !important; box-sizing: border-box !important;"

		const dot = el("span", "dk-badge-dot")
		dot.style.cssText = "width: 8px !important; height: 8px !important; border-radius: 50% !important; background: #14b8a6 !important; box-shadow: 0 0 8px #14b8a6 !important; flex-shrink: 0 !important;"

		const dims = el("span", "dk-badge-dims")
		dims.style.cssText = "font-weight: 700 !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; color: #ffffff !important; font-size: 13.5px !important; letter-spacing: 0.3px !important;"
		dims.textContent = `${window.innerWidth} × ${window.innerHeight} px`

		const tag = el("span", "dk-badge-tag")
		tag.style.cssText = "background: rgba(255, 90, 31, 0.25) !important; border: 1px solid rgba(255, 90, 31, 0.5) !important; color: #ffb08a !important; border-radius: 12px !important; padding: 2px 8px !important; font-size: 11px !important; font-weight: 600 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important;"
		tag.textContent = bucket(window.innerWidth)

		const dpr = el("span", "dk-badge-dpr")
		dpr.style.cssText = "color: #b3a894 !important; font-size: 12px !important; border-left: 1px solid rgba(243, 236, 224, 0.2) !important; padding-left: 8px !important;"
		dpr.textContent = `DPR ${window.devicePixelRatio}`

		const closeBtn = el("button", "dk-badge-close")
		closeBtn.type = "button"
		closeBtn.appendChild(icon("close", 12))
		closeBtn.title = "Close viewport badge"
		closeBtn.style.cssText = "background: rgba(255, 77, 77, 0.2) !important; border: 1px solid rgba(255, 77, 77, 0.4) !important; border-radius: 12px !important; color: #ffb3a3 !important; cursor: pointer !important; font-size: 11px !important; font-weight: 700 !important; padding: 3px 8px !important; line-height: 1 !important; margin-left: 6px !important; display: inline-flex !important; align-items: center !important;"
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation()
			toggleViewport()
		})
		badge.append(dot, dims, tag, dpr, closeBtn)

		try {
			runtime.runtime.sendMessage({
				type: "devkit:viewport-update",
				payload: {
					enabled: true,
					width: window.innerWidth,
					height: window.innerHeight,
					dpr: window.devicePixelRatio,
				},
			}).catch(() => {})
		} catch {  }
	}

	const SIMULATOR_PRESETS = [
		{ label: "iPhone SE", icon: "phone", w: 375, h: 667 },
		{ label: "iPhone 14", icon: "phone", w: 390, h: 844 },
		{ label: "iPad Mini", icon: "phone", w: 768, h: 1024 },
		{ label: "MacBook 13", icon: "laptop", w: 1280, h: 800 },
		{ label: "Full HD", icon: "monitor", w: 1920, h: 1080 },
	]

	let deviceEscHandler = null

	function setDeviceTitle(target, label, width) {
		target.textContent = ""
		target.appendChild(icon(width <= 820 ? "phone" : width <= 1440 ? "laptop" : "monitor", 14))
		target.appendChild(document.createTextNode(label))
	}

	function toggleDeviceFrame(payload) {
		if (payload?.close === true || (deviceSimulator && !payload)) {
			if (deviceSimulator?.parentNode) {
				deviceSimulator.parentNode.removeChild(deviceSimulator)
			}
			deviceSimulator = null
			state.deviceFrame = null
			if (deviceEscHandler) window.removeEventListener("keydown", deviceEscHandler)
			deviceEscHandler = null
			if (badge) badge.style.display = ""
			hideFloatingCta()
			try {
				runtime.runtime.sendMessage({
					type: "devkit:device-frame-update",
					payload: { active: false },
				}).catch(() => {})
			} catch {}
			return { active: false }
		}

		let curW = Math.max(280, Math.round(Number(payload?.width) || 375))
		let curH = Math.max(200, Math.round(Number(payload?.height) || 667))
		let curLabel = payload?.label || "Mobile"
		let curIcon = typeof payload?.icon === "string" && ICONS[payload.icon] ? payload.icon : "phone"
		let isLandscape = false

		if (badge) badge.style.display = "none"

		if (deviceSimulator && getShadowRoot()?.contains(deviceSimulator)) {
			const shell = deviceSimulator.querySelector(".dk-sim-shell")
			const titleText = deviceSimulator.querySelector(".dk-sim-title")
			const dimBadge = deviceSimulator.querySelector(".dk-sim-dim-badge")
			if (shell && titleText && dimBadge) {
				shell.style.setProperty("width", `${curW}px`, "important")
				shell.style.setProperty("height", `${curH}px`, "important")
				shell.style.setProperty("border-radius", curW <= 480 ? "40px" : "24px", "important")
				const notch = shell.querySelector(".dk-sim-notch")
				const homeBar = shell.querySelector(".dk-sim-home-bar")
				if (notch) notch.style.display = curW <= 480 ? "block" : "none"
				if (homeBar) homeBar.style.display = curW <= 480 ? "block" : "none"
				setDeviceTitle(titleText, curLabel, curW)
				dimBadge.textContent = `${curW} × ${curH} px`
				state.deviceFrame = { active: true, width: curW, height: curH, label: curLabel, icon: curIcon, isLandscape: false }
				showFloatingCta(
					"Sidekick: Device Simulator",
					`In-page frame active (${curLabel} ${curW}×${curH})`,
					() => toggleDeviceFrame({ close: true })
				)
				try {
					runtime.runtime.sendMessage({
						type: "devkit:device-frame-update",
						payload: { active: true, width: curW, height: curH, label: curLabel, icon: curIcon },
					}).catch(() => {})
				} catch {}
				return { active: true, width: curW, height: curH, label: curLabel }
			}
		}

		ensureStyles()
		const root = getShadowRoot()

		root.querySelectorAll(".dk-device-sim-overlay").forEach((el) => el.remove())

		const overlay = el("div", "dk-device-sim-overlay")
		overlay.style.cssText = "position: fixed !important; inset: 0 !important; z-index: 2147483645 !important; background: radial-gradient(circle at 50% 25%, #221e18 0%, #17140f 100%) !important; background-image: radial-gradient(rgba(243, 236, 224, 0.08) 1.5px, transparent 1.5px) !important; background-size: 24px 24px !important; overflow: auto !important; padding: 16px 20px 60px 20px !important; pointer-events: auto !important; box-sizing: border-box !important;"

		const inner = el("div", "dk-sim-inner")
		inner.style.cssText = "display: flex !important; flex-direction: column !important; align-items: center !important; min-width: 100% !important; width: max-content !important; margin: 0 auto !important; box-sizing: border-box !important;"

		const toolbar = el("div", "dk-sim-toolbar")
		toolbar.style.cssText = "position: sticky !important; top: 0 !important; z-index: 30 !important; display: inline-flex !important; align-items: center !important; gap: 10px !important; background: rgba(23, 20, 15, 0.92) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1.5px solid rgba(255, 90, 31, 0.5) !important; border-radius: 12px !important; padding: 6px 14px !important; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7), 0 0 20px rgba(255, 90, 31, 0.3) !important; margin-bottom: 20px !important; flex-wrap: wrap !important; justify-content: center !important;"

		const titleText = el("span", "dk-sim-title")
		titleText.style.cssText = "font-weight: 700 !important; color: #ffffff !important; font-size: 13px !important; display: inline-flex !important; align-items: center !important; gap: 6px !important;"
		setDeviceTitle(titleText, curLabel, curW)

		const dimBadge = el("span", "dk-sim-dim-badge")
		dimBadge.style.cssText = "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 11.5px !important; font-weight: 600 !important; color: #ffb08a !important; background: rgba(255, 90, 31, 0.25) !important; border: 1px solid rgba(255, 90, 31, 0.4) !important; padding: 2px 8px !important; border-radius: 12px !important;"
		dimBadge.textContent = `${curW} × ${curH} px`

		const rotateBtn = el("button", "dk-sim-btn")
		rotateBtn.type = "button"
		rotateBtn.style.cssText = "background: rgba(243, 236, 224, 0.1) !important; border: 1px solid rgba(243, 236, 224, 0.2) !important; border-radius: 12px !important; color: #ffffff !important; cursor: pointer !important; font-size: 11.5px !important; font-weight: 600 !important; padding: 3px 10px !important; display: inline-flex !important; align-items: center !important; gap: 4px !important; transition: all 0.15s !important;"
		setButtonContent(rotateBtn, "rotate", "Rotate")
		rotateBtn.title = "Toggle Portrait / Landscape orientation"
		rotateBtn.addEventListener("click", () => {
			isLandscape = !isLandscape
			const temp = curW
			curW = curH
			curH = temp
			shell.style.setProperty("width", `${curW}px`, "important")
			shell.style.setProperty("height", `${curH}px`, "important")
			dimBadge.textContent = `${curW} × ${curH} px ${isLandscape ? "(Landscape)" : "(Portrait)"}`
			state.deviceFrame = { active: true, width: curW, height: curH, label: curLabel, icon: curIcon, isLandscape }
			try {
				runtime.runtime.sendMessage({
					type: "devkit:device-frame-update",
					payload: { active: true, width: curW, height: curH, label: curLabel, icon: curIcon, isLandscape },
				}).catch(() => {})
			} catch {}
		})

		const presetGroup = el("div", "dk-sim-presets")
		presetGroup.style.cssText = "display: inline-flex !important; align-items: center !important; gap: 4px !important; border-left: 1px solid rgba(243, 236, 224, 0.2) !important; padding-left: 8px !important;"

		for (const p of SIMULATOR_PRESETS) {
			const pBtn = el("button", "dk-sim-preset-btn")
			pBtn.type = "button"
			pBtn.style.cssText = "background: rgba(243, 236, 224, 0.08) !important; border: 1px solid rgba(243, 236, 224, 0.15) !important; border-radius: 12px !important; color: #d6ccbb !important; cursor: pointer !important; font-size: 10.5px !important; font-weight: 500 !important; padding: 2px 7px !important; transition: all 0.15s !important;"
			pBtn.textContent = p.label
			pBtn.addEventListener("click", () => {
				curW = p.w
				curH = p.h
				curLabel = p.label
				curIcon = p.icon
				isLandscape = false
				shell.style.setProperty("width", `${curW}px`, "important")
				shell.style.setProperty("height", `${curH}px`, "important")
				shell.style.setProperty("border-radius", curW <= 480 ? "40px" : "24px", "important")
				const notch = shell.querySelector(".dk-sim-notch")
				const homeBar = shell.querySelector(".dk-sim-home-bar")
				if (notch) notch.style.display = curW <= 480 ? "block" : "none"
				if (homeBar) homeBar.style.display = curW <= 480 ? "block" : "none"
				setDeviceTitle(titleText, curLabel, curW)
				dimBadge.textContent = `${curW} × ${curH} px`
				state.deviceFrame = { active: true, width: curW, height: curH, label: curLabel, icon: curIcon, isLandscape: false }
				showFloatingCta(
					"Sidekick: Device Simulator",
					`In-page frame active (${curLabel} ${curW}×${curH})`,
					() => toggleDeviceFrame({ close: true })
				)
				try {
					runtime.runtime.sendMessage({
						type: "devkit:device-frame-update",
						payload: { active: true, width: curW, height: curH, label: curLabel, icon: curIcon },
					}).catch(() => {})
				} catch {}
			})
			presetGroup.appendChild(pBtn)
		}

		const reloadBtn = el("button", "dk-sim-btn")
		reloadBtn.type = "button"
		reloadBtn.style.cssText = "background: rgba(243, 236, 224, 0.1) !important; border: 1px solid rgba(243, 236, 224, 0.2) !important; border-radius: 12px !important; color: #ffffff !important; cursor: pointer !important; font-size: 11.5px !important; font-weight: 600 !important; padding: 3px 10px !important; display: inline-flex !important; align-items: center !important; gap: 4px !important;"
		setButtonContent(reloadBtn, "reset", "Reload")
		reloadBtn.title = "Reload frame content"
		reloadBtn.addEventListener("click", () => {
			if (iframe) iframe.src = iframe.src
		})

		const exitBtn = el("button", "dk-sim-exit")
		exitBtn.type = "button"
		exitBtn.style.cssText = "background: rgba(255, 77, 77, 0.25) !important; border: 1px solid rgba(255, 77, 77, 0.5) !important; border-radius: 12px !important; color: #ffb3a3 !important; cursor: pointer !important; font-size: 11.5px !important; font-weight: 700 !important; padding: 3px 12px !important; display: inline-flex !important; align-items: center !important; gap: 4px !important; transition: all 0.15s !important;"
		setButtonContent(exitBtn, "close", "Exit frame")
		exitBtn.addEventListener("click", () => toggleDeviceFrame({ close: true }))

		toolbar.append(titleText, dimBadge, rotateBtn, presetGroup, reloadBtn, exitBtn)
		inner.appendChild(toolbar)

		const shell = el("div", "dk-sim-shell")
		shell.style.cssText = `width: ${curW}px !important; height: ${curH}px !important; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important; border: 12px solid #221e18 !important; outline: 2px solid rgba(179, 168, 148, 0.25) !important; border-radius: ${curW <= 480 ? "40px" : "24px"} !important; box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 40px rgba(255, 90, 31, 0.25) !important; background: #ffffff !important; overflow: hidden !important; position: relative !important; flex-shrink: 0 !important;`

		const notch = el("div", "dk-sim-notch")
		notch.style.cssText = `position: absolute !important; top: 8px !important; left: 50% !important; transform: translateX(-50%) !important; width: 90px !important; height: 18px !important; background: #17140f !important; border-radius: 12px !important; z-index: 10 !important; pointer-events: none !important; display: ${curW <= 480 ? "block" : "none"} !important;`
		shell.appendChild(notch)

		const homeBar = el("div", "dk-sim-home-bar")
		homeBar.style.cssText = `position: absolute !important; bottom: 6px !important; left: 50% !important; transform: translateX(-50%) !important; width: 120px !important; height: 4px !important; background: rgba(0, 0, 0, 0.3) !important; border-radius: 12px !important; z-index: 10 !important; pointer-events: none !important; display: ${curW <= 480 ? "block" : "none"} !important;`
		shell.appendChild(homeBar)

		const iframe = document.createElement("iframe")
		iframe.className = "dk-sim-iframe"
		iframe.src = window.location.href
		iframe.style.cssText = "width: 100% !important; height: 100% !important; border: none !important; display: block !important; background: #ffffff !important;"
		shell.appendChild(iframe)

		inner.appendChild(shell)

		const tip = el("div", "dk-sim-tip")
		tip.style.cssText = "color: #b3a894 !important; font-size: 11.5px !important; margin-top: 14px !important; text-align: center !important;"
		tip.textContent = "Press Esc to exit the frame · Scroll inside the device to test responsive layouts"
		inner.appendChild(tip)

		if (deviceEscHandler) window.removeEventListener("keydown", deviceEscHandler)
		deviceEscHandler = (e) => {
			if (e.key === "Escape") toggleDeviceFrame({ close: true })
		}
		window.addEventListener("keydown", deviceEscHandler)

		overlay.appendChild(inner)
		root.appendChild(overlay)
		deviceSimulator = overlay
		state.deviceFrame = { active: true, width: curW, height: curH, label: curLabel, icon: curIcon, isLandscape: false }

		showFloatingCta(
			"Sidekick: Device Simulator",
			`In-page frame active (${curLabel} ${curW}×${curH})`,
			() => toggleDeviceFrame({ close: true })
		)

		try {
			runtime.runtime.sendMessage({
				type: "devkit:device-frame-update",
				payload: { active: true, width: curW, height: curH, label: curLabel, icon: curIcon },
			}).catch(() => {})
		} catch {}

		return { active: true, width: curW, height: curH, label: curLabel }
	}

	function accessibleName(node) {
		const aria = node.getAttribute("aria-label")
		if (aria && aria.trim()) return aria.trim()
		const ids = node.getAttribute("aria-labelledby")
		if (ids) {
			const text = ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim()
			if (text) return text
		}
		const text = (node.textContent || "").trim()
		if (text) return text
		const title = node.getAttribute("title")
		if (title && title.trim()) return title.trim()
		if (node.tagName === "INPUT") return node.value || node.getAttribute("alt") || ""
		const inner = node.querySelector("img[alt]:not([alt='']), [aria-label], svg title")
		if (inner) return inner.getAttribute("alt") || inner.getAttribute("aria-label") || inner.textContent || ""
		return ""
	}

	// Returns the first opaque background color behind a node, or null when an image or gradient
	// is in the way and the contrast cannot be computed reliably.
	function opaqueBackground(node) {
		let current = node
		while (current && current.nodeType === 1) {
			const style = getComputedStyle(current)
			if (style.backgroundImage && style.backgroundImage !== "none") return null
			const bg = style.backgroundColor
			if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg
			current = current.parentElement
		}
		return "rgb(255, 255, 255)"
	}

	function auditA11y() {
		const issues = []
		let truncated = false
		const add = (severity, rule, message, node) =>
			issues.push({ severity, rule, message, selector: node ? cssPath(node) : undefined })
		const track = (scan) => {
			if (scan.truncated) truncated = true
		}
		const opts = { limit: 3000, ms: 200 }
		const hidden = (node) => Boolean(node.closest("[aria-hidden='true'], [hidden]"))

		track(scanElements("img", (img) => {
			if (img.hasAttribute("alt") || hidden(img)) return
			if (img.getAttribute("role") === "presentation" || img.getAttribute("role") === "none") return
			add("serious", "image-alt", "Image missing alt attribute", img)
		}, opts))
		track(scanElements("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea", (control) => {
			if (hidden(control) || !isRendered(control)) return
			const labelled =
				control.labels?.length ||
				control.getAttribute("aria-label")?.trim() ||
				control.getAttribute("aria-labelledby") ||
				control.getAttribute("title")
			if (!labelled) {
				add("critical", "form-label", control.placeholder ? "Form control relies on a placeholder instead of a label" : "Form control has no accessible name", control)
			}
		}, opts))
		track(scanElements("button, [role=button], a[href], input[type=submit], input[type=button], input[type=image]", (control) => {
			if (hidden(control)) return
			if (!accessibleName(control) && isRendered(control)) add("serious", "control-name", "Interactive control has no visible or ARIA name", control)
		}, opts))

		let previous = 0
		track(scanElements("h1,h2,h3,h4,h5,h6", (heading) => {
			const level = Number(heading.tagName[1])
			if (previous && level - previous > 1) add("moderate", "heading-order", `Heading jumps h${previous} to h${level}`, heading)
			if (!heading.textContent.trim()) add("moderate", "empty-heading", "Heading has no text", heading)
			previous = level
		}, opts))
		if (document.querySelectorAll("h1").length !== 1) add("moderate", "page-has-h1", "Page should have exactly one h1")
		if (!document.documentElement.lang) add("serious", "html-lang", "<html> is missing a lang attribute")

		// Contrast is checked on elements that own visible text, found through text nodes.
		const seen = new Set()
		const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
		const deadline = performance.now() + 300
		let checked = 0
		while (walker.nextNode() && checked < 600) {
			const textNode = walker.currentNode
			const parent = textNode.parentElement
			if (!parent || seen.has(parent) || !textNode.data.trim()) continue
			seen.add(parent)
			if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(parent.tagName) || hidden(parent)) continue
			checked++
			if ((checked & 31) === 31 && performance.now() > deadline) {
				truncated = true
				break
			}
			const style = getComputedStyle(parent)
			if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue
			if (!isRendered(parent)) continue
			const bg = opaqueBackground(parent)
			if (!bg) continue
			const ratio = contrast(style.color, bg)
			const size = parseFloat(style.fontSize)
			const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
			if (ratio !== null && ratio < (large ? 3 : 4.5)) {
				add("serious", "color-contrast", `Contrast ${ratio}:1 is below WCAG AA (${large ? "3" : "4.5"}:1)`, parent)
			}
		}

		track(scanElements("[tabindex]", (node) => {
			if (Number(node.getAttribute("tabindex")) > 0) add("minor", "tabindex", "Positive tabindex breaks natural focus order", node)
		}, opts))
		enhancedA11yChecks(issues, add, track)
		const summary = issues.reduce((acc, issue) => ({ ...acc, [issue.severity]: (acc[issue.severity] ?? 0) + 1 }), {})
		return { total: issues.length, summary, issues: issues.slice(0, 200), truncated }
	}

	function auditSeo() {
		const meta = (name) =>
			document.querySelector(`meta[name="${name}"]`)?.content ||
			document.querySelector(`meta[property="${name}"]`)?.content ||
			null
		const title = document.title || ""
		const description = meta("description") || ""
		const canonical = document.querySelector("link[rel=canonical]")?.href ?? null
		const robots = meta("robots")
		const warnings = []

		if (!title) warnings.push("Missing <title> tag")
		else if (title.length < 15) warnings.push(`Title is too short (${title.length} chars, aim for 30–60)`)
		else if (title.length > 60) warnings.push(`Title is ${title.length} chars (aim for <= 60)`)

		if (!description) warnings.push("Missing meta description")
		else if (description.length < 50) warnings.push(`Description is too short (${description.length} chars, aim for 70–160)`)
		else if (description.length > 160) warnings.push(`Description is ${description.length} chars (aim for <= 160)`)

		if (!canonical) warnings.push("Missing canonical link")
		else if (canonical.replace(/\/$/, "") !== location.href.split("#")[0].replace(/\/$/, "")) warnings.push("Canonical URL differs from current page URL")

		if (robots && /noindex/i.test(robots)) warnings.push("Page has robots noindex directive (search engines will not index this page)")

		if (!meta("og:title")) warnings.push("Missing og:title")
		if (!meta("og:image")) warnings.push("Missing og:image")
		if (!meta("viewport")) warnings.push("Missing viewport meta — page is not mobile ready")
		if (!document.documentElement.lang) warnings.push("Missing lang attribute on <html> element")

		const h1List = [...document.querySelectorAll("h1")].map((h) => (h.textContent || "").trim()).filter(Boolean)
		if (h1List.length === 0) warnings.push("Page has no <h1> heading")
		else if (h1List.length > 1) warnings.push(`Page has multiple (${h1List.length}) <h1> headings (recommended: exactly 1)`)

		const outline = []
		let lastLevel = 0
		scanElements("h1,h2,h3,h4,h5,h6", (heading) => {
			const level = Number(heading.tagName[1])
			const entry = { level, text: (heading.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120), selector: cssPath(heading) }
			if (lastLevel && level - lastLevel > 1) entry.issue = `skips from h${lastLevel}`
			if (!entry.text) entry.issue = "empty heading"
			outline.push(entry)
			lastLevel = level
			if (outline.length >= 150) return false
		}, { limit: 2000, ms: 100 })
		if (outline.some((h) => h.issue?.startsWith("skips"))) warnings.push("Heading levels skip (for example h2 to h4), see the headings outline")

		const images = [...document.images]
		const favicon = document.querySelector("link[rel*='icon']")?.href || null

		return {
			title,
			titleLength: title.length,
			description,
			canonical,
			robots: robots || "all (index, follow)",
			isNoIndex: Boolean(robots && /noindex/i.test(robots)),
			viewport: meta("viewport"),
			lang: document.documentElement.lang || null,
			charset: document.characterSet || document.querySelector("meta[charset]")?.getAttribute("charset") || null,
			favicon,
			openGraph: {
				title: meta("og:title") || title,
				description: meta("og:description") || description,
				image: meta("og:image"),
				url: meta("og:url") || canonical || location.href,
				siteName: meta("og:site_name"),
			},
			twitter: {
				card: meta("twitter:card") || "summary",
				title: meta("twitter:title") || meta("og:title") || title,
				description: meta("twitter:description") || meta("og:description") || description,
				image: meta("twitter:image") || meta("og:image"),
				site: meta("twitter:site"),
			},
			headings: {
				h1: h1List.slice(0, 10),
				outline,
				counts: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`h${n}`, document.querySelectorAll(`h${n}`).length])),
			},
			images: { total: images.length, missingAlt: images.filter((i) => !i.alt).length },
			structuredData: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
			hreflang: [...document.querySelectorAll("link[rel=alternate][hreflang]")].map((l) => l.hreflang),
			warnings,
		}
	}

	async function scanLinks(payload = {}) {
		const links = [...document.querySelectorAll("a")].slice(0, 5000)
		const problems = []
		const brokenLinks = []
		const redirects = []
		const isHttps = location.protocol === "https:"
		const textOf = (link) => (link.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)

		for (const link of links) {
			const href = link.getAttribute("href")
			if (href === null) continue
			const trimmed = href.trim()
			if (trimmed === "" || trimmed === "#") {
				problems.push({ issue: "empty or hash href", selector: cssPath(link), text: textOf(link) })
			} else if (/^javascript:/i.test(trimmed)) {
				problems.push({ issue: "javascript: link", selector: cssPath(link), text: textOf(link) })
			} else if (trimmed.startsWith("#") && trimmed !== "#top") {
				let targetId = trimmed.slice(1)
				try {
					targetId = decodeURIComponent(targetId)
				} catch {}
				if (!document.getElementById(targetId) && !document.getElementsByName(targetId).length) {
					problems.push({ issue: `Broken in-page anchor (#${targetId})`, selector: cssPath(link), text: textOf(link) })
				}
			} else if (isHttps && /^http:/i.test(trimmed)) {
				problems.push({ issue: "Mixed content link (HTTP on HTTPS)", href, selector: cssPath(link) })
			}
			// noreferrer implies noopener, and modern browsers default to noopener for _blank links.
			if (link.target === "_blank" && !/noopener|noreferrer/i.test(link.rel)) {
				problems.push({ issue: "target=_blank without rel=noopener (relies on browser default)", selector: cssPath(link) })
			}
		}

		if (isHttps) {
			for (const img of document.images) {
				if (/^http:/i.test(img.currentSrc || img.src)) {
					problems.push({ issue: "Mixed content image (HTTP on HTTPS)", href: img.currentSrc || img.src, selector: cssPath(img) })
				}
			}
		}

		const brokenImages = [...document.images]
			.filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src))
			.map((img) => ({ src: img.currentSrc || img.src, selector: cssPath(img), alt: img.alt || null }))

		const byUrl = new Map()
		for (const link of links) {
			const url = link.href
			if (!/^https?:/i.test(url)) continue
			const clean = url.split("#")[0]
			if (!byUrl.has(clean)) byUrl.set(clean, link)
		}
		const sameOrigin = [...byUrl.keys()].filter((u) => u.startsWith(location.origin))
		const external = [...byUrl.keys()].filter((u) => !u.startsWith(location.origin))

		let httpChecked = false
		let httpError = null
		let checkedCount = 0
		if (payload?.checkHttp === true || payload?.checkHttp === "true") {
			// Same origin links first so the 300 URL cap keeps the most relevant ones.
			const urls = [...sameOrigin, ...external].slice(0, 300)
			const response = await sendRuntime({ type: "links:check", urls, pageUrl: location.href })
			if (response?.ok && Array.isArray(response.results)) {
				httpChecked = true
				checkedCount = response.checked ?? response.results.length
				for (const result of response.results) {
					if (!result) continue
					const link = byUrl.get(result.url)
					const failed = (typeof result.status === "number" && result.status >= 400) || (result.ok === false && result.status === null)
					if (failed) {
						brokenLinks.push({
							url: result.url,
							status: result.status ?? 0,
							statusText: result.statusText || result.error || "",
							error: result.error,
							selector: link ? cssPath(link) : undefined,
							text: link ? textOf(link) : undefined,
						})
					} else if (result.redirected && redirects.length < 50) {
						redirects.push({ url: result.url, finalUrl: result.finalUrl, status: result.status })
					}
				}
			} else {
				httpError = response?.error ?? "Link check unavailable"
			}
		}

		return {
			links: links.length,
			images: document.images.length,
			brokenLinks,
			brokenImages,
			problems: problems.slice(0, 200),
			httpChecked,
			checkedCount,
			httpError,
			redirects,
			uniqueUrls: byUrl.size,
			sameOriginUrls: sameOrigin.length,
			externalUrls: external.length,
		}
	}

	// LCP, layout shift, event and long task entries are only exposed through a buffered
	// PerformanceObserver, never through getEntriesByType.
	function observeBuffered(type, extra = {}) {
		return new Promise((resolve) => {
			try {
				if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes(type)) {
					resolve(null)
					return
				}
				let entries = []
				const observer = new PerformanceObserver((list) => {
					entries = entries.concat(list.getEntries())
				})
				observer.observe({ type, buffered: true, ...extra })
				setTimeout(() => {
					try {
						entries = entries.concat(observer.takeRecords())
						observer.disconnect()
					} catch {}
					resolve(entries)
				}, 50)
			} catch {
				resolve(null)
			}
		})
	}

	function clsFromShifts(shifts) {
		let max = 0
		let current = 0
		let first = 0
		let last = 0
		for (const shift of shifts) {
			if (shift.hadRecentInput) continue
			if (current && (shift.startTime - last > 1000 || shift.startTime - first > 5000)) {
				max = Math.max(max, current)
				current = 0
			}
			if (!current) first = shift.startTime
			current += shift.value
			last = shift.startTime
		}
		return Math.round(Math.max(max, current) * 1000) / 1000
	}

	async function metrics() {
		const nav = performance.getEntriesByType("navigation")[0]
		const resources = performance.getEntriesByType("resource")
		const bytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0)
		const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]))
		const byType = {}
		const bytesByType = {}
		for (const resource of resources) {
			const key = resource.initiatorType || "other"
			byType[key] = (byType[key] ?? 0) + 1
			bytesByType[key] = (bytesByType[key] ?? 0) + (resource.transferSize || 0)
		}

		const [lcpEntries, shiftEntries, eventEntries, longTaskEntries] = await Promise.all([
			observeBuffered("largest-contentful-paint"),
			observeBuffered("layout-shift"),
			observeBuffered("event", { durationThreshold: 40 }),
			observeBuffered("longtask"),
		])

		const lastLcp = lcpEntries?.length ? lcpEntries[lcpEntries.length - 1] : null
		const lcp = lastLcp ? Math.round(lastLcp.renderTime || lastLcp.startTime) : null
		const lcpElement = lastLcp?.element ? cssPath(lastLcp.element) : null
		const cls = shiftEntries ? clsFromShifts(shiftEntries) : null
		let inp = null
		if (eventEntries?.length) {
			const interactions = eventEntries.filter((e) => e.interactionId)
			if (interactions.length) inp = Math.round(Math.max(...interactions.map((e) => e.duration)))
		}
		const longTasks = longTaskEntries?.length
			? { count: longTaskEntries.length, totalMs: Math.round(longTaskEntries.reduce((s, t) => s + t.duration, 0)) }
			: null

		const ttfb = nav ? Math.round(nav.responseStart) : null
		const fcp = paints["first-contentful-paint"] ?? null
		const rate = (val, good, poor) => {
			if (val === null || val === undefined) return "unknown"
			if (val <= good) return "good"
			if (val <= poor) return "needs-improvement"
			return "poor"
		}
		const vitals = {
			ttfb: { value: ttfb, rating: rate(ttfb, 800, 1800), label: "TTFB", unit: "ms" },
			fcp: { value: fcp, rating: rate(fcp, 1800, 3000), label: "FCP", unit: "ms" },
			lcp: { value: lcp, rating: rate(lcp, 2500, 4000), label: "LCP", unit: "ms" },
			cls: { value: cls, rating: rate(cls, 0.1, 0.25), label: "CLS", unit: "" },
		}
		if (inp !== null) vitals.inp = { value: inp, rating: rate(inp, 200, 500), label: "INP (approx.)", unit: "ms" }

		const largest = [...resources]
			.filter((r) => r.transferSize > 0)
			.sort((a, b) => b.transferSize - a.transferSize)
			.slice(0, 8)
			.map((r) => ({
				name: r.name.split("/").pop().split("?")[0] || r.name,
				fullUrl: r.name,
				size: `${Math.round(r.transferSize / 1024)} KB`,
				bytes: r.transferSize,
				type: r.initiatorType,
			}))

		let memory = null
		if (performance.memory) {
			memory = {
				usedJsHeap: `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`,
				totalJsHeap: `${Math.round(performance.memory.totalJSHeapSize / 1048576)} MB`,
			}
		}

		return {
			url: location.href,
			readyState: document.readyState,
			navigationType: nav?.type ?? null,
			ttfbMs: ttfb,
			domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
			loadMs: nav ? Math.round(nav.loadEventEnd) : null,
			paints,
			lcpMs: lcp,
			lcpElement,
			cls,
			inpMs: inp,
			vitals,
			longTasks,
			memory,
			resourceCount: resources.length,
			transferBytes: bytes,
			transferReadable: bytes > 1048576 ? `${Math.round((bytes / 1048576) * 10) / 10} MB` : `${Math.round((bytes / 1024) * 10) / 10} KB`,
			resourcesByType: byType,
			bytesByType,
			largestResources: largest,
			domNodes: document.getElementsByTagName("*").length,
			iframes: document.querySelectorAll("iframe").length,
			eventListeners: document.querySelectorAll("[onclick],[onmouseover],[onkeydown]").length,
		}
	}

	function storageDump() {
		const read = (store) => {
			const map = {}
			const items = []
			let totalBytes = 0
			try {
				if (store) {
					for (let i = 0; i < store.length; i += 1) {
						const key = store.key(i)
						const rawVal = store.getItem(key) ?? ""
						const bytes = (key.length + rawVal.length) * 2
						totalBytes += bytes
						map[key] = rawVal.length > 500 ? rawVal.slice(0, 500) + "…" : rawVal
						items.push({
							key,
							value: rawVal.length > 50000 ? rawVal.slice(0, 50000) + "… (truncated)" : rawVal,
							bytes,
						})
					}
				}
			} catch (error) {
				map.__error = error.message
			}
			return { map, items, totalBytes }
		}

		const cookieStrings = document.cookie ? document.cookie.split(";").map((c) => c.trim()).filter(Boolean) : []
		const cookieItems = cookieStrings.map((c) => {
			const eqIdx = c.indexOf("=")
			if (eqIdx === -1) return { key: c, value: "", bytes: c.length }
			const key = c.slice(0, eqIdx).trim()
			const value = c.slice(eqIdx + 1).trim()
			return { key, value, bytes: c.length }
		})
		const totalCookieBytes = cookieItems.reduce((acc, c) => acc + c.bytes, 0)

		const store = (name) => {
			try {
				return window[name]
			} catch {
				return null
			}
		}
		return {
			localStorage: read(store("localStorage")),
			sessionStorage: read(store("sessionStorage")),
			cookies: { items: cookieItems, raw: cookieStrings, totalBytes: totalCookieBytes },
		}
	}

	function fontsReport() {
		const seen = new Map()
		scanElements("body *", (node) => {
			// Only elements that own text actually render it with their font.
			if (!hasOwnText(node)) return
			const style = getComputedStyle(node)
			if (style.display === "none") return
			const primaryFamily = style.fontFamily.split(",")[0].replace(/["']/g, "").trim()
			const fullFamily = style.fontFamily.replace(/["']/g, "").trim()
			const lineHeight = style.lineHeight === "normal" ? "normal" : style.lineHeight
			const key = `${primaryFamily} | ${style.fontSize} | ${style.fontWeight} | ${lineHeight}`
			let entry = seen.get(key)
			if (!entry) {
				const text = (node.textContent || "").trim().replace(/\s+/g, " ")
				entry = {
					style: key,
					family: primaryFamily,
					fullFamily,
					size: style.fontSize,
					weight: style.fontWeight,
					lineHeight,
					sampleText: text.length > 35 ? `${text.slice(0, 35)}…` : text,
					count: 0,
				}
				seen.set(key, entry)
			}
			entry.count++
		}, { limit: 6000, ms: 300 })
		return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 40)
	}

	let colorCanvasCtx = null
	const colorCache = new Map()
	function normalizeCssColor(colorStr) {
		if (!colorStr || colorStr === "transparent" || colorStr === "inherit" || colorStr === "initial" || colorStr === "currentColor") return null
		if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(colorStr)) return null
		if (colorCache.has(colorStr)) return colorCache.get(colorStr)
		let result
		try {
			if (!colorCanvasCtx) {
				const canvas = document.createElement("canvas")
				canvas.width = 1
				canvas.height = 1
				colorCanvasCtx = canvas.getContext("2d", { willReadFrequently: true })
			}
			colorCanvasCtx.clearRect(0, 0, 1, 1)
			colorCanvasCtx.fillStyle = colorStr
			colorCanvasCtx.fillRect(0, 0, 1, 1)
			const [r, g, b, a] = colorCanvasCtx.getImageData(0, 0, 1, 1).data
			if (a === 0) {
				result = null
			} else {
				const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
				const rgb = a < 255 ? `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(2))})` : `rgb(${r}, ${g}, ${b})`
				result = { hex, rgb, raw: colorStr, alpha: a / 255 }
			}
		} catch {
			result = { hex: toHex(colorStr), rgb: colorStr, raw: colorStr, alpha: 1 }
		}
		if (colorCache.size < 2000) colorCache.set(colorStr, result)
		return result
	}

	function colorReport() {
		const seen = new Map()
		scanElements("body *", (node) => {
			const style = getComputedStyle(node)
			const values = [style.color, style.backgroundColor]
			if (style.borderTopStyle !== "none" && style.borderTopWidth !== "0px") values.push(style.borderTopColor)
			if (style.outlineStyle !== "none") values.push(style.outlineColor)
			for (const value of values) {
				const norm = normalizeCssColor(value)
				if (!norm) continue
				const key = norm.hex.toLowerCase()
				let entry = seen.get(key)
				if (!entry) {
					entry = { hex: key, rgb: norm.rgb, raw: norm.raw, count: 0 }
					seen.set(key, entry)
				}
				entry.count++
			}
		}, { limit: 6000, ms: 300 })
		return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 36)
	}

	let eyedropperActive = false
	let eyedropperBadge = null

	function startInPageEyedropper() {
		stopInPageEyedropper()
		eyedropperActive = true
		ensureStyles()
		document.addEventListener("mousemove", onEyedropperMove, true)
		document.addEventListener("click", onEyedropperClick, true)
		document.addEventListener("keydown", onEyedropperKeyDown, true)
		const pixelAction = typeof window.EyeDropper === "function"
			? [{ icon: "pipette", label: "Pick a pixel", title: "Use the browser eyedropper to sample any pixel", action: () => pickScreenPixel() }]
			: null
		showFloatingCta(
			"Sidekick: Color Eyedropper",
			"Hover any element to preview its color · Click to copy HEX · Esc to cancel",
			() => stopInPageEyedropper(),
			pixelAction,
		)
		registerCleanup("eyedropper", () => stopInPageEyedropper())
		return { ok: true, data: { status: "active", message: "Color eyedropper active on page. Hover any element to preview color, click to sample & copy." } }
	}

	function stopInPageEyedropper() {
		if (!eyedropperActive && !eyedropperBadge) return
		eyedropperActive = false
		activeCleanups.delete("eyedropper")
		renderEyedropper.cancel()
		document.removeEventListener("mousemove", onEyedropperMove, true)
		document.removeEventListener("click", onEyedropperClick, true)
		document.removeEventListener("keydown", onEyedropperKeyDown, true)
		if (eyedropperBadge?.parentNode) eyedropperBadge.parentNode.removeChild(eyedropperBadge)
		eyedropperBadge = null
		lastEyedropperNode = null
		if (highlight?.parentNode) highlight.style.display = "none"
		hideFloatingCta()
	}

	function onEyedropperKeyDown(event) {
		if (event.key === "Escape") {
			stopInPageEyedropper()
		}
	}

	function onEyedropperMove(event) {
		if (!eyedropperActive) return
		if (isDevKitEvent(event)) {
			if (eyedropperBadge) eyedropperBadge.style.display = "none"
			return
		}
		if (event.target instanceof Element) renderEyedropper(event.target, event.clientX, event.clientY)
	}

	async function pickScreenPixel() {
		try {
			// The click on our own button is the user activation EyeDropper.open() requires.
			const result = await new window.EyeDropper().open()
			const hex = String(result?.sRGBHex ?? "").toLowerCase()
			if (!hex) return
			copy(hex)
			stopInPageEyedropper()
			showFloatingCta("Sidekick: Eyedropper", `Sampled pixel ${hex}, copied to clipboard`, () => hideFloatingCta())
			showHud("Pixel sample", `HEX: ${hex}\n\nCopied to clipboard.`)
		} catch {}
	}

	let lastEyedropperNode = null
	const renderEyedropper = rafThrottle((node, clientX, clientY) => {
		if (!eyedropperActive || !node.isConnected) return
		const root = getShadowRoot()
		if (!eyedropperBadge) {
			eyedropperBadge = el("div", "dk-eyedropper-badge")
			eyedropperBadge.style.cssText = "position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important; display: flex !important; align-items: center !important; gap: 8px !important; background: #17140f !important; color: #f3ece0 !important; padding: 5px 10px !important; border-radius: 10px !important; border: 1px solid rgba(243,236,224,0.22) !important; font-size: 11px !important; font-family: ui-monospace, monospace !important; font-weight: 700 !important; box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important; transform: translate(16px, 16px) !important;"
			const swatchDot = el("span", "dk-eyedropper-dot")
			swatchDot.style.cssText = "width: 14px !important; height: 14px !important; border-radius: 6px !important; border: 1px solid rgba(243,236,224,0.4) !important; flex-shrink: 0 !important;"
			const hexText = el("span", "dk-eyedropper-text")
			eyedropperBadge.append(swatchDot, hexText)
			root.appendChild(eyedropperBadge)
		}
		const rect = node.getBoundingClientRect()
		if (node !== lastEyedropperNode) {
			lastEyedropperNode = node
			const bg = effectiveBackground(node)
			const hasBg = bg && bg !== "transparent" && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)
			const hex = toHex(hasBg ? bg : getComputedStyle(node).color)
			eyedropperBadge.querySelector(".dk-eyedropper-dot").style.background = hex
			eyedropperBadge.querySelector(".dk-eyedropper-text").textContent = hex
		}
		eyedropperBadge.style.display = "flex"
		eyedropperBadge.style.top = `${clientY}px`
		eyedropperBadge.style.left = `${clientX}px`
		placeHighlight(rect)
	})

	function onEyedropperClick(event) {
		if (!eyedropperActive) return
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element)) return
		if (isDevKitNode(node)) return

		event.preventDefault()
		event.stopPropagation()

		const style = getComputedStyle(node)
		const bg = effectiveBackground(node)
		const hasBg = bg && bg !== "transparent" && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)
		const sampleColor = hasBg ? bg : style.color
		const hex = toHex(sampleColor)
		let rgb = hex
		try {
			const match = String(sampleColor).match(/rgba?\(([^)]+)\)/)
			if (match) {
				const [r, g, b] = match[1].split(/[,\s/]+/).map(Number)
				rgb = `rgb(${r}, ${g}, ${b})`
			}
		} catch {}

		copy(hex)
		stopInPageEyedropper()

		showFloatingCta(
			"Sidekick: Eyedropper",
			`Sampled: ${hex} (${rgb}) — Copied to clipboard!`,
			() => hideFloatingCta()
		)
		showHud(
			"Color Eyedropper Sample",
			`HEX: ${hex}\nRGB: ${rgb}\nElement: <${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}>\n\nHex color copied to clipboard!`,
			"Copy RGB",
			() => copy(rgb)
		)

	}

	function openEyeDropper() {
		return startInPageEyedropper()
	}

	function zIndexScan() {
		const items = []
		scanElements("body *", (node) => {
			const style = getComputedStyle(node)
			const z = parseInt(style.zIndex, 10)
			if (Number.isFinite(z)) items.push({ node, z, position: style.position })
		}, { limit: 10000, ms: 300 })
		return items
			.sort((a, b) => b.z - a.z)
			.slice(0, 25)
			.map((item) => ({ zIndex: item.z, selector: cssPath(item.node), position: item.position }))
	}

	function detectStack() {
		// Page globals and framework expandos are invisible to the isolated world, so ask the main world.
		const probe = probeMain({ globals: ["__NEXT_DATA__", "__remixContext", "___gatsby", "Vue", "__NUXT__", "ng", "preact", "_$HY", "Alpine", "htmx", "qwikevents", "jQuery", "gsap", "THREE", "__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__", "__APOLLO_CLIENT__", "google_tag_manager", "gtag", "dataLayer", "fbq", "twq", "Sentry", "__SENTRY__", "hj", "analytics.identify", "posthog", "__cfRLUnblockHandlers", "va", "clarity", "Stripe", "firebase", "Intercom", "wp", "Shopify", "Static.SQUARESPACE_CACHE_VERSION", "webpackJsonp", "__turbopack_require__", "webpackChunk*"], scan: { limit: 400 } })
		const globals = new Set(probe?.globals ?? [])
		const scanFrameworks = new Set((probe?.scan ?? []).flatMap((hit) => hit.frameworks ?? []))
		const win = (path) => globals.has(path)
		const found = []
		const check = (name, test) => {
			try {
				if (test()) found.push(name)
			} catch {

			}
		}

		const scripts = [...document.scripts].map((s) => s.src).filter(Boolean)
		const scriptDomains = new Set()
		for (const src of scripts) {
			try {
				scriptDomains.add(new URL(src).hostname)
			} catch {  }
		}
		const scriptList = scripts.map((s) => s.toLowerCase())
		const domainList = [...scriptDomains].map((d) => d.toLowerCase())

		check("Next.js", () =>
			scriptList.some((s) => s.includes("/_next/")) ||
			document.querySelector("link[href*='/_next/'], #__next, script#__NEXT_DATA__") ||
			win("__NEXT_DATA__"),
		)
		check("React", () =>
			found.includes("Next.js") ||
			found.includes("Remix") ||
			found.includes("Gatsby") ||
			scriptList.some((s) => s.includes("react") || s.includes("react-dom")) ||
			document.querySelector("[data-reactroot], #__next, [data-react-helmet]") ||
			scanFrameworks.has("React"),
		)
		check("Remix", () =>
			scriptList.some((s) => s.includes("/build/") && s.includes("entry.client")) ||
			win("__remixContext") ||
			document.querySelector("script[data-remix]"),
		)
		check("Gatsby", () => document.querySelector("#___gatsby") || win("___gatsby"))
		check("Vue", () =>
			scriptList.some((s) => s.includes("vue")) ||
			win("Vue") ||
			document.querySelector("[data-v-app]") ||
			scanFrameworks.has("Vue"),
		)
		check("Nuxt", () =>
			scriptList.some((s) => s.includes("/_nuxt/")) ||
			win("__NUXT__") ||
			document.querySelector("#__nuxt"),
		)
		check("Angular", () =>
			scriptList.some((s) => s.includes("angular")) ||
			win("ng") ||
			document.querySelector("[ng-version]"),
		)
		check("Svelte", () =>
			scriptList.some((s) => s.includes("/_app/immutable/")) ||
			document.querySelector("[class*='svelte-'], [data-sveltekit]"),
		)
		check("Preact", () =>
			scriptList.some((s) => s.includes("preact")) ||
			win("preact") ||
			document.querySelector("[data-preact]"),
		)
		check("Solid", () => win("_$HY") || document.querySelector("[data-hk]"))
		check("Lit", () => document.querySelector("[_$litType$]"))
		check("Alpine.js", () => win("Alpine") || document.querySelector("[x-data]"))
		check("htmx", () =>
			scriptList.some((s) => s.includes("htmx")) ||
			win("htmx") ||
			document.querySelector("[hx-get], [hx-post]"),
		)
		check("Astro", () =>
			scriptList.some((s) => s.includes("astro")) ||
			document.querySelector("[data-astro-cid], astro-island, astro-slot"),
		)
		check("Qwik", () => Boolean(document.querySelector("[q\\:container], [q\\:id]")) || win("qwikevents"))
		check("SvelteKit", () => Boolean(document.querySelector("[data-sveltekit-preload-data]")) || scriptList.some((s) => s.includes("/_app/immutable/")))
		check("jQuery", () => scriptList.some((s) => s.includes("jquery")) || win("jQuery"))

		check("Tailwind CSS", () =>
			document.querySelector("[class*='dark:'], [class*='md:'], [class*='sm:'], [class*='lg:'], [class*='text-['], [class*='bg-['], [class*='space-y-'], [class*='space-x-']") ||
			[...document.styleSheets].some((s) => {
				try { return (s.href || "").includes("tailwind") } catch { return false }
			}),
		)
		check("Radix UI", () =>
			Boolean(document.querySelector("[data-radix-collection-item], [data-state][data-orientation], [data-radix-popper-content-wrapper]")),
		)
		check("Shadcn UI", () => Boolean(document.querySelector("[data-slot='button'], [data-slot='card'], [data-slot='dialog'], [data-sidebar]")))
		check("Bootstrap", () =>
			document.querySelector("[class*='container-fluid'], .navbar, [class*='col-md-']") ||
			[...document.styleSheets].some((s) => (s.href || "").includes("bootstrap")),
		)
		check("Material UI", () => Boolean(document.querySelector("[class*='MuiBox-'], [class*='MuiButton-'], [class*='MuiTypography-']")))
		check("Chakra UI", () => Boolean(document.querySelector("[class*='chakra-'], .chakra-ui-light, .chakra-ui-dark")))
		check("Mantine", () => Boolean(document.querySelector("[class*='mantine-']")))
		check("Ant Design", () => Boolean(document.querySelector("[class*='ant-btn'], [class*='ant-layout'], .ant-menu")))
		check("Styled Components", () => Boolean(document.querySelector("style[data-styled], [class*='sc-']")))
		check("Lucide Icons", () => Boolean(document.querySelector("svg.lucide, [class*='lucide-']")))
		check("Font Awesome", () =>
			Boolean(document.querySelector("[class*='fa-'], [class*='fas '], [class*='fab '], link[href*='font-awesome']")),
		)
		check("Framer Motion", () => Boolean(document.querySelector("[data-framer-component-type], [style*='--framer-']")))
		check("GSAP", () => scriptList.some((s) => s.includes("gsap")) || win("gsap"))
		check("Three.js", () => scriptList.some((s) => s.includes("three")) || win("THREE"))

		check("Redux", () => Boolean(document.querySelector("[data-redux]")))
		check("TanStack Query", () => Boolean(win("__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__")) || scriptList.some((s) => s.includes("react-query") || s.includes("tanstack")))
		check("Apollo GraphQL", () => Boolean(win("__APOLLO_CLIENT__")) || scriptList.some((s) => s.includes("apollo")))

		check("Google Tag Manager", () =>
			scriptList.some((s) => s.includes("googletagmanager.com/gtm.js")) ||
			domainList.includes("www.googletagmanager.com") ||
			win("google_tag_manager"),
		)
		check("Google Analytics", () =>
			scriptList.some((s) => s.includes("google-analytics.com") || s.includes("googletagmanager.com/gtag")) ||
			win("gtag") ||
			win("dataLayer"),
		)
		check("Meta (Facebook) Pixel", () =>
			scriptList.some((s) => s.includes("connect.facebook.net")) ||
			domainList.includes("connect.facebook.net") ||
			win("fbq"),
		)
		check("Twitter (X) Ads", () =>
			scriptList.some((s) => s.includes("static.ads-twitter.com")) ||
			domainList.includes("static.ads-twitter.com") ||
			win("twq"),
		)
		check("Sentry", () => scriptList.some((s) => s.includes("sentry")) || win("Sentry") || win("__SENTRY__"))
		check("Hotjar", () => scriptList.some((s) => s.includes("static.hotjar.com")) || win("hj"))
		check("Segment", () => scriptList.some((s) => s.includes("cdn.segment.com")) || win("analytics.identify"))
		check("PostHog", () => scriptList.some((s) => s.includes("posthog")) || win("posthog"))
		check("Cloudflare Insights", () => Boolean(win("__cfRLUnblockHandlers") || domainList.includes("static.cloudflareinsights.com")))
		check("Vercel Analytics", () => Boolean(win("va") || scriptList.some((s) => s.includes("/_vercel/insights"))))
		check("Microsoft Clarity", () => Boolean(win("clarity") || scriptList.some((s) => s.includes("clarity.ms"))))

		check("Clerk", () =>
			scriptList.some((s) => s.includes("clerk")) ||
			domainList.some((d) => d.includes("clerk")),
		)
		check("Stripe", () =>
			scriptList.some((s) => s.includes("js.stripe.com")) ||
			domainList.includes("js.stripe.com") ||
			win("Stripe"),
		)
		check("Supabase", () => domainList.some((d) => d.includes("supabase.co")) || scriptList.some((s) => s.includes("supabase")))
		check("Firebase", () => Boolean(win("firebase")) || domainList.some((d) => d.includes("firebaseapp.com")))
		check("Tolt", () =>
			domainList.some((d) => d.includes("tolt.io")) ||
			scriptList.some((s) => s.includes("tolt")),
		)
		check("Intercom", () =>
			scriptList.some((s) => s.includes("widget.intercom.io")) ||
			domainList.includes("widget.intercom.io") ||
			win("Intercom"),
		)

		check("WordPress", () => document.querySelector("meta[name='generator'][content*='WordPress']") || win("wp"))
		check("Shopify", () => win("Shopify"))
		check("Webflow", () => Boolean(document.querySelector("html.w-mod-js, [data-w-id]")) || scriptList.some((s) => s.includes("webflow")))
		check("Squarespace", () => Boolean(win("Static.SQUARESPACE_CACHE_VERSION") || document.querySelector("link[href*='squarespace']")))

		check("Webpack", () =>
			scriptList.some((s) => s.includes("webpack") || s.includes("chunks/")) ||
			win("webpackChunk*") ||
			win("webpackJsonp"),
		)
		check("Vite", () =>
			scriptList.some((s) => s.includes("/@vite/") || s.includes("vite/")) ||
			document.querySelector("script[type='module'][src*='/@vite']"),
		)
		check("Turbopack", () =>
			scriptList.some((s) => s.includes("turbopack")) ||
			win("__turbopack_require__"),
		)

		check("Service Worker", () => Boolean(navigator.serviceWorker?.controller))
		check("PWA Manifest", () => Boolean(document.querySelector("link[rel='manifest']")))

		const TECH_CATEGORIES = {
			"Next.js": { category: "Framework", icon: "▲" },
			"React": { category: "Framework", icon: "⚛" },
			"Vue": { category: "Framework", icon: "🟢" },
			"Nuxt": { category: "Framework", icon: "▲" },
			"Angular": { category: "Framework", icon: "🅰" },
			"Svelte": { category: "Framework", icon: "🔥" },
			"SvelteKit": { category: "Framework", icon: "🔥" },
			"Remix": { category: "Framework", icon: "💿" },
			"Astro": { category: "Framework", icon: "🚀" },
			"Qwik": { category: "Framework", icon: "⚡" },
			"Preact": { category: "Framework", icon: "⚛" },
			"Solid": { category: "Framework", icon: "🔷" },
			"Lit": { category: "Framework", icon: "🔥" },
			"Alpine.js": { category: "Framework", icon: "🏔" },
			"htmx": { category: "Framework", icon: "⚡" },
			"jQuery": { category: "Library", icon: "💲" },
			"Tailwind CSS": { category: "CSS & UI", icon: "🌊" },
			"Radix UI": { category: "CSS & UI", icon: "🧩" },
			"Shadcn UI": { category: "CSS & UI", icon: "🖤" },
			"Bootstrap": { category: "CSS & UI", icon: "🅱" },
			"Material UI": { category: "CSS & UI", icon: "Ⓜ" },
			"Chakra UI": { category: "CSS & UI", icon: "⚡" },
			"Mantine": { category: "CSS & UI", icon: "🔷" },
			"Ant Design": { category: "CSS & UI", icon: "🐜" },
			"Styled Components": { category: "CSS & UI", icon: "💅" },
			"Lucide Icons": { category: "Icons & Media", icon: "✨" },
			"Font Awesome": { category: "Icons & Media", icon: "🚩" },
			"Framer Motion": { category: "Animation", icon: "🎬" },
			"GSAP": { category: "Animation", icon: "🟩" },
			"Three.js": { category: "3D & Graphics", icon: "🔺" },
			"Redux": { category: "State Management", icon: "🔄" },
			"TanStack Query": { category: "State & Data", icon: "📡" },
			"Apollo GraphQL": { category: "State & Data", icon: "🚀" },
			"Google Tag Manager": { category: "Analytics & Tagging", icon: "🏷" },
			"Google Analytics": { category: "Analytics", icon: "📊" },
			"Meta (Facebook) Pixel": { category: "Advertising", icon: "♾" },
			"Twitter (X) Ads": { category: "Advertising", icon: "🐦" },
			"Clerk": { category: "Authentication", icon: "🔐" },
			"Stripe": { category: "Payments", icon: "💳" },
			"Supabase": { category: "Backend & DB", icon: "⚡" },
			"Firebase": { category: "Backend & DB", icon: "🔥" },
			"Tolt": { category: "Affiliate Tracking", icon: "🤝" },
			"Sentry": { category: "Monitoring & Errors", icon: "🛡" },
			"Hotjar": { category: "Analytics & Heatmaps", icon: "🔥" },
			"Segment": { category: "Customer Data", icon: "🔀" },
			"PostHog": { category: "Product Analytics", icon: "🦔" },
			"Cloudflare Insights": { category: "Analytics", icon: "☁️" },
			"Vercel Analytics": { category: "Analytics", icon: "▲" },
			"Microsoft Clarity": { category: "Analytics & Heatmaps", icon: "🔍" },
			"WordPress": { category: "CMS", icon: "📝" },
			"Shopify": { category: "E-Commerce", icon: "🛍" },
			"Webflow": { category: "CMS & Builder", icon: "🌐" },
			"Squarespace": { category: "CMS & Builder", icon: "⬛" },
			"Webpack": { category: "Build Tools", icon: "📦" },
			"Vite": { category: "Build Tools", icon: "⚡" },
			"Turbopack": { category: "Build Tools", icon: "⚡" },
			"Service Worker": { category: "PWA & Offline", icon: "⚙" },
			"PWA Manifest": { category: "PWA & Offline", icon: "📱" },
		}

		const categorized = {}
		const items = []
		for (const name of found) {
			const meta = TECH_CATEGORIES[name] || { category: "Other", icon: "⚙" }
			if (!categorized[meta.category]) categorized[meta.category] = []
			categorized[meta.category].push({ name, icon: meta.icon })
			items.push({ name, category: meta.category, icon: meta.icon })
		}

		return {
			detected: found,
			count: found.length,
			items,
			categories: categorized,
			generator: document.querySelector("meta[name=generator]")?.content ?? null,
			serviceWorker: Boolean(navigator.serviceWorker?.controller),
			scripts: scripts.slice(0, 40),
			scriptDomains: [...scriptDomains].sort().slice(0, 30),
		}
	}

	function pageContext() {
		return {
			URL: location.href,
			Title: document.title,
			"User agent": navigator.userAgent,
			Platform: navigator.platform,
			Language: navigator.language,
			Viewport: `${window.innerWidth}x${window.innerHeight} @ DPR ${window.devicePixelRatio}`,
			Screen: `${screen.width}x${screen.height}`,
			Online: navigator.onLine,
			"Captured at": new Date().toISOString(),
			"Console errors": countConsoleErrors(),
		}
	}

	function deepInspectElement(node) {
		if (!node || !(node instanceof Element)) return null
		const rect = node.getBoundingClientRect()
		const style = getComputedStyle(node)
		const bg = effectiveBackground(node)

		return {
			selector: cssPath(node),
			tag: node.tagName.toLowerCase(),
			id: node.id || null,
			classes: [...node.classList],
			dimensions: {
				width: Math.round(rect.width),
				height: Math.round(rect.height),
				top: Math.round(rect.top),
				left: Math.round(rect.left),
				scrollTop: node.scrollTop,
				scrollLeft: node.scrollLeft,
				offsetWidth: node.offsetWidth,
				offsetHeight: node.offsetHeight,
			},
			boxModel: {
				padding: { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft },
				margin: { top: style.marginTop, right: style.marginRight, bottom: style.marginBottom, left: style.marginLeft },
				border: { top: style.borderTopWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth, left: style.borderLeftWidth },
				boxSizing: style.boxSizing,
			},
			layout: {
				display: style.display,
				position: style.position,
				float: style.float,
				clear: style.clear,
				zIndex: style.zIndex,
				flexDirection: style.flexDirection !== "row" ? style.flexDirection : undefined,
				gridTemplateColumns: style.gridTemplateColumns !== "none" ? style.gridTemplateColumns : undefined,
				gap: style.gap !== "normal" ? style.gap : undefined,
				overflow: style.overflow,
				transform: style.transform !== "none" ? style.transform : undefined,
				opacity: style.opacity !== "1" ? style.opacity : undefined,
				visibility: style.visibility,
				pointerEvents: style.pointerEvents,
				willChange: style.willChange !== "auto" ? style.willChange : undefined,
				contain: style.contain !== "none" ? style.contain : undefined,
			},
			typography: {
				fontFamily: style.fontFamily,
				fontSize: style.fontSize,
				fontWeight: style.fontWeight,
				fontStyle: style.fontStyle,
				lineHeight: style.lineHeight,
				letterSpacing: style.letterSpacing,
				textAlign: style.textAlign,
				textDecoration: style.textDecoration,
				textTransform: style.textTransform,
				wordBreak: style.wordBreak,
				whiteSpace: style.whiteSpace,
				textOverflow: style.textOverflow,
			},
			colors: {
				color: toHex(style.color),
				background: toHex(bg),
				borderColor: toHex(style.borderTopColor),
				contrast: contrast(style.color, bg),
			},
			interactivity: {
				cursor: style.cursor,
				tabIndex: node.tabIndex,
				contentEditable: node.contentEditable,
				draggable: node.draggable,
				href: node.getAttribute("href"),
				formInfo: node.name ? { name: node.name, type: node.type, value: String(node.value).slice(0, 100) } : undefined,
			},
			accessibility: getAriaAttrs(node),
			dataAttributes: getDataAttrs(node),
			animations: getAnimations(node),
			eventListeners: getInlineListeners(node),
			frameworkBindings: getFrameworkBindings(node),
			media: getMediaInfo(node),
			shadowDOM: Boolean(node.shadowRoot),
			childCount: node.children.length,
			textLength: (node.textContent || "").trim().length,
		}
	}

	let deepInspectPending = false
	function onDeepClick(event) {
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element) || isDevKitNode(node)) return
		event.preventDefault()
		event.stopPropagation()
		deepInspectPending = false
		document.removeEventListener("click", onDeepClick, true)
		document.removeEventListener("mousemove", onMove, true)
		if (highlight?.parentNode) highlight.parentNode.removeChild(highlight)
		highlight = null
		hideFloatingCta()
		const data = deepInspectElement(node)
		showHud("Deep inspection", data)
	}

	function startDeepInspect() {
		deepInspectPending = true
		document.addEventListener("mousemove", onMove, true)
		document.addEventListener("click", onDeepClick, true)
		showFloatingCta("Sidekick: Deep Inspector", "Click any element to inspect in depth", () => stopAllActiveTools())
		return { ok: true, data: "Click any element to inspect it in depth. Press Escape or click 'Close Tool' to cancel." }
	}

	function scanAnimations() {
		const allAnimations = []
		try {
			for (const anim of document.getAnimations()) {
				const target = anim.effect?.target
				allAnimations.push({
					name: anim.animationName || anim.id || "(unnamed)",
					type: anim instanceof CSSAnimation ? "css-animation" : anim instanceof CSSTransition ? "css-transition" : "js-animation",
					state: anim.playState,
					duration: anim.effect?.getTiming?.()?.duration ?? null,
					delay: anim.effect?.getTiming?.()?.delay ?? null,
					iterations: anim.effect?.getTiming?.()?.iterations ?? null,
					easing: anim.effect?.getTiming?.()?.easing ?? null,
					selector: target ? cssPath(target) : null,
				})
				if (allAnimations.length >= 200) break
			}
		} catch {  }

		const transitioned = []
		scanElements("body *", (node) => {
			const style = getComputedStyle(node)
			if (style.animationName && style.animationName !== "none") {
				transitioned.push({
					selector: cssPath(node),
					animationName: style.animationName,
					animationDuration: style.animationDuration,
					animationTimingFunction: style.animationTimingFunction,
					animationIterationCount: style.animationIterationCount,
				})
				if (transitioned.length >= 50) return false
			}
		}, { limit: 5000, ms: 250 })

		return {
			activeAnimations: allAnimations,
			activeCount: allAnimations.length,
			elementsWithCssAnimation: transitioned.slice(0, 50),
		}
	}


	function enhancedA11yChecks(issues, add, track = () => {}) {
		if (!document.querySelector("main, [role=main]")) add("moderate", "landmark-main", "Page has no <main> landmark")
		if (!document.querySelector("nav, [role=navigation]")) add("minor", "landmark-nav", "Page has no <nav> landmark")

		const skipLink = document.querySelector("a[href='#main-content'], a[href='#content'], a[href='#main'], a.skip-link, a.skip-to-content")
		if (!skipLink) add("minor", "skip-link", "No skip to content link found")

		for (const media of document.querySelectorAll("video[autoplay], audio[autoplay]")) {
			if (!media.muted) add("serious", "autoplay-muted", "Autoplaying media without muted attribute", media)
		}

		for (const iframe of document.querySelectorAll("iframe:not([title])")) {
			if (!iframe.closest("[aria-hidden='true']")) add("serious", "iframe-title", "<iframe> element missing title attribute (WCAG 4.1.2)", iframe)
		}

		let smallTargetCount = 0
		track(scanElements("button, a[href], input[type=checkbox], input[type=radio]", (target) => {
			const rect = target.getBoundingClientRect()
			if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
				// Inline links inside running text are exempt from the WCAG 2.2 target size rule.
				if (target.tagName === "A" && getComputedStyle(target).display === "inline" && hasOwnText(target.parentElement ?? target)) return
				add("minor", "target-size", `Target size is small (${Math.round(rect.width)}×${Math.round(rect.height)}px, aim for at least 24×24px)`, target)
				smallTargetCount++
				if (smallTargetCount >= 10) return false
			}
		}, { limit: 3000, ms: 150 }))

		for (const img of document.querySelectorAll("img[alt]")) {
			const alt = img.alt.trim().toLowerCase()
			if (/^(image|photo|picture|icon|graphic|logo image|img)$/.test(alt)) {
				add("minor", "redundant-alt", `Alt text "${img.alt}" is redundant (avoid generic words like "image" or "photo")`, img)
			}
		}

		const ids = new Set()
		let dupCount = 0
		track(scanElements("[id]", (node) => {
			const id = node.id.trim()
			if (!id) return
			if (ids.has(id)) {
				add("moderate", "duplicate-id", `Duplicate ID "#${id}" found in DOM`, node)
				dupCount++
				if (dupCount >= 5) return false
			} else {
				ids.add(id)
			}
		}, { limit: 8000, ms: 100 }))
	}

	let lastGeneratedPassword = ""
	let formStepObserver = null

	function isVisibleField(el) {
		if (!el) return false
		if (el.type === "hidden") return false
		if (el.disabled) return false
		if (el.closest("[hidden]")) return false
		if (el.closest("[aria-hidden='true']")) return false
		if (el.type === "file") return true
		if (el.type === "checkbox" || el.type === "radio") {
			const parentRect = el.parentElement?.getBoundingClientRect()
			if (parentRect && parentRect.width > 0 && parentRect.height > 0) return true
		}
		if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-haspopup") === "menu") {
			const box = el.closest('[class*="select"], [class*="combobox"], [class*="picker"]') || el.parentElement || el
			const rect = box.getBoundingClientRect()
			const boxStyle = window.getComputedStyle(box)
			if (boxStyle.display !== "none" && boxStyle.visibility !== "hidden" && rect.width > 0 && rect.height > 0) {
				return true
			}
		}
		const style = window.getComputedStyle(el)
		if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
		const rect = el.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0
	}

	function classifyField(field) {
		const tag = field.tagName.toLowerCase()
		const type = (field.type || "text").toLowerCase()
		if (tag === "select") return "select"
		if (tag === "textarea") return "textarea"
		if (type === "checkbox") return "checkbox"
		if (type === "radio") return "radio"
		if (type === "color") return "color"
		if (type === "range") return "range"
		if (type === "date") return "date"
		if (type === "time") return "time"
		if (type === "datetime-local") return "datetime-local"
		if (type === "email") return "email"
		if (type === "password") return "password"
		if (type === "tel") return "tel"
		if (type === "number") return "number"
		if (type === "url") return "url"
		if (type === "file") return "file"

		const id = field.id || ""
		const name = field.name || ""
		const placeholder = field.placeholder || ""
		const aria = field.getAttribute("aria-label") || ""
		const auto = field.autocomplete || ""
		let labelText = ""
		if (id) {
			try {
				const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`)
				if (labelEl) labelText = labelEl.textContent || ""
			} catch {  }
		}
		if (!labelText) {
			const parentLabel = field.closest("label")
			if (parentLabel) labelText = parentLabel.textContent || ""
		}

		const s = `${name} ${id} ${placeholder} ${aria} ${auto} ${labelText}`.toLowerCase()

		if (/email|e-mail|mail/i.test(s)) return "email"
		if (/confirm.*pass|pass.*confirm|repeat.*pass/i.test(s)) return "confirm-password"
		if (/password|pwd|passcode|secret/i.test(s)) return "password"
		if (/phone|\btel\b|mobile|cell/i.test(s)) return "tel"
		if (/first.*name|fname|given.*name/i.test(s)) return "first-name"
		if (/last.*name|lname|surname|family.*name/i.test(s)) return "last-name"
		if (/full.*name|your.*name|^name$/i.test(s)) return "full-name"
		if (/user.*name|login|handle/i.test(s)) return "username"
		if (/street|address.*1|addr.*1|address/i.test(s)) return "address"
		if (/apt|suite|unit|flat|address.*2/i.test(s)) return "suite"
		if (/city|town|municipality/i.test(s)) return "city"
		if (/state|province|region/i.test(s)) return "state"
		if (/zip|postal|postcode|pincode/i.test(s)) return "zip"
		if (/country/i.test(s)) return "country"
		if (/company|organization|org|business|employer/i.test(s)) return "company"
		if (/job|title|position|role/i.test(s)) return "job-title"
		if (/card.*num|cc.*num|credit.*card/i.test(s)) return "credit-card"
		if (/expir|cc.*exp/i.test(s)) return "card-expiry"
		if (/cvv|cvc|security.*code/i.test(s)) return "card-cvv"
		if (/birth|dob|bday/i.test(s)) return "dob"
		if (/date/i.test(s)) return "date"
		if (/time/i.test(s)) return "time"
		if (/website|url|web|domain|link/i.test(s)) return "url"
		if (/age/i.test(s)) return "age"
		if (/qty|quantity|amount|count/i.test(s)) return "quantity"
		if (/price|salary|budget|cost|rate|fee/i.test(s)) return "price"
		if (/comment|bio|desc|message|note|feedback|review|about/i.test(s)) return "textarea"
		if (/search|query/i.test(s)) return "search"

		return "text"
	}

	function generateRealistic(field, payload) {
		const category = classifyField(field)
		const rand = (arr) => arr[Math.floor(Math.random() * arr.length)]
		const num = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

		switch (category) {
			case "email": {
				if (payload?.customEmail && payload.customEmail.includes("@")) {
					return payload.customEmail.replace("{id}", String(num(100, 999)))
				}
				const names = ["alex.tester", "jordan.dev", "sam.qa", "taylor.quality", "casey.eng", "morgan.builder"]
				const domains = ["example.com", "testcorp.io", "qualitylabs.org"]
				return `${rand(names)}_${num(100, 999)}@${rand(domains)}`
			}
			case "password": {
				lastGeneratedPassword = `Str0ng#Pass${num(100, 999)}!`
				return lastGeneratedPassword
			}
			case "confirm-password": {
				return lastGeneratedPassword || `Str0ng#Pass${num(100, 999)}!`
			}
			case "tel": {
				return `555${num(100, 999)}${num(1000, 9999)}`
			}
			case "first-name": {
				return rand(["Alex", "Jordan", "Taylor", "Morgan", "Sam", "Chris", "Casey", "Riley", "Jamie", "Avery"])
			}
			case "last-name": {
				return rand(["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Anderson"])
			}
			case "full-name": {
				const first = rand(["Alex", "Jordan", "Taylor", "Morgan", "Sam", "Chris", "Casey", "Riley"])
				const last = rand(["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis"])
				return `${first} ${last}`
			}
			case "username": {
				return `user_qa_${num(1000, 9999)}`
			}
			case "address": {
				return `${num(100, 999)} Market Street`
			}
			case "suite": {
				return `Suite ${num(10, 99)}0`
			}
			case "city": {
				return rand(["San Francisco", "New York", "Austin", "Seattle", "Chicago", "Boston"])
			}
			case "state": {
				return rand(["CA", "NY", "TX", "WA", "IL", "MA"])
			}
			case "zip": {
				return String(num(10001, 99950))
			}
			case "country": {
				return "United States"
			}
			case "company": {
				return rand(["Acme Corporation", "Pinnacle Dynamics", "Vertex Solutions", "Apex Quality Systems", "Redstone Industries", "Silverlake Partners"])
			}
			case "job-title": {
				return rand(["QA Automation Engineer", "Senior Software Developer", "Product Designer", "Security Analyst"])
			}
			case "credit-card": {
				return "4242 4242 4242 4242"
			}
			case "card-expiry": {
				return "12/28"
			}
			case "card-cvv": {
				return String(num(100, 999))
			}
			case "dob": {
				return `199${num(0, 9)}-0${num(1, 9)}-${num(10, 28)}`
			}
			case "date": {
				return new Date().toISOString().slice(0, 10)
			}
			case "time": {
				return "10:30"
			}
			case "datetime-local": {
				return `${new Date().toISOString().slice(0, 10)}T10:30`
			}
			case "url": {
				return "https://example.com/portfolio"
			}
			case "age": {
				return String(num(22, 58))
			}
			case "quantity": {
				return String(num(1, 10))
			}
			case "price": {
				return `${num(25, 450)}.00`
			}
			case "number": {
				const min = Number(field.min) || 1
				const max = Number(field.max) || 100
				return String(num(min, Math.min(max, 100)))
			}
			case "textarea": {
				return "Automated test input. Synthetic form data verifying cross-field validation, responsive inputs, and submission stability under standard conditions."
			}
			case "file": {
				return "demo-upload.png"
			}
			case "color": {
				return "#ff5a1f"
			}
			case "range": {
				const min = Number(field.min) || 0
				const max = Number(field.max) || 100
				return String(Math.floor((min + max) / 2))
			}
			default: {
				return rand(["Test Sample", "Demo Input", "Standard Data", "Lorem Ipsum", "Quality Check"])
			}
		}
	}

	function generateEdgeCase(field) {
		const category = classifyField(field)
		switch (category) {
			case "email":
				return `qa+boundary.test_${Date.now()}@subdomain.testing-domain.co.uk`
			case "password":
			case "confirm-password":
				return `VeryL0ngP@ssw0rd!#$2026_WithSpecialChars_&_Unicode_🚀`
			case "tel":
				return `+19999999999`
			case "number":
			case "age":
			case "quantity":
			case "price":
				return "999999"
			case "date":
			case "dob":
				return "2099-12-31"
			case "url":
				return "https://sub.domain.example.com/path?query=1&test=true#hash-anchor"
			case "textarea":
				return "Boundary stress test:\n" + "Testing database limits, text overflow and multiline layout rendering. ".repeat(15) + "\nSpecial: <script>alert('XSS')</script> & ' OR '1'='1' -- 🚀✨"
			default:
				return `' OR '1'='1' -- <script>alert("XSS")</script> 🚀 ${"A".repeat(80)}`
		}
	}

	function createDummyImageFile() {
		try {
			const canvas = document.createElement("canvas")
			canvas.width = 400
			canvas.height = 300
			const ctx = canvas.getContext("2d")
			if (ctx) {
				const grad = ctx.createLinearGradient(0, 0, 400, 300)
				grad.addColorStop(0, "#ff5a1f")
				grad.addColorStop(1, "#1D4ED8")
				ctx.fillStyle = grad
				ctx.fillRect(0, 0, 400, 300)

				ctx.fillStyle = "rgba(243, 236, 224, 0.2)"
				ctx.beginPath()
				ctx.arc(200, 110, 45, 0, Math.PI * 2)
				ctx.fill()

				ctx.fillStyle = "#FFFFFF"
				ctx.font = "bold 20px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
				ctx.textAlign = "center"
				ctx.fillText("SAMPLE PROPERTY IMAGE", 200, 190)
				ctx.font = "14px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
				ctx.fillStyle = "rgba(243, 236, 224, 0.8)"
				ctx.fillText("400 × 300 px  •  DevKit Preview", 200, 220)

				const dataUrl = canvas.toDataURL("image/png")
				const bin = atob(dataUrl.split(",")[1])
				const arr = new Uint8Array(bin.length)
				for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
				return new File([arr], "property-demo.png", { type: "image/png" })
			}
		} catch {  }

		const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC"
		const bin = atob(b64)
		const arr = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
		return new File([arr], "property-demo.png", { type: "image/png" })
	}

	function setFieldValue(field, value) {
		if (!field) return
		const tag = field.tagName.toLowerCase()
		const type = (field.type || "").toLowerCase()

		if (type === "checkbox") {
			if (!field.checked) field.click()
			field.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
		} else if (type === "radio") {
			if (!field.checked) field.click()
			field.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
		} else if (tag === "select") {

			const validOptions = [...field.options].filter((opt) => {
				if (opt.disabled) return false
				if (opt.value === "") return false
				const txt = (opt.text || "").trim().toLowerCase()

				if (/^(select|choose|please|pick|--)/i.test(txt)) return false
				if (txt === "" || txt === "-") return false
				return true
			})
			if (validOptions.length) {

				const pick = validOptions[Math.floor(Math.random() * validOptions.length)]
				const proto = Object.getPrototypeOf(field)
				const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
				if (desc?.set) desc.set.call(field, pick.value)
				else field.value = pick.value
			} else if (field.options.length > 1) {

				const fallbackIdx = [...field.options].findIndex((opt, i) => i > 0 && !opt.disabled)
				field.selectedIndex = fallbackIdx > 0 ? fallbackIdx : 1
			}
		} else if (type === "file") {
			try {
				const file = createDummyImageFile()
				const dt = new DataTransfer()
				dt.items.add(file)
				field.files = dt.files
			} catch {  }
		} else if (field.isContentEditable) {
			field.textContent = String(value)
		} else if (type === "date" || type === "time" || type === "datetime-local") {

			const proto = Object.getPrototypeOf(field)
			const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
			if (desc?.set) desc.set.call(field, String(value))
			else field.value = String(value)

			try {
				if (type === "date" && !field.value) field.valueAsNumber = new Date(value).getTime()
				if (type === "datetime-local" && !field.value) field.valueAsNumber = new Date(value).getTime()
			} catch {  }
		} else {
			const proto = Object.getPrototypeOf(field)
			const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(
				field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value"
			)
			if (desc?.set) desc.set.call(field, value)
			else field.value = value
		}

		field.dispatchEvent(new Event("focus", { bubbles: true, composed: true }))
		field.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
		field.dispatchEvent(new Event("change", { bubbles: true, composed: true }))

		try {
			field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }))
			field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }))
		} catch {  }
		field.dispatchEvent(new Event("blur", { bubbles: true, composed: true }))
	}

	function clearField(field) {
		if (field.type === "checkbox" || field.type === "radio") {
			field.checked = false
		} else if (field.tagName.toLowerCase() === "select") {
			field.selectedIndex = 0
		} else if (field.isContentEditable) {
			field.textContent = ""
		} else {
			const proto = Object.getPrototypeOf(field)
			const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
			if (desc?.set) desc.set.call(field, "")
			else field.value = ""
		}
		field.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
		field.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
	}

	function highlightField(field) {
		field.classList.add("dk-field-filled")
		setTimeout(() => {
			field.classList.remove("dk-field-filled")
		}, 1800)
	}

	function findNextButton() {
		const candidates = [...document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button'], a.btn")]
		let fallback = null
		for (const btn of candidates) {
			if (!isVisibleField(btn)) continue
			const txt = (btn.textContent || btn.value || "").trim().toLowerCase()
			const aria = (btn.getAttribute("aria-label") || "").toLowerCase()
			const cls = (btn.className || "").toLowerCase()
			if (
				/^(next|continue|proceed|forward|step|save & continue|go to step)/i.test(txt) ||
				/next|continue|proceed/i.test(aria) ||
				/next-btn|btn-next|wizard-next|step-next/i.test(cls)
			) {
				return btn
			}
			if (btn.type === "submit" || /submit|register|sign up|create/i.test(txt)) {
				if (!fallback) fallback = btn
			}
		}
		return fallback
	}

	let formRunId = 0
	let formDebounce = null
	function stopFormFiller() {
		formRunId++
		clearTimeout(formDebounce)
		formDebounce = null
		activeCleanups.delete("form-filler")
		if (formStepObserver) {
			formStepObserver.disconnect()
			formStepObserver = null
		}
		hideFloatingCta()
	}

	function simulatePlaywrightClick(el) {
		if (!el) return false
		if (el.disabled || el.getAttribute("aria-disabled") === "true") return false

		try {
			el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" })
		} catch {}

		const rect = el.getBoundingClientRect()
		const clientX = Math.round(rect.left + Math.max(1, rect.width / 2))
		const clientY = Math.round(rect.top + Math.max(1, rect.height / 2))

		const baseInit = {
			bubbles: true,
			cancelable: true,
			composed: true,
			view: window,
			detail: 1,
			clientX,
			clientY,
			screenX: clientX,
			screenY: clientY,
		}

		try { el.dispatchEvent(new PointerEvent("pointerover", { ...baseInit, button: 0, buttons: 0 })) } catch {}
		try { el.dispatchEvent(new MouseEvent("mouseover", { ...baseInit, button: 0, buttons: 0 })) } catch {}
		try { el.dispatchEvent(new PointerEvent("pointerenter", { ...baseInit, bubbles: false, button: 0, buttons: 0 })) } catch {}
		try { el.dispatchEvent(new MouseEvent("mouseenter", { ...baseInit, bubbles: false, button: 0, buttons: 0 })) } catch {}

		try { el.dispatchEvent(new PointerEvent("pointerdown", { ...baseInit, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true })) } catch {}
		try { el.dispatchEvent(new MouseEvent("mousedown", { ...baseInit, button: 0, buttons: 1 })) } catch {}

		try {
			if (typeof el.focus === "function") el.focus()
		} catch {}

		try { el.dispatchEvent(new PointerEvent("pointerup", { ...baseInit, button: 0, buttons: 0, pointerType: "mouse", isPrimary: true })) } catch {}
		try { el.dispatchEvent(new MouseEvent("mouseup", { ...baseInit, button: 0, buttons: 0 })) } catch {}

		try {
			if (typeof el.click === "function") {
				el.click()
			} else {
				el.dispatchEvent(new MouseEvent("click", { ...baseInit, button: 0, buttons: 0 }))
			}
		} catch {
			try { el.dispatchEvent(new MouseEvent("click", { ...baseInit, button: 0, buttons: 0 })) } catch {}
		}

		return true
	}

	function resetReactState(el, isMulti = false) {
		if (!el) return false
		const targetVal = isMulti ? [] : null

		const nodesToInspect = [el, el.parentElement, el.parentElement?.parentElement, el.closest('[data-slot="form-item"]'), el.closest('form')].filter(Boolean)
		for (const node of nodesToInspect) {

			const propsKey = Object.keys(node).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'))
			if (propsKey && node[propsKey]) {
				const p = node[propsKey]
				if (typeof p.onValueChange === 'function') {
					try { p.onValueChange(targetVal); return true } catch {}
				}
				if (typeof p.setValue === 'function') {
					try { p.setValue(targetVal); return true } catch {}
				}
				if (typeof p.setSelected === 'function') {
					try { p.setSelected(targetVal); return true } catch {}
				}
				if (typeof p.resetField === 'function') {
					try { p.resetField(); return true } catch {}
				}
			}

			const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
			if (fiberKey && node[fiberKey]) {
				let fiber = node[fiberKey]
				let depth = 0
				while (fiber && depth < 6) {
					const p = fiber.memoizedProps
					if (p) {
						if (typeof p.onValueChange === 'function') {
							try { p.onValueChange(targetVal); return true } catch {}
						}
						if (typeof p.setValue === 'function') {
							try { p.setValue(targetVal); return true } catch {}
						}
						if (typeof p.setSelected === 'function') {
							try { p.setSelected(targetVal); return true } catch {}
						}
						if (typeof p.onChange === 'function' && fiber !== node[fiberKey]) {
							try { p.onChange(targetVal); return true } catch {}
						}
					}
					fiber = fiber.return
					depth++
				}
			}
		}
		return false
	}

	function isChipSelected(el, groupSiblings = []) {
		if (!el) return false
		if (
			el.getAttribute("aria-checked") === "true" ||
			el.getAttribute("aria-pressed") === "true" ||
			el.getAttribute("aria-selected") === "true" ||
			el.getAttribute("data-state") === "checked" ||
			el.getAttribute("data-state") === "on" ||
			el.getAttribute("data-selected") === "true" ||
			el.getAttribute("data-active") === "true"
		) {
			return true
		}
		const cls = ((el.className || "") + " " + (el.parentElement?.className || "")).toLowerCase()
		if (/\b(active|selected|checked|is-active|is-selected)\b/.test(cls)) return true
		if (/\bbg-primary\b|\btext-white\b|\bring-primary\b|\bborder-primary\b/.test(cls)) {
			if (!cls.includes("hover:bg-primary") && !cls.includes("hover:text-white")) return true
		}
		if (el.querySelector('[class*="check"], svg[class*="check"], [class*="selected"]')) return true

		if (groupSiblings && groupSiblings.length > 2) {
			const classCounts = new Map()
			groupSiblings.forEach(s => {
				const sc = (s.className || "").trim()
				classCounts.set(sc, (classCounts.get(sc) || 0) + 1)
			})
			let maxCount = 0
			let baseline = ""
			for (const [sc, count] of classCounts.entries()) {
				if (count > maxCount) {
					maxCount = count
					baseline = sc
				}
			}
			if (maxCount >= Math.ceil(groupSiblings.length / 2)) {
				const thisCls = (el.className || "").trim()
				if (thisCls !== baseline) {
					return true
				}
			}
		}

		return false
	}

	function getGroupLabel(parent, children = []) {
		let curr = parent
		for (let depth = 0; depth < 5 && curr; depth++) {
			let prev = curr.previousElementSibling
			while (prev) {
				const t = (prev.textContent || "").trim()
				if (t && t.length < 50 && !/^(step|cancel|save|next|back|previous|create property|creating on behalf)/i.test(t)) {
					return t.replace(/[*:]$/, "").trim()
				}
				prev = prev.previousElementSibling
			}
			const labelInParent = curr.parentElement?.querySelector('label, h2, h3, h4, h5, [class*="label"], [class*="title"]')
			if (labelInParent && labelInParent !== curr && !curr.contains(labelInParent)) {
				const t = (labelInParent.textContent || "").trim()
				if (t && t.length < 50 && !/^(step|cancel|save|next|back|previous|create property|creating on behalf)/i.test(t)) {
					return t.replace(/[*:]$/, "").trim()
				}
			}
			curr = curr.parentElement
		}
		const sampleTexts = children.slice(0, 3).map(c => (c.textContent || "").trim().toLowerCase())
		if (sampleTexts.some(s => /villa|flat|apartment|plot|office|commercial/.test(s))) return "Property Type"
		if (sampleTexts.some(s => /bhk|studio/.test(s))) return "BHK"
		if (sampleTexts.some(s => /furnish/.test(s))) return "Furnishing Status"
		if (sampleTexts.some(s => /yes|no/.test(s))) return "Preference"
		return ""
	}

	function isMultiSelectGroup(parent, children, groupLabel = "") {
		if (!parent || !children || children.length < 2) return false

		if (parent.getAttribute("role") === "radiogroup" || parent.getAttribute("aria-multiselectable") === "false") return false
		if (parent.getAttribute("aria-multiselectable") === "true") return true

		const roles = children.map(c => c.getAttribute("role") || "").filter(Boolean)
		if (roles.includes("radio") || roles.includes("tab")) return false
		if (roles.includes("checkbox")) return true

		if (children.some(c => c.querySelector('input[type="radio"]'))) return false
		if (children.some(c => c.querySelector('input[type="checkbox"]'))) return true

		const activeCount = children.filter(isChipSelected).length
		if (activeCount >= 2) return true

		const texts = children.map(c => (c.textContent || "").trim().toLowerCase())
		if (children.length === 2) {
			const joined = [...texts].sort().join("/")
			if (joined === "no/yes" || joined === "false/true" || joined === "off/on" || joined === "buy/rent" || joined === "rent/sell" || joined === "female/male") {
				return false
			}
		}

		if (texts.every(t => /^\d+$/.test(t))) return false

		if (texts.some(t => /bhk|studio/.test(t))) return false
		if (texts.some(t => /unfurnished|furnished/.test(t))) return false
		if (texts.some(t => /villa|flat|apartment|plot|office|commercial/.test(t))) return false

		const lbl = groupLabel.toLowerCase()
		if (/\b(tag|tags|amenit|amenities|feature|features|facilit|facilities|interest|interests|hobby|hobbies|perk|perks|infrastructure|skill|skills|language|languages|service|services|category|categories|highlight|highlights|addon|addons|extra|extras|option|options|choose multiple|select all|include)\b/.test(lbl)) {
			return true
		}
		if (/\b(type|status|select one|choose one|bhk|bedroom|bathroom|furnish|facing|tenure|condition|gender|floor|age|possession|parking|frequency|period|rating|priority|stage|phase)\b/.test(lbl)) {
			return false
		}

		return false
	}

	function pickOptionFromHiddenSelect(hiddenSelect) {
		if (!hiddenSelect || !hiddenSelect.options) return null
		const valid = [...hiddenSelect.options].filter(opt => {
			if (opt.disabled) return false
			if (!opt.value) return false
			const t = (opt.text || "").trim()
			if (/^(select|choose|please|pick|none|--)/i.test(t)) return false
			return true
		})
		return valid.length ? valid[Math.floor(Math.random() * valid.length)] : null
	}

	async function fillCustomSelects(isClear, filledList = []) {

		const triggers = [...document.querySelectorAll(
			'[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [aria-expanded][aria-haspopup], [class*="select-trigger"], button[class*="select"]'
		)]
			.filter(el => !isDevKitNode(el))
			.filter(isVisibleField)

		let count = 0
		for (const trigger of triggers) {
			if (trigger.getAttribute("data-dk-filled")) continue

			const hiddenSelect = trigger.parentElement?.querySelector('select[aria-hidden="true"]') ||
				trigger.closest('[data-slot="form-item"]')?.querySelector('select[aria-hidden="true"]') ||
				trigger.parentElement?.querySelector('select[tabindex="-1"]')

			if (isClear) {
				trigger.removeAttribute("data-dk-filled")
				if (hiddenSelect) {
					hiddenSelect.selectedIndex = 0
					hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }))
				}
				count++
				continue
			}

			const clickTarget = trigger.closest('[class*="select"], [class*="combobox"], [class*="trigger"]') || trigger.parentElement || trigger
			const target = (trigger.offsetParent !== null && trigger.getBoundingClientRect().width > 0) ? trigger : clickTarget

			let matchItem = null
			try {
				simulatePlaywrightClick(target)
				target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }))
				await new Promise(r => setTimeout(r, 350))

				const popupCandidates = [...document.querySelectorAll(
					'[role="listbox"], [role="menu"], ul[class*="select"], div[class*="dropdown"], div[class*="menu"], div[class*="select-content"], div[class*="select-dropdown"], div[class*="popup"], div[class*="popover"]'
				)]
				const listbox = popupCandidates.reverse().find(el => {
					if (el.closest('[hidden]')) return false
					const style = window.getComputedStyle(el)
					return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.getBoundingClientRect().width > 0
				})

				if (listbox) {

					const items = [...listbox.querySelectorAll('[role="option"], [role="menuitem"], li, div[class*="option"], div[class*="item"]')]
						.filter(item => {
							if (!isVisibleField(item)) return false
							if (item.querySelector('[role="listbox"], ul')) return false
							return true
						})

					const pickValue = hiddenSelect ? pickOptionFromHiddenSelect(hiddenSelect) : null

					const validItems = items.filter(item => {
						const txt = (item.textContent || "").trim()
						if (!txt) return false
						if (/^(select|choose|please|pick|none|--)/i.test(txt)) return false
						if (item.getAttribute("aria-disabled") === "true") return false
						if (item.hasAttribute("disabled")) return false
						if (window.getComputedStyle(item).cursor === "not-allowed") return false
						if (/disabled/i.test(item.className || "")) return false
						return true
					})

					if (validItems.length) {
						if (pickValue) {
							matchItem = validItems.find(i => (i.textContent||"").trim() === pickValue.text.trim() || i.getAttribute("data-value") === pickValue.value)
						}
						if (!matchItem) matchItem = validItems[Math.floor(Math.random() * validItems.length)]
					}
				}

				if (matchItem) {
					simulatePlaywrightClick(matchItem)
					count++
					highlightField(target)
					trigger.setAttribute("data-dk-filled", "true")
					target.setAttribute("data-dk-filled", "true")

					const fieldLabel = trigger.getAttribute("aria-label") ||
						(trigger.id && document.querySelector(`label[for="${CSS.escape(trigger.id)}"]`)?.textContent) ||
						target.closest('div')?.querySelector('label')?.textContent ||
						"Dropdown"

					filledList.push({
						field: fieldLabel.replace(/\*$/, "").trim().slice(0, 30),
						type: "select",
						value: (matchItem.textContent || "").trim().slice(0, 30),
					})
					await new Promise(r => setTimeout(r, 200))
					continue
				} else {
					document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
					target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
					await new Promise(r => setTimeout(r, 100))
				}
			} catch {  }

			if (hiddenSelect && hiddenSelect.options.length > 0) {
				const pick = pickOptionFromHiddenSelect(hiddenSelect)
				if (!pick) continue
				try {
					const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
					if (nativeInputValueSetter) nativeInputValueSetter.call(hiddenSelect, pick.value)
					else hiddenSelect.value = pick.value
					hiddenSelect.dispatchEvent(new Event("input", { bubbles: true }))
					hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }))
					count++
					highlightField(trigger)
					trigger.setAttribute("data-dk-filled", "true")
					filledList.push({
						field: hiddenSelect.name || "Select",
						type: "select",
						value: pick.text.slice(0, 30),
					})
				} catch {  }
			}
		}

		const customChecks = [...document.querySelectorAll(
			'[role="checkbox"], [role="switch"], [role="radio"], [role="menuitemcheckbox"], [role="menuitemradio"]'
		)]
			.filter(el => !isDevKitNode(el))
			.filter(isVisibleField)

		for (const check of customChecks) {
			if (check.getAttribute("data-dk-filled")) continue
			if (isClear) {
				if (check.getAttribute("aria-checked") === "true" || check.getAttribute("data-state") === "checked") {
					simulatePlaywrightClick(check)
				}
				check.removeAttribute("data-dk-filled")
				count++
				continue
			}

			if (check.getAttribute("aria-checked") !== "true" && check.getAttribute("data-state") !== "checked") {
				if (Math.random() > 0.4 || check.getAttribute("role") === "radio" || check.getAttribute("role") === "menuitemradio") {
					simulatePlaywrightClick(check)
					highlightField(check)
					filledList.push({
						field: check.getAttribute("aria-label") || check.textContent?.trim().slice(0, 25) || "Option",
						type: check.getAttribute("role") || "checkbox",
						value: "checked",
					})
				}
			}
			check.setAttribute("data-dk-filled", "true")
			count++
		}

		const chipSelector = [
			'span[class*="cursor-pointer"]',
			'div[class*="cursor-pointer"]',
			'label[class*="cursor-pointer"]',
			'button[type="button"]',
			'[role="button"]',
			'[role="radio"]',
			'[role="checkbox"]',
			'[role="switch"]',
			'[role="tab"]',
			'[class*="chip"]',
			'[class*="pill"]',
			'[class*="tag"]:not(html):not(head):not(body)',
			'[class*="badge"]'
		].join(", ")

		const genericOptions = [...document.querySelectorAll(chipSelector)]
			.filter(el => !isDevKitNode(el))
			.filter(isVisibleField)
			.filter(el => {
				const text = (el.textContent || "").trim()
				if (!text || text.length > 50) return false

				if (/^(next|submit|cancel|save|close|upload|create|add|delete|remove|edit|update|back|previous|reset|confirm|discard|finish)$/i.test(text)) return false

				if (el.closest('header, nav, aside, footer, [role="navigation"], [role="banner"], [role="complementary"]')) return false
				if (el.closest('[role="listbox"], [role="combobox"], [role="menu"]')) return false
				if (el.querySelector('input, select, textarea')) return false
				return true
			})

		const candidates = genericOptions.filter(el => {
			let p = el.parentElement
			while (p) {
				if (genericOptions.includes(p)) return false
				p = p.parentElement
			}
			return true
		})

		const groups = new Map()
		for (const el of candidates) {
			let parent = el.parentElement
			if (parent && parent.children.length === 1 && parent.parentElement) {
				parent = parent.parentElement
			}
			if (!parent) continue
			if (!groups.has(parent)) groups.set(parent, [])
			groups.get(parent).push(el)
		}

		for (const [parent, children] of groups.entries()) {
			if (children.length < 2) continue

			const groupLabel = getGroupLabel(parent, children) || "Option"
			const isMulti = isMultiSelectGroup(parent, children, groupLabel)

			if (isClear) {

				resetReactState(parent, isMulti)
				children.forEach(c => resetReactState(c, isMulti))

				parent.querySelectorAll('input[type="hidden"], select[aria-hidden="true"]').forEach(h => {
					try {
						const proto = Object.getPrototypeOf(h)
						const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
						if (desc?.set) desc.set.call(h, "")
						else h.value = ""
						h.dispatchEvent(new Event("input", { bubbles: true }))
						h.dispatchEvent(new Event("change", { bubbles: true }))
					} catch {}
				})

				for (const c of children) {
					c.removeAttribute("data-dk-filled")
					if (isChipSelected(c, children)) {
						simulatePlaywrightClick(c)
						await new Promise(r => setTimeout(r, 80))
						count++
					}
				}
				continue
			}

			if (children.some(c => c.getAttribute("data-dk-filled"))) continue

			if (isMulti) {

				const targetCount = Math.min(children.length, Math.floor(Math.random() * 3) + 2)
				const shuffled = [...children].sort(() => 0.5 - Math.random())
				const selected = shuffled.slice(0, targetCount)

				for (const item of selected) {
					if (!isChipSelected(item, children)) {
						simulatePlaywrightClick(item)
						await new Promise(r => setTimeout(r, 120))
					}
					highlightField(item)
					item.setAttribute("data-dk-filled", "true")
					count++
					filledList.push({
						field: groupLabel,
						type: "chip (multi-select)",
						value: (item.textContent || "").trim().replace(/\s+/g, ' ').slice(0, 30),
					})
				}
			} else {

				const already = children.find(c => isChipSelected(c, children))
				const pick = already || children[Math.floor(Math.random() * children.length)]
				if (!already) {
					simulatePlaywrightClick(pick)
					await new Promise(r => setTimeout(r, 80))
				}
				highlightField(pick)
				pick.setAttribute("data-dk-filled", "true")
				count++
				filledList.push({
					field: groupLabel,
					type: "chip (single-select)",
					value: (pick.textContent || "").trim().replace(/\s+/g, ' ').slice(0, 30),
				})
			}

			children.forEach(c => c.setAttribute("data-dk-filled", "true"))
			await new Promise(r => setTimeout(r, 40))
		}

		return count
	}

	function fillCurrentVisible(isClear, isEdgeCase, payload, filledList) {
		const allInputs = [
			...document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([role='combobox']), textarea, select, [contenteditable='true']")
		]
			.filter(el => !isDevKitNode(el))
		const visible = allInputs.filter(isVisibleField)
		let count = 0
		const radioGroups = new Set()

		for (const field of visible) {
			if (isClear) {
				clearField(field)
				field.removeAttribute("data-dk-filled")
				count++
				continue
			}
			if (field.getAttribute("data-dk-filled")) continue

			if (field.type === "radio") {
				if (radioGroups.has(field.name)) continue
				radioGroups.add(field.name)
			}
			const val = isEdgeCase ? generateEdgeCase(field) : generateRealistic(field, payload)
			setFieldValue(field, val)
			field.setAttribute("data-dk-filled", "true")
			highlightField(field)
			count++
			filledList.push({
				field: field.name || field.id || field.getAttribute("aria-label") || field.tagName.toLowerCase(),
				type: field.type || field.tagName.toLowerCase(),
				value: String(val).slice(0, 35),
			})
		}
		return count
	}

	async function fillFormStep(isClear, isEdgeCase, payload, filledList) {
		const nativeCount = fillCurrentVisible(isClear, isEdgeCase, payload, filledList)
		const customCount = await fillCustomSelects(isClear, filledList)
		return nativeCount + customCount
	}

	async function fillForm(payload = {}) {
		const mode = payload?.mode || "Fill current step / form"
		const profile = payload?.profile || "Realistic user data"
		const isClear = profile.includes("Clear") || mode.includes("Clear")
		const isEdgeCase = profile.includes("edge cases")
		const isAutoAdvance = mode.includes("Auto-advance")
		const isWatchSteps = mode.includes("Watch & fill")

		stopFormFiller()
		ensurePageStyles()
		const runId = formRunId

		document.querySelectorAll("[data-dk-filled]").forEach(el => el.removeAttribute("data-dk-filled"))

		if (isClear) {
			document.querySelectorAll("form").forEach(f => {
				try { f.reset() } catch {}
			})
		}

		let totalFilled = 0
		const filledList = []
		let currentStep = 1

		totalFilled += await fillFormStep(isClear, isEdgeCase, payload, filledList)

		if (isAutoAdvance && !isClear) {
			;(async () => {
				let stepsRemaining = 8
				while (stepsRemaining > 0 && runId === formRunId) {
					stepsRemaining--
					const nextBtn = findNextButton()
					if (!nextBtn) break
					simulatePlaywrightClick(nextBtn)
					currentStep++
					await new Promise((r) => setTimeout(r, 650))
					if (runId !== formRunId) return
					const newCount = await fillFormStep(isClear, isEdgeCase, payload, filledList)
					totalFilled += newCount
					if (newCount === 0) break
				}
				updateFloatingCta("Form Auto-Filler", `${totalFilled} field${totalFilled === 1 ? "" : "s"} filled across ${currentStep} steps`)
			})()
		}

		if (isWatchSteps && !isClear) {
			formStepObserver = new MutationObserver(() => {
				clearTimeout(formDebounce)
				formDebounce = setTimeout(async () => {
					if (runId !== formRunId) return
					const newlyFilled = await fillFormStep(isClear, isEdgeCase, payload, filledList)
					totalFilled += newlyFilled
					if (newlyFilled > 0) {
						currentStep++
						updateFloatingCta("Form Auto-Filler Active", `Step ${currentStep} auto-filled (${totalFilled} total fields)`)
					}
				}, 250)
			})
			formStepObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style", "class", "hidden", "aria-hidden"],
			})
		}

		showFloatingCta(
			"Form Auto-Filler",
			`${totalFilled} field${totalFilled === 1 ? "" : "s"} filled ${currentStep > 1 ? `across ${currentStep} steps` : ""}${isWatchSteps ? " (Watching steps)" : ""}`,
			() => stopFormFiller()
		)
		if (isWatchSteps || isAutoAdvance) registerCleanup("form-filler", () => stopFormFiller())

		return {
			ok: true,
			data: {
				fieldsFilled: totalFilled,
				stepsNavigated: currentStep,
				mode,
				profile,
				sampleFields: filledList.slice(0, 60),
				message: `Successfully populated ${totalFilled} fields${currentStep > 1 ? ` across ${currentStep} steps` : ""}. Use Close on the page bar to stop watching.`,
			},
		}
	}

	let snipOverlay = null
	let snipRegionBox = null
	let snipActive = false
	let activeSnipCancel = null

	function isEscapeKey(e) {
		return e.key === "Escape" || e.key === "Esc" || e.code === "Escape" || e.keyCode === 27
	}

	function nextFrame() {
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	}

	// Our own overlay must not end up in the screenshot, so hide the host while capturing.
	// The service worker queues captures to respect the captureVisibleTab rate limit.
	async function requestScreenshot() {
		const host = shadowHost
		const previous = host?.style.getPropertyValue("visibility")
		if (host) host.style.setProperty("visibility", "hidden", "important")
		try {
			if (host) await nextFrame()
			const response = await sendRuntime({ type: "screenshot" })
			if (!response?.ok) throw new Error(response?.error ?? "Screenshot failed")
			return response.dataUrl
		} finally {
			if (host) {
				if (previous) host.style.setProperty("visibility", previous, "important")
				else host.style.removeProperty("visibility")
			}
		}
	}

	function dataUrlToImageEl(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => resolve(img)
			img.onerror = () => reject(new Error("Failed to decode screenshot"))
			img.src = dataUrl
		})
	}

	async function cropDataUrl(dataUrl, x, y, w, h, dpr) {
		const img = await dataUrlToImageEl(dataUrl)
		const canvas = document.createElement("canvas")
		canvas.width = Math.round(w * dpr)
		canvas.height = Math.round(h * dpr)
		const ctx = canvas.getContext("2d")
		ctx.drawImage(img, Math.round(x * dpr), Math.round(y * dpr), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
		return canvas.toDataURL("image/png")
	}

	function cleanupSnipOverlay() {
		if (typeof activeSnipCancel === "function") {
			const cancel = activeSnipCancel
			activeSnipCancel = null
			cancel()
		}
		if (snipOverlay?.parentNode) snipOverlay.parentNode.removeChild(snipOverlay)
		if (snipRegionBox?.parentNode) snipRegionBox.parentNode.removeChild(snipRegionBox)
		snipOverlay = null
		snipRegionBox = null
		snipActive = false
		hideFloatingCta()
	}

	function snipFreeformRegion() {
		return new Promise((resolve, reject) => {
			ensureStyles()
			cleanupSnipOverlay()
			snipActive = true

			try { window.focus() } catch {  }

			const root = getShadowRoot()
			const overlay = el("div", "dk-snip-overlay")
			overlay.tabIndex = -1
			overlay.setAttribute("role", "dialog")
			overlay.setAttribute("aria-label", "DevKit Snipping Tool - Freeform Selection")

			const regionBox = el("div", "dk-snip-region")
			regionBox.style.display = "none"
			const dimsLabel = el("span", "dk-snip-dims")
			regionBox.appendChild(dimsLabel)

			snipOverlay = overlay
			snipRegionBox = regionBox

			let startX = 0, startY = 0, dragging = false
			let finished = false

			function onDown(e) {
				if (e.button !== 0) return
				if (floatingCta && (e.target === floatingCta || floatingCta.contains(e.target) || e.composedPath?.().includes(floatingCta))) return
				e.preventDefault()
				e.stopPropagation()
				startX = e.clientX
				startY = e.clientY
				dragging = true
				regionBox.style.display = "block"
				regionBox.style.left = startX + "px"
				regionBox.style.top = startY + "px"
				regionBox.style.width = "0px"
				regionBox.style.height = "0px"
				dimsLabel.textContent = "0 × 0"
				try { overlay.focus({ preventScroll: true }) } catch {  }
			}

			function onMove(e) {
				if (!dragging) return
				e.preventDefault()
				e.stopPropagation()
				const x = Math.min(startX, e.clientX)
				const y = Math.min(startY, e.clientY)
				const w = Math.abs(e.clientX - startX)
				const h = Math.abs(e.clientY - startY)
				regionBox.style.left = x + "px"
				regionBox.style.top = y + "px"
				regionBox.style.width = w + "px"
				regionBox.style.height = h + "px"
				dimsLabel.textContent = `${w} × ${h}`
			}

			function removeListeners() {
				overlay.removeEventListener("mousedown", onDown, true)
				window.removeEventListener("mousemove", onMove, true)
				window.removeEventListener("mouseup", onUp, true)
				window.removeEventListener("keydown", onKey, true)
				document.removeEventListener("keydown", onKey, true)
				overlay.removeEventListener("keydown", onKey, true)
			}

			function finishClean() {
				if (finished) return
				finished = true
				removeListeners()
				activeSnipCancel = null
				if (snipOverlay?.parentNode) snipOverlay.parentNode.removeChild(snipOverlay)
				if (snipRegionBox?.parentNode) snipRegionBox.parentNode.removeChild(snipRegionBox)
				snipOverlay = null
				snipRegionBox = null
				snipActive = false
				hideFloatingCta()
			}

			function cancelAndExit() {
				if (finished) return
				finishClean()
				resolve({ cancelled: true, mode: "Freeform region" })
			}

			async function onUp(e) {
				if (!dragging) return
				e.preventDefault()
				e.stopPropagation()
				dragging = false
				const rx = Math.min(startX, e.clientX)
				const ry = Math.min(startY, e.clientY)
				const rw = Math.abs(e.clientX - startX)
				const rh = Math.abs(e.clientY - startY)
				if (rw < 5 || rh < 5) {
					regionBox.style.display = "none"
					return
				}
				finishClean()
				try {
					const dataUrl = await requestScreenshot()
					const dpr = window.devicePixelRatio || 1
					const cropped = await cropDataUrl(dataUrl, rx, ry, rw, rh, dpr)
					resolve({ dataUrl: cropped, width: rw, height: rh, mode: "Freeform region" })
				} catch (err) {
					reject(err)
				}
			}

			function onKey(e) {
				if (isEscapeKey(e)) {
					e.preventDefault()
					e.stopPropagation()
					cancelAndExit()
				}
			}

			activeSnipCancel = cancelAndExit

			overlay.addEventListener("mousedown", onDown, true)
			window.addEventListener("mousemove", onMove, true)
			window.addEventListener("mouseup", onUp, true)
			window.addEventListener("keydown", onKey, true)
			document.addEventListener("keydown", onKey, true)
			overlay.addEventListener("keydown", onKey, true)

			root.appendChild(overlay)
			root.appendChild(regionBox)

			try { overlay.focus({ preventScroll: true }) } catch {  }

			showFloatingCta(
				"Sidekick: Snipping tool",
				"Draw a region · Esc to cancel",
				cancelAndExit
			)
		})
	}

	async function snipVisibleTab() {
		const dataUrl = await requestScreenshot()
		const dpr = window.devicePixelRatio || 1
		return {
			dataUrl,
			width: Math.round(window.innerWidth * dpr),
			height: Math.round(window.innerHeight * dpr),
			mode: "Visible tab",
		}
	}

	async function snipFullPage() {
		const dpr = window.devicePixelRatio || 1
		const viewW = window.innerWidth
		const viewH = window.innerHeight
		const fullH = Math.max(
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
			document.body.offsetHeight,
			document.documentElement.offsetHeight
		)
		const fullW = Math.max(
			document.body.scrollWidth,
			document.documentElement.scrollWidth
		)
		// Browsers cap canvas size (about 32k px per side), so very long pages are truncated.
		const maxCssHeight = Math.floor(32000 / dpr)
		const truncated = fullH > maxCssHeight
		const captureH = Math.min(fullH, maxCssHeight)

		const savedX = window.scrollX
		const savedY = window.scrollY

		let cancelled = false
		function onKey(e) {
			if (isEscapeKey(e)) {
				e.preventDefault()
				e.stopPropagation()
				cancelled = true
			}
		}

		window.addEventListener("keydown", onKey, true)
		document.addEventListener("keydown", onKey, true)
		activeSnipCancel = () => { cancelled = true }

		// Fixed and sticky elements stay visible in the first section only, otherwise headers repeat.
		const fixedEls = []
		scanElements("body *", (node) => {
			const pos = getComputedStyle(node).position
			if (pos === "fixed" || pos === "sticky") fixedEls.push({ node, orig: node.style.cssText })
		}, { limit: 20000, ms: 400 })
		const hideFixed = () => {
			for (const { node } of fixedEls) node.style.setProperty("visibility", "hidden", "important")
		}

		const totalChunks = Math.ceil(captureH / viewH)
		const canvas = document.createElement("canvas")
		canvas.width = Math.round(fullW * dpr)
		canvas.height = Math.round(captureH * dpr)
		const ctx = canvas.getContext("2d")

		showFloatingCta(
			"Sidekick: Full page capture",
			`Capturing… 0/${totalChunks} sections · Esc to cancel`,
			() => { cancelled = true }
		)

		try {
			for (let i = 0; i < totalChunks; i++) {
				if (cancelled) break

				if (i === 1) hideFixed()
				window.scrollTo({ left: 0, top: i * viewH, behavior: "instant" })

				await new Promise(r => setTimeout(r, 200))

				if (cancelled) break

				updateFloatingCta(
					"Sidekick: Full page capture",
					`Capturing… ${i + 1}/${totalChunks} sections · Esc to cancel`,
					() => { cancelled = true }
				)

				const dataUrl = await requestScreenshot()
				if (cancelled) break

				const img = await dataUrlToImageEl(dataUrl)
				if (cancelled) break

				const actualScrollY = window.scrollY
				const yOffset = actualScrollY * dpr
				const drawH = Math.min(viewH * dpr, canvas.height - yOffset)

				ctx.drawImage(
					img,
					0, 0, img.width, Math.round(drawH),
					0, Math.round(yOffset), img.width, Math.round(drawH)
				)
			}
		} finally {
			window.removeEventListener("keydown", onKey, true)
			document.removeEventListener("keydown", onKey, true)
			activeSnipCancel = null

			window.scrollTo({ left: savedX, top: savedY, behavior: "instant" })
			for (const { node, orig } of fixedEls) {
				node.style.cssText = orig
			}
			hideFloatingCta()
		}

		if (cancelled) {
			return { cancelled: true, mode: "Full page (scroll)" }
		}

		const result = canvas.toDataURL("image/png")
		return {
			dataUrl: result,
			width: Math.round(fullW * dpr),
			height: Math.round(captureH * dpr),
			mode: "Full page (scroll)",
			truncated,
		}
	}

	async function snipContentOnly() {
		const dpr = window.devicePixelRatio || 1
		const dataUrl = await requestScreenshot()

		const contentW = document.documentElement.clientWidth
		const contentH = document.documentElement.clientHeight
		const cropped = await cropDataUrl(dataUrl, 0, 0, contentW, contentH, dpr)
		return {
			dataUrl: cropped,
			width: Math.round(contentW * dpr),
			height: Math.round(contentH * dpr),
			mode: "Content only",
		}
	}

	async function handleSnip(payload) {
		const mode = payload?.mode || "Visible tab"
		try {
			let result
			if (mode === "Freeform region") {
				result = await snipFreeformRegion()
			} else if (mode === "Full page (scroll)") {
				result = await snipFullPage()
			} else if (mode === "Content only") {
				result = await snipContentOnly()
			} else {
				result = await snipVisibleTab()
			}
			if (result?.cancelled) {
				return { ok: true, data: { cancelled: true, mode } }
			}
			return { ok: true, data: result }
		} catch (err) {
			return { ok: false, error: err?.message ?? String(err) }
		}
	}

	function toneCounts(sections) {
		const counts = { good: 0, warn: 0, bad: 0, info: 0 }
		for (const section of sections) for (const item of section.items) counts[item.tone] = (counts[item.tone] ?? 0) + 1
		return counts
	}

	function cspDirective(policy, name) {
		const match = String(policy || "")
			.split(";")
			.map((part) => part.trim())
			.find((part) => part.toLowerCase().startsWith(`${name} `) || part.toLowerCase() === name)
		return match ? match.slice(name.length).trim() : null
	}

	function checkHeaders(data, isHttps) {
		const items = []
		const headers = data.headers ?? {}
		const csp = headers["content-security-policy"]
		if (!csp) {
			items.push({
				label: "Content-Security-Policy",
				detail: headers["content-security-policy-report-only"] ? "Only a report-only policy is set, nothing is enforced" : "Missing, so injected scripts run unrestricted",
				tone: "bad",
			})
		} else {
			const scripts = cspDirective(csp, "script-src") ?? cspDirective(csp, "default-src") ?? ""
			const problems = []
			if (/'unsafe-inline'/.test(scripts) && !/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(scripts)) problems.push("allows 'unsafe-inline' scripts")
			if (/'unsafe-eval'/.test(scripts)) problems.push("allows 'unsafe-eval'")
			if (/(^|\s)(\*|https?:|data:)(\s|$)/.test(scripts)) problems.push("allows scripts from any host or data: URLs")
			if (!scripts) problems.push("has no script-src or default-src")
			items.push({ label: "Content-Security-Policy", detail: problems.length ? `Present but ${problems.join(", ")}` : "Present with a restrictive script policy", tone: problems.length ? "warn" : "good" })
		}
		const hsts = headers["strict-transport-security"]
		if (!isHttps) {
			items.push({ label: "HTTPS", detail: "Page is served over plain HTTP", tone: "bad" })
		} else if (!hsts) {
			items.push({ label: "Strict-Transport-Security", detail: "Missing, first visits can be downgraded to HTTP", tone: "warn" })
		} else {
			const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0)
			items.push({
				label: "Strict-Transport-Security",
				detail: maxAge < 15552000 ? `max-age ${maxAge}s is below 180 days` : `max-age ${maxAge}s${/includesubdomains/i.test(hsts) ? ", includeSubDomains" : ""}${/preload/i.test(hsts) ? ", preload" : ""}`,
				tone: maxAge < 15552000 ? "warn" : "good",
			})
		}
		const nosniff = /nosniff/i.test(headers["x-content-type-options"] ?? "")
		items.push({ label: "X-Content-Type-Options", detail: nosniff ? "nosniff" : "Missing nosniff, browsers may MIME sniff responses", tone: nosniff ? "good" : "warn" })
		const xfo = headers["x-frame-options"]
		const frameAncestors = cspDirective(csp, "frame-ancestors")
		items.push({
			label: "Clickjacking protection",
			detail: frameAncestors ? `CSP frame-ancestors ${frameAncestors}` : xfo ? `X-Frame-Options ${xfo}` : "Neither X-Frame-Options nor CSP frame-ancestors is set",
			tone: frameAncestors || xfo ? "good" : "warn",
		})
		const referrer = headers["referrer-policy"]
		items.push({
			label: "Referrer-Policy",
			detail: referrer ?? "Not set, browsers default to strict-origin-when-cross-origin",
			tone: !referrer ? "info" : /unsafe-url|no-referrer-when-downgrade/i.test(referrer) ? "warn" : "good",
		})
		items.push({ label: "Permissions-Policy", detail: headers["permissions-policy"] ? "Set" : "Not set, powerful features fall back to defaults", tone: headers["permissions-policy"] ? "good" : "info" })
		for (const [name, label] of [["cross-origin-opener-policy", "COOP"], ["cross-origin-embedder-policy", "COEP"], ["cross-origin-resource-policy", "CORP"]]) {
			items.push({ label, detail: headers[name] ?? "Not set", tone: headers[name] ? "good" : "info" })
		}
		if (headers["x-powered-by"]) items.push({ label: "X-Powered-By", detail: `Discloses ${headers["x-powered-by"]}`, tone: "warn" })
		if (headers.server && /\d/.test(headers.server)) items.push({ label: "Server", detail: `Discloses a version: ${headers.server}`, tone: "info" })
		if (headers["access-control-allow-origin"] === "*") items.push({ label: "CORS", detail: "Access-Control-Allow-Origin is * on the document", tone: "info" })
		return items
	}

	function checkCookies(cookies, isHttps) {
		const items = []
		for (const cookie of cookies.slice(0, 60)) {
			const flags = [cookie.secure ? "Secure" : "no Secure", cookie.httpOnly ? "HttpOnly" : "readable by JS", `SameSite=${cookie.sameSite}`]
			const sensitive = /sess|token|auth|sid|jwt|login|csrf|xsrf/i.test(cookie.name)
			let tone = "good"
			if (isHttps && !cookie.secure) tone = "bad"
			else if (sensitive && !cookie.httpOnly && !/csrf|xsrf/i.test(cookie.name)) tone = "bad"
			else if (cookie.sameSite === "no_restriction" || cookie.sameSite === "none") tone = "warn"
			else if (!cookie.httpOnly || cookie.sameSite === "unspecified") tone = "info"
			items.push({ label: cookie.name, detail: `${flags.join(" · ")} · ${cookie.domain}${cookie.path}`, tone })
		}
		return items.sort((a, b) => ["bad", "warn", "info", "good"].indexOf(a.tone) - ["bad", "warn", "info", "good"].indexOf(b.tone))
	}

	async function securityCheck() {
		const isHttps = location.protocol === "https:"
		const response = await sendRuntime({ type: "security:check", url: location.href })
		const data = response?.ok ? response.data : null
		const sections = []

		if (!data || (data.error && !data.status)) {
			sections.push({ title: "Response headers", items: [{ label: "Headers", detail: `Could not fetch the page headers: ${data?.error ?? response?.error ?? "unavailable"}`, tone: "warn" }] })
		} else {
			sections.push({ title: "Response headers", items: checkHeaders(data, isHttps) })
		}
		sections.push({ title: "Cookies", items: checkCookies(data?.cookies ?? [], isHttps) })

		const pageItems = []
		const mixed = []
		if (isHttps) {
			scanElements("img[src], script[src], link[href], iframe[src], video[src], audio[src], source[src], embed[src], object[data]", (node) => {
				const url = node.getAttribute("src") ?? node.getAttribute("href") ?? node.getAttribute("data") ?? ""
				if (/^http:/i.test(url)) mixed.push(node)
			}, { limit: 5000, ms: 150 })
		}
		for (const node of mixed.slice(0, 15)) {
			pageItems.push({ label: "Mixed content", detail: `<${node.tagName.toLowerCase()}> loads ${(node.getAttribute("src") ?? node.getAttribute("href") ?? node.getAttribute("data")).slice(0, 120)}`, tone: node.tagName === "SCRIPT" || node.tagName === "IFRAME" ? "bad" : "warn", selector: cssPath(node) })
		}

		for (const form of [...document.forms].slice(0, 50)) {
			const hasPassword = Boolean(form.querySelector("input[type=password]"))
			if (/^http:/i.test(form.action) && (isHttps || hasPassword)) {
				pageItems.push({ label: "Insecure form", detail: `Form submits to ${form.action.slice(0, 120)}`, tone: "bad", selector: cssPath(form) })
			} else if (!isHttps && hasPassword) {
				pageItems.push({ label: "Password over HTTP", detail: "Password form on a page served over HTTP", tone: "bad", selector: cssPath(form) })
			}
		}

		let unlabeledPasswords = 0
		for (const input of document.querySelectorAll("input[type=password]")) {
			const autocomplete = (input.getAttribute("autocomplete") ?? "").toLowerCase()
			if (!/current-password|new-password|one-time-code/.test(autocomplete)) {
				unlabeledPasswords++
				if (unlabeledPasswords <= 5) {
					pageItems.push({ label: "Password autocomplete", detail: autocomplete ? `autocomplete="${autocomplete}", prefer current-password or new-password` : "No autocomplete hint, add current-password or new-password", tone: "info", selector: cssPath(input) })
				}
			}
		}

		const inlineScripts = [...document.querySelectorAll("script:not([src])")].filter((script) => !/json|importmap|template|text\/(html|x-)/i.test(script.type))
		if (inlineScripts.length) {
			pageItems.push({ label: "Inline scripts", detail: `${inlineScripts.length} inline <script> blocks, a strict CSP needs nonces or hashes for these`, tone: "info", selector: cssPath(inlineScripts[0]) })
		}
		let handlerCount = 0
		let firstHandler = null
		scanElements("body *", (node) => {
			for (const attr of node.attributes) {
				if (/^on[a-z]+$/.test(attr.name)) {
					handlerCount++
					firstHandler ??= node
				}
			}
		}, { limit: 8000, ms: 150 })
		if (handlerCount) pageItems.push({ label: "Inline event handlers", detail: `${handlerCount} onclick style attributes, blocked by a strict CSP`, tone: "warn", selector: cssPath(firstHandler) })

		const openers = [...document.querySelectorAll("a[target=_blank]")].filter((a) => !/noopener|noreferrer/i.test(a.rel) && a.origin !== location.origin)
		if (openers.length) {
			pageItems.push({ label: "target=_blank links", detail: `${openers.length} external links without rel=noopener (modern browsers imply it, older ones do not)`, tone: "info", selector: cssPath(openers[0]) })
		}

		const origins = new Map()
		for (const script of document.querySelectorAll("script[src]")) {
			try {
				const url = new URL(script.src, location.href)
				if (url.origin === location.origin) continue
				const entry = origins.get(url.origin) ?? { count: 0, withoutIntegrity: 0, node: script }
				entry.count++
				if (!script.integrity) entry.withoutIntegrity++
				origins.set(url.origin, entry)
			} catch {}
		}
		const thirdPartyItems = [...origins.entries()]
			.sort((a, b) => b[1].count - a[1].count)
			.slice(0, 30)
			.map(([origin, entry]) => ({
				label: origin.replace(/^https?:\/\//, ""),
				detail: `${entry.count} script${entry.count === 1 ? "" : "s"}${entry.withoutIntegrity ? `, ${entry.withoutIntegrity} without Subresource Integrity` : ""}`,
				tone: origin.startsWith("http:") ? "bad" : "info",
				selector: cssPath(entry.node),
			}))

		sections.push({ title: "Page checks", items: pageItems })
		sections.push({ title: "Third party script origins", items: thirdPartyItems })
		const counts = toneCounts(sections)
		const summary = [
			{ label: "Problems", value: counts.bad, tone: counts.bad ? "bad" : "good" },
			{ label: "Warnings", value: counts.warn, tone: counts.warn ? "warn" : "good" },
			{ label: "Cookies", value: data?.cookies?.length ?? 0, tone: "info" },
			{ label: "Script origins", value: origins.size, tone: origins.size > 10 ? "warn" : "info" },
		]
		if (data?.status) summary.push({ label: "HTTP status", value: data.status, tone: data.status < 400 ? "good" : "bad" })
		return report(summary, sections)
	}

	function imageAudit() {
		const dpr = window.devicePixelRatio || 1
		const viewH = window.innerHeight
		const sizes = new Map()
		for (const entry of performance.getEntriesByType("resource")) {
			if (entry.initiatorType === "img" || entry.initiatorType === "css" || entry.initiatorType === "other") {
				sizes.set(entry.name, entry.encodedBodySize || entry.transferSize || 0)
			}
		}
		const groups = { broken: [], alt: [], dims: [], oversized: [], lazy: [], eager: [], legacy: [] }
		let total = 0
		let wastedBytes = 0
		const scan = scanElements("img", (img) => {
			const src = img.currentSrc || img.src
			if (!src) return
			total++
			const name = (src.startsWith("data:") ? "inline data URL" : src.split("/").pop().split("?")[0]) || src
			const label = name.slice(0, 60)
			const selector = cssPath(img)
			if (img.complete && img.naturalWidth === 0) {
				groups.broken.push({ label, detail: `Failed to load ${src.slice(0, 160)}`, tone: "bad", selector })
				return
			}
			const rect = img.getBoundingClientRect()
			const rendered = rect.width > 0 && rect.height > 0
			if (!img.hasAttribute("alt") && !img.closest("[aria-hidden='true']")) {
				groups.alt.push({ label, detail: "Missing alt attribute (use alt=\"\" for decorative images)", tone: "bad", selector })
			}
			if (rendered && (!img.getAttribute("width") || !img.getAttribute("height"))) {
				const style = getComputedStyle(img)
				if (style.aspectRatio === "auto" && style.position !== "absolute" && style.position !== "fixed") {
					groups.dims.push({ label, detail: "No width and height attributes or CSS aspect-ratio, the layout shifts when it loads", tone: "warn", selector })
				}
			}
			const bytes = sizes.get(src) ?? 0
			if (rendered && img.naturalWidth) {
				const needed = Math.ceil(rect.width * dpr)
				const ratio = img.naturalWidth / needed
				if (ratio > 1.5 && img.naturalWidth - needed > 150) {
					if (bytes) wastedBytes += Math.round(bytes * (1 - 1 / (ratio * ratio)))
					groups.oversized.push({
						label,
						detail: `${img.naturalWidth}×${img.naturalHeight} natural, shown at ${Math.round(rect.width)}×${Math.round(rect.height)} CSS px (about ${needed}px wide needed at ${dpr}x)${bytes ? `, ${Math.round(bytes / 1024)} KB` : ""}`,
						tone: ratio > 3 ? "bad" : "warn",
						selector,
					})
				}
			}
			const belowFold = rect.top > viewH
			if (rendered && belowFold && img.loading !== "lazy") {
				groups.lazy.push({ label, detail: `Below the fold (${Math.round(rect.top)}px down) without loading="lazy"`, tone: "warn", selector })
			}
			if (rendered && !belowFold && img.loading === "lazy" && rect.width * rect.height > 60000) {
				groups.eager.push({ label, detail: "Large image above the fold is lazy loaded, this delays LCP", tone: "warn", selector })
			}
			if (/\.(jpe?g|png|gif|bmp)(\?|#|$)/i.test(src) && (bytes > 100 * 1024 || img.naturalWidth * img.naturalHeight > 640 * 480)) {
				groups.legacy.push({ label, detail: `${src.match(/\.(jpe?g|png|gif|bmp)/i)[1].toUpperCase()}${bytes ? ` ${Math.round(bytes / 1024)} KB` : ""}, WebP or AVIF is usually 25 to 50% smaller`, tone: "info", selector })
			}
		}, { limit: 2000, ms: 300 })

		const cap = (list) => list.slice(0, 40)
		const sections = [
			{ title: "Broken images", items: cap(groups.broken) },
			{ title: "Missing alt text", items: cap(groups.alt) },
			{ title: "Layout shift risk (no dimensions)", items: cap(groups.dims) },
			{ title: "Oversized for their rendered size", items: cap(groups.oversized) },
			{ title: "Lazy loading", items: cap([...groups.eager, ...groups.lazy]) },
			{ title: "Legacy formats", items: cap(groups.legacy) },
		]
		const issues = Object.values(groups).reduce((sum, list) => sum + list.length, 0)
		const summary = [
			{ label: "Images", value: scan.truncated ? `${total}+` : total, tone: "info" },
			{ label: "Issues", value: issues, tone: groups.broken.length || groups.alt.length ? "bad" : issues ? "warn" : "good" },
			{ label: "Oversized", value: groups.oversized.length, tone: groups.oversized.length ? "warn" : "good" },
			{ label: "No dimensions", value: groups.dims.length, tone: groups.dims.length ? "warn" : "good" },
		]
		if (wastedBytes > 1024) summary.push({ label: "Est. savings", value: `${Math.round(wastedBytes / 1024)} KB`, tone: "warn" })
		if (!issues) sections.push({ title: "Result", items: [{ label: "All clear", detail: `${total} images checked, no issues found`, tone: "good" }] })
		return report(summary, sections)
	}

	function a11ySummaryRows(result) {
		const s = result.summary ?? {}
		return [
			{ label: "Total issues", value: result.total, tone: result.total ? "warn" : "good" },
			{ label: "Critical", value: s.critical ?? 0, tone: s.critical ? "bad" : "good" },
			{ label: "Serious", value: s.serious ?? 0, tone: s.serious ? "bad" : "good" },
			{ label: "Moderate", value: s.moderate ?? 0, tone: s.moderate ? "warn" : "good" },
			{ label: "Minor", value: s.minor ?? 0, tone: "info" },
		]
	}

	function stopAllActiveTools() {
		if (state.inspect) setInspect(false)
		if (state.grid) toggleGrid()
		if (state.outline) toggleOutline()
		if (state.edit) toggleEdit()
		if (state.viewport) toggleViewport()
		if (state.deviceFrame) toggleDeviceFrame({ close: true })
		if (state.measure) toggleMeasure(false)
		if (eyedropperActive) stopInPageEyedropper()
		if (deepInspectPending) {
			deepInspectPending = false
			document.removeEventListener("mousemove", onMove, true)
			document.removeEventListener("click", onDeepClick, true)
			if (highlight?.parentNode) highlight.parentNode.removeChild(highlight)
			highlight = null
		}
		stopFormFiller()
		cleanupSnipOverlay()
		for (const name of [...activeCleanups.keys()]) runCleanup(name)
		hideHud()
		hideFloatingCta()
		return { ok: true, data: "All active tools closed" }
	}

	const handlers = {
		ping: () => ({ ok: true, data: "pong" }),
		"toggle-inspect": () => ({ ok: true, data: { enabled: setInspect() } }),
		"toggle-grid": () => ({ ok: true, data: { enabled: toggleGrid() } }),
		"toggle-outline": () => ({ ok: true, data: { enabled: toggleOutline() } }),
		"toggle-edit": () => ({ ok: true, data: { enabled: toggleEdit() } }),
		"edit-reset-all": () => ({ ok: true, data: { count: resetAllMovedElements() } }),
		viewport: (payload) => {
			let enabled = state.viewport
			if (payload?.enable === true) {
				if (!state.viewport) enabled = toggleViewport()
			} else if (payload?.enable === false) {
				if (state.viewport) enabled = toggleViewport()
			} else {
				enabled = toggleViewport()
			}
			return { ok: true, data: { enabled, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } }
		},
		"viewport-query": () => ({ ok: true, data: { enabled: state.viewport, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } }),
		"device-frame": (payload) => ({ ok: true, data: toggleDeviceFrame(payload) }),
		"device-frame-query": () => ({ ok: true, data: { active: !!state.deviceFrame, ...state.deviceFrame } }),
		"active-tools-query": () => ({
			ok: true,
			data: {
				viewport: !!state.viewport,
				deviceFrame: state.deviceFrame ? { ...state.deviceFrame } : { active: false },
				inspect: !!state.inspect,
				edit: !!state.edit,
				grid: !!state.grid,
				outline: !!state.outline,
				measure: !!state.measure,
				eyedropper: !!eyedropperActive,
			},
		}),
		eyedropper: () => openEyeDropper(),
		"start-eyedropper": () => startInPageEyedropper(),
		"stop-eyedropper": () => {
			stopInPageEyedropper()
			return { ok: true }
		},
		"audit-a11y": (payload) => {
			const data = auditA11y()
			if (payload?.source) showReportHud("Accessibility audit", a11ySummaryRows(data), JSON.stringify(data, null, 2))
			return { ok: true, data }
		},
		"audit-seo": () => ({ ok: true, data: auditSeo() }),
		"scan-links": async (payload) => ({ ok: true, data: await scanLinks(payload) }),
		metrics: async () => ({ ok: true, data: await metrics() }),
		storage: () => ({ ok: true, data: storageDump() }),
		"storage-clear": (payload) => {
			const store = payload?.store || "all"
			try {
				if (store === "localStorage" || store === "all") localStorage.clear()
				if (store === "sessionStorage" || store === "all") sessionStorage.clear()
			} catch (err) {
				return { ok: false, error: err?.message ?? String(err) }
			}
			return { ok: true, data: storageDump() }
		},
		"storage-remove-key": (payload) => {
			try {
				if (payload?.store === "sessionStorage") {
					sessionStorage.removeItem(payload.key)
				} else if (payload?.store === "localStorage") {
					localStorage.removeItem(payload.key)
				}
				return { ok: true, data: storageDump() }
			} catch (err) {
				return { ok: false, error: err?.message ?? String(err) }
			}
		},
		fonts: () => ({ ok: true, data: fontsReport() }),
		colors: () => ({ ok: true, data: colorReport() }),
		"console-log": () => ({ ok: true, data: getRecentLogs(100) }),
		zindex: () => ({ ok: true, data: zIndexScan() }),
		stack: () => ({ ok: true, data: detectStack() }),
		"capture-context": (payload) => {
			const data = pageContext()
			if (payload?.source) {
				const text = Object.entries(data).map(([key, value]) => `${key}: ${value}`).join("\n")
				showHud("Bug context", text, "Copy", () => copy(text))
			}
			return { ok: true, data }
		},
		"deep-inspect": () => ({ ok: true, data: { enabled: setInspect() } }),
		"scan-animations": () => ({ ok: true, data: scanAnimations() }),
		"fill-form": (payload) => fillForm(payload),
		snip: (payload) => handleSnip(payload),
		"stop-tool": () => stopAllActiveTools(),
		"toggle-measure": () => ({ ok: true, data: { enabled: toggleMeasure() } }),
		"security-check": async () => ({ ok: true, data: await securityCheck() }),
		"image-audit": () => ({ ok: true, data: imageAudit() }),
		"hide-hud": () => {
			hideHud()
			return { ok: true }
		},
		"highlight-element": (payload) => highlightElement(payload),
	}

	const onRuntimeMessage = (message, _sender, sendResponse) => {
		if (window[CORE_KEY] !== core) return false
		const handler = handlers[message?.type]
		if (!handler) {
			sendResponse({ ok: false, error: `Unknown command: ${message?.type}` })
			return false
		}
		try {
			const output = handler(message.payload)
			if (output && typeof output.then === "function") {
				output.then(sendResponse, (error) => sendResponse({ ok: false, error: error?.message ?? String(error) }))
				return true
			}
			sendResponse(output)
			return false
		} catch (error) {
			sendResponse({ ok: false, error: error?.message ?? String(error) })
			return false
		}
	}
	runtime.runtime.onMessage.addListener(onRuntimeMessage)

	core.teardown = () => {
		try {
			stopAllActiveTools()
		} catch {}
		try {
			runtime.runtime.onMessage.removeListener(onRuntimeMessage)
		} catch {}
		for (const fn of coreTeardowns.splice(0)) {
			try {
				fn()
			} catch {}
		}
		shadowHost?.remove()
		shadowHost = null
		shadowRoot = null
		if (window[CORE_KEY] === core) delete window[CORE_KEY]
	}
})()
