// Declared in the manifests for the page's MAIN world at document_start, because the isolated
// content script cannot see page console calls or page JavaScript objects. It must stay cheap:
// it buffers console errors and warnings, uncaught errors, rejections, failed resource loads
// and CSP violations in a capped ring buffer. Probing page globals and framework bindings, and
// recording fetch and XHR calls, run only when the isolated script asks through DOM CustomEvents.
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
	const STACK_LEN = 1800
	const buffer = new Array(CAP)
	let head = 0
	let size = 0
	let total = 0
	let errorCount = 0

	function describe(value) {
		if (typeof value === "string") return value
		if (value === null || value === undefined || typeof value !== "object") return String(value)
		if (value instanceof Error) {
			const stack = typeof value.stack === "string" ? value.stack : ""
			const head = `${value.name}: ${value.message}`
			return stack ? (stack.startsWith(head) ? stack : `${head}\n${stack}`).split("\n").slice(0, 12).join("\n").slice(0, STACK_LEN) : head
		}
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
		const text = String(message)
		const entry = { level, message: text.slice(0, /\n\s+at |@\S+:\d+/.test(text) ? STACK_LEN : MAX_LEN), at: new Date().toISOString() }
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
			const stack = event.error instanceof Error && typeof event.error.stack === "string" ? `\n${event.error.stack.split("\n").slice(0, 12).join("\n")}` : ""
			push("error", `${event.message || describe(event.error)}${where}${stack}`, { source: (event.filename || "").slice(0, 300) })
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

	function componentInfo(node) {
		const components = []
		let source = null
		let keys = []
		try {
			keys = Object.keys(node)
		} catch {}
		const fiberKey = keys.find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"))
		if (fiberKey) {
			let fiber = node[fiberKey]
			for (let depth = 0; fiber && depth < 40 && components.length < 6; depth++) {
				const type = fiber.type
				let name = null
				if (typeof type === "function") name = type.displayName || type.name
				else if (type && typeof type === "object") name = type.displayName || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name
				if (name && !/^(?:Anonymous|_c\d*)$/.test(name) && !components.includes(name)) components.push(name)
				if (!source && fiber._debugSource?.fileName) source = `${fiber._debugSource.fileName}:${fiber._debugSource.lineNumber ?? ""}`
				fiber = fiber.return
			}
			return { framework: "React", components, source }
		}
		let vue = node.__vueParentComponent
		if (vue) {
			for (let depth = 0; vue && depth < 20 && components.length < 6; depth++) {
				const type = vue.type || {}
				const name = type.name || type.__name || (type.__file ? type.__file.split("/").pop().replace(/\.vue$/, "") : null)
				if (name && !components.includes(name)) components.push(name)
				if (!source && type.__file) source = type.__file
				vue = vue.parent
			}
			return { framework: "Vue", components, source }
		}
		if (node.__vue__) {
			let vm = node.__vue__
			for (let depth = 0; vm && depth < 20 && components.length < 6; depth++) {
				const name = vm.$options?.name || vm.$options?._componentTag
				if (name && !components.includes(name)) components.push(name)
				if (!source && vm.$options?.__file) source = vm.$options.__file
				vm = vm.$parent
			}
			return { framework: "Vue 2", components, source }
		}
		for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
			if (el.__svelte_meta?.loc?.file) return { framework: "Svelte", components, source: `${el.__svelte_meta.loc.file}:${(el.__svelte_meta.loc.line ?? 0) + 1}` }
		}
		try {
			const ng = window.ng
			const component = ng?.getOwningComponent?.(node) || ng?.getComponent?.(node)
			if (component) return { framework: "Angular", components: [component.constructor?.name].filter(Boolean), source }
		} catch {}
		return null
	}

	const NET_CAP = 120
	const BODY_LEN = 3000
	const net = []
	let netArmed = false

	function recordNet(entry) {
		net.push(entry)
		if (net.length > NET_CAP) net.splice(0, net.length - NET_CAP)
	}

	function bodyText(body) {
		if (body === undefined || body === null) return undefined
		if (typeof body === "string") return body.slice(0, BODY_LEN)
		if (body instanceof URLSearchParams) return body.toString().slice(0, BODY_LEN)
		if (typeof FormData !== "undefined" && body instanceof FormData) {
			const fields = []
			for (const [key, value] of body.entries()) fields.push(`${key}=${typeof value === "string" ? value.slice(0, 200) : `[file ${value.name}]`}`)
			return `[form data] ${fields.join("&")}`.slice(0, BODY_LEN)
		}
		if (typeof Blob !== "undefined" && body instanceof Blob) return `[blob ${body.type || "binary"}, ${body.size} bytes]`
		if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[binary ${body.byteLength} bytes]`
		return `[${Object.prototype.toString.call(body).slice(8, -1)}]`
	}

	function readable(type) {
		return /json|text|xml|problem|html|javascript/i.test(type || "") && !/event-stream|ndjson|x-ndjson|stream/i.test(type || "")
	}

	async function readCapped(response, max = BODY_LEN) {
		const reader = response.body?.getReader()
		if (!reader) return ""
		const decoder = new TextDecoder()
		let text = ""
		try {
			while (text.length < max) {
				const { done, value } = await reader.read()
				if (done) break
				text += decoder.decode(value, { stream: true })
			}
		} finally {
			reader.cancel().catch(() => {})
		}
		return text.slice(0, max)
	}

	function armNetwork() {
		if (netArmed) return
		netArmed = true
		const nativeFetch = window.fetch
		if (typeof nativeFetch === "function") {
			window.fetch = new Proxy(nativeFetch, {
				apply(target, thisArg, args) {
					const started = performance.now()
					const at = Date.now()
					let method = "GET"
					let url = ""
					let requestBody
					try {
						const [input, init] = args
						const request = typeof Request !== "undefined" && input instanceof Request ? input : null
						method = String(init?.method || request?.method || "GET").toUpperCase()
						url = new URL(String(request ? request.url : input), location.href).href
						requestBody = bodyText(init?.body)
					} catch {}
					const pending = Reflect.apply(target, thisArg, args)
					try {
						pending.then(
							(response) => {
								try {
									const entry = { at, kind: "fetch", method, url, status: response.status, ms: Math.round(performance.now() - started), requestBody }
									recordNet(entry)
									if (!response.ok && readable(response.headers.get("content-type"))) {
										readCapped(response.clone()).then((text) => (entry.responseBody = text), () => {})
									}
								} catch {}
							},
							(error) => {
								try {
									recordNet({ at, kind: "fetch", method, url, status: 0, error: String(error?.message || error).slice(0, 300), ms: Math.round(performance.now() - started), requestBody })
								} catch {}
							},
						)
					} catch {}
					return pending
				},
			})
		}
		const proto = window.XMLHttpRequest?.prototype
		if (proto) {
			const meta = new WeakMap()
			proto.open = new Proxy(proto.open, {
				apply(target, thisArg, args) {
					try {
						let url = String(args[1])
						try {
							url = new URL(url, location.href).href
						} catch {}
						meta.set(thisArg, { method: String(args[0] || "GET").toUpperCase(), url })
					} catch {}
					return Reflect.apply(target, thisArg, args)
				},
			})
			proto.send = new Proxy(proto.send, {
				apply(target, thisArg, args) {
					try {
						const info = meta.get(thisArg) || { method: "GET", url: "" }
						const started = performance.now()
						const at = Date.now()
						const requestBody = bodyText(args[0])
						thisArg.addEventListener("loadend", () => {
							try {
								const entry = { at, kind: "xhr", method: info.method, url: info.url, status: thisArg.status, ms: Math.round(performance.now() - started), requestBody }
								if (thisArg.status === 0) entry.error = "network error, CORS block or aborted"
								if (thisArg.status >= 400 && (thisArg.responseType === "" || thisArg.responseType === "text")) entry.responseBody = String(thisArg.responseText || "").slice(0, BODY_LEN)
								recordNet(entry)
							} catch {}
						}, { once: true })
					} catch {}
					return Reflect.apply(target, thisArg, args)
				},
			})
		}
	}

	document.addEventListener("sidekick:net-arm", () => {
		armNetwork()
		reply("sidekick:net-armed", { armed: netArmed })
	})
	document.addEventListener("sidekick:net-request", () => reply("sidekick:net-response", { armed: netArmed, entries: net }))

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
			if (request.component && event.target && event.target.nodeType === 1) {
				result.component = componentInfo(event.target)
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
