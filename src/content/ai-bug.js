;(() => {
	const MAX_STEPS = 15
	const MAX_ERRORS = 12
	const MAX_FAILED = 10
	const MAX_CALLS = 8
	const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	const B64_INDEX = Object.fromEntries([...B64].map((char, index) => [char, index]))
	const FRAME = /(?:\bat\s+(?:(.+?)\s+\()?|^\s*([^@\s]*)@)((?:https?|webpack|file):\/\/[^\s)]+?):(\d+):(\d+)\)?/gm

	function clip(text, max = 60) {
		return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)
	}

	function ago(at, now) {
		const seconds = Math.max(0, Math.round((now - at) / 1000))
		if (seconds < 60) return `${seconds}s ago`
		const minutes = Math.floor(seconds / 60)
		return `${minutes}m ${seconds % 60}s ago`
	}

	function shortUrl(url) {
		try {
			const parsed = new URL(url, location.href)
			return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}` : `${parsed.host}${parsed.pathname}${parsed.search}`
		} catch {
			return String(url ?? "")
		}
	}

	function browserOf(ua) {
		const pick = (re, name) => {
			const m = ua.match(re)
			return m ? `${name} ${m[1]}` : null
		}
		const browser = pick(/Edg\/(\d+)/, "Edge") || pick(/OPR\/(\d+)/, "Opera") || pick(/Firefox\/(\d+)/, "Firefox") || pick(/Chrome\/(\d+)/, "Chrome") || pick(/Version\/(\d+)[\d.]* .*Safari/, "Safari") || "Unknown browser"
		const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows" : /Android (\d+)/.test(ua) ? `Android ${ua.match(/Android (\d+)/)[1]}` : /(iPhone|iPad).*OS (\d+)/.test(ua) ? `iOS ${ua.match(/OS (\d+)/)[1]}` : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS"
		return `${browser} on ${os}`
	}

	function devBuild() {
		if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$|\.(local|test|localhost)$/.test(location.hostname)) return true
		return [...document.scripts].some((s) => /\/@vite\/client|webpack-dev-server|hot-update|\/_next\/static\/chunks\/webpack\.js|react-refresh/.test(s.src || ""))
	}

	function roleOf(el) {
		const explicit = el.getAttribute("role")
		if (explicit) return explicit
		const tag = el.tagName.toLowerCase()
		const type = String(el.type || "").toLowerCase()
		if (tag === "a") return "link"
		if (tag === "button" || tag === "summary" || (tag === "input" && /^(button|submit|reset|image)$/.test(type))) return "button"
		if (tag === "input" && /^(checkbox|radio)$/.test(type)) return type
		if (tag === "select") return "combobox"
		if (tag === "input" || tag === "textarea" || el.isContentEditable) return "textbox"
		if (tag === "img") return "img"
		return tag
	}

	function nameOf(el) {
		const direct = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt")
		if (direct) return clip(direct)
		if (el.labels?.length) return clip(el.labels[0].textContent)
		if (el.placeholder) return clip(el.placeholder)
		return clip(el.innerText || el.textContent || el.value)
	}

	function stepText(action, withValues) {
		const target = `${action.role || "element"}${action.name ? ` "${action.name}"` : ""}`
		const where = action.selector ? ` \`${action.selector}\`` : ""
		switch (action.kind) {
			case "click":
				return `Clicked ${target}${where}`
			case "change":
				if (action.value === "checked" || action.value === "unchecked") return `${action.value === "checked" ? "Checked" : "Unchecked"} ${target}${where}`
				if (action.role === "combobox" || action.role === "listbox") return `Selected "${action.value}" in ${target}${where}`
				if (/^•+ \(/.test(action.value || "")) return `Typed into ${target}${where} (sensitive, hidden)`
				return withValues ? `Typed "${action.value}" into ${target}${where}` : `Typed into ${target}${where} (value hidden)`
			case "submit":
				return `Submitted form${action.name ? ` "${action.name}"` : ""}${where}`
			case "key":
				return `Pressed ${action.key}${action.role !== "page" ? ` in ${target}` : ""}`
			case "navigate":
				return `Navigated to ${shortUrl(action.to)}`
			default:
				return `${action.kind} ${target}`
		}
	}

	function vlqDecode(segment) {
		const values = []
		let value = 0
		let shift = 0
		for (const char of segment) {
			const digit = B64_INDEX[char]
			if (digit === undefined) return null
			value += (digit & 31) << shift
			if (digit & 32) shift += 5
			else {
				values.push(value & 1 ? -(value >>> 1) : value >>> 1)
				value = 0
				shift = 0
			}
		}
		return values
	}

	function lookupMapping(map, line, column) {
		const lines = String(map.mappings || "").split(";")
		if (line < 1 || line > lines.length) return null
		let source = 0
		let origLine = 0
		let origCol = 0
		let name = 0
		for (let i = 0; i < line; i++) {
			let genCol = 0
			let best = null
			for (const segment of lines[i].split(",")) {
				if (!segment) continue
				const fields = vlqDecode(segment)
				if (!fields) return null
				genCol += fields[0]
				if (fields.length >= 4) {
					source += fields[1]
					origLine += fields[2]
					origCol += fields[3]
					if (fields.length >= 5) name += fields[4]
					if (i === line - 1 && genCol <= column - 1) best = { source, origLine, origCol, name: fields.length >= 5 ? name : null }
				}
			}
			if (i === line - 1) {
				if (!best) return null
				const root = map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : ""
				const file = `${root}${map.sources?.[best.source] ?? "?"}`.replace(/^webpack:\/\/\/?(?:[^/]*\/)?/, "").replace(/^\/?\.\//, "").replace(/\?[^/]*$/, "")
				return { file, line: best.origLine + 1, column: best.origCol + 1, name: best.name !== null ? map.names?.[best.name] : null }
			}
		}
		return null
	}

	async function fetchText(h, url) {
		const response = await h.sendRuntime({ type: "fetch-text", url })
		return response?.ok ? response.text : null
	}

	async function loadMap(h, scriptUrl) {
		const script = await fetchText(h, scriptUrl)
		if (!script) return null
		const ref = [...script.slice(-4000).matchAll(/[#@]\s*sourceMappingURL=(\S+)/g)].pop()?.[1]
		if (!ref) return null
		let text = null
		if (ref.startsWith("data:")) {
			const comma = ref.indexOf(",")
			const body = ref.slice(comma + 1)
			try {
				text = /;base64/i.test(ref.slice(0, comma)) ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body)
			} catch {
				return null
			}
		} else {
			text = await fetchText(h, new URL(ref, scriptUrl).href)
		}
		try {
			const map = JSON.parse(text)
			return map?.mappings !== undefined ? map : null
		} catch {
			return null
		}
	}

	async function mapStacks(texts, h) {
		const frames = []
		for (const text of texts) for (const m of String(text).matchAll(FRAME)) frames.push({ url: m[3], line: Number(m[4]), column: Number(m[5]) })
		const urls = [...new Set(frames.map((f) => f.url).filter((u) => /^https?:/.test(u)))].slice(0, 6)
		const maps = new Map()
		await Promise.all(urls.map(async (url) => maps.set(url, await loadMap(h, url).catch(() => null))))
		const mapped = new Map()
		for (const frame of frames) {
			const map = maps.get(frame.url)
			if (!map) continue
			const hit = lookupMapping(map, frame.line, frame.column)
			if (hit) mapped.set(`${frame.url}:${frame.line}:${frame.column}`, hit)
		}
		return { mapped, mapsFound: [...maps.values()].filter(Boolean).length }
	}

	function rewriteStack(text, mapped) {
		return String(text).replace(FRAME, (match, fnA, fnB, url, line, column) => {
			const hit = mapped.get(`${url}:${line}:${column}`)
			if (!hit) return match.replace(url, shortUrl(url))
			const fn = hit.name || fnA || fnB || ""
			return `at ${fn ? `${fn} (` : ""}${hit.file}:${hit.line}:${hit.column}${fn ? ")" : ""}`
		})
	}

	function dedupeLogs(logs) {
		const out = []
		const seen = new Map()
		for (const entry of logs) {
			const key = `${entry.level}|${entry.message}`
			if (seen.has(key)) {
				seen.get(key).count++
				continue
			}
			const item = { ...entry, count: 1 }
			seen.set(key, item)
			out.push(item)
		}
		return out
	}

	function pickErrors(logs) {
		const errors = dedupeLogs(logs.filter((l) => l && l.level !== "warn"))
		if (errors.length <= MAX_ERRORS) return { errors, skipped: 0 }
		return { errors: [...errors.slice(0, 3), ...errors.slice(-(MAX_ERRORS - 3))], skipped: errors.length - MAX_ERRORS }
	}

	function absoluteUrl(url) {
		try {
			return new URL(url, location.href).href
		} catch {
			return String(url ?? "")
		}
	}

	function mergeNetwork(passive, deep) {
		const out = deep.map((d) => ({ ...d, method: d.method }))
		for (const p of passive) {
			if (/\/(favicon\.ico|apple-touch-icon[\w.-]*\.png)(\?|$)/i.test(p.url)) continue
			const duplicate = deep.some((d) => absoluteUrl(d.url) === absoluteUrl(p.url) && (p.status === null || d.status === p.status) && Math.abs(d.at - p.at) < 10000)
			if (!duplicate) out.push({ at: p.at, kind: p.type, method: null, url: p.url, status: p.status, ms: p.ms })
		}
		return out.sort((a, b) => a.at - b.at)
	}

	function elementInfo(el, h) {
		const style = getComputedStyle(el)
		const rect = el.getBoundingClientRect()
		const attrs = {}
		for (const name of ["data-testid", "data-test", "data-cy", "data-qa", "data-sentry-component", "data-sentry-source-file", "data-component", "id", "name", "type", "href", "aria-disabled", "aria-expanded", "aria-invalid", "disabled"]) {
			if (el.hasAttribute(name)) attrs[name] = clip(el.getAttribute(name), 120)
		}
		const component = h.probe({ component: true }, el)?.component ?? null
		const clone = el.cloneNode(el.getElementsByTagName("*").length < 1500)
		for (const node of clone.querySelectorAll("svg, script, style")) node.replaceWith(document.createComment(node.localName))
		let html = clone.outerHTML.replace(/\s+/g, " ").replace(/>\s+</g, "><")
		if (html.length > 1500) html = `${html.slice(0, 1500)}…`
		return {
			selector: h.cssPath(el),
			role: roleOf(el),
			name: nameOf(el),
			attrs,
			component,
			html,
			box: `${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
			state: {
				display: style.display,
				visibility: style.visibility,
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				zIndex: style.zIndex,
				position: style.position,
				disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
				covered: (() => {
					const x = rect.left + rect.width / 2
					const y = rect.top + rect.height / 2
					if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null
					const top = document.elementFromPoint?.(x, y)
					return top && top !== el && !el.contains(top) && !top.contains(el) ? h.cssPath(top) : null
				})(),
			},
		}
	}

	function fence(text, lang = "") {
		const body = String(text ?? "")
		const longest = Math.max(2, ...(body.match(/`+/g) || []).map((r) => r.length))
		const ticks = "`".repeat(longest + 1)
		return `${ticks}${lang}\n${body}\n${ticks}`
	}

	async function capture(payload, h) {
		if (payload.action === "arm") {
			const reply = h.mainWorldCall("sidekick:net-arm", "sidekick:net-armed", {})
			const armed = Boolean(reply?.armed)
			const text = armed
				? "Full network recording is on for this tab until it reloads. Reproduce the bug, then run AI bug report again with Capture."
				: "This page did not accept network recording. Status codes from the passive log are still included."
			return { ok: true, data: { type: "text", value: text, copy: text, note: armed ? "Recording request methods, request bodies and error responses" : "" } }
		}

		let element = null
		if (payload.pick) {
			element = await h.pickElement("Sidekick: AI bug report", "Click the element that misbehaves · Esc to skip")
		}
		const now = Date.now()
		const recorder = globalThis.__sidekickRecorder?.snapshot?.() ?? null
		const deepReply = h.mainWorldCall("sidekick:net-request", "sidekick:net-response", {})
		const deep = Array.isArray(deepReply?.entries) ? deepReply.entries : []
		const logs = (h.getRecentLogs(200) || []).filter(Boolean)
		const frameworks = h.detectStack().filter((name) => /React|Next|Vue|Nuxt|Angular|Svelte|Remix|Gatsby|Astro|Solid|Preact|Qwik|jQuery|Ember/i.test(name))
		const { errors, skipped } = pickErrors(logs)
		const warnings = dedupeLogs(logs.filter((l) => l.level === "warn")).slice(-5)
		const network = mergeNetwork(recorder?.network ?? [], deep)
		const failed = network.filter((n) => (typeof n.status === "number" && n.status >= 400) || (n.status === 0 && n.error)).slice(-MAX_FAILED)
		const slow = network.filter((n) => n.ms > 3000 && !failed.includes(n)).slice(-5)
		const calls = network.filter((n) => /fetch|xhr|xmlhttprequest|beacon/.test(n.kind || "") && !failed.includes(n)).slice(-MAX_CALLS)
		const steps = (recorder?.actions ?? []).filter((a) => now - a.at < 10 * 60 * 1000)
		const shownSteps = steps.slice(-MAX_STEPS)
		const info = element ? elementInfo(element, h) : null
		const { mapped, mapsFound } = payload.sourcemaps === false ? { mapped: new Map(), mapsFound: 0 } : await mapStacks(errors.map((e) => e.message), h)

		let screenshot = null
		if (payload.screenshot) {
			try {
				screenshot = element ? await h.screenshotElement(element) : { dataUrl: await h.screenshot() }
			} catch {}
		}

		const note = String(payload.note ?? "").trim()
		const symptom = clip(note.split("\n")[0] || (errors[0] ? errors[0].message.split("\n")[0] : "") || (failed[0] ? `${failed[0].method || "Request"} ${shortUrl(failed[0].url)} failed with ${failed[0].status}` : "") || "Unexpected behaviour", 120)
		const env = {
			page: location.href,
			title: document.title,
			when: new Date(now).toISOString(),
			browser: browserOf(navigator.userAgent),
			viewport: `${innerWidth}×${innerHeight} @${window.devicePixelRatio || 1}x`,
			language: navigator.language,
			frameworks,
			build: devBuild() ? "development" : "production",
			online: navigator.onLine,
		}

		if (payload.format === "json") {
			const data = {
				symptom,
				description: note || null,
				environment: env,
				signals: { errors: errors.length, failedRequests: failed.length, warnings: warnings.length },
				errors: errors.map((e) => ({ level: e.level, count: e.count, at: e.at, message: rewriteStack(e.message, mapped) })),
				failedRequests: failed.map((n) => ({ method: n.method, url: n.url, status: n.status, ms: n.ms, error: n.error, requestBody: n.requestBody, responseBody: n.responseBody })),
				slowRequests: slow.map((n) => ({ method: n.method, url: n.url, status: n.status, ms: n.ms })),
				recentCalls: calls.map((n) => ({ method: n.method, url: n.url, status: n.status, ms: n.ms })),
				steps: shownSteps.map((a) => ({ at: new Date(a.at).toISOString(), step: stepText(a, payload.values) })),
				element: info,
				warnings: warnings.map((w) => w.message),
			}
			const text = JSON.stringify(data, null, 2)
			return result(text, "json", screenshot, errors.length, failed.length, steps.length, mapsFound)
		}

		const issue = payload.format === "issue"
		const out = []
		out.push(issue ? `## ${symptom}` : `# Bug: ${symptom}`)
		if (note) out.push(note)
		out.push(`**Page:** ${shortUrl(env.page)} (${env.title ? `"${clip(env.title, 80)}", ` : ""}${location.origin}) · **When:** ${new Date(now).toLocaleString()} · **Browser:** ${env.browser} · **Viewport:** ${env.viewport}${frameworks.length ? ` · **Stack:** ${frameworks.join(", ")}` : ""} · **Build:** ${env.build}`)
		out.push(`**Signals:** ${errors.length} error${errors.length === 1 ? "" : "s"} · ${failed.length} failed request${failed.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}${steps.length ? ` · ${steps.length} recorded step${steps.length === 1 ? "" : "s"}` : ""}`)

		if (issue) {
			out.push("### Steps to reproduce")
			out.push(shownSteps.length ? shownSteps.map((a, i) => `${i + 1}. ${stepText(a, payload.values)}`).join("\n") : "1. _Open the page above and repeat the action that fails._")
			out.push("### Expected\n_Describe what should happen._\n\n### Actual\n" + (note ? "_See the description above._" : "_Describe what happens instead._"))
		}

		if (errors.length) {
			out.push(issue ? "### Errors" : "## Errors")
			if (mapsFound) out.push(`_Stack frames mapped to source files with ${mapsFound} source map${mapsFound === 1 ? "" : "s"}._`)
			for (const e of errors) out.push(`${e.level}${e.count > 1 ? ` ×${e.count}` : ""}, ${ago(Date.parse(e.at) || now, now)}\n${fence(rewriteStack(e.message, mapped))}`)
			if (skipped) out.push(`_${skipped} more errors in between were left out._`)
		}

		if (failed.length || slow.length) {
			out.push(issue ? "### Network" : "## Failed and slow requests")
			for (const n of failed) {
				out.push(`- ${ago(n.at, now)}: \`${n.method ?? "?"} ${shortUrl(n.url)}\` → **${n.status || "no response"}**${n.error ? ` (${n.error})` : ""}, ${n.ms} ms`)
				if (n.requestBody) out.push(`  Request body:\n${fence(n.requestBody).replace(/^/gm, "  ")}`)
				if (n.responseBody) out.push(`  Response:\n${fence(n.responseBody).replace(/^/gm, "  ")}`)
			}
			for (const n of slow) out.push(`- ${ago(n.at, now)}: \`${n.method ?? "?"} ${shortUrl(n.url)}\` took **${(n.ms / 1000).toFixed(1)} s** (status ${n.status ?? "?"})`)
		}

		if (!issue && shownSteps.length) {
			out.push(`## Steps before the bug (last ${shownSteps.length}${steps.length > shownSteps.length ? ` of ${steps.length}` : ""})`)
			out.push(shownSteps.map((a, i) => `${i + 1}. ${stepText(a, payload.values)} (${ago(a.at, now)})`).join("\n"))
		}

		if (info) {
			out.push(issue ? "### Element" : "## Element")
			const lines = [`- ${info.role}${info.name ? ` "${info.name}"` : ""}: \`${info.selector}\``]
			if (info.component?.components?.length || info.component?.source) lines.push(`- ${info.component.framework} component: ${info.component.components.map((c) => `<${c}>`).join(" in ")}${info.component.source ? ` (${info.component.source})` : ""}`)
			const attrs = Object.entries(info.attrs).map(([k, v]) => `${k}="${v}"`).join(" ")
			if (attrs) lines.push(`- Attributes: ${attrs}`)
			const s = info.state
			lines.push(`- Box ${info.box}; display ${s.display}, visibility ${s.visibility}, opacity ${s.opacity}, pointer-events ${s.pointerEvents}, position ${s.position}, z-index ${s.zIndex}${s.disabled ? ", disabled" : ""}${s.covered ? `; covered by \`${s.covered}\`` : ""}`)
			out.push(lines.join("\n"))
			out.push(fence(info.html, "html"))
		}

		if (calls.length) {
			out.push(issue ? "### Recent API calls" : "## Recent API calls")
			out.push(calls.map((n) => `- \`${n.method ?? "?"} ${shortUrl(n.url)}\` → ${n.status ?? "?"} in ${n.ms} ms`).join("\n"))
		}

		if (warnings.length) {
			out.push(issue ? "### Warnings" : "## Warnings")
			out.push(warnings.map((w) => `- ${clip(w.message.split("\n")[0], 200)}${w.count > 1 ? ` (×${w.count})` : ""}`).join("\n"))
		}

		if (!deep.length && !issue) out.push("_Request methods and bodies were not recorded. For full network detail, run this tool with \"Record full network on this tab\", reproduce the bug, then capture again._")

		if (!issue) {
			out.push("## Task")
			out.push("Find the root cause in this codebase and fix it. Start from the first error and any failed request; the element section shows where the UI lives. Explain the cause in one or two sentences, then give the change. If this report is not enough to be sure, say what else you need.")
		}

		return result(out.join("\n\n"), "md", screenshot, errors.length, failed.length, steps.length, mapsFound)
	}

	function result(text, ext, screenshot, errorCount, failedCount, stepCount, mapsFound) {
		const meta = `${errorCount} errors · ${failedCount} failed requests · ${stepCount} steps`
		const download = screenshot?.dataUrl
			? { filename: "bug-screenshot.png", mime: "image/png", dataUrl: screenshot.dataUrl }
			: { filename: `bug-report.${ext}`, mime: ext === "json" ? "application/json" : "text/markdown", text }
		const tips = []
		if (screenshot?.dataUrl) tips.push("Save downloads the screenshot; attach it next to the report")
		if (mapsFound) tips.push(`stack traces mapped to source files`)
		return { ok: true, data: { type: "text", value: text, copy: text, download, meta, note: tips.join(" · ") } }
	}

	globalThis.__sidekickAiBug = capture
})()
