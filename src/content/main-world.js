// Declared in the manifests for the page's MAIN world at document_start, because the isolated
// content script cannot see page console calls or page JavaScript objects. It must stay cheap:
// it only buffers console errors and warnings, uncaught errors, rejections, failed resource loads
// and CSP violations in a capped ring buffer. Probing page globals and framework bindings runs
// only when the isolated script asks for it through DOM CustomEvents.
;(() => {
	const KEY = Symbol.for("sidekick.mainWorld")
	if (window[KEY]) return
	try {
		Object.defineProperty(window, KEY, { value: true })
	} catch {
		return
	}

	const CAP = 300
	const MAX_LEN = 600
	const buffer = new Array(CAP)
	let head = 0
	let size = 0
	let total = 0
	let errorCount = 0

	function describe(value) {
		if (typeof value === "string") return value
		if (value === null || value === undefined || typeof value !== "object") return String(value)
		if (value instanceof Error) return `${value.name}: ${value.message}`
		if (typeof Element !== "undefined" && value instanceof Element) {
			return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ""}>`
		}
		try {
			const text = JSON.stringify(value)
			return text === undefined ? String(value) : text.slice(0, MAX_LEN)
		} catch {
			return Object.prototype.toString.call(value)
		}
	}

	function push(level, message, extra) {
		const entry = { level, message: String(message).slice(0, MAX_LEN), at: new Date().toISOString() }
		if (extra) Object.assign(entry, extra)
		buffer[head] = entry
		head = (head + 1) % CAP
		if (size < CAP) size++
		total++
		if (level !== "warn") errorCount++
	}

	for (const level of ["error", "warn"]) {
		const original = console[level]
		if (typeof original !== "function") continue
		console[level] = function sidekickConsole(...args) {
			try {
				push(level, args.map(describe).join(" "))
			} catch {}
			return original.apply(this, args)
		}
	}

	window.addEventListener(
		"error",
		(event) => {
			const target = event.target
			if (target && target !== window && target.tagName) {
				const url = target.currentSrc || target.src || target.href || ""
				push("resource", `Failed to load <${target.tagName.toLowerCase()}> ${url}`.trim(), { source: url.slice(0, 300) })
				return
			}
			const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : ""
			push("error", `${event.message || describe(event.error)}${where}`, { source: (event.filename || "").slice(0, 300) })
		},
		true,
	)
	window.addEventListener("unhandledrejection", (event) => push("rejection", describe(event.reason)))
	document.addEventListener("securitypolicyviolation", (event) => {
		push("csp", `CSP blocked ${event.blockedURI || "inline"} (${event.effectiveDirective || event.violatedDirective})`, {
			source: (event.sourceFile || "").slice(0, 300),
		})
	})

	function reply(type, payload) {
		document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(payload) }))
	}

	function readRequest(event) {
		try {
			return typeof event.detail === "string" ? JSON.parse(event.detail) : {}
		} catch {
			return {}
		}
	}

	document.addEventListener("sidekick:console-request", (event) => {
		const { limit = 100 } = readRequest(event)
		const count = Math.min(Math.max(1, Number(limit) || 100), size)
		const start = (head - count + CAP) % CAP
		const logs = []
		for (let i = 0; i < count; i++) logs.push(buffer[(start + i) % CAP])
		reply("sidekick:console-response", { logs, total, errors: errorCount, buffered: size })
	})

	const HANDLER_PROPS = [
		"onclick", "ondblclick", "onmousedown", "onmouseup", "onmouseover", "onmouseout", "onmousemove",
		"onkeydown", "onkeyup", "onkeypress", "onfocus", "onblur", "onchange", "oninput", "onsubmit",
		"onscroll", "ontouchstart", "ontouchend", "ontouchmove", "onwheel", "onpointerdown", "onpointerup",
		"ondrag", "ondrop", "onload", "onerror",
	]

	function readGlobal(path) {
		// A trailing star matches any own window property with that prefix, e.g. webpackChunk names.
		if (String(path).endsWith("*")) {
			const prefix = String(path).slice(0, -1)
			try {
				return Object.getOwnPropertyNames(window).some((name) => name.startsWith(prefix))
			} catch {
				return false
			}
		}
		let target = window
		for (const part of String(path).split(".")) {
			if (target === null || target === undefined) return false
			try {
				target = target[part]
			} catch {
				return false
			}
		}
		return target !== undefined && target !== null && target !== false
	}

	function nodeInfo(node) {
		const frameworks = []
		const handlers = []
		let keys = []
		try {
			keys = Object.keys(node)
		} catch {}
		for (const key of keys) {
			if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
				if (!frameworks.includes("React")) frameworks.push("React")
			} else if (key.startsWith("__reactProps$")) {
				const props = node[key]
				if (props && typeof props === "object") {
					for (const prop of Object.keys(props)) {
						if (/^on[A-Z]/.test(prop) && typeof props[prop] === "function") handlers.push(`react:${prop.slice(2).toLowerCase()}`)
					}
				}
			} else if (key === "__vue__" || key === "__vue_app__" || key === "__vueParentComponent" || key === "_vnode") {
				if (!frameworks.includes("Vue")) frameworks.push("Vue")
			} else if (key === "__ngContext__") {
				if (!frameworks.includes("Angular")) frameworks.push("Angular")
			} else if (key.startsWith("__svelte")) {
				if (!frameworks.includes("Svelte")) frameworks.push("Svelte")
			} else if (key.startsWith("jQuery") && !frameworks.includes("jQuery")) {
				frameworks.push("jQuery")
			}
		}
		for (const prop of HANDLER_PROPS) {
			try {
				if (typeof node[prop] === "function") handlers.push(prop.slice(2))
			} catch {}
		}
		return { frameworks, handlers }
	}

	// The request may carry globals (names), node (true) and scan ({ limit }). Node probes are
	// dispatched on the element itself and do not bubble, so this capture listener still sees them.
	document.addEventListener(
		"sidekick:probe",
		(event) => {
			const request = readRequest(event)
			const result = {}
			if (Array.isArray(request.globals)) {
				result.globals = request.globals.slice(0, 200).filter(readGlobal)
			}
			if (request.node && event.target && event.target.nodeType === 1) {
				result.node = nodeInfo(event.target)
			}
			if (request.scan) {
				const limit = Math.min(Number(request.scan.limit) || 3000, 10000)
				const nodes = document.body ? document.body.getElementsByTagName("*") : []
				const hits = []
				const deadline = performance.now() + 150
				for (let i = 0; i < nodes.length && i < limit; i++) {
					const info = nodeInfo(nodes[i])
					if (info.frameworks.length || info.handlers.length) hits.push({ i, ...info })
					if ((i & 255) === 0 && performance.now() > deadline) {
						result.truncated = true
						break
					}
				}
				result.scan = hits
			}
			reply("sidekick:probe-result", result)
		},
		true,
	)
})()
