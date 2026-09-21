
;(() => {
	if (window.__devkitLoaded) return
	window.__devkitLoaded = true

	const runtime = typeof browser !== "undefined" && browser.runtime ? browser : chrome
	const state = { inspect: false, grid: false, outline: false, edit: false, viewport: false }
	const LOG_CAP = 300
	const logBuffer = new Array(LOG_CAP)
	let logCount = 0
	let logHead = 0
	let highlight = null
	let hud = null
	let badge = null

	for (const level of ["error", "warn"]) {
		const original = console[level].bind(console)
		console[level] = (...args) => {
			push(level, args.map(stringify).join(" "))
			original(...args)
		}
	}
	window.addEventListener("error", (event) => push("error", `${event.message} @ ${event.filename}:${event.lineno}`))
	window.addEventListener("unhandledrejection", (event) => push("rejection", stringify(event.reason)))

	function push(level, message) {
		logBuffer[logHead] = { level, message: String(message).slice(0, 600), at: new Date().toISOString() }
		logHead = (logHead + 1) % LOG_CAP
		if (logCount < LOG_CAP) logCount++
	}

	function getRecentLogs(limit = 100) {
		const res = []
		const count = Math.min(limit, logCount)
		const start = (logHead - count + LOG_CAP) % LOG_CAP
		for (let i = 0; i < count; i++) {
			res.push(logBuffer[(start + i) % LOG_CAP])
		}
		return res
	}

	function countConsoleErrors() {
		let count = 0
		for (let i = 0; i < logCount; i++) {
			if (logBuffer[i] && logBuffer[i].level === "error") count++
		}
		return count
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

	function el(tag, className) {
		const node = document.createElement(tag)
		if (className) node.className = className
		node.classList.add("dk-root")
		return node
	}

	let shadowHost = null
	let shadowRoot = null

	function getShadowRoot() {
		if (!shadowHost || !shadowHost.parentNode) {
			shadowHost = document.getElementById("devkit-shadow-host")
			if (!shadowHost) {
				shadowHost = document.createElement("div")
				shadowHost.id = "devkit-shadow-host"
				;(document.body || document.documentElement).appendChild(shadowHost)
			}
			shadowHost.classList.add("dk-root")
			shadowHost.style.cssText = "all: initial !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; pointer-events: none !important; border: none !important; margin: 0 !important; padding: 0 !important; display: block !important; overflow: visible !important;"
			try {
				shadowRoot = shadowHost.shadowRoot || shadowHost.attachShadow({ mode: "open" })
			} catch {
				shadowRoot = shadowHost
			}
		}
		ensureStyles()
		return shadowRoot
	}

	function isDevKitNode(node) {
		if (!node) return false
		if (node === shadowHost || node === shadowRoot) return true
		if (shadowHost && (shadowHost === node || shadowHost.contains(node))) return true
		if (shadowRoot && typeof node.getRootNode === "function" && node.getRootNode() === shadowRoot) return true
		const id = typeof node.id === "string" ? node.id : (node.id?.baseVal || node.getAttribute?.("id") || "")
		if (id === "devkit-shadow-host") return true
		return false
	}

	function isDevKitEvent(event) {
		if (!event) return false
		try {
			const path = typeof event.composedPath === "function" ? event.composedPath() : []
			for (const el of path) {
				if (isDevKitNode(el)) return true
			}
			const target = event.target instanceof Element ? event.target : event.target?.parentElement
			if (isDevKitNode(target)) return true
		} catch {

		}
		return false
	}

	function ensureStyles() {
		const root = shadowRoot || shadowHost
		if (!root) return
		let styleEl = root.querySelector("#dk-injected-styles")
		if (!styleEl) {
			styleEl = document.createElement("style")
			styleEl.id = "dk-injected-styles"
			root.appendChild(styleEl)
		}
		if (!document.getElementById("dk-injected-page-styles")) {
			const pageStyle = document.createElement("style")
			pageStyle.id = "dk-injected-page-styles"
			pageStyle.textContent = `
				.dk-field-filled { outline: 2px solid #3b82f6 !important; outline-offset: 1px !important; }
				.dk-outline-all *:not(.dk-root):not(.dk-root *) { outline: 1px solid rgba(229, 100, 88, 0.45) !important; }
			`
			;(document.head || document.documentElement).appendChild(pageStyle)
		}
		styleEl.textContent = `
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
			*, *::before, *::after {
				box-sizing: border-box !important;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
			}
			.dk-snip-overlay {
				position: fixed !important;
				inset: 0 !important;
				width: 100vw !important;
				height: 100vh !important;
				z-index: 2147483646 !important;
				pointer-events: auto !important;
				cursor: crosshair !important;
				background: rgba(0, 0, 0, 0.3) !important;
				outline: none !important;
				user-select: none !important;
				-webkit-user-select: none !important;
			}
			.dk-snip-region {
				position: fixed !important;
				z-index: 2147483647 !important;
				border: 2px solid #3b82f6 !important;
				background: rgba(59, 130, 246, 0.12) !important;
				box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45) !important;
				pointer-events: none !important;
			}
			.dk-snip-dims {
				position: absolute !important;
				bottom: -24px !important;
				left: 50% !important;
				transform: translateX(-50%) !important;
				background: rgba(15, 23, 42, 0.92) !important;
				color: #f8fafc !important;
				padding: 2px 8px !important;
				border-radius: 4px !important;
				font-size: 11px !important;
				font-family: ui-monospace, SFMono-Regular, monospace !important;
				white-space: nowrap !important;
				pointer-events: none !important;
			}
			.dk-cta-esc-badge {
				all: initial !important;
				background: rgba(255, 255, 255, 0.18) !important;
				color: #f8fafc !important;
				border: 1px solid rgba(255, 255, 255, 0.35) !important;
				border-radius: 4px !important;
				padding: 1px 6px !important;
				font-size: 11px !important;
				font-family: ui-monospace, monospace !important;
				font-weight: 700 !important;
				cursor: pointer !important;
				display: inline-block !important;
				margin: 0 3px !important;
				line-height: 1.2 !important;
				transition: all 0.15s ease !important;
				vertical-align: baseline !important;
			}
			.dk-cta-esc-badge:hover {
				background: rgba(239, 68, 68, 0.5) !important;
				border-color: #ef4444 !important;
				color: #ffffff !important;
			}
			.dk-highlight {
				position: fixed !important;
				z-index: 2147483645 !important;
				pointer-events: none !important;
				border: 2px solid #3b82f6 !important;
				background: rgba(59, 130, 246, 0.18) !important;
				border-radius: 3px !important;
				box-shadow: 0 0 0 1px rgba(255,255,255,0.7), 0 0 16px rgba(59,130,246,0.5) !important;
				transition: none !important;
			}
			.dk-hud {
				position: fixed !important;
				z-index: 2147483646 !important;
				bottom: 20px !important;
				right: 20px !important;
				width: 360px !important;
				max-width: calc(100vw - 40px) !important;
				max-height: 75vh !important;
				overflow: auto !important;
				background: rgba(15, 23, 42, 0.96) !important;
				backdrop-filter: blur(16px) !important;
				-webkit-backdrop-filter: blur(16px) !important;
				color: #f8fafc !important;
				border: 1px solid rgba(59, 130, 246, 0.4) !important;
				border-radius: 12px !important;
				padding: 14px 16px !important;
				font-size: 12px !important;
				box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
				pointer-events: auto !important;
			}
			.dk-floating-cta-bar {
				position: fixed !important;
				bottom: 24px !important;
				left: 50% !important;
				transform: translateX(-50%) !important;
				z-index: 2147483647 !important;
				pointer-events: auto !important;
				width: max-content !important;
				max-width: 90vw !important;
				animation: dkFadeUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
			}
			@keyframes dkFadeUp {
				from { opacity: 0; transform: translate(-50%, 14px); }
				to { opacity: 1; transform: translate(-50%, 0); }
			}
			.dk-cta-pill {
				display: flex !important;
				align-items: center !important;
				gap: 12px !important;
				background: rgba(15, 23, 42, 0.94) !important;
				backdrop-filter: blur(16px) !important;
				-webkit-backdrop-filter: blur(16px) !important;
				color: #f8fafc !important;
				border: 1px solid rgba(59, 130, 246, 0.4) !important;
				border-radius: 9999px !important;
				padding: 8px 14px 8px 18px !important;
				box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
				font-size: 13px !important;
				line-height: 1 !important;
				white-space: nowrap !important;
			}
			.dk-cta-dot {
				width: 8px !important;
				height: 8px !important;
				border-radius: 50% !important;
				background: #3b82f6 !important;
				box-shadow: 0 0 10px #3b82f6 !important;
				animation: dkPulse 1.8s infinite !important;
				flex-shrink: 0 !important;
			}
			.dk-cta-title { font-weight: 600 !important; color: #ffffff !important; white-space: nowrap !important; }
			.dk-cta-info { color: #94a3b8 !important; font-size: 12px !important; white-space: nowrap !important; border-left: 1px solid rgba(255, 255, 255, 0.15) !important; padding-left: 10px !important; }
			.dk-cta-close-btn {
				background: rgba(239, 68, 68, 0.2) !important;
				color: #fca5a5 !important;
				border: 1px solid rgba(239, 68, 68, 0.4) !important;
				border-radius: 9999px !important;
				padding: 5px 12px !important;
				font-size: 12px !important;
				font-weight: 600 !important;
				cursor: pointer !important;
				margin-left: 6px !important;
				display: inline-flex !important;
				align-items: center !important;
				gap: 4px !important;
				line-height: 1.2 !important;
				transition: all 0.15s ease !important;
			}
			.dk-cta-close-btn:hover { background: rgba(239, 68, 68, 0.4) !important; color: #ffffff !important; border-color: #ef4444 !important; }
			.dk-grid {
				position: fixed !important;
				inset: 0 !important;
				width: 100vw !important;
				height: 100vh !important;
				z-index: 2147483644 !important;
				pointer-events: none !important;
				background-image: linear-gradient(to right, rgba(39, 131, 222, 0.18) 1px, transparent 1px),
					linear-gradient(to bottom, rgba(39, 131, 222, 0.12) 1px, transparent 1px) !important;
				background-size: 8px 8px, 8px 8px !important;
			}
			.dk-drawer-overlay {
				position: fixed !important;
				inset: 0 !important;
				width: 100vw !important;
				height: 100vh !important;
				z-index: 2147483640 !important;
				background: rgba(0, 0, 0, 0.5) !important;
				backdrop-filter: blur(4px) !important;
				pointer-events: auto !important;
			}
			.dk-drawer-panel {
				position: fixed !important;
				top: 0 !important;
				right: 0 !important;
				bottom: 0 !important;
				width: 520px !important;
				max-width: 90vw !important;
				height: 100vh !important;
				z-index: 2147483645 !important;
				background: #0e121a !important;
				border-left: 1px solid rgba(255, 255, 255, 0.1) !important;
				box-shadow: -12px 0 40px rgba(0, 0, 0, 0.6) !important;
				display: flex !important;
				flex-direction: column !important;
				overflow: hidden !important;
				pointer-events: auto !important;
			}
			.dk-drawer-frame {
				width: 100% !important;
				height: 100% !important;
				border: none !important;
				background: transparent !important;
			}
			.dk-field-filled { outline: 2px solid #3b82f6 !important; outline-offset: 1px !important; }
			.dk-outline-all *:not(.dk-root):not(.dk-root *) { outline: 1px solid rgba(229, 100, 88, 0.45) !important; }
			.dk-badge {
				position: fixed !important;
				top: 16px !important;
				left: 50% !important;
				transform: translateX(-50%) !important;
				z-index: 2147483647 !important;
				display: inline-flex !important;
				align-items: center !important;
				gap: 10px !important;
				background: rgba(15, 23, 42, 0.95) !important;
				backdrop-filter: blur(16px) !important;
				-webkit-backdrop-filter: blur(16px) !important;
				border: 1px solid rgba(59, 130, 246, 0.5) !important;
				border-radius: 9999px !important;
				padding: 7px 16px !important;
				box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
				font-size: 13px !important;
				font-weight: 500 !important;
				color: #ffffff !important;
				pointer-events: auto !important;
				line-height: 1 !important;
				white-space: nowrap !important;
				animation: dkFadeDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
			}
			@keyframes dkFadeDown {
				from { opacity: 0; transform: translate(-50%, -10px); }
				to { opacity: 1; transform: translate(-50%, 0); }
			}
			.dk-badge-dot {
				width: 8px !important;
				height: 8px !important;
				border-radius: 50% !important;
				background: #10b981 !important;
				box-shadow: 0 0 8px #10b981 !important;
				animation: dkPulse 1.8s infinite !important;
				flex-shrink: 0 !important;
			}
			.dk-badge-dims {
				font-weight: 700 !important;
				font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
				color: #ffffff !important;
				font-size: 13.5px !important;
				letter-spacing: 0.3px !important;
			}
			.dk-badge-tag {
				background: rgba(59, 130, 246, 0.2) !important;
				border: 1px solid rgba(59, 130, 246, 0.45) !important;
				color: #93c5fd !important;
				border-radius: 9999px !important;
				padding: 2px 8px !important;
				font-size: 11px !important;
				font-weight: 600 !important;
				text-transform: uppercase !important;
				letter-spacing: 0.5px !important;
			}
			.dk-badge-dpr {
				color: #94a3b8 !important;
				font-size: 12px !important;
				border-left: 1px solid rgba(255, 255, 255, 0.15) !important;
				padding-left: 8px !important;
			}
			.dk-badge-close {
				background: rgba(239, 68, 68, 0.15) !important;
				border: 1px solid rgba(239, 68, 68, 0.3) !important;
				border-radius: 9999px !important;
				color: #fca5a5 !important;
				cursor: pointer !important;
				font-size: 11px !important;
				font-weight: 700 !important;
				padding: 2px 6px !important;
				line-height: 1 !important;
				margin-left: 4px !important;
				transition: all 0.15s ease !important;
			}
			.dk-badge-close:hover {
				background: rgba(239, 68, 68, 0.35) !important;
				color: #ffffff !important;
				border-color: #ef4444 !important;
			}
			.dk-edit-hover {
				outline: 2px dashed rgba(59, 130, 246, 0.75) !important;
				outline-offset: 2px !important;
				cursor: grab !important;
			}
			.dk-edit-selected {
				position: fixed !important;
				z-index: 2147483645 !important;
				pointer-events: auto !important;
				border: 2px solid #3b82f6 !important;
				background: rgba(59, 130, 246, 0.08) !important;
				border-radius: 2px !important;
				box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6), 0 0 20px rgba(59, 130, 246, 0.45) !important;
				cursor: grab !important;
			}
			.dk-edit-selected.dk-dragging {
				cursor: grabbing !important;
			}
			.dk-edit-handle {
				position: absolute !important;
				width: 8px !important;
				height: 8px !important;
				background: #ffffff !important;
				border: 2px solid #3b82f6 !important;
				border-radius: 1px !important;
				pointer-events: none !important;
			}
			.dk-edit-handle-tl { top: -5px !important; left: -5px !important; }
			.dk-edit-handle-tr { top: -5px !important; right: -5px !important; }
			.dk-edit-handle-bl { bottom: -5px !important; left: -5px !important; }
			.dk-edit-handle-br { bottom: -5px !important; right: -5px !important; }
			.dk-edit-toolbar {
				position: fixed !important;
				z-index: 2147483646 !important;
				display: flex !important;
				align-items: center !important;
				gap: 4px !important;
				background: rgba(15, 23, 42, 0.96) !important;
				backdrop-filter: blur(16px) !important;
				border: 1px solid rgba(59, 130, 246, 0.5) !important;
				border-radius: 8px !important;
				padding: 4px 8px !important;
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
				font-size: 11.5px !important;
				pointer-events: auto !important;
				animation: dkFadeUp 0.18s ease-out !important;
			}
			.dk-edit-btn {
				background: rgba(255, 255, 255, 0.08) !important;
				color: #f1f5f9 !important;
				border: 1px solid rgba(255, 255, 255, 0.15) !important;
				border-radius: 4px !important;
				padding: 3px 8px !important;
				font-size: 11px !important;
				cursor: pointer !important;
				font-weight: 500 !important;
				display: inline-flex !important;
				align-items: center !important;
				gap: 3px !important;
				user-select: none !important;
				line-height: 1.2 !important;
				transition: all 0.15s ease !important;
			}
			.dk-edit-btn:hover {
				background: rgba(59, 130, 246, 0.3) !important;
				border-color: #3b82f6 !important;
				color: #fff !important;
			}
			.dk-edit-btn.dk-drag-grip {
				cursor: grab !important;
				background: rgba(59, 130, 246, 0.2) !important;
				border-color: rgba(59, 130, 246, 0.5) !important;
				color: #93c5fd !important;
			}
			.dk-edit-btn.dk-drag-grip:active {
				cursor: grabbing !important;
			}
			.dk-edit-btn.dk-delete:hover {
				background: rgba(239, 68, 68, 0.3) !important;
				border-color: #ef4444 !important;
				color: #fca5a5 !important;
			}
			.dk-edit-tag-label {
				color: #60a5fa !important;
				font-weight: 700 !important;
				font-size: 11px !important;
				text-transform: uppercase !important;
				padding: 2px 6px !important;
				font-family: ui-monospace, SFMono-Regular, monospace !important;
				letter-spacing: 0.3px !important;
			}
			.dk-drop-indicator {
				position: fixed !important;
				z-index: 2147483645 !important;
				pointer-events: none !important;
				height: 4px !important;
				background: #3b82f6 !important;
				border-radius: 2px !important;
				box-shadow: 0 0 10px #3b82f6 !important;
			}
			@keyframes dkPulse {
				0%, 100% { opacity: 0.95; transform: scale(1); }
				50% { opacity: 0.45; transform: scale(1.02); }
			}
		`
		root.appendChild(styleEl)
	}

	function showHud(title, body, actionLabel, action) {
		ensureStyles()
		if (!hud || !hud.parentNode) {
			hud = el("div", "dk-hud")
			getShadowRoot().appendChild(hud)
		}
		hud.innerHTML = ""
		const heading = el("h4")
		heading.textContent = title
		heading.style.cssText = "margin: 0 0 8px 0 !important; font-size: 12px !important; color: #60a5fa !important; text-transform: uppercase !important; letter-spacing: 0.05em !important; font-weight: 700 !important;"
		hud.appendChild(heading)

		const pre = el("div")
		pre.style.cssText = "white-space: pre-wrap !important; word-break: break-word !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 11.5px !important; line-height: 1.45 !important; color: #e2e8f0 !important;"
		pre.textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2)
		hud.appendChild(pre)

		const actionsRow = el("div")
		actionsRow.style.cssText = "display: flex !important; gap: 8px !important; margin-top: 10px !important; justify-content: flex-end !important;"
		if (actionLabel && action) {
			const extra = el("button")
			extra.textContent = actionLabel
			extra.style.cssText = "background: rgba(59, 130, 246, 0.2) !important; color: #93c5fd !important; border: 1px solid rgba(59, 130, 246, 0.4) !important; border-radius: 6px !important; padding: 4px 10px !important; font-size: 11.5px !important; cursor: pointer !important;"
			extra.addEventListener("click", action)
			actionsRow.appendChild(extra)
		}
		const close = el("button")
		close.textContent = "✕ Close"
		close.style.cssText = "background: rgba(255, 255, 255, 0.1) !important; color: #cbd5e1 !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; border-radius: 6px !important; padding: 4px 10px !important; font-size: 11.5px !important; cursor: pointer !important;"
		close.addEventListener("click", hideHud)
		actionsRow.appendChild(close)
		hud.appendChild(actionsRow)
	}

	function hideHud() {
		if (hud?.parentNode) hud.parentNode.removeChild(hud)
		hud = null
	}

	let floatingCta = null
	function showFloatingCta(title, info, onClose) {
		ensureStyles()
		hideFloatingCta()
		floatingCta = el("div", "dk-floating-cta-bar dk-root")
		const pill = el("div", "dk-cta-pill")
		const dot = el("span", "dk-cta-dot")
		const titleEl = el("span", "dk-cta-title")
		titleEl.textContent = title
		const infoEl = el("span", "dk-cta-info")
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
				hideFloatingCta()
			})
			infoEl.appendChild(escBadge)
			infoEl.appendChild(document.createTextNode(" to cancel" + (parts[1] || "")))
		} else {
			infoEl.textContent = info || "Active"
		}
		const closeBtn = el("button", "dk-cta-close-btn")
		closeBtn.type = "button"
		closeBtn.textContent = "✕ Close Tool"
		closeBtn.title = "Stop and close this tool (or press Esc)"
		closeBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			if (typeof onClose === "function") onClose()
			hideFloatingCta()
		})
		pill.append(dot, titleEl, infoEl, closeBtn)
		floatingCta.appendChild(pill)
		getShadowRoot().appendChild(floatingCta)
	}

	function updateFloatingCta(title, info, onClose) {
		if (!floatingCta) return
		const titleEl = floatingCta.querySelector(".dk-cta-title")
		const infoEl = floatingCta.querySelector(".dk-cta-info")
		if (titleEl && title) titleEl.textContent = title
		if (infoEl && info) {
			if (typeof info === "string" && info.includes("Esc to cancel")) {
				infoEl.textContent = ""
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
				infoEl.textContent = info
			}
		}
	}

	function hideFloatingCta() {
		if (floatingCta?.parentNode) floatingCta.parentNode.removeChild(floatingCta)
		floatingCta = null
	}

	let pulseBox = null
	function highlightElement(payload) {
		const selector = payload?.selector
		if (!selector) return { ok: false, error: "No selector provided" }
		try {
			const target = document.querySelector(selector)
			if (!target) return { ok: false, error: `Element not found on page: ${selector}` }
			target.scrollIntoView({ behavior: "smooth", block: "center" })

			const root = getShadowRoot()
			ensureStyles()
			if (pulseBox?.parentNode) pulseBox.remove()
			const rect = target.getBoundingClientRect()
			pulseBox = el("div", "dk-pulse-box dk-root")
			pulseBox.style.cssText = `
				position: fixed !important;
				top: ${Math.max(0, rect.top - 4)}px !important;
				left: ${Math.max(0, rect.left - 4)}px !important;
				width: ${rect.width + 8}px !important;
				height: ${rect.height + 8}px !important;
				border: 3px solid #ef4444 !important;
				background: rgba(239, 68, 68, 0.15) !important;
				border-radius: 4px !important;
				box-shadow: 0 0 24px rgba(239, 68, 68, 0.6), 0 0 0 1px #ffffff !important;
				z-index: 2147483646 !important;
				pointer-events: none !important;
				animation: dkPulse 1.2s infinite ease-in-out !important;
			`
			const label = el("div", "dk-pulse-label")
			label.textContent = selector.length > 50 ? selector.slice(0, 47) + "…" : selector
			label.style.cssText = `
				position: absolute !important;
				top: -26px !important;
				left: 0 !important;
				background: #ef4444 !important;
				color: #ffffff !important;
				font-size: 11px !important;
				font-weight: 700 !important;
				padding: 2px 8px !important;
				border-radius: 4px !important;
				white-space: nowrap !important;
				font-family: monospace !important;
			`
			pulseBox.appendChild(label)
			root.appendChild(pulseBox)
			setTimeout(() => {
				if (pulseBox?.parentNode) pulseBox.remove()
				pulseBox = null
			}, 6000)
			return { ok: true }
		} catch (e) {
			return { ok: false, error: e.message }
		}
	}

	function cssPath(node) {
		if (!(node instanceof Element)) return ""
		if (node.id) return `#${CSS.escape(node.id)}`
		const parts = []
		let current = node
		while (current && current.nodeType === 1 && parts.length < 5) {
			let part = current.tagName.toLowerCase()
			if (current.classList.length) part += `.${[...current.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".")}`
			const parent = current.parentElement
			if (parent) {
				const twins = [...parent.children].filter((child) => child.tagName === current.tagName)
				if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(current) + 1})`
			}
			parts.unshift(part)
			current = current.parentElement
		}
		return parts.join(" > ")
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
		const found = []
		const attrs = [
			"onclick", "onmouseover", "onmouseout", "onmousedown", "onmouseup",
			"onkeydown", "onkeyup", "onkeypress", "onfocus", "onblur",
			"onchange", "oninput", "onsubmit", "onscroll", "onresize",
			"ontouchstart", "ontouchend", "onwheel", "ondrag", "ondrop",
		]
		for (const attr of attrs) {
			if (node.hasAttribute(attr) || typeof node[attr] === "function") {
				found.push(attr.replace("on", ""))
			}
		}
		return found
	}

	function getFrameworkBindings(node) {
		const bindings = []

		for (const key of Object.keys(node)) {
			if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
				bindings.push("React component")
				break
			}
		}

		if (node.__vue__ || node.__vue_app__ || node._vnode) bindings.push("Vue instance")

		const ngAttrs = [...node.attributes].filter((a) => a.name.startsWith("_ng") || a.name.startsWith("ng-"))
		if (ngAttrs.length) bindings.push("Angular binding")

		const svelteClasses = [...node.classList].filter((c) => /^svelte-/.test(c))
		if (svelteClasses.length) bindings.push("Svelte component")
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

	function onMove(event) {
		if (!state.inspect && !deepInspectPending) return
		if (isDevKitEvent(event)) {
			if (highlight?.parentNode) highlight.style.display = "none"
			return
		}
		const node = event.target
		if (!(node instanceof Element)) return

		try {
			ensureStyles()
			const rect = node.getBoundingClientRect()
			if (!highlight) {
				highlight = el("div", "dk-highlight")
				getShadowRoot().appendChild(highlight)
			}

			const style = getComputedStyle(node)
			const mt = parseFloat(style.marginTop) || 0
			const mr = parseFloat(style.marginRight) || 0
			const mb = parseFloat(style.marginBottom) || 0
			const ml = parseFloat(style.marginLeft) || 0
			highlight.style.cssText = `
				position: fixed !important;
				z-index: 2147483645 !important;
				pointer-events: none !important;
				border: 2px solid #3b82f6 !important;
				background: rgba(59, 130, 246, 0.08) !important;
				border-radius: 3px !important;
				top: ${Math.round(rect.top)}px !important;
				left: ${Math.round(rect.left)}px !important;
				width: ${Math.max(2, Math.round(rect.width))}px !important;
				height: ${Math.max(2, Math.round(rect.height))}px !important;
				display: block !important;
				box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 0 16px rgba(59, 130, 246, 0.35) !important;
			`

			const bg = effectiveBackground(node)
			const fontFam = (style.fontFamily || "sans-serif").split(",")[0].replace(/['"]/g, "")
			const contrastRatio = contrast(style.color, bg)
			const contrastNum = contrastRatio ?? 0
			const aaPass = contrastNum >= 4.5
			const aaaPass = contrastNum >= 7
			const pt = style.paddingTop, pr = style.paddingRight, pb = style.paddingBottom, pl = style.paddingLeft

			showVisualHud(node, {
				tag: node.tagName.toLowerCase(),
				id: node.id,
				classes: [...node.classList].slice(0, 3),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
				font: fontFam,
				fontSize: style.fontSize,
				fontWeight: style.fontWeight,
				color: toHex(style.color),
				colorRaw: style.color,
				bg: toHex(bg),
				bgRaw: bg,
				contrast: contrastRatio,
				aaPass,
				aaaPass,
				display: style.display,
				position: style.position,
				margin: { top: style.marginTop, right: style.marginRight, bottom: style.marginBottom, left: style.marginLeft },
				padding: { top: pt, right: pr, bottom: pb, left: pl },
				border: {
					top: style.borderTopWidth, right: style.borderRightWidth,
					bottom: style.borderBottomWidth, left: style.borderLeftWidth,
				},
				borderColor: toHex(style.borderTopColor),
				borderStyle: style.borderTopStyle,
				zIndex: style.zIndex,
			}, event)
		} catch {

		}
	}

	function showVisualHud(node, info, event) {
		ensureStyles()
		if (!hud || !hud.parentNode) {
			hud = el("div", "dk-hud")
			getShadowRoot().appendChild(hud)
		}
		hud.innerHTML = ""
		hud.style.maxWidth = "400px"

		const tagRow = el("div")
		tagRow.style.cssText = "display: flex !important; align-items: center !important; gap: 6px !important; margin-bottom: 8px !important; flex-wrap: wrap !important;"
		const semanticTags = new Set(["nav", "header", "footer", "main", "aside", "article", "section", "form", "button", "a", "dialog", "details", "figure", "table"])
		const isSemanticTag = semanticTags.has(info.tag)
		const tagPill = el("span")
		tagPill.textContent = `<${info.tag}>`
		tagPill.style.cssText = `display: inline-block !important; padding: 2px 8px !important; border-radius: 4px !important; font-size: 11px !important; font-weight: 700 !important; font-family: ui-monospace, monospace !important; background: ${isSemanticTag ? "rgba(16, 185, 129, 0.2)" : "rgba(148, 163, 184, 0.2)"} !important; color: ${isSemanticTag ? "#34d399" : "#94a3b8"} !important; border: 1px solid ${isSemanticTag ? "rgba(16, 185, 129, 0.3)" : "rgba(148, 163, 184, 0.2)"} !important;`
		tagRow.appendChild(tagPill)
		if (info.id) {
			const idPill = el("span")
			idPill.textContent = `#${info.id}`
			idPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 4px !important; font-size: 10px !important; font-weight: 600 !important; font-family: ui-monospace, monospace !important; background: rgba(139, 92, 246, 0.2) !important; color: #a78bfa !important;"
			tagRow.appendChild(idPill)
		}
		if (info.classes.length) {
			const clsPill = el("span")
			clsPill.textContent = `.${info.classes.join(".")}`
			clsPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 4px !important; font-size: 10px !important; font-family: ui-monospace, monospace !important; color: #64748b !important; max-width: 160px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;"
			tagRow.appendChild(clsPill)
		}
		const layoutPill = el("span")
		layoutPill.textContent = info.display
		layoutPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 4px !important; font-size: 10px !important; font-weight: 600 !important; background: rgba(59, 130, 246, 0.15) !important; color: #60a5fa !important;"
		tagRow.appendChild(layoutPill)
		if (info.position !== "static") {
			const posPill = el("span")
			posPill.textContent = info.position
			posPill.style.cssText = "display: inline-block !important; padding: 2px 6px !important; border-radius: 4px !important; font-size: 10px !important; background: rgba(245, 158, 11, 0.15) !important; color: #fbbf24 !important;"
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

		addMetricChip(metricsRow, "📐", `${info.width} × ${info.height}`)

		addMetricChip(metricsRow, "🔤", `${info.font} ${info.fontSize} w${info.fontWeight}`)

		const colorChip = el("div")
		colorChip.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 4px !important; background: rgba(255,255,255,0.06) !important; font-size: 10px !important; color: #94a3b8 !important;"
		const colorSwatch = el("span")
		colorSwatch.style.cssText = `width: 12px !important; height: 12px !important; border-radius: 3px !important; background: ${info.color} !important; border: 1px solid rgba(255,255,255,0.2) !important; flex-shrink: 0 !important;`
		const colorText = el("span")
		colorText.textContent = info.color
		colorText.style.cssText = "font-family: ui-monospace, monospace !important; font-size: 10px !important;"
		colorChip.append(colorSwatch, colorText)
		metricsRow.appendChild(colorChip)

		const bgChip = el("div")
		bgChip.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 4px !important; background: rgba(255,255,255,0.06) !important; font-size: 10px !important; color: #94a3b8 !important;"
		const bgSwatch = el("span")
		bgSwatch.style.cssText = `width: 12px !important; height: 12px !important; border-radius: 3px !important; background: ${info.bg} !important; border: 1px solid rgba(255,255,255,0.2) !important; flex-shrink: 0 !important;`
		const bgText = el("span")
		bgText.textContent = `bg:${info.bg}`
		bgText.style.cssText = "font-family: ui-monospace, monospace !important; font-size: 10px !important;"
		bgChip.append(bgSwatch, bgText)
		metricsRow.appendChild(bgChip)

		if (info.contrast !== null && info.contrast !== undefined) {
			const contrastChip = el("div")
			const passLevel = info.aaaPass ? "AAA" : info.aaPass ? "AA" : "Fail"
			const passColor = info.aaaPass ? "#34d399" : info.aaPass ? "#fbbf24" : "#f87171"
			const passBg = info.aaaPass ? "rgba(16,185,129,0.15)" : info.aaPass ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.15)"
			contrastChip.style.cssText = `display: flex !important; align-items: center !important; gap: 3px !important; padding: 2px 6px !important; border-radius: 4px !important; background: ${passBg} !important; font-size: 10px !important; font-weight: 600 !important; color: ${passColor} !important;`
			contrastChip.textContent = `${info.contrast}:1 ${passLevel}`
			metricsRow.appendChild(contrastChip)
		}

		hud.appendChild(metricsRow)

		positionHud(event, hud)
	}

	function addMetricChip(parent, icon, text) {
		const chip = el("div")
		chip.style.cssText = "display: flex !important; align-items: center !important; gap: 3px !important; padding: 2px 6px !important; border-radius: 4px !important; background: rgba(255,255,255,0.06) !important; font-size: 10px !important; color: #94a3b8 !important; white-space: nowrap !important;"
		chip.textContent = `${icon} ${text}`
		parent.appendChild(chip)
	}

	function buildBoxModelDiagram(info) {
		const wrap = el("div")
		wrap.style.cssText = "position: relative !important; width: 240px !important; height: 150px !important; font-family: ui-monospace, monospace !important; font-size: 9px !important; color: #e2e8f0 !important;"

		const marginBox = el("div")
		marginBox.style.cssText = "position: absolute !important; inset: 0 !important; background: rgba(249, 115, 22, 0.15) !important; border: 1px dashed rgba(249, 115, 22, 0.5) !important; border-radius: 4px !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important;"

		addBoxLabel(marginBox, "top", info.margin.top, "#fb923c")
		addBoxLabel(marginBox, "right", info.margin.right, "#fb923c")
		addBoxLabel(marginBox, "bottom", info.margin.bottom, "#fb923c")
		addBoxLabel(marginBox, "left", info.margin.left, "#fb923c")

		const borderBox = el("div")
		borderBox.style.cssText = "position: absolute !important; inset: 18px !important; background: rgba(250, 204, 21, 0.12) !important; border: 1px solid rgba(250, 204, 21, 0.5) !important; border-radius: 3px !important;"
		addBoxLabel(borderBox, "top", info.border.top, "#facc15")
		addBoxLabel(borderBox, "right", info.border.right, "#facc15")
		addBoxLabel(borderBox, "bottom", info.border.bottom, "#facc15")
		addBoxLabel(borderBox, "left", info.border.left, "#facc15")

		const paddingBox = el("div")
		paddingBox.style.cssText = "position: absolute !important; inset: 32px !important; background: rgba(34, 197, 94, 0.12) !important; border: 1px solid rgba(34, 197, 94, 0.4) !important; border-radius: 2px !important;"
		addBoxLabel(paddingBox, "top", info.padding.top, "#4ade80")
		addBoxLabel(paddingBox, "right", info.padding.right, "#4ade80")
		addBoxLabel(paddingBox, "bottom", info.padding.bottom, "#4ade80")
		addBoxLabel(paddingBox, "left", info.padding.left, "#4ade80")

		const contentBox = el("div")
		contentBox.style.cssText = "position: absolute !important; inset: 46px !important; background: rgba(59, 130, 246, 0.2) !important; border: 1px solid rgba(59, 130, 246, 0.5) !important; border-radius: 2px !important; display: flex !important; align-items: center !important; justify-content: center !important;"
		const contentLabel = el("span")
		contentLabel.textContent = `${info.width} × ${info.height}`
		contentLabel.style.cssText = "font-size: 10px !important; color: #93c5fd !important; font-weight: 600 !important;"
		contentBox.appendChild(contentLabel)

		const marLabel = el("span")
		marLabel.textContent = "margin"
		marLabel.style.cssText = "position: absolute !important; top: 2px !important; left: 4px !important; font-size: 8px !important; color: #fb923c !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
		marginBox.appendChild(marLabel)

		const borLabel = el("span")
		borLabel.textContent = "border"
		borLabel.style.cssText = "position: absolute !important; top: 2px !important; left: 4px !important; font-size: 8px !important; color: #facc15 !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
		borderBox.appendChild(borLabel)

		const padLabel = el("span")
		padLabel.textContent = "padding"
		padLabel.style.cssText = "position: absolute !important; top: 1px !important; left: 3px !important; font-size: 8px !important; color: #4ade80 !important; text-transform: uppercase !important; letter-spacing: 0.03em !important;"
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
		if (node === shadowHost || node.id === "devkit-shadow-host" || node.closest?.(".dk-root, #devkit-shadow-host")) return
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

		return formatHtml(clone.outerHTML)
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

		const processNode = (el, depth) => {
			if (!(el instanceof Element) || depth > 6) return
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
		inspectorDrawer.style.cssText += "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; color: #e2e8f0 !important;"
		getShadowRoot().appendChild(inspectorDrawer)

		const header = el("div")
		header.style.cssText = "display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 16px 20px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; flex-shrink: 0 !important;"
		const titleArea = el("div")
		const title = el("h3")
		title.textContent = "Element Inspector"
		title.style.cssText = "margin: 0 !important; font-size: 15px !important; font-weight: 700 !important; color: #f8fafc !important;"
		const subtitle = el("div")
		subtitle.textContent = `<${node.tagName.toLowerCase()}>${node.id ? "#" + node.id : ""} — ${selector.slice(0, 50)}`
		subtitle.style.cssText = "margin-top: 3px !important; font-size: 11px !important; color: #64748b !important; font-family: ui-monospace, monospace !important;"
		titleArea.append(title, subtitle)
		const closeBtn = el("button")
		closeBtn.textContent = "✕"
		closeBtn.type = "button"
		closeBtn.style.cssText = "background: rgba(255,255,255,0.06) !important; color: #94a3b8 !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 6px !important; width: 32px !important; height: 32px !important; font-size: 14px !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;"
		closeBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			hideInspectorDrawer()
		})
		header.append(titleArea, closeBtn)
		inspectorDrawer.appendChild(header)

		const tabBar = el("div")
		tabBar.style.cssText = "display: flex !important; gap: 0 !important; padding: 0 20px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; flex-shrink: 0 !important;"
		const tabs = ["HTML", "CSS", "Copy", "Box Model", "Data"]
		const tabPanels = []
		const tabBtns = []
		for (const tabName of tabs) {
			const btn = el("button")
			btn.type = "button"
			btn.textContent = tabName
			btn.style.cssText = "padding: 10px 14px !important; font-size: 12px !important; font-weight: 600 !important; background: none !important; border: none !important; border-bottom: 2px solid transparent !important; color: #64748b !important; cursor: pointer !important; transition: all 0.15s !important;"
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
				btn.style.borderBottomColor = i === idx ? "#3b82f6" : "transparent"
				btn.style.color = i === idx ? "#f8fafc" : "#64748b"
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
		langLabel.style.cssText = "font-size: 11px !important; font-weight: 700 !important; color: #60a5fa !important; text-transform: uppercase !important; letter-spacing: 0.05em !important;"
		const copyBtn = el("button")
		copyBtn.type = "button"
		copyBtn.textContent = "📋 Copy"
		copyBtn.style.cssText = "background: rgba(59, 130, 246, 0.15) !important; color: #93c5fd !important; border: 1px solid rgba(59, 130, 246, 0.3) !important; border-radius: 6px !important; padding: 5px 12px !important; font-size: 11px !important; cursor: pointer !important; font-weight: 600 !important;"
		copyBtn.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			copy(code)
			copyBtn.textContent = "✓ Copied!"
			setTimeout(() => { copyBtn.textContent = "📋 Copy" }, 1500)
		})
		toolbar.append(langLabel, copyBtn)
		panel.appendChild(toolbar)

		const pre = el("pre")
		pre.style.cssText = "background: rgba(0,0,0,0.3) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 14px 16px !important; font-size: 12px !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; line-height: 1.5 !important; overflow-x: auto !important; white-space: pre-wrap !important; word-break: break-word !important; color: #e2e8f0 !important; max-height: 500px !important;"
		pre.textContent = code
		panel.appendChild(pre)
		return panel
	}

	function buildCopyPanel(cleanHtml, cleanCss, node) {
		const panel = el("div")
		const desc = el("p")
		desc.textContent = "One-click copy in multiple formats. Click any button to copy to clipboard."
		desc.style.cssText = "font-size: 12px !important; color: #64748b !important; margin: 0 0 14px 0 !important;"
		panel.appendChild(desc)

		const htmlCss = `<!-- Component extracted by Sidekick -->\n<style>\n${cleanCss}\n</style>\n\n${cleanHtml}`
		addCopyButton(panel, "📄 HTML + CSS (self-contained)", htmlCss, "Complete snippet ready to paste into a new HTML file")

		const styles = extractCleanCss(node)
		const twClasses = cssToTailwindInline(node ? Object.fromEntries(
			["display", "position", "flex-direction", "justify-content", "align-items", "gap",
			"margin", "padding", "width", "height", "font-size", "font-weight",
			"text-align", "text-transform", "border-radius", "overflow", "cursor"]
			.map((p) => [p, getComputedStyle(node).getPropertyValue(p)])
			.filter(([, v]) => v)
		) : {})
		addCopyButton(panel, "🎨 Tailwind Classes", twClasses.join(" "), "Mapped Tailwind v3 utility classes for this element")

		const cssVars = extractCssVarsFromNode(node)
		addCopyButton(panel, "🎯 CSS Variables / Tokens", cssVars, "Design tokens extracted as CSS custom properties")

		const jsxCode = htmlToJsxInline(cleanHtml)
		const jsxFull = `function Component() {\n\treturn (\n${jsxCode.split("\n").map((l) => "\t\t" + l).join("\n")}\n\t)\n}`
		addCopyButton(panel, "⚛️ React / JSX Skeleton", jsxFull, "JSX component skeleton with className, self-closing tags")

		const vueSfc = `<template>\n${cleanHtml.split("\n").map((l) => "\t" + l).join("\n")}\n</template>\n\n<script setup>\n</script>\n\n<style scoped>\n${cleanCss}\n</style>`
		addCopyButton(panel, "💚 Vue SFC Skeleton", vueSfc, "Single-file component for Vue 3 with scoped styles")

		const aiPrompt = generateAiPromptInline(cleanHtml, cleanCss, node)
		addCopyButton(panel, "🤖 AI-Ready Prompt", aiPrompt, "Structured prompt for ChatGPT/Claude/Copilot to recreate this component")

		return panel
	}

	function addCopyButton(parent, label, content, description) {
		const card = el("div")
		card.style.cssText = "background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 12px 14px !important; margin-bottom: 8px !important; cursor: pointer !important; transition: all 0.15s !important;"
		card.addEventListener("mouseenter", () => { card.style.borderColor = "rgba(59,130,246,0.4)" })
		card.addEventListener("mouseleave", () => { card.style.borderColor = "rgba(255,255,255,0.06)" })
		const row = el("div")
		row.style.cssText = "display: flex !important; justify-content: space-between !important; align-items: center !important;"
		const labelEl = el("span")
		labelEl.textContent = label
		labelEl.style.cssText = "font-size: 13px !important; font-weight: 600 !important; color: #f1f5f9 !important;"
		const badge = el("span")
		badge.textContent = "Copy"
		badge.style.cssText = "font-size: 10px !important; font-weight: 600 !important; padding: 3px 8px !important; border-radius: 4px !important; background: rgba(59,130,246,0.15) !important; color: #60a5fa !important;"
		row.append(labelEl, badge)
		const descEl = el("div")
		descEl.textContent = description
		descEl.style.cssText = "font-size: 11px !important; color: #64748b !important; margin-top: 4px !important;"
		card.append(row, descEl)
		card.addEventListener("click", (e) => {
			e.preventDefault()
			e.stopPropagation()
			copy(content)
			badge.textContent = "✓ Copied!"
			badge.style.color = "#34d399"
			badge.style.background = "rgba(16,185,129,0.15)"
			setTimeout(() => {
				badge.textContent = "Copy"
				badge.style.color = "#60a5fa"
				badge.style.background = "rgba(59,130,246,0.15)"
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
		title.style.cssText = "margin: 0 0 12px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f8fafc !important;"
		panel.appendChild(title)

		const diagram = buildBoxModelDiagram(info)
		diagram.style.cssText += "width: 320px !important; height: 200px !important; margin: 0 auto !important;"
		panel.appendChild(diagram)

		if (data?.typography) {
			const typTitle = el("h4")
			typTitle.textContent = "Typography"
			typTitle.style.cssText = "margin: 20px 0 8px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f8fafc !important;"
			panel.appendChild(typTitle)
			const typGrid = el("div")
			typGrid.style.cssText = "display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px !important;"
			for (const [key, value] of Object.entries(data.typography)) {
				if (!value || value === "normal" || value === "none") continue
				const cell = el("div")
				cell.style.cssText = "display: flex !important; justify-content: space-between !important; padding: 4px 8px !important; background: rgba(255,255,255,0.03) !important; border-radius: 4px !important; font-size: 11px !important;"
				const k = el("span")
				k.textContent = key.replace(/([A-Z])/g, "-$1").toLowerCase()
				k.style.cssText = "color: #64748b !important;"
				const v = el("span")
				v.textContent = String(value).slice(0, 30)
				v.style.cssText = "color: #e2e8f0 !important; font-family: ui-monospace, monospace !important; font-size: 10px !important;"
				cell.append(k, v)
				typGrid.appendChild(cell)
			}
			panel.appendChild(typGrid)
		}

		if (data?.colors) {
			const colTitle = el("h4")
			colTitle.textContent = "Colors & Contrast"
			colTitle.style.cssText = "margin: 20px 0 8px 0 !important; font-size: 13px !important; font-weight: 700 !important; color: #f8fafc !important;"
			panel.appendChild(colTitle)
			const colGrid = el("div")
			colGrid.style.cssText = "display: flex !important; gap: 8px !important; flex-wrap: wrap !important;"
			for (const [key, value] of Object.entries(data.colors)) {
				if (!value || key === "contrast") continue
				const swatch = el("div")
				swatch.style.cssText = `display: flex !important; align-items: center !important; gap: 6px !important; padding: 6px 10px !important; background: rgba(255,255,255,0.03) !important; border-radius: 6px !important; cursor: pointer !important;`
				const dot = el("span")
				dot.style.cssText = `width: 16px !important; height: 16px !important; border-radius: 4px !important; background: ${value} !important; border: 1px solid rgba(255,255,255,0.15) !important; flex-shrink: 0 !important;`
				const info2 = el("div")
				const label = el("div")
				label.textContent = key
				label.style.cssText = "font-size: 10px !important; color: #64748b !important;"
				const val = el("div")
				val.textContent = value
				val.style.cssText = "font-size: 11px !important; font-family: ui-monospace, monospace !important; color: #e2e8f0 !important;"
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
				contrastBadge.textContent = `Contrast: ${ratio}:1 ${pass ? "✓ AA" : "✗ Fail"}`
				contrastBadge.style.cssText = `padding: 6px 12px !important; border-radius: 6px !important; font-size: 12px !important; font-weight: 600 !important; background: ${pass ? "rgba(16,185,129,0.12)" : "rgba(248,113,113,0.12)"} !important; color: ${pass ? "#34d399" : "#f87171"} !important;`
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
			highlight.style.border = "2px dashed #f59e0b !important"
			highlight.style.background = "rgba(245, 158, 11, 0.08) !important"
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
			highlight.style.border = "2px solid #3b82f6 !important"
			highlight.style.background = "rgba(59, 130, 246, 0.08) !important"
		}
		if (inspectorDrawer) showInspectorDrawer(componentBoundary)
		updateFloatingCta("Sidekick: Inspector", `Contracted to <${componentBoundary.tagName.toLowerCase()}>`)
	}

	let measureState = { active: false, first: null, line: null, label: null }

	function toggleMeasureMode() {
		measureState.active = !measureState.active
		if (measureState.active) {
			measureState.first = null
			showFloatingCta("Sidekick: Measure", "Click first element, then second to measure distance", () => toggleMeasureMode())
			document.addEventListener("click", onMeasureClick, true)
		} else {
			document.removeEventListener("click", onMeasureClick, true)
			if (measureState.line?.parentNode) measureState.line.parentNode.removeChild(measureState.line)
			if (measureState.label?.parentNode) measureState.label.parentNode.removeChild(measureState.label)
			measureState = { active: false, first: null, line: null, label: null }
			hideFloatingCta()
		}
	}

	function onMeasureClick(event) {
		if (!measureState.active) return
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element)) return
		event.preventDefault()
		event.stopPropagation()

		if (!measureState.first) {
			measureState.first = node
			updateFloatingCta("Sidekick: Measure", `First: <${node.tagName.toLowerCase()}> — now click second element`)
		} else {
			const r1 = measureState.first.getBoundingClientRect()
			const r2 = node.getBoundingClientRect()
			const cx1 = r1.left + r1.width / 2
			const cy1 = r1.top + r1.height / 2
			const cx2 = r2.left + r2.width / 2
			const cy2 = r2.top + r2.height / 2
			const dist = Math.round(Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2))
			const dx = Math.abs(Math.round(cx2 - cx1))
			const dy = Math.abs(Math.round(cy2 - cy1))

			ensureStyles()
			if (measureState.line?.parentNode) measureState.line.parentNode.removeChild(measureState.line)
			const line = document.createElementNS("http://www.w3.org/2000/svg", "svg")
			line.setAttribute("class", "dk-root")
			line.style.cssText = "position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; pointer-events: none !important; z-index: 2147483645 !important;"
			const svgLine = document.createElementNS("http://www.w3.org/2000/svg", "line")
			svgLine.setAttribute("x1", cx1)
			svgLine.setAttribute("y1", cy1)
			svgLine.setAttribute("x2", cx2)
			svgLine.setAttribute("y2", cy2)
			svgLine.setAttribute("stroke", "#f59e0b")
			svgLine.setAttribute("stroke-width", "2")
			svgLine.setAttribute("stroke-dasharray", "6 3")
			line.appendChild(svgLine)
			getShadowRoot().appendChild(line)
			measureState.line = line

			if (measureState.label?.parentNode) measureState.label.parentNode.removeChild(measureState.label)
			const lbl = el("div", "dk-root")
			lbl.style.cssText = `position: fixed !important; z-index: 2147483646 !important; top: ${Math.min(cy1, cy2) + Math.abs(cy2 - cy1) / 2 - 12}px !important; left: ${Math.min(cx1, cx2) + Math.abs(cx2 - cx1) / 2 + 8}px !important; background: rgba(15,23,42,0.95) !important; color: #fbbf24 !important; padding: 4px 10px !important; border-radius: 6px !important; font-size: 12px !important; font-weight: 600 !important; font-family: ui-monospace, monospace !important; border: 1px solid rgba(245,158,11,0.4) !important; pointer-events: none !important;`
			lbl.textContent = `${dist}px (↔${dx} ↕${dy})`
			getShadowRoot().appendChild(lbl)
			measureState.label = lbl

			updateFloatingCta("Sidekick: Measure", `Distance: ${dist}px (↔${dx} ↕${dy}) — click new pair or close`)
			measureState.first = null
		}
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
			toggleMeasureMode()
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
			showFloatingCta("Sidekick: Element Inspector", "Hover to preview • Click for full report • [ ] expand/contract • M measure • X x-ray", () => setInspect(false))
		} else {
			document.removeEventListener("mousemove", onMove, true)
			document.removeEventListener("click", onClickInspect, true)
			document.removeEventListener("keydown", onInspectKeyDown, true)
			if (highlight?.parentNode) highlight.parentNode.removeChild(highlight)
			highlight = null
			inspectedNode = null
			componentBoundary = null
			hideHud()
			hideInspectorDrawer()
			hideFloatingCta()
			if (measureState.active) toggleMeasureMode()
		}
		return state.inspect
	}

	function copy(text) {
		try {
			navigator.clipboard?.writeText(text)
		} catch {

		}
	}

	function toggleGrid() {
		state.grid = !state.grid
		let grid = document.querySelector(".dk-grid") || getShadowRoot()?.querySelector?.(".dk-grid")
		if (state.grid && !grid) {
			grid = el("div", "dk-grid")
			getShadowRoot().appendChild(grid)
			showFloatingCta("Sidekick: Layout Grid", "8px Baseline Grid active", () => toggleGrid())
		} else if (!state.grid && grid) {
			grid.remove()
			hideFloatingCta()
		}
		return state.grid
	}

	function toggleOutline() {
		state.outline = !state.outline
		ensureStyles()
		document.documentElement.classList.toggle("dk-outline-all", state.outline)
		if (state.outline) {
			showFloatingCta("Sidekick: CSS Outlines", "All DOM elements outlined", () => toggleOutline())
		} else {
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
		updateEditOverlay()
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
			editHighlightBox.innerHTML = `
				<div class="dk-edit-handle dk-edit-handle-tl" style="position: absolute !important; top: -5px !important; left: -5px !important; width: 8px !important; height: 8px !important; background: #ffffff !important; border: 2px solid #3b82f6 !important; border-radius: 1px !important; pointer-events: none !important;"></div>
				<div class="dk-edit-handle dk-edit-handle-tr" style="position: absolute !important; top: -5px !important; right: -5px !important; width: 8px !important; height: 8px !important; background: #ffffff !important; border: 2px solid #3b82f6 !important; border-radius: 1px !important; pointer-events: none !important;"></div>
				<div class="dk-edit-handle dk-edit-handle-bl" style="position: absolute !important; bottom: -5px !important; left: -5px !important; width: 8px !important; height: 8px !important; background: #ffffff !important; border: 2px solid #3b82f6 !important; border-radius: 1px !important; pointer-events: none !important;"></div>
				<div class="dk-edit-handle dk-edit-handle-br" style="position: absolute !important; bottom: -5px !important; right: -5px !important; width: 8px !important; height: 8px !important; background: #ffffff !important; border: 2px solid #3b82f6 !important; border-radius: 1px !important; pointer-events: none !important;"></div>
			`
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
		editHighlightBox.style.cssText = `position: fixed !important; top: ${rect.top}px !important; left: ${rect.left}px !important; width: ${rect.width}px !important; height: ${rect.height}px !important; z-index: 2147483645 !important; pointer-events: auto !important; border: 2px solid #3b82f6 !important; background: rgba(59, 130, 246, 0.12) !important; border-radius: 2px !important; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 20px rgba(59, 130, 246, 0.5) !important; cursor: grab !important; box-sizing: border-box !important; display: block !important;`

		if (!editToolbar) {
			editToolbar = el("div", "dk-edit-toolbar")
			getShadowRoot().appendChild(editToolbar)
		}
		const topPos = Math.max(8, rect.top - 48)
		const leftPos = Math.max(8, Math.min(window.innerWidth - 520, rect.left))
		editToolbar.style.cssText = `position: fixed !important; top: ${topPos}px !important; left: ${leftPos}px !important; z-index: 2147483646 !important; display: flex !important; align-items: center !important; gap: 4px !important; background: #0b1120 !important; background: rgba(11, 17, 32, 0.98) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1.5px solid #3b82f6 !important; border-radius: 8px !important; padding: 5px 8px !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 15px rgba(59, 130, 246, 0.3) !important; font-size: 11.5px !important; pointer-events: auto !important; white-space: nowrap !important; max-width: 95vw !important; overflow-x: auto !important;`

		editToolbar.innerHTML = ""

		function makeEditBtn(text, title, onClick, isDragGrip = false, isDelete = false) {
			const btn = el("button", "dk-edit-btn" + (isDragGrip ? " dk-drag-grip" : "") + (isDelete ? " dk-delete" : ""))
			btn.type = "button"
			btn.textContent = text
			btn.title = title
			const bg = isDelete ? "rgba(239, 68, 68, 0.2)" : isDragGrip ? "rgba(59, 130, 246, 0.25)" : "rgba(255, 255, 255, 0.1)"
			const color = isDelete ? "#fca5a5" : isDragGrip ? "#93c5fd" : "#f1f5f9"
			const border = isDelete ? "1px solid rgba(239, 68, 68, 0.4)" : isDragGrip ? "1px solid rgba(59, 130, 246, 0.5)" : "1px solid rgba(255, 255, 255, 0.2)"
			btn.style.cssText = `background: ${bg} !important; color: ${color} !important; border: ${border} !important; border-radius: 4px !important; padding: 4px 8px !important; font-size: 11px !important; cursor: ${isDragGrip ? "grab" : "pointer"} !important; font-weight: 600 !important; display: inline-flex !important; align-items: center !important; gap: 3px !important; user-select: none !important; line-height: 1.2 !important; white-space: nowrap !important;`
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
			breadcrumbWrap.style.cssText = "display: inline-flex !important; align-items: center !important; gap: 2px !important; margin-right: 4px !important; padding-right: 6px !important; border-right: 1px solid rgba(255, 255, 255, 0.15) !important;"
			chain.forEach((anc, idx) => {
				const isCurrent = anc === editSelectedElement
				const ancTag = anc.tagName.toLowerCase()
				const ancCls = typeof anc.className === "string" && anc.classList.length ? `.${anc.classList[0]}` : ""
				const crumbBtn = el("button", "dk-crumb-btn")
				crumbBtn.type = "button"
				crumbBtn.title = `Select <${ancTag}${ancCls}>`
				crumbBtn.textContent = `<${ancTag}${ancCls}>`
				crumbBtn.style.cssText = `background: ${isCurrent ? "rgba(59, 130, 246, 0.3)" : "rgba(255, 255, 255, 0.06)"} !important; color: ${isCurrent ? "#93c5fd" : "#94a3b8"} !important; border: 1px solid ${isCurrent ? "#3b82f6" : "rgba(255, 255, 255, 0.1)"} !important; border-radius: 3px !important; padding: 2px 6px !important; font-size: 10.5px !important; font-family: ui-monospace, monospace !important; cursor: pointer !important; font-weight: ${isCurrent ? "700" : "500"} !important;`
				crumbBtn.addEventListener("click", (e) => {
					e.preventDefault()
					e.stopPropagation()
					selectEditElement(anc)
				})
				breadcrumbWrap.appendChild(crumbBtn)
				if (idx < chain.length - 1) {
					const sep = el("span", "")
					sep.textContent = "›"
					sep.style.cssText = "color: #64748b !important; font-size: 11px !important; margin: 0 1px !important;"
					breadcrumbWrap.appendChild(sep)
				}
			})
			editToolbar.appendChild(breadcrumbWrap)
		} else {
			const tagLabel = el("span", "dk-edit-tag-label")
			tagLabel.style.cssText = "color: #60a5fa !important; font-weight: 700 !important; font-size: 11px !important; text-transform: uppercase !important; padding: 2px 6px !important; font-family: ui-monospace, SFMono-Regular, monospace !important; letter-spacing: 0.3px !important; white-space: nowrap !important;"
			const idStr = editSelectedElement.id ? `#${editSelectedElement.id}` : ""
			const classStr = typeof editSelectedElement.className === "string" && editSelectedElement.classList.length ? `.${editSelectedElement.classList[0]}` : ""
			tagLabel.textContent = `<${editSelectedElement.tagName.toLowerCase()}${idStr || classStr}>`
			editToolbar.appendChild(tagLabel)
		}

		if (editSelectedElement.parentElement && editSelectedElement.parentElement !== document.body && editSelectedElement.parentElement !== document.documentElement) {
			const parentTag = editSelectedElement.parentElement.tagName.toLowerCase()
			const parentBtn = makeEditBtn(`▲ Parent (${parentTag})`, "Select parent container div/section", () => {
				selectEditElement(editSelectedElement.parentElement)
			})
			editToolbar.appendChild(parentBtn)
		}

		if (editSelectedElement.firstElementChild) {
			const childBtn = makeEditBtn("▼ Child", "Select first child element inside this container", () => {
				selectEditElement(editSelectedElement.firstElementChild)
			})
			editToolbar.appendChild(childBtn)
		}

		const gripBtn = makeEditBtn("⠿ Drag", "Click & hold to drag element anywhere on page", null, true)
		editToolbar.appendChild(gripBtn)

		const editTextBtn = makeEditBtn("✏️ Edit", "Edit copy/text directly (or double click element)", () => {
			enableTextEdit(editSelectedElement)
		})
		editToolbar.appendChild(editTextBtn)

		const dupBtn = makeEditBtn("⧉ Duplicate", "Duplicate component block", () => {
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

		const moveUpBtn = makeEditBtn("▲ Up", "Move element before previous sibling in DOM", () => {
			if (editSelectedElement?.previousElementSibling) {
				editSelectedElement.parentNode.insertBefore(editSelectedElement, editSelectedElement.previousElementSibling)
				updateEditOverlay()
				updateFloatingCta("Sidekick: Design & Move", "Element moved up")
			}
		})
		editToolbar.appendChild(moveUpBtn)

		const moveDownBtn = makeEditBtn("▼ Down", "Move element after next sibling in DOM", () => {
			if (editSelectedElement?.nextElementSibling) {
				editSelectedElement.parentNode.insertBefore(editSelectedElement.nextElementSibling, editSelectedElement)
				updateEditOverlay()
				updateFloatingCta("Sidekick: Design & Move", "Element moved down")
			}
		})
		editToolbar.appendChild(moveDownBtn)

		const resetBtn = makeEditBtn("↺ Reset", "Reset moved position to original (0, 0)", () => {
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

		const delBtn = makeEditBtn("🗑", "Delete element (or press Del key)", () => {
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
			`Selected <${target.tagName.toLowerCase()}> (X: ${dx}px, Y: ${dy}px) · Drag to move · ▲ Parent for container · Double-click to edit text`
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
			editHoverBox.style.cssText = "position: fixed !important; z-index: 2147483643 !important; pointer-events: none !important; border: 2px dashed #3b82f6 !important; background: rgba(59, 130, 246, 0.08) !important; border-radius: 3px !important; transition: none !important; box-sizing: border-box !important;"
			const badge = el("div", "dk-hover-badge")
			badge.style.cssText = "position: absolute !important; top: -20px !important; left: -2px !important; background: #3b82f6 !important; color: #ffffff !important; font-size: 10.5px !important; font-family: ui-monospace, monospace !important; font-weight: 700 !important; padding: 1px 6px !important; border-radius: 3px !important; pointer-events: none !important; white-space: nowrap !important; line-height: 1.4 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;"
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

	function onEditScroll() {
		if (state.edit && editSelectedElement) {
			updateEditOverlay()
		}
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
				"Figma Mode active · Hover/click any element · Use '▲ Parent' for containers · Drag to move · Esc to deselect",
				() => toggleEdit()
			)
		} else {
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
			window.removeEventListener("resize", paintBadge)
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
		window.addEventListener("resize", paintBadge)
		showFloatingCta(
			"Sidekick: Viewport Sizer",
			"Live viewport HUD active · Resize browser window to test breakpoints",
			() => toggleViewport()
		)
		return true
	}

	function bucket(width) {
		if (width < 480) return "xs (mobile)"
		if (width < 768) return "sm"
		if (width < 1024) return "md (tablet)"
		if (width < 1280) return "lg"
		return "xl (desktop)"
	}

	function paintBadge() {
		if (!badge) return
		badge.innerHTML = ""
		badge.style.cssText = "position: fixed !important; top: 16px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 2147483647 !important; display: inline-flex !important; align-items: center !important; gap: 10px !important; background: #0b1120 !important; background: rgba(11, 17, 32, 0.96) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1.5px solid #3b82f6 !important; border-radius: 9999px !important; padding: 8px 18px !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(59, 130, 246, 0.4) !important; font-size: 13px !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; color: #ffffff !important; pointer-events: auto !important; line-height: 1 !important; white-space: nowrap !important; box-sizing: border-box !important;"

		const dot = el("span", "dk-badge-dot")
		dot.style.cssText = "width: 8px !important; height: 8px !important; border-radius: 50% !important; background: #10b981 !important; box-shadow: 0 0 8px #10b981 !important; flex-shrink: 0 !important;"

		const dims = el("span", "dk-badge-dims")
		dims.style.cssText = "font-weight: 700 !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; color: #ffffff !important; font-size: 13.5px !important; letter-spacing: 0.3px !important;"
		dims.textContent = `${window.innerWidth} × ${window.innerHeight} px`

		const tag = el("span", "dk-badge-tag")
		tag.style.cssText = "background: rgba(59, 130, 246, 0.25) !important; border: 1px solid rgba(59, 130, 246, 0.5) !important; color: #93c5fd !important; border-radius: 9999px !important; padding: 2px 8px !important; font-size: 11px !important; font-weight: 600 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important;"
		tag.textContent = bucket(window.innerWidth)

		const dpr = el("span", "dk-badge-dpr")
		dpr.style.cssText = "color: #94a3b8 !important; font-size: 12px !important; border-left: 1px solid rgba(255, 255, 255, 0.2) !important; padding-left: 8px !important;"
		dpr.textContent = `DPR ${window.devicePixelRatio}`

		const closeBtn = el("button", "dk-badge-close")
		closeBtn.type = "button"
		closeBtn.textContent = "✕"
		closeBtn.title = "Close Viewport Badge"
		closeBtn.style.cssText = "background: rgba(239, 68, 68, 0.2) !important; border: 1px solid rgba(239, 68, 68, 0.4) !important; border-radius: 9999px !important; color: #fca5a5 !important; cursor: pointer !important; font-size: 11px !important; font-weight: 700 !important; padding: 3px 8px !important; line-height: 1 !important; margin-left: 6px !important; display: inline-flex !important; align-items: center !important;"
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

	function auditA11y() {
		const issues = []
		const add = (severity, rule, message, node) =>
			issues.push({ severity, rule, message, selector: node ? cssPath(node) : undefined })

		for (const img of document.images) {
			if (!img.hasAttribute("alt")) add("serious", "image-alt", "Image missing alt attribute", img)
		}
		for (const control of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
			const labelled =
				control.labels?.length ||
				control.getAttribute("aria-label") ||
				control.getAttribute("aria-labelledby") ||
				control.getAttribute("title")
			if (!labelled) add("critical", "form-label", "Form control has no accessible name", control)
		}
		for (const button of document.querySelectorAll("button, [role=button], a")) {
			const name = (button.textContent || "").trim() || button.getAttribute("aria-label") || button.querySelector("img[alt]")?.alt
			if (!name) add("serious", "control-name", "Interactive control has no visible or ARIA name", button)
		}
		let previous = 0
		for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
			const level = Number(heading.tagName[1])
			if (previous && level - previous > 1) add("moderate", "heading-order", `Heading jumps h${previous} → h${level}`, heading)
			previous = level
		}
		if (document.querySelectorAll("h1").length !== 1) add("moderate", "page-has-h1", "Page should have exactly one h1")
		if (!document.documentElement.lang) add("serious", "html-lang", "<html> is missing a lang attribute")
		for (const node of [...document.querySelectorAll("p,span,a,li,button,h1,h2,h3")].slice(0, 400)) {
			if (!node.textContent.trim()) continue
			const style = getComputedStyle(node)
			if (style.visibility === "hidden" || style.display === "none") continue
			const ratio = contrast(style.color, effectiveBackground(node))
			const size = parseFloat(style.fontSize)
			const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
			if (ratio !== null && ratio < (large ? 3 : 4.5)) {
				add("serious", "color-contrast", `Contrast ${ratio}:1 below WCAG AA`, node)
			}
		}
		for (const node of document.querySelectorAll("[tabindex]")) {
			if (Number(node.getAttribute("tabindex")) > 0) add("minor", "tabindex", "Positive tabindex breaks natural focus order", node)
		}
		enhancedA11yChecks(issues, add)
		const summary = issues.reduce((acc, issue) => ({ ...acc, [issue.severity]: (acc[issue.severity] ?? 0) + 1 }), {})
		return { total: issues.length, summary, issues: issues.slice(0, 200) }
	}

	function auditSeo() {
		const meta = (name) =>
			document.querySelector(`meta[name="${name}"]`)?.content ||
			document.querySelector(`meta[property="${name}"]`)?.content ||
			null
		const title = document.title || ""
		const description = meta("description") || ""
		const warnings = []
		if (!title) warnings.push("Missing <title>")
		else if (title.length > 60) warnings.push(`Title is ${title.length} chars (aim for <= 60)`)
		if (!description) warnings.push("Missing meta description")
		else if (description.length > 160) warnings.push(`Description is ${description.length} chars (aim for <= 160)`)
		if (!document.querySelector("link[rel=canonical]")) warnings.push("Missing canonical link")
		if (!meta("og:title")) warnings.push("Missing og:title")
		if (!meta("og:image")) warnings.push("Missing og:image")
		if (!meta("viewport")) warnings.push("Missing viewport meta — page is not mobile ready")
		const images = [...document.images]
		return {
			title,
			titleLength: title.length,
			description,
			canonical: document.querySelector("link[rel=canonical]")?.href ?? null,
			robots: meta("robots"),
			viewport: meta("viewport"),
			openGraph: { title: meta("og:title"), description: meta("og:description"), image: meta("og:image") },
			headings: {
				h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()).slice(0, 10),
				counts: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`h${n}`, document.querySelectorAll(`h${n}`).length])),
			},
			images: { total: images.length, missingAlt: images.filter((i) => !i.alt).length },
			structuredData: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
			hreflang: [...document.querySelectorAll("link[rel=alternate][hreflang]")].map((l) => l.hreflang),
			warnings,
		}
	}

	async function scanLinks() {
		const links = [...document.querySelectorAll("a")]
		const problems = []
		const checkedUrls = new Set()
		const brokenLinks = []
		for (const link of links) {
			const href = link.getAttribute("href")
			if (href === null || href.trim() === "" || href === "#") {
				problems.push({ issue: "empty or hash href", selector: cssPath(link), text: (link.textContent || "").trim().slice(0, 40) })
			} else if (href.startsWith("javascript:")) {
				problems.push({ issue: "javascript: link", selector: cssPath(link) })
			} else if (location.protocol === "https:" && href.startsWith("http:")) {
				problems.push({ issue: "mixed content link", href, selector: cssPath(link) })
			}
			if (link.target === "_blank" && !/noopener/.test(link.rel)) {
				problems.push({ issue: "target=_blank without rel=noopener", selector: cssPath(link) })
			}
		}
		const candidateLinks = links
			.map((l) => l.href)
			.filter((h) => h && h.startsWith(location.origin) && !checkedUrls.has(h))
			.slice(0, 30)
		for (const url of candidateLinks) {
			checkedUrls.add(url)
			try {
				const res = await fetch(url, { method: "HEAD" }).catch(() => fetch(url, { method: "GET" }))
				if (res && res.status >= 400) {
					brokenLinks.push({ url, status: res.status, statusText: res.statusText })
				}
			} catch {

			}
		}
		const brokenImages = [...document.images]
			.filter((img) => img.complete && img.naturalWidth === 0)
			.map((img) => ({ src: img.currentSrc || img.src, selector: cssPath(img), alt: img.alt || null }))
		return { links: links.length, images: document.images.length, brokenLinks, brokenImages, problems: problems.slice(0, 200) }
	}

	function metrics() {
		const nav = performance.getEntriesByType("navigation")[0]
		const resources = performance.getEntriesByType("resource")
		const bytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0)
		const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]))
		const byType = {}
		for (const resource of resources) {
			const key = resource.initiatorType || "other"
			byType[key] = (byType[key] ?? 0) + 1
		}

		let lcp = null
		try {
			const lcpEntries = performance.getEntriesByType("largest-contentful-paint")
			if (lcpEntries.length) lcp = Math.round(lcpEntries[lcpEntries.length - 1].startTime)
		} catch {  }

		let cls = null
		try {
			const layoutShifts = performance.getEntriesByType("layout-shift")
			if (layoutShifts.length) {
				cls = Math.round(layoutShifts.reduce((sum, e) => sum + (e.hadRecentInput ? 0 : e.value), 0) * 1000) / 1000
			}
		} catch {  }

		let longTasks = null
		try {
			const lt = performance.getEntriesByType("longtask")
			if (lt.length) longTasks = { count: lt.length, totalMs: Math.round(lt.reduce((s, t) => s + t.duration, 0)) }
		} catch {  }

		const largest = [...resources]
			.filter((r) => r.transferSize > 0)
			.sort((a, b) => b.transferSize - a.transferSize)
			.slice(0, 5)
			.map((r) => ({ name: r.name.split("/").pop().split("?")[0], size: `${Math.round(r.transferSize / 1024)} KB`, type: r.initiatorType }))

		return {
			url: location.href,
			readyState: document.readyState,
			navigationType: nav?.type ?? null,
			ttfbMs: nav ? Math.round(nav.responseStart) : null,
			domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
			loadMs: nav ? Math.round(nav.loadEventEnd) : null,
			paints,
			lcpMs: lcp,
			cls,
			longTasks,
			resourceCount: resources.length,
			transferBytes: bytes,
			transferReadable: bytes > 1048576 ? `${Math.round((bytes / 1048576) * 10) / 10} MB` : `${Math.round((bytes / 1024) * 10) / 10} KB`,
			resourcesByType: byType,
			largestResources: largest,
			domNodes: document.getElementsByTagName("*").length,
			iframes: document.querySelectorAll("iframe").length,
			eventListeners: document.querySelectorAll("[onclick],[onmouseover],[onkeydown]").length,
		}
	}

	function storageDump() {
		const read = (store) => {
			const out = {}
			try {
				for (let i = 0; i < store.length; i += 1) {
					const key = store.key(i)
					out[key] = String(store.getItem(key)).slice(0, 500)
				}
			} catch (error) {
				out.__error = error.message
			}
			return out
		}
		return {
			localStorage: read(window.localStorage),
			sessionStorage: read(window.sessionStorage),
			cookies: document.cookie ? document.cookie.split(";").map((c) => c.trim()) : [],
		}
	}

	function fontsReport() {
		const seen = new Map()
		for (const node of [...document.querySelectorAll("body *")].slice(0, 3000)) {
			const text = node.textContent?.trim()
			if (!text) continue
			const style = getComputedStyle(node)
			const primaryFamily = style.fontFamily.split(",")[0].replace(/["']/g, "").trim()
			const fullFamily = style.fontFamily.replace(/["']/g, "").trim()
			const fontSize = style.fontSize
			const fontWeight = style.fontWeight
			const lineHeight = style.lineHeight === "normal" ? "1.5" : style.lineHeight
			const key = `${primaryFamily} | ${fontSize} | ${fontWeight} | ${lineHeight}`

			if (!seen.has(key)) {
				const sample = text.length > 35 ? text.slice(0, 35) + "…" : text
				seen.set(key, {
					style: key,
					family: primaryFamily,
					fullFamily,
					size: fontSize,
					weight: fontWeight,
					lineHeight,
					sampleText: sample,
					count: 0,
				})
			}
			const entry = seen.get(key)
			entry.count++
		}
		return [...seen.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, 40)
	}

	let colorCanvasCtx = null
	function normalizeCssColor(colorStr) {
		if (!colorStr || colorStr === "transparent" || colorStr === "inherit" || colorStr === "initial" || colorStr === "currentColor") return null
		if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(colorStr)) return null
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
			if (a === 0 && !colorStr.toLowerCase().includes("black")) return null
			const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
			const rgb = a < 255 ? `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(2))})` : `rgb(${r}, ${g}, ${b})`
			return { hex, rgb, raw: colorStr, alpha: a / 255 }
		} catch {
			const fallbackHex = toHex(colorStr)
			return { hex: fallbackHex, rgb: colorStr, raw: colorStr, alpha: 1 }
		}
	}

	function colorReport() {
		const seen = new Map()
		for (const node of [...document.querySelectorAll("body *")].slice(0, 3000)) {
			const style = getComputedStyle(node)
			for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.outlineColor]) {
				if (!value || /rgba\(0,\s*0,\s*0,\s*0\)/.test(value)) continue
				const norm = normalizeCssColor(value)
				if (!norm) continue
				const key = norm.hex.toLowerCase()
				if (!seen.has(key)) {
					seen.set(key, { hex: key, rgb: norm.rgb, raw: norm.raw, count: 0 })
				}
				seen.get(key).count++
			}
		}
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
		showFloatingCta(
			"Sidekick: Color Eyedropper",
			"Hover any element to preview color • Click to sample and copy HEX • Esc to cancel",
			() => stopInPageEyedropper()
		)
		return { ok: true, data: { status: "active", message: "Color eyedropper active on page. Hover any element to preview color, click to sample & copy." } }
	}

	function stopInPageEyedropper() {
		if (!eyedropperActive && !eyedropperBadge) return
		eyedropperActive = false
		document.removeEventListener("mousemove", onEyedropperMove, true)
		document.removeEventListener("click", onEyedropperClick, true)
		document.removeEventListener("keydown", onEyedropperKeyDown, true)
		if (eyedropperBadge?.parentNode) eyedropperBadge.parentNode.removeChild(eyedropperBadge)
		eyedropperBadge = null
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
		const node = event.target
		if (!(node instanceof Element)) return

		const style = getComputedStyle(node)
		const bg = effectiveBackground(node)
		const hasBg = bg && bg !== "transparent" && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)
		const sampleColor = hasBg ? bg : style.color
		const hex = toHex(sampleColor)

		if (!eyedropperBadge) {
			eyedropperBadge = el("div", "dk-eyedropper-badge dk-root")
			eyedropperBadge.style.cssText = "position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important; display: flex !important; align-items: center !important; gap: 8px !important; background: rgba(15, 23, 42, 0.95) !important; color: #f8fafc !important; padding: 5px 10px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.2) !important; font-size: 11px !important; font-family: ui-monospace, monospace !important; font-weight: 700 !important; box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important; transform: translate(16px, 16px) !important; transition: transform 0.05s ease-out !important;"
			const swatchDot = el("span", "dk-eyedropper-dot")
			swatchDot.style.cssText = "width: 14px !important; height: 14px !important; border-radius: 4px !important; border: 1px solid rgba(255,255,255,0.4) !important; flex-shrink: 0 !important;"
			const hexText = el("span", "dk-eyedropper-text")
			eyedropperBadge.append(swatchDot, hexText)
			getShadowRoot().appendChild(eyedropperBadge)
		}

		eyedropperBadge.style.display = "flex"
		eyedropperBadge.style.top = `${event.clientY}px`
		eyedropperBadge.style.left = `${event.clientX}px`
		const dot = eyedropperBadge.querySelector(".dk-eyedropper-dot")
		const txt = eyedropperBadge.querySelector(".dk-eyedropper-text")
		if (dot) dot.style.background = hex
		if (txt) txt.textContent = hex

		ensureStyles()
		const rect = node.getBoundingClientRect()
		if (!highlight) {
			highlight = el("div", "dk-highlight")
			getShadowRoot().appendChild(highlight)
		}
		highlight.style.cssText = `
			position: fixed !important;
			z-index: 2147483645 !important;
			pointer-events: none !important;
			border: 2px solid #3b82f6 !important;
			background: rgba(59, 130, 246, 0.08) !important;
			border-radius: 3px !important;
			top: ${Math.round(rect.top)}px !important;
			left: ${Math.round(rect.left)}px !important;
			width: ${Math.max(2, Math.round(rect.width))}px !important;
			height: ${Math.max(2, Math.round(rect.height))}px !important;
			display: block !important;
			box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 0 16px rgba(59, 130, 246, 0.35) !important;
		`
	}

	function onEyedropperClick(event) {
		if (!eyedropperActive) return
		if (isDevKitEvent(event)) return
		const node = event.target
		if (!(node instanceof Element)) return
		if (node === shadowHost || node.id === "devkit-shadow-host" || node.closest?.(".dk-root, #devkit-shadow-host")) return

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

		window.__devkitEyedropperResult = { hex, rgb, copied: true }
	}

	function openEyeDropper() {
		return startInPageEyedropper()
	}

	function zIndexScan() {
		return [...document.querySelectorAll("body *")]
			.map((node) => {
				const style = getComputedStyle(node)
				return { node, z: parseInt(style.zIndex, 10), position: style.position }
			})
			.filter((item) => Number.isFinite(item.z))
			.sort((a, b) => b.z - a.z)
			.slice(0, 25)
			.map((item) => ({ zIndex: item.z, selector: cssPath(item.node), position: item.position }))
	}

	function detectStack() {
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
			window.__NEXT_DATA__,
		)
		check("React", () =>
			found.includes("Next.js") ||
			found.includes("Remix") ||
			found.includes("Gatsby") ||
			scriptList.some((s) => s.includes("react") || s.includes("react-dom")) ||
			document.querySelector("[data-reactroot], #__next, [data-react-helmet]") ||
			[...document.querySelectorAll("body, body *")].slice(0, 100).some((el) =>
				Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")),
			),
		)
		check("Remix", () =>
			scriptList.some((s) => s.includes("/build/") && s.includes("entry.client")) ||
			window.__remixContext ||
			document.querySelector("script[data-remix]"),
		)
		check("Gatsby", () => document.querySelector("#___gatsby") || window.___gatsby)
		check("Vue", () =>
			scriptList.some((s) => s.includes("vue")) ||
			window.Vue ||
			document.querySelector("[data-v-app], [data-v-]"),
		)
		check("Nuxt", () =>
			scriptList.some((s) => s.includes("/_nuxt/")) ||
			window.__NUXT__ ||
			document.querySelector("#__nuxt"),
		)
		check("Angular", () =>
			scriptList.some((s) => s.includes("angular")) ||
			window.ng ||
			document.querySelector("[ng-version]"),
		)
		check("Svelte", () =>
			scriptList.some((s) => s.includes("/_app/immutable/")) ||
			document.querySelector("[class*='svelte-'], [data-sveltekit]"),
		)
		check("Preact", () =>
			scriptList.some((s) => s.includes("preact")) ||
			window.preact ||
			document.querySelector("[data-preact]"),
		)
		check("Solid", () => window._$HY || document.querySelector("[data-hk]"))
		check("Lit", () => document.querySelector("[_$litType$]"))
		check("Alpine.js", () => window.Alpine || document.querySelector("[x-data]"))
		check("htmx", () =>
			scriptList.some((s) => s.includes("htmx")) ||
			window.htmx ||
			document.querySelector("[hx-get], [hx-post]"),
		)
		check("Astro", () =>
			scriptList.some((s) => s.includes("astro")) ||
			document.querySelector("[data-astro-cid], astro-island, astro-slot"),
		)
		check("jQuery", () => scriptList.some((s) => s.includes("jquery")) || window.jQuery)

		check("Tailwind CSS", () =>
			document.querySelector("[class*='dark:'], [class*='md:'], [class*='sm:'], [class*='lg:'], [class*='text-['], [class*='bg-['], [class*='space-y-'], [class*='space-x-']") ||
			[...document.styleSheets].some((s) => {
				try { return (s.href || "").includes("tailwind") } catch { return false }
			}),
		)
		check("Radix UI", () =>
			Boolean(document.querySelector("[data-radix-collection-item], [data-state][data-orientation], [data-radix-popper-content-wrapper]")),
		)
		check("Bootstrap", () =>
			document.querySelector("[class*='container-fluid'], .navbar, [class*='col-md-']") ||
			[...document.styleSheets].some((s) => (s.href || "").includes("bootstrap")),
		)
		check("Material UI", () => Boolean(document.querySelector("[class*='MuiBox-'], [class*='MuiButton-'], [class*='MuiTypography-']")))
		check("Lucide Icons", () => Boolean(document.querySelector("svg.lucide, [class*='lucide-']")))
		check("Font Awesome", () =>
			Boolean(document.querySelector("[class*='fa-'], [class*='fas '], [class*='fab '], link[href*='font-awesome']")),
		)
		check("Framer Motion", () => Boolean(document.querySelector("[data-framer-component-type], [style*='--framer-']")))
		check("GSAP", () => scriptList.some((s) => s.includes("gsap")) || window.gsap)
		check("Three.js", () => scriptList.some((s) => s.includes("three")) || window.THREE)

		check("Google Tag Manager", () =>
			scriptList.some((s) => s.includes("googletagmanager.com/gtm.js")) ||
			domainList.includes("www.googletagmanager.com") ||
			window.google_tag_manager,
		)
		check("Google Analytics", () =>
			scriptList.some((s) => s.includes("google-analytics.com") || s.includes("googletagmanager.com/gtag")) ||
			window.gtag ||
			window.dataLayer,
		)
		check("Meta (Facebook) Pixel", () =>
			scriptList.some((s) => s.includes("connect.facebook.net")) ||
			domainList.includes("connect.facebook.net") ||
			window.fbq,
		)
		check("Twitter (X) Ads", () =>
			scriptList.some((s) => s.includes("static.ads-twitter.com")) ||
			domainList.includes("static.ads-twitter.com") ||
			window.twq,
		)
		check("Sentry", () => scriptList.some((s) => s.includes("sentry")) || window.Sentry || window.__SENTRY__)
		check("Hotjar", () => scriptList.some((s) => s.includes("static.hotjar.com")) || window.hj)
		check("Segment", () => scriptList.some((s) => s.includes("cdn.segment.com")) || window.analytics?.identify)
		check("PostHog", () => scriptList.some((s) => s.includes("posthog")) || window.posthog)

		check("Clerk", () =>
			scriptList.some((s) => s.includes("clerk")) ||
			domainList.some((d) => d.includes("clerk")),
		)
		check("Stripe", () =>
			scriptList.some((s) => s.includes("js.stripe.com")) ||
			domainList.includes("js.stripe.com") ||
			window.Stripe,
		)
		check("Tolt", () =>
			domainList.some((d) => d.includes("tolt.io")) ||
			scriptList.some((s) => s.includes("tolt")),
		)
		check("Intercom", () =>
			scriptList.some((s) => s.includes("widget.intercom.io")) ||
			domainList.includes("widget.intercom.io") ||
			window.Intercom,
		)

		check("WordPress", () => document.querySelector("meta[name='generator'][content*='WordPress']") || window.wp)
		check("Shopify", () => window.Shopify)

		check("Webpack", () =>
			scriptList.some((s) => s.includes("webpack") || s.includes("chunks/")) ||
			window.webpackChunk ||
			window.webpackJsonp,
		)
		check("Vite", () =>
			scriptList.some((s) => s.includes("/@vite/") || s.includes("vite/")) ||
			document.querySelector("script[type='module'][src*='/@vite']"),
		)
		check("Turbopack", () =>
			scriptList.some((s) => s.includes("turbopack")) ||
			window.__turbopack_require__,
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
			"Remix": { category: "Framework", icon: "💿" },
			"Astro": { category: "Framework", icon: "🚀" },
			"Preact": { category: "Framework", icon: "⚛" },
			"Solid": { category: "Framework", icon: "🔷" },
			"Lit": { category: "Framework", icon: "🔥" },
			"Alpine.js": { category: "Framework", icon: "🏔" },
			"htmx": { category: "Framework", icon: "⚡" },
			"jQuery": { category: "Library", icon: "💲" },
			"Tailwind CSS": { category: "CSS & UI", icon: "🌊" },
			"Radix UI": { category: "CSS & UI", icon: "🧩" },
			"Bootstrap": { category: "CSS & UI", icon: "🅱" },
			"Material UI": { category: "CSS & UI", icon: "Ⓜ" },
			"Lucide Icons": { category: "Icons & Media", icon: "✨" },
			"Font Awesome": { category: "Icons & Media", icon: "🚩" },
			"Framer Motion": { category: "Animation", icon: "🎬" },
			"GSAP": { category: "Animation", icon: "🟩" },
			"Three.js": { category: "3D & Graphics", icon: "🔺" },
			"Google Tag Manager": { category: "Analytics & Tagging", icon: "🏷" },
			"Google Analytics": { category: "Analytics", icon: "📊" },
			"Meta (Facebook) Pixel": { category: "Advertising", icon: "♾" },
			"Twitter (X) Ads": { category: "Advertising", icon: "🐦" },
			"Clerk": { category: "Authentication", icon: "🔐" },
			"Stripe": { category: "Payments", icon: "💳" },
			"Tolt": { category: "Affiliate Tracking", icon: "🤝" },
			"Sentry": { category: "Monitoring & Errors", icon: "🛡" },
			"Hotjar": { category: "Analytics & Heatmaps", icon: "🔥" },
			"Segment": { category: "Customer Data", icon: "🔀" },
			"PostHog": { category: "Product Analytics", icon: "🦔" },
			"WordPress": { category: "CMS", icon: "📝" },
			"Shopify": { category: "E-Commerce", icon: "🛍" },
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
		if (!(node instanceof Element) || node === shadowHost || node.id === "devkit-shadow-host" || node.closest?.(".dk-root, #devkit-shadow-host")) return
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

		window.__devkitDeepResult = data
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
			}
		} catch {  }

		const transitioned = []
		for (const node of [...document.querySelectorAll("body *")].slice(0, 2000)) {
			const style = getComputedStyle(node)
			if (style.animationName && style.animationName !== "none") {
				transitioned.push({
					selector: cssPath(node),
					animationName: style.animationName,
					animationDuration: style.animationDuration,
					animationTimingFunction: style.animationTimingFunction,
					animationIterationCount: style.animationIterationCount,
				})
			}
		}

		return {
			activeAnimations: allAnimations,
			activeCount: allAnimations.length,
			elementsWithCssAnimation: transitioned.slice(0, 50),
		}
	}

	function scanEventListeners() {
		const results = []
		const attrs = [
			"onclick", "onmouseover", "onmouseout", "onmousedown", "onmouseup", "onmousemove",
			"onkeydown", "onkeyup", "onkeypress", "onfocus", "onblur",
			"onchange", "oninput", "onsubmit", "onscroll", "onresize",
			"ontouchstart", "ontouchend", "ontouchmove", "onwheel", "ondrag", "ondrop",
			"onload", "onerror", "onplay", "onpause",
		]

		for (const node of [...document.querySelectorAll("body *")].slice(0, 3000)) {
			const events = []
			for (const attr of attrs) {
				if (node.hasAttribute(attr) || typeof node[attr] === "function") {
					events.push(attr.replace("on", ""))
				}
			}

			const fw = getFrameworkBindings(node)
			if (events.length || fw.length) {
				results.push({
					selector: cssPath(node),
					tag: node.tagName.toLowerCase(),
					inlineEvents: events,
					frameworkBindings: fw,
				})
			}
		}

		const byEventType = {}
		for (const r of results) {
			for (const e of r.inlineEvents) byEventType[e] = (byEventType[e] ?? 0) + 1
		}

		return {
			elementsWithListeners: results.length,
			byEventType,
			details: results.slice(0, 100),
		}
	}

	function enhancedA11yChecks(issues, add) {

		if (!document.querySelector("main")) add("moderate", "landmark-main", "Page has no <main> landmark")
		if (!document.querySelector("nav")) add("minor", "landmark-nav", "Page has no <nav> landmark")

		const skipLink = document.querySelector("a[href='#main-content'], a[href='#content'], a.skip-link, a.skip-to-content")
		if (!skipLink) add("minor", "skip-link", "No skip-to-content link found")

		for (const media of document.querySelectorAll("video[autoplay], audio[autoplay]")) {
			if (!media.muted) add("serious", "autoplay-muted", "Autoplaying media without muted attribute", media)
		}

		for (const el of document.querySelectorAll("*:focus")) {
			const style = getComputedStyle(el)
			if (style.outlineStyle === "none" && style.boxShadow === "none") {
				add("moderate", "focus-visible", "Focused element has no visible focus indicator", el)
			}
		}
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
				return "#3b82f6"
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
				grad.addColorStop(0, "#3B82F6")
				grad.addColorStop(1, "#1D4ED8")
				ctx.fillStyle = grad
				ctx.fillRect(0, 0, 400, 300)

				ctx.fillStyle = "rgba(255, 255, 255, 0.2)"
				ctx.beginPath()
				ctx.arc(200, 110, 45, 0, Math.PI * 2)
				ctx.fill()

				ctx.fillStyle = "#FFFFFF"
				ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
				ctx.textAlign = "center"
				ctx.fillText("SAMPLE PROPERTY IMAGE", 200, 190)
				ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
				ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
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

	function stopFormFiller() {
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
			.filter(el => !el.closest('#dk-floating-cta, #dk-hud, .dk-overlay, [class*="dk-"], [id*="dk-"]'))
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
			.filter(el => !el.closest('#dk-floating-cta, #dk-hud, .dk-overlay, [class*="dk-"], [id*="dk-"]'))
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
			.filter(el => !el.closest('#dk-floating-cta, #dk-hud, .dk-overlay, [class*="dk-"], [id*="dk-"]'))
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
			.filter(el => !el.closest('#dk-floating-cta, #dk-hud, .dk-overlay, [class*="dk-"], [id*="dk-"]'))
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
				while (stepsRemaining > 0) {
					stepsRemaining--
					const nextBtn = findNextButton()
					if (!nextBtn) break
					simulatePlaywrightClick(nextBtn)
					currentStep++
					await new Promise((r) => setTimeout(r, 650))
					const newCount = await fillFormStep(isClear, isEdgeCase, payload, filledList)
					totalFilled += newCount
					if (newCount === 0) break
				}
				updateFloatingCta("Form Auto-Filler", `${totalFilled} field${totalFilled === 1 ? "" : "s"} filled across ${currentStep} steps`)
			})()
		}

		if (isWatchSteps && !isClear) {
			let debounce = null
			formStepObserver = new MutationObserver(() => {
				clearTimeout(debounce)
				debounce = setTimeout(async () => {
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

		return {
			ok: true,
			data: {
				fieldsFilled: totalFilled,
				stepsNavigated: currentStep,
				mode,
				profile,
				sampleFields: filledList.slice(0, 60),
				message: `Successfully populated ${totalFilled} fields${currentStep > 1 ? ` across ${currentStep} steps` : ""}. Click '✕ Close Tool' on page when done.`,
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

	function requestScreenshot() {
		return new Promise((resolve, reject) => {
			try {
				runtime.runtime.sendMessage({ type: "screenshot" }, (response) => {
					if (runtime.runtime.lastError) {
						reject(new Error(runtime.runtime.lastError.message))
						return
					}
					if (!response?.ok) {
						reject(new Error(response?.error ?? "Screenshot failed"))
						return
					}
					resolve(response.dataUrl)
				})
			} catch (err) {
				reject(err)
			}
		})
	}

	function dataUrlToImageEl(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => resolve(img)
			img.onerror = () => reject(new Error("Failed to decode screenshot"))
			img.src = dataUrl
		})
	}

	function cropDataUrl(dataUrl, x, y, w, h, dpr) {
		return new Promise(async (resolve, reject) => {
			try {
				const img = await dataUrlToImageEl(dataUrl)
				const canvas = document.createElement("canvas")
				canvas.width = Math.round(w * dpr)
				canvas.height = Math.round(h * dpr)
				const ctx = canvas.getContext("2d")
				ctx.drawImage(
					img,
					Math.round(x * dpr), Math.round(y * dpr),
					Math.round(w * dpr), Math.round(h * dpr),
					0, 0,
					Math.round(w * dpr), Math.round(h * dpr)
				)
				resolve(canvas.toDataURL("image/png"))
			} catch (err) {
				reject(err)
			}
		})
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
				"✂️ Snipping Tool",
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

		const fixedEls = []
		try {
			const all = document.querySelectorAll("body *")
			for (const node of all) {
				if (isDevKitNode(node)) continue
				const pos = getComputedStyle(node).position
				if (pos === "fixed" || pos === "sticky") {
					fixedEls.push({ node, orig: node.style.cssText })
					node.style.setProperty("visibility", "hidden", "important")
				}
			}
		} catch {  }

		const totalChunks = Math.ceil(fullH / viewH)
		const canvas = document.createElement("canvas")
		canvas.width = Math.round(fullW * dpr)
		canvas.height = Math.round(fullH * dpr)
		const ctx = canvas.getContext("2d")

		showFloatingCta(
			"📸 Full Page Capture",
			`Capturing… 0/${totalChunks} sections · Esc to cancel`,
			() => { cancelled = true }
		)

		try {
			for (let i = 0; i < totalChunks; i++) {
				if (cancelled) break

				const scrollY = i * viewH
				window.scrollTo(0, scrollY)

				await new Promise(r => setTimeout(r, 250))

				if (cancelled) break

				updateFloatingCta(
					"📸 Full Page Capture",
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

			window.scrollTo(savedX, savedY)
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
			height: Math.round(fullH * dpr),
			mode: "Full page (scroll)",
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

	function stopAllActiveTools() {
		if (state.inspect) setInspect(false)
		if (state.grid) toggleGrid()
		if (state.outline) toggleOutline()
		if (state.edit) toggleEdit()
		if (state.viewport) toggleViewport()
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
		viewport: () => ({ ok: true, data: { enabled: toggleViewport(), width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } }),
		"viewport-query": () => ({ ok: true, data: { enabled: state.viewport, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } }),
		eyedropper: () => openEyeDropper(),
		"start-eyedropper": () => startInPageEyedropper(),
		"stop-eyedropper": () => {
			stopInPageEyedropper()
			return { ok: true }
		},
		"audit-a11y": () => ({ ok: true, data: auditA11y() }),
		"audit-seo": () => ({ ok: true, data: auditSeo() }),
		"scan-links": async () => ({ ok: true, data: await scanLinks() }),
		metrics: () => ({ ok: true, data: metrics() }),
		storage: () => ({ ok: true, data: storageDump() }),
		"storage-clear": () => {
			localStorage.clear()
			sessionStorage.clear()
			return { ok: true, data: "Local and session storage cleared" }
		},
		fonts: () => ({ ok: true, data: fontsReport() }),
		colors: () => ({ ok: true, data: colorReport() }),
		"console-log": () => ({ ok: true, data: getRecentLogs(100) }),
		zindex: () => ({ ok: true, data: zIndexScan() }),
		stack: () => ({ ok: true, data: detectStack() }),
		"capture-context": () => ({ ok: true, data: pageContext() }),
		"deep-inspect": () => ({ ok: true, data: { enabled: setInspect() } }),
		"scan-animations": () => ({ ok: true, data: scanAnimations() }),
		"scan-events": () => ({ ok: true, data: scanEventListeners() }),
		"fill-form": (payload) => fillForm(payload),
		snip: (payload) => handleSnip(payload),
		"stop-tool": () => stopAllActiveTools(),
		"hide-hud": () => {
			hideHud()
			return { ok: true }
		},
		"highlight-element": (payload) => highlightElement(payload),
	}

	runtime.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
	})
})()
