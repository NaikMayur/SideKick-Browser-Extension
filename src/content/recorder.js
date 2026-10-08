;(() => {
	const KEY = "__sidekickRecorder"
	if (globalThis[KEY]) return
	const ACTION_CAP = 80
	const NET_CAP = 150
	const actions = []
	const network = []
	let lastUrl = location.href
	const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="combobox"], [role="slider"], [contenteditable="true"], [onclick]'

	function push(list, cap, entry) {
		list.push(entry)
		if (list.length > cap) list.splice(0, list.length - cap)
	}

	function clip(text, max = 60) {
		return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)
	}

	function sensitive(el) {
		const type = String(el.type || "").toLowerCase()
		if (type === "password" || type === "hidden") return true
		const hint = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""} ${el.getAttribute?.("aria-label") || ""} ${el.placeholder || ""}`.toLowerCase()
		return /pass|secret|token|otp|one-time|cc-|card|cvv|cvc|ssn|\bpin\b|iban|routing|account.?number|security.?code/.test(hint)
	}

	function nameOf(el) {
		const direct = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt")
		if (direct) return clip(direct)
		const labelledby = el.getAttribute("aria-labelledby")
		if (labelledby) {
			const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
			if (text.trim()) return clip(text)
		}
		if (el.labels?.length) return clip(el.labels[0].textContent)
		if (el.placeholder) return clip(el.placeholder)
		if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return clip(el.name || el.id)
		return clip(el.innerText || el.textContent || el.value)
	}

	function roleOf(el) {
		const explicit = el.getAttribute("role")
		if (explicit) return explicit
		const tag = el.tagName.toLowerCase()
		const type = String(el.type || "").toLowerCase()
		if (tag === "a") return "link"
		if (tag === "button" || tag === "summary" || (tag === "input" && /^(button|submit|reset|image)$/.test(type))) return "button"
		if (tag === "input" && /^(checkbox|radio|range)$/.test(type)) return type === "range" ? "slider" : type
		if (tag === "select") return "combobox"
		if (tag === "input" || tag === "textarea" || el.isContentEditable) return "textbox"
		if (tag === "img") return "img"
		return tag
	}

	function stableId(id) {
		return id && !/^\d|[:]|\d{4,}|^(?:radix|headlessui|mui|react|ember|ext-gen)[-_]/i.test(id) && id.length < 60
	}

	function selectorOf(el) {
		for (const attr of ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa", "data-e2e"]) {
			const value = el.getAttribute(attr)
			if (value) return `[${attr}="${value}"]`
		}
		if (stableId(el.id)) return `#${CSS.escape(el.id)}`
		const name = el.getAttribute("name")
		if (name && /^(INPUT|SELECT|TEXTAREA|BUTTON|FORM)$/.test(el.tagName)) return `${el.tagName.toLowerCase()}[name="${name}"]`
		const parts = []
		let node = el
		for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
			let part = node.tagName.toLowerCase()
			if (stableId(node.id)) {
				parts.unshift(`#${CSS.escape(node.id)}`)
				break
			}
			const parent = node.parentElement
			if (parent) {
				const same = [...parent.children].filter((child) => child.tagName === node.tagName)
				if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
			}
			parts.unshift(part)
			node = parent
		}
		return parts.join(" > ")
	}

	function describe(el) {
		return { role: roleOf(el), name: nameOf(el), selector: selectorOf(el) }
	}

	function urlCheck() {
		if (location.href === lastUrl) return
		push(actions, ACTION_CAP, { at: Date.now(), kind: "navigate", from: lastUrl, to: location.href })
		lastUrl = location.href
	}

	function ours(node) {
		return Boolean(node?.closest?.("[data-sidekick-core]"))
	}

	function origin(event) {
		const first = event.composedPath?.()[0]
		const node = first instanceof Element ? first : event.target instanceof Element ? event.target : event.target?.parentElement
		return node instanceof Element ? node : null
	}

	document.addEventListener("click", (event) => {
		if (!event.isTrusted) return
		urlCheck()
		const start = origin(event)
		if (!start || ours(start)) return
		const el = start.closest(INTERACTIVE) || start
		if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(button|submit|reset|image|checkbox|radio)$/i.test(el.type || "")) return
		push(actions, ACTION_CAP, { at: Date.now(), kind: "click", ...describe(el) })
		setTimeout(urlCheck, 500)
	}, true)

	document.addEventListener("change", (event) => {
		if (!event.isTrusted) return
		const el = origin(event)
		if (!el || ours(el)) return
		const entry = { at: Date.now(), kind: "change", ...describe(el) }
		const type = String(el.type || "").toLowerCase()
		if (type === "checkbox" || type === "radio") entry.value = el.checked ? "checked" : "unchecked"
		else if (el.tagName === "SELECT") entry.value = clip([...el.selectedOptions].map((option) => option.text).join(", "), 80)
		else if (type === "file") entry.value = `${el.files?.length ?? 0} file(s)`
		else if (sensitive(el)) entry.value = el.value ? `•••• (${el.value.length} characters, hidden)` : "(empty)"
		else entry.value = el.value ? clip(el.value, 80) : "(empty)"
		push(actions, ACTION_CAP, entry)
	}, true)

	document.addEventListener("submit", (event) => {
		if (!event.isTrusted) return
		const form = event.target
		if (!(form instanceof Element) || ours(form)) return
		push(actions, ACTION_CAP, { at: Date.now(), kind: "submit", role: "form", name: clip(form.getAttribute("aria-label") || form.getAttribute("name") || form.querySelector("legend, h1, h2, h3")?.textContent || form.id || ""), selector: selectorOf(form), action: clip(form.getAttribute("action") || "", 120) })
		setTimeout(urlCheck, 800)
	}, true)

	document.addEventListener("keydown", (event) => {
		if (!event.isTrusted || !["Enter", "Escape"].includes(event.key) || event.isComposing) return
		const el = origin(event)
		if (el && ours(el)) return
		push(actions, ACTION_CAP, { at: Date.now(), kind: "key", key: event.key, ...(el && el !== document.body ? describe(el) : { role: "page", name: "", selector: "" }) })
		setTimeout(urlCheck, 500)
	}, true)

	window.addEventListener("popstate", urlCheck)
	window.addEventListener("hashchange", urlCheck)
	try {
		globalThis.navigation?.addEventListener?.("navigatesuccess", urlCheck)
	} catch {}

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const status = typeof entry.responseStatus === "number" ? entry.responseStatus : null
				const api = entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest" || entry.initiatorType === "beacon"
				const failed = status !== null && status >= 400
				const slow = entry.duration > 3000
				if (!api && !failed && !slow) continue
				push(network, NET_CAP, {
					at: Math.round(performance.timeOrigin + entry.startTime),
					url: entry.name,
					type: entry.initiatorType,
					status,
					ms: Math.round(entry.duration),
					bytes: entry.transferSize || entry.encodedBodySize || 0,
				})
			}
		}).observe({ type: "resource", buffered: true })
	} catch {}

	globalThis[KEY] = {
		snapshot() {
			urlCheck()
			return { pageLoadedAt: Math.round(performance.timeOrigin), actions: actions.slice(), network: network.slice() }
		},
	}
})()
