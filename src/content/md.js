;(() => {
	const NOISE = 'button, svg, style, script, noscript, template, textarea, input, select, [role="toolbar"], [role="button"], [aria-hidden="true"], .sr-only, .visually-hidden, [class*="copy-button" i], [data-testid*="copy" i], [data-testid*="feedback" i], .katex-html, mjx-assistive-mml, [data-sidekick-core]'
	const THINKING = '[data-testid*="thinking" i], [class*="thinking" i], [class*="reasoning" i], .ds-think-content, [data-testid*="reasoning" i]'
	const BLOCKS = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "form", "fieldset", "address", "message-content", "user-query", "model-response"])
	const TRACKING = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|yclid|ref_src|si|spm|vero_id|mkt_tok)$/i

	function fenceFor(text) {
		const longest = Math.max(2, ...(text.match(/`+/g) || []).map((run) => run.length))
		return "`".repeat(longest + 1)
	}

	function codeLanguage(block, code) {
		const fromClass = (node) => (node?.className && typeof node.className === "string" ? node.className.match(/(?:language|lang)-([\w+#.-]+)/)?.[1] : null)
		const direct = fromClass(code) || fromClass(block) || fromClass(block.querySelector('[class*="language-"]')) || block.getAttribute("data-language") || code.getAttribute?.("data-language")
		if (direct) return direct.toLowerCase()
		const label = [...block.querySelectorAll("span, div, p")].find((n) => !n.contains(code) && !code.contains(n) && /^[\w+#.-]{1,20}$/.test((n.textContent || "").trim()))
		return label ? label.textContent.trim().toLowerCase() : ""
	}

	function texOf(el) {
		return el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || ""
	}

	function cleanUrl(href) {
		try {
			const url = new URL(href, location.href)
			if (!url.search) return url.href
			const kept = url.search.slice(1).split("&").filter((pair) => {
				if (!pair) return false
				let key = pair.split("=")[0]
				try {
					key = decodeURIComponent(key.replace(/\+/g, " "))
				} catch {}
				return !TRACKING.test(key)
			})
			url.search = kept.length ? `?${kept.join("&")}` : ""
			return url.href
		} catch {
			return href
		}
	}

	function convert(root, opts = {}) {
		const shift = opts.headingShift ?? 0
		const extraSkip = opts.skip || ""
		const holds = []
		const hold = (s) => `\u0000${holds.push(s) - 1}\u0000`
		const refs = []
		const refFor = (url) => {
			const at = refs.indexOf(url)
			return at === -1 ? refs.push(url) : at + 1
		}
		const styleOf = (el) => {
			try {
				return getComputedStyle(el)
			} catch {
				return null
			}
		}

		const walk = (node, ctx) => {
			if (node.nodeType === 3) return ctx.lines ? node.data.replace(/[ \t]+/g, " ") : node.data.replace(/\s+/g, " ")
			if (node.nodeType !== 1) return ""
			const el = node
			const tag = el.localName
			if (el.matches(".katex") || tag === "math") {
				const tex = texOf(el)
				if (tex) return el.closest(".katex-display") || el.getAttribute("display") === "block" ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
			}
			if (el !== root) {
				if (!opts.thinking && el.matches(THINKING)) return ""
				if (el.matches(NOISE)) return ""
				if (extraSkip && el.matches(extraSkip)) return ""
			}
			const style = opts.skipHidden || !ctx.lines ? styleOf(el) : null
			if (opts.skipHidden && el !== root && style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) return ""
			if (tag === "pre" || tag === "code-block") return `\n\n${hold(codeBlock(el))}\n\n`
			const inner = { lines: ctx.lines || (style ? /^pre/.test(style.whiteSpace) : false) }
			const kids = () => [...el.childNodes].map((c) => walk(c, inner)).join("")
			const wrap = (mark) => {
				const m = kids().match(/^(\s*)([\s\S]*?)(\s*)$/)
				return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : m[0]
			}
			if (/^h[1-6]$/.test(tag)) {
				const text = kids().replace(/\s+/g, " ").trim()
				return text ? `\n\n${"#".repeat(Math.min(6, Number(tag[1]) + shift))} ${text}\n\n` : ""
			}
			switch (tag) {
				case "br":
					return "\n"
				case "hr":
					return "\n\n---\n\n"
				case "strong":
				case "b":
					return wrap("**")
				case "em":
				case "i":
					return wrap("*")
				case "del":
				case "s":
					return wrap("~~")
				case "sup":
					return kids().trim() ? `^${kids().trim()}` : ""
				case "code":
				case "kbd":
				case "samp": {
					const text = el.textContent || ""
					const ticks = "`".repeat(Math.max(0, ...(text.match(/`+/g) || []).map((r) => r.length)) + 1)
					return text ? `${ticks}${text}${ticks}` : ""
				}
				case "a": {
					const text = kids().replace(/\s+/g, " ").trim()
					const href = el.getAttribute("href") || ""
					if (href.startsWith("#") && /^(#|¶|§|🔗|link)?$/i.test(text)) return ""
					if (!href || href.startsWith("#") || /^(javascript|data):/i.test(href) || opts.links === false) return text
					const abs = opts.cleanUrls === false ? el.href : cleanUrl(el.href)
					if (!text) return opts.links === "text" || opts.links === "refs" ? "" : abs
					if (opts.links === "refs") return `[${text}][${refFor(abs)}]`
					return text === abs || text === href ? abs : `[${text}](${abs})`
				}
				case "img": {
					const alt = (el.getAttribute("alt") || "").replace(/\s+/g, " ").trim()
					if (opts.images === "none") return ""
					const src = el.currentSrc || el.src || ""
					if (opts.images === "markdown" && src && !src.startsWith("data:")) return `![${alt}](${cleanUrl(src)})`
					return alt ? `[image: ${alt}]` : ""
				}
				case "video":
				case "audio":
				case "iframe":
				case "canvas":
				case "object":
				case "embed": {
					const label = el.getAttribute("title") || el.getAttribute("aria-label") || ""
					return opts.media === false ? "" : `\n\n[${tag}${label ? `: ${label}` : ""}]\n\n`
				}
				case "blockquote":
					return `\n\n${kids().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`
				case "ul":
				case "ol":
					return list(el, tag === "ol", inner)
				case "table":
					return table(el, inner)
				case "dt":
					return `\n\n**${kids().trim()}**\n`
				default:
					return BLOCKS.has(tag) ? `\n\n${kids()}\n\n` : kids()
			}
		}

		const codeBlock = (el) => {
			const code = el.querySelector("code") || el
			const text = (code.textContent || "").replace(/\n+$/, "")
			const lang = codeLanguage(el, code)
			const lines = text.split("\n").length
			if (opts.codeLimit !== undefined && lines > opts.codeLimit) return `[code${lang ? ` (${lang})` : ""}: ${lines} lines omitted]`
			const fence = fenceFor(text)
			return `${fence}${lang}\n${text}\n${fence}`
		}

		const list = (el, ordered, ctx) => {
			let n = Number(el.getAttribute("start")) || 1
			const items = [...el.children].filter((c) => c.localName === "li").map((li) => {
				const marker = ordered ? `${n++}.` : "-"
				const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > * > input[type="checkbox"]')
				let body = [...li.childNodes].map((c) => walk(c, ctx)).join("").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
				if (!li.querySelector("p")) body = body.replace(/\n{2,}/g, "\n")
				if (checkbox) body = `[${checkbox.checked ? "x" : " "}] ${body}`
				const pad = "\u0002".repeat(marker.length + 1)
				return body ? `${marker} ${body.split("\n").join(`\n${pad}`)}` : ""
			}).filter(Boolean)
			return items.length ? `\n\n${items.join("\n")}\n\n` : ""
		}

		const table = (el, ctx) => {
			const rows = [...el.querySelectorAll("tr")].filter((tr) => tr.closest("table") === el).map((tr) => [...tr.children].map((cell) => walk(cell, ctx).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim()))
			if (!rows.length) return ""
			const width = Math.max(...rows.map((r) => r.length))
			const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`
			return `\n\n${[line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n")}\n\n`
		}

		const rootStyle = styleOf(root)
		const body = walk(root, { lines: rootStyle ? /^pre/.test(rootStyle.whiteSpace) : false })
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/\u0002/g, " ")
			.replace(/\u0000(\d+)\u0000/g, (m, i) => holds[Number(i)])
			.trim()
		return refs.length ? `${body}\n\n${refs.map((url, i) => `[${i + 1}]: ${url}`).join("\n")}` : body
	}

	const TOKEN_PARTS = /(\p{Script=Han}+)|(\p{Script=Hiragana}+|\p{Script=Katakana}+)|(\p{Script=Hangul}+)|(\d+)|([A-Za-z]+)|([\p{L}\p{M}]+)|([^\s\p{L}\p{N}]+)/gu

	function estimateTokens(text) {
		let tokens = 0
		for (const [, han, kana, hangul, digits, latin, other, punct] of String(text || "").matchAll(TOKEN_PARTS)) {
			if (han) tokens += Math.ceil(han.length / 1.15)
			else if (kana) tokens += Math.ceil(kana.length / 1.4)
			else if (hangul) tokens += Math.ceil(hangul.length / 1.65)
			else if (digits) tokens += Math.ceil(digits.length / 3)
			else if (latin) tokens += latin.length <= 3 || (latin.length <= 8 && latin === latin.toLowerCase()) ? 1 : Math.ceil(latin.length / 7)
			else if (other) tokens += Math.ceil(other.length / 3)
			else if (punct) tokens += Math.ceil(punct.length / 6)
		}
		return tokens
	}

	globalThis.__sidekickMd = { convert, estimateTokens, cleanUrl }
})()
