;(() => {
	const runtime = typeof browser !== "undefined" && browser.runtime ? browser : chrome
	const VAULT_NAME = "ai-context"

	const GENERIC = {
		user: '[data-message-author-role="user"], [data-role="user"], [data-testid*="user-message" i], [class*="user-message" i], [class*="human-message" i], [class*="UserMessage"]',
		assistant: '[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant-message" i], [class*="assistant-message" i], [class*="bot-message" i], [class*="ai-message" i], [class*="AssistantMessage"]',
	}

	const PLATFORMS = [
		{
			name: "ChatGPT",
			host: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
			turns: () => [...document.querySelectorAll("[data-message-author-role]")].map((el) => {
				const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant"
				return { role, el: el.querySelector(role === "user" ? ".whitespace-pre-wrap" : ".markdown") || el }
			}),
		},
		{
			name: "Claude",
			host: /(^|\.)claude\.ai$/,
			user: '[data-testid="user-message"]',
			assistant: '.font-claude-response, .font-claude-message, [data-testid="assistant-message"]',
		},
		{
			name: "Gemini",
			host: /^gemini\.google\.com$/,
			user: "user-query .query-text, user-query .query-content",
			assistant: "model-response message-content, model-response .model-response-text",
		},
		{
			name: "Copilot",
			host: /(^|\.)(copilot\.microsoft\.com|copilot\.com)$/,
			user: '[data-content="user-message"]',
			assistant: '[data-content="ai-message"], [class*="group/ai-message-item"]',
		},
		{
			name: "Perplexity",
			host: /(^|\.)perplexity\.ai$/,
			user: '[class*="group/query"], [data-testid="user-query"], h1[class*="query"]',
			assistant: '[id^="markdown-content-"], [data-testid="answer"], [data-renderer="lm"]',
		},
		{
			name: "DeepSeek",
			host: /^chat\.deepseek\.com$/,
			turns: () => [...document.querySelectorAll(".ds-message")].map((el) => {
				const answers = [...el.querySelectorAll(".ds-markdown")].filter((m) => !m.closest(".ds-think-content"))
				return answers.length ? { role: "assistant", el: answers[answers.length - 1] } : { role: "user", el }
			}),
		},
		{
			name: "Grok",
			host: /(^|\.)(grok\.com|x\.com)$/,
			turns: () => [...document.querySelectorAll('div[id^="response-"]')].map((el) => ({
				role: el.matches(".items-end") ? "user" : "assistant",
				el: el.querySelector(".response-content-markdown, .message-bubble") || el,
			})),
		},
		{
			name: "Mistral Le Chat",
			host: /^chat\.mistral\.ai$/,
			user: '[data-message-author-role="user"], [class*="user-message" i]',
			assistant: '[data-message-author-role="assistant"], [class*="assistant-message" i]',
		},
		{
			name: "Poe",
			host: /(^|\.)poe\.com$/,
			user: '[class*="rightSideMessageBubble"]',
			assistant: '[class*="leftSideMessageBubble"]',
		},
		{
			name: "Meta AI",
			host: /(^|\.)meta\.ai$/,
			user: GENERIC.user,
			assistant: GENERIC.assistant,
		},
	]

	const COMPOSERS = [
		"#prompt-textarea",
		'div.ProseMirror[contenteditable="true"]',
		"rich-textarea .ql-editor",
		"#ask-input",
		"textarea#userInput",
		"textarea#chat-input",
		'div[contenteditable="true"][role="textbox"]',
		"textarea",
		'div[contenteditable="true"]',
	]

	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

	function detectPlatform() {
		const host = location.hostname.replace(/^www\./, "")
		return PLATFORMS.find((p) => p.host.test(host)) || { name: host || "AI chat", ...GENERIC, generic: true }
	}

	function outermost(list) {
		return list.filter((el) => !list.some((other) => other !== el && other.contains(el)))
	}

	function pairTurns(user, assistant) {
		let found
		try {
			found = outermost([...document.querySelectorAll(`${user}, ${assistant}`)])
		} catch {
			return []
		}
		return found.map((el) => ({ role: el.matches(user) ? "user" : "assistant", el }))
	}

	function findTurns(platform) {
		let turns = platform.turns ? platform.turns() : pairTurns(platform.user, platform.assistant)
		if (!turns.length && !platform.generic) turns = pairTurns(GENERIC.user, GENERIC.assistant)
		return turns.filter((t) => t.el && t.el.isConnected)
	}

	function convert(root, opts) {
		return globalThis.__sidekickMd.convert(root, { headingShift: 2, skip: "nav", ...opts })
	}

	function vault(type, payload) {
		try {
			return runtime.runtime.sendMessage({ type, ...payload }).then((res) => res ?? { ok: false, error: "No response" }, (error) => ({ ok: false, error: error?.message ?? String(error) }))
		} catch (error) {
			return Promise.resolve({ ok: false, error: error?.message ?? String(error) })
		}
	}

	function truncate(text, max) {
		if (!max || text.length <= max) return text
		let cut = text.lastIndexOf("\n\n", max)
		if (cut < max * 0.6) cut = text.lastIndexOf(". ", max) + 1
		if (cut < max * 0.6) cut = max
		let head = text.slice(0, cut).trimEnd()
		if ((head.match(/^`{3,}/gm) || []).length % 2) head += "\n```"
		return `${head}\n[…${text.length - head.length} more characters trimmed]`
	}

	const DETAIL = {
		full: { keepFull: Infinity },
		balanced: { keepFull: 6, user: 3000, assistant: 1500, codeLimit: 25 },
		compact: { keepFull: 2, user: 1000, assistant: 400, codeLimit: 0 },
	}

	function snapshot(platform, opts) {
		return findTurns(platform).map(({ role, el }) => {
			const text = (el.innerText || el.textContent || "").trim()
			const key = el.getAttribute("data-message-id") || el.closest("[data-message-id], [data-virtual-list-item-key], [data-testid^='conversation-turn-']")?.getAttribute("data-message-id") || el.closest("[data-virtual-list-item-key]")?.getAttribute("data-virtual-list-item-key") || `${role}:${text.length}:${text.slice(0, 200)}`
			return { role, el, key }
		}).filter((t) => t.el.textContent.trim() || t.el.querySelector("img, pre, code"))
	}

	function scrollerOf(el) {
		for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
			if (node.scrollHeight - node.clientHeight > 50 && /auto|scroll|overlay/.test(getComputedStyle(node).overflowY)) return node
		}
		return document.scrollingElement || document.documentElement
	}

	async function collect(platform, opts) {
		let turns = snapshot(platform, opts)
		if (!opts.loadAll || !turns.length) return turns.map((t) => ({ role: t.role, md: null, el: t.el }))
		const scroller = scrollerOf(turns[0].el)
		const saved = scroller.scrollTop
		const merged = new Map()
		const absorb = () => {
			for (const t of snapshot(platform, opts)) if (!merged.has(t.key)) merged.set(t.key, { role: t.role, md: convert(t.el, opts.convert(merged.size)), el: t.el })
		}
		try {
			let lastHeight = -1
			for (let i = 0; i < 30; i += 1) {
				scroller.scrollTop = 0
				await wait(i ? 700 : 300)
				if (scroller.scrollHeight === lastHeight && scroller.scrollTop === 0) break
				lastHeight = scroller.scrollHeight
			}
			const top = snapshot(platform, opts)
			scroller.scrollTop = scroller.scrollHeight
			await wait(400)
			const bottom = snapshot(platform, opts)
			if (top.length && bottom.length && top[0].key === bottom[0].key) return bottom.map((t) => ({ role: t.role, md: null, el: t.el }))
			scroller.scrollTop = 0
			await wait(400)
			for (let step = 0; step < 400; step += 1) {
				absorb()
				if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break
				scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.8)
				await wait(350)
			}
			absorb()
			return [...merged.values()]
		} finally {
			scroller.scrollTop = saved
		}
	}

	function chatTitle(platform) {
		const fromPage = document.querySelector("conversation-actions .conversation-title, [data-testid='chat-title'], nav a[aria-current='page'], nav [aria-current='page']")?.textContent?.trim()
		const fromDoc = document.title.replace(/\s*[-|–]\s*(ChatGPT|Claude|Gemini|Copilot|Perplexity|DeepSeek|Grok|Le Chat|Poe|Meta AI).*$/i, "").trim()
		return (fromPage || fromDoc || `${platform.name} chat`).slice(0, 120)
	}

	function selectionTurns() {
		const selection = window.getSelection()
		if (!selection || selection.isCollapsed || !selection.toString().trim()) return null
		const box = document.createElement("div")
		for (let i = 0; i < selection.rangeCount; i += 1) box.appendChild(selection.getRangeAt(i).cloneContents())
		return [{ role: "selection", md: null, el: box }]
	}

	function render(messages, meta, format) {
		const label = { user: "User", assistant: "Assistant", selection: "Excerpt" }
		const body = messages.map((m) => `## ${label[m.role] || "Message"}\n${m.md}`).join("\n\n")
		if (format === "json") return JSON.stringify({ source: meta.platform, title: meta.title, url: meta.url, messages: messages.map((m) => ({ role: m.role === "selection" ? "user" : m.role, content: m.md })) })
		if (format === "transcript") return `# ${meta.title}\n_${meta.platform} · ${meta.url} · ${meta.date}_\n\n${body}\n`
		const note = meta.trimmed ? " Older replies are shortened; ask me if you need a missing detail." : ""
		return `I'm moving this conversation over from ${meta.platform} so we can keep going here. The transcript is below.${note} Pick up from my last message, keeping the same context, decisions and constraints. Don't summarise it back to me.\n\n<conversation source="${meta.platform}" title="${meta.title.replace(/"/g, "'")}" messages="${messages.length}">\n${body}\n</conversation>\n`
	}

	async function capture(payload) {
		const platform = detectPlatform()
		const detail = DETAIL[payload?.detail] || DETAIL.full
		const format = payload?.format || "handoff"
		const lastN = Math.max(0, Math.floor(Number(payload?.lastN) || 0))
		const settingsFor = (index, total) => {
			const older = index < total - detail.keepFull
			return { thinking: Boolean(payload?.thinking), codeLimit: older ? detail.codeLimit : undefined, older }
		}
		let raw = selectionTurns()
		const fromSelection = Boolean(raw)
		if (!raw) raw = await collect(platform, { loadAll: payload?.loadAll !== false, convert: () => ({ thinking: Boolean(payload?.thinking) }) })
		if (!raw.length) {
			return { ok: false, error: `No chat messages found on ${platform.name}. Open a conversation, or select the part of the page you want and run again.` }
		}
		if (lastN) raw = raw.slice(-lastN)
		let trimmed = false
		const messages = raw.map((m, index) => {
			const settings = settingsFor(index, raw.length)
			let md = m.md ?? convert(m.el, settings)
			if (settings.older && detail[m.role === "assistant" ? "assistant" : "user"]) {
				const cut = truncate(md, detail[m.role === "assistant" ? "assistant" : "user"])
				if (cut !== md) trimmed = true
				md = cut
			}
			if (md.includes("lines omitted]")) trimmed = true
			return { role: m.role, md }
		}).filter((m) => m.md)
		const meta = { platform: platform.name, title: chatTitle(platform), url: location.href.split("?")[0], date: new Date().toISOString().slice(0, 10), trimmed }
		const text = render(messages, meta, format)
		const tokens = globalThis.__sidekickMd.estimateTokens(text)
		const stored = await vault("vault:put", { name: VAULT_NAME, value: { text, platform: meta.platform, title: meta.title, messages: messages.length, tokens, at: Date.now() } })
		const slug = meta.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ai-chat"
		const ext = format === "json" ? "json" : "md"
		return {
			ok: true,
			note: `${fromSelection ? "Selection" : `${messages.length} messages`} from ${meta.platform} · about ${tokens.toLocaleString()} tokens · ${stored.ok ? "saved encrypted for \"Insert into this chat\"" : "not saved: " + stored.error}`,
			data: { type: "text", value: text, copy: text, download: { filename: `${slug}.${ext}`, mime: format === "json" ? "application/json" : "text/markdown", text } },
		}
	}

	function visible(el) {
		if (!el || el.closest("[data-sidekick-core]")) return false
		const rect = el.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 && !el.disabled && getComputedStyle(el).visibility !== "hidden"
	}

	function findComposer() {
		for (const selector of COMPOSERS) {
			const match = [...document.querySelectorAll(selector)].filter(visible)
			if (match.length) return match.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]
		}
		return null
	}

	function readValue(el) {
		return "value" in el && typeof el.value === "string" ? el.value : el.innerText || ""
	}

	async function typeInto(el, text) {
		el.focus()
		const before = readValue(el).length
		if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
			const current = el.value
			const next = current.trim() ? `${current}\n\n${text}` : text
			const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set
			if (setter) setter.call(el, next)
			else el.value = next
			el.dispatchEvent(new Event("input", { bubbles: true }))
			el.dispatchEvent(new Event("change", { bubbles: true }))
			return true
		}
		const range = document.createRange()
		range.selectNodeContents(el)
		range.collapse(false)
		const selection = window.getSelection()
		selection.removeAllRanges()
		selection.addRange(range)
		try {
			const data = new DataTransfer()
			data.setData("text/plain", text)
			el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
		} catch {}
		await wait(200)
		if (readValue(el).length > before) return true
		try {
			document.execCommand("insertText", false, text)
		} catch {}
		await wait(150)
		return readValue(el).length > before
	}

	async function insert() {
		const response = await vault("vault:get", { name: VAULT_NAME })
		const saved = response.ok ? response.value : null
		if (!saved?.text) return { ok: false, error: "Nothing captured yet. Run \"Capture this chat\" on the AI you are leaving first." }
		const composer = findComposer()
		const result = { type: "text", value: saved.text, copy: saved.text }
		if (!composer) return { ok: true, note: "No message box found here. Use Copy in Sidekick and paste it.", data: result }
		const done = await typeInto(composer, saved.text)
		return {
			ok: true,
			note: done ? `Inserted "${saved.title}" from ${saved.platform} (about ${saved.tokens.toLocaleString()} tokens). Review it, then send.` : "This message box blocked typing. Use Copy in Sidekick and paste it.",
			data: result,
		}
	}

	globalThis.__sidekickAiContext = {
		run: (payload) => (payload?.action === "insert" ? insert() : capture(payload)),
	}
})()
