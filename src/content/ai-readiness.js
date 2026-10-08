;(() => {
	const BOTS = [
		{ token: "OAI-SearchBot", vendor: "ChatGPT search", purpose: "search" },
		{ token: "Claude-SearchBot", vendor: "Claude search", purpose: "search" },
		{ token: "PerplexityBot", vendor: "Perplexity", purpose: "search" },
		{ token: "Googlebot", vendor: "Google Search, AI Overviews, AI Mode", purpose: "search" },
		{ token: "Bingbot", vendor: "Bing and Copilot", purpose: "search" },
		{ token: "Applebot", vendor: "Apple Siri and Spotlight", purpose: "search", fallback: "googlebot" },
		{ token: "DuckAssistBot", vendor: "DuckDuckGo DuckAssist", purpose: "search" },
		{ token: "ChatGPT-User", vendor: "ChatGPT fetching a link for a user", purpose: "user" },
		{ token: "Claude-User", vendor: "Claude fetching a link for a user", purpose: "user" },
		{ token: "Perplexity-User", vendor: "Perplexity fetching a link for a user", purpose: "user" },
		{ token: "MistralAI-User", vendor: "Le Chat fetching a link for a user", purpose: "user" },
		{ token: "GPTBot", vendor: "OpenAI model training", purpose: "training" },
		{ token: "ClaudeBot", vendor: "Anthropic model training", purpose: "training" },
		{ token: "Google-Extended", vendor: "Gemini training and grounding (not Search)", purpose: "training" },
		{ token: "Applebot-Extended", vendor: "Apple model training", purpose: "training" },
		{ token: "Meta-ExternalAgent", vendor: "Meta AI training", purpose: "training" },
		{ token: "Amazonbot", vendor: "Amazon", purpose: "training" },
		{ token: "CCBot", vendor: "Common Crawl (used by many models)", purpose: "training" },
		{ token: "Bytespider", vendor: "ByteDance", purpose: "training" },
	]
	const PURPOSE_LABEL = { search: "AI search and answers", user: "Fetches a link a user shares", training: "Model training" }
	const RELEVANT_TYPES = /^(Article|BlogPosting|NewsArticle|TechArticle|Report|Product|Offer|Organization|Corporation|LocalBusiness|WebSite|WebPage|BreadcrumbList|FAQPage|HowTo|SoftwareApplication|Recipe|Event|Course|Person|Review|VideoObject|Dataset|QAPage|ProfilePage|Service|Book|Movie|JobPosting)$/

	function clean(text) {
		return String(text ?? "").replace(/\s+/g, " ").trim()
	}

	function words(text) {
		return clean(text).split(" ").filter(Boolean).length
	}

	function parseRobots(text) {
		const groups = []
		const sitemaps = []
		const signals = []
		let current = null
		let collectingAgents = false
		for (const raw of String(text).split(/\r?\n/)) {
			const line = raw.replace(/#.*$/, "").trim()
			const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
			if (!m) continue
			const field = m[1].toLowerCase()
			const value = m[2].trim()
			if (field === "user-agent") {
				if (!collectingAgents) {
					current = { agents: [], rules: [] }
					groups.push(current)
				}
				current.agents.push(value.split("/")[0].trim().toLowerCase())
				collectingAgents = true
				continue
			}
			if (field === "allow" || field === "disallow") {
				collectingAgents = false
				if (current) current.rules.push({ allow: field === "allow", path: value })
			} else if (field === "crawl-delay") {
				collectingAgents = false
				if (current) current.crawlDelay = value
			} else if (field === "sitemap") sitemaps.push(value)
			else if (field === "content-signal") signals.push(value)
		}
		return { groups, sitemaps, signals }
	}

	function ruleMatches(pattern, path) {
		const anchored = pattern.endsWith("$")
		const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
		try {
			return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path)
		} catch {
			return path.startsWith(pattern)
		}
	}

	function verdictFor(robots, token, path, fallback) {
		if (path === "/robots.txt") return { allowed: true, why: "robots.txt is always readable" }
		const name = token.toLowerCase()
		let groups = robots.groups.filter((g) => g.agents.includes(name))
		let via = token
		if (!groups.length && fallback) {
			groups = robots.groups.filter((g) => g.agents.includes(fallback))
			if (groups.length) via = `${fallback} (fallback)`
		}
		if (!groups.length) {
			groups = robots.groups.filter((g) => g.agents.includes("*"))
			via = "*"
		}
		if (!groups.length) return { allowed: true, why: "no matching rules" }
		let best = null
		for (const rule of groups.flatMap((g) => g.rules)) {
			if (!rule.path) continue
			if (!ruleMatches(rule.path, path)) continue
			const length = new TextEncoder().encode(rule.path).length
			if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) best = { ...rule, length }
		}
		if (!best) return { allowed: true, why: `no rule matches in the "${via}" group` }
		return { allowed: best.allow, why: `${best.allow ? "Allow" : "Disallow"}: ${best.path} (group "${via}")` }
	}

	function robotsDirectives(headers) {
		const parts = []
		for (const meta of document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i], meta[name="bingbot" i], meta[name="googlebot-news" i]')) {
			parts.push(`${meta.getAttribute("name").toLowerCase()}: ${meta.getAttribute("content") || ""}`)
		}
		if (headers?.["x-robots-tag"]) parts.push(`x-robots-tag: ${headers["x-robots-tag"]}`)
		const all = parts.join(", ").toLowerCase()
		return {
			raw: parts,
			noindex: /\b(noindex|none)\b/.test(all),
			nosnippet: /\bnosnippet\b/.test(all) || /max-snippet\s*:\s*0\b/.test(all),
			maxSnippet: all.match(/max-snippet\s*:\s*(-?\d+)/)?.[1] ?? null,
			nocache: /\bnocache\b/.test(all),
			noarchive: /\bnoarchive\b/.test(all),
			noai: /\bnoai\b|\bnoimageai\b/.test(all),
		}
	}

	function jsonLd() {
		const items = []
		let invalid = 0
		const visit = (node) => {
			if (!node || typeof node !== "object") return
			if (Array.isArray(node)) return node.forEach(visit)
			if (node["@graph"]) visit(node["@graph"])
			const types = [].concat(node["@type"] || []).map(String)
			if (types.length) items.push({ types, node })
		}
		for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
			try {
				visit(JSON.parse(script.textContent))
			} catch {
				invalid++
			}
		}
		return { items, invalid }
	}

	function mainRoot() {
		const candidates = [...document.querySelectorAll('main, [role="main"], article')].filter((node) => clean(node.innerText).length > 200)
		return candidates.sort((a, b) => clean(b.innerText).length - clean(a.innerText).length)[0] || document.body
	}

	function visibleParagraphs(root) {
		return [...root.querySelectorAll("p, li")].filter((p) => {
			const text = clean(p.innerText)
			if (text.length < 60) return false
			const rect = p.getBoundingClientRect()
			return rect.width > 0 && rect.height > 0
		})
	}

	function rawDocument(html) {
		try {
			const doc = new DOMParser().parseFromString(html || "", "text/html")
			for (const node of doc.querySelectorAll("script, style, noscript, template, svg")) node.remove()
			return doc
		} catch {
			return null
		}
	}

	function dateOf(value) {
		const t = Date.parse(value)
		return Number.isFinite(t) ? t : null
	}

	function freshness(ld) {
		const candidates = []
		for (const { node } of ld.items) {
			for (const key of ["dateModified", "datePublished", "uploadDate"]) if (node[key]) candidates.push({ source: `JSON-LD ${key}`, at: dateOf(node[key]) })
		}
		for (const name of ["article:modified_time", "og:updated_time", "article:published_time", "last-modified", "date"]) {
			const meta = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
			if (meta?.content) candidates.push({ source: `meta ${name}`, at: dateOf(meta.content) })
		}
		const time = document.querySelector("main time[datetime], article time[datetime], time[datetime]")
		if (time) candidates.push({ source: "<time> element", at: dateOf(time.getAttribute("datetime")) })
		const visible = /(updated|last updated|modified|published|posted)\s*(on)?\s*:?\s*([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4}|\d{4}-\d{2}-\d{2})/i.exec(clean(mainRoot().innerText).slice(0, 4000))
		if (visible) candidates.push({ source: "visible text", at: dateOf(visible[3]), visible: true })
		const dated = candidates.filter((c) => c.at)
		dated.sort((a, b) => b.at - a.at)
		return { newest: dated[0] ?? null, visible: Boolean(visible) || Boolean(time && time.getBoundingClientRect().width), candidates: dated }
	}

	function linkStats(root) {
		const host = location.hostname.replace(/^www\./, "")
		let outbound = 0
		let vague = 0
		const outboundHosts = new Set()
		for (const a of root.querySelectorAll("a[href]")) {
			let url
			try {
				url = new URL(a.getAttribute("href"), location.href)
			} catch {
				continue
			}
			const text = clean(a.innerText).toLowerCase()
			if (/^(click here|here|read more|more|learn more|this|link)$/.test(text)) vague++
			if (!/^https?:$/.test(url.protocol)) continue
			const other = url.hostname.replace(/^www\./, "")
			if (other !== host && !/(facebook|twitter|x|linkedin|instagram|pinterest|reddit|whatsapp|t)\.(com|me|co)$/.test(other)) {
				outbound++
				outboundHosts.add(other)
			}
		}
		return { outbound, outboundHosts: outboundHosts.size, vague }
	}

	function sitemapInfo(xml) {
		const locs = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"))
		const lastmods = [...String(xml).matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map((m) => m[1])
		const index = /<sitemapindex/i.test(xml)
		return { locs, lastmods, index }
	}

	function llmsValid(text) {
		const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim())
		const h1 = lines[0]?.match(/^#\s+(.+)/)
		return {
			valid: Boolean(h1),
			title: h1?.[1] ?? null,
			summary: lines.some((l) => /^>\s+\S/.test(l)),
			sections: lines.filter((l) => /^##\s+\S/.test(l)).length,
			links: lines.filter((l) => /^\s*[-*]\s*\[[^\]]+\]\([^)]+\)/.test(l)).length,
		}
	}

	function siteName(ld) {
		for (const { types, node } of ld.items) if (types.some((t) => /^(Organization|WebSite|Corporation)$/.test(t)) && node.name) return clean(node.name)
		const og = document.querySelector('meta[property="og:site_name"]')?.content
		if (og) return clean(og)
		return clean(document.title.split(/\s[|–—-]\s/).pop()) || location.hostname
	}

	function draftLlms(ld, sitemap) {
		const name = siteName(ld)
		const description = clean(document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || "")
		const origin = location.origin
		const seen = new Set()
		const linkOf = (a) => {
			try {
				const url = new URL(a.getAttribute("href"), location.href)
				if (url.origin !== origin || url.hash && url.pathname === location.pathname) return null
				url.hash = ""
				const text = clean(a.innerText || a.getAttribute("aria-label") || a.title)
				if (!text || text.length > 80 || seen.has(url.href)) return null
				seen.add(url.href)
				return `- [${text}](${url.href})`
			} catch {
				return null
			}
		}
		const sections = []
		const optional = []
		const nav = document.querySelector('header nav, nav[aria-label*="main" i], nav[aria-label*="primary" i], [role="navigation"], nav')
		if (nav) {
			const top = []
			for (const li of nav.querySelectorAll(":scope > ul > li, :scope > div > ul > li, :scope ul:first-of-type > li")) {
				const sub = li.querySelector("ul, [role=menu]")
				const head = li.querySelector("a[href], button, span")
				if (sub) {
					const items = [...sub.querySelectorAll("a[href]")].map(linkOf).filter(Boolean)
					if (items.length) sections.push({ title: clean(head?.innerText) || "Section", items })
				} else {
					const a = li.querySelector("a[href]")
					const item = a && linkOf(a)
					if (item) top.push(item)
				}
			}
			if (top.length) sections.unshift({ title: "Main pages", items: top })
		}
		const total = sections.reduce((n, s) => n + s.items.length, 0)
		if (total < 5 && sitemap?.locs?.length) {
			const groups = new Map()
			for (const loc of sitemap.locs.slice(0, 400)) {
				try {
					const url = new URL(loc)
					if (url.origin !== origin || seen.has(url.href)) continue
					seen.add(url.href)
					const segment = url.pathname.split("/").filter(Boolean)[0] || "home"
					const label = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "Home").replace(/[-_]+/g, " ").replace(/\.\w+$/, "")
					if (!groups.has(segment)) groups.set(segment, [])
					groups.get(segment).push(`- [${label.charAt(0).toUpperCase()}${label.slice(1)}](${url.href})`)
				} catch {}
			}
			for (const [segment, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
				sections.push({ title: segment === "home" ? "Pages" : segment.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()), items: items.slice(0, 15) })
			}
		}
		for (const a of document.querySelectorAll("footer a[href]")) {
			if (/privacy|terms|legal|cookie|careers|jobs|press|imprint|impressum|accessibility|security/i.test(`${a.innerText} ${a.getAttribute("href")}`)) {
				const item = linkOf(a)
				if (item) optional.push(item)
			}
		}
		const out = [`# ${name}`, ""]
		if (description) out.push(`> ${description}`, "")
		let budget = 100
		for (const section of sections) {
			if (budget <= 0) break
			const items = section.items.slice(0, budget)
			budget -= items.length
			out.push(`## ${section.title}`, "", ...items, "")
		}
		if (optional.length) out.push("## Optional", "", ...optional.slice(0, 15), "")
		return out.join("\n").trim() + "\n"
	}

	function grade(score) {
		if (score >= 85) return { label: "Excellent", tone: "good" }
		if (score >= 70) return { label: "Good", tone: "good" }
		if (score >= 50) return { label: "Needs work", tone: "warn" }
		return { label: "Poor", tone: "bad" }
	}

	async function audit(payload, h) {
		const response = await h.sendRuntime({ type: "ai-readiness:fetch", url: location.href })
		const signals = response?.ok ? response.data : null
		if (!signals || signals.error) return { ok: false, error: `Could not read this site's files: ${signals?.error ?? response?.error ?? "no response"}` }
		const ld = jsonLd()
		const sitemapText = signals.sitemap?.ok && /<(urlset|sitemapindex)/i.test(signals.sitemap.text) ? signals.sitemap.text : ""
		const sitemap = sitemapText ? sitemapInfo(sitemapText) : null

		if (payload.output === "llms") {
			const draft = draftLlms(ld, sitemap)
			const existing = signals.llms?.ok && /^\s*#\s/.test(signals.llms.text) ? "This site already has an llms.txt; compare before replacing it." : "Upload this as /llms.txt at the site root."
			return { ok: true, data: { type: "text", value: draft, copy: draft, download: { filename: "llms.txt", mime: "text/plain", text: draft }, meta: `${draft.split("\n").filter((l) => /^\s*-\s\[/.test(l)).length} links`, note: `Draft built from this page's navigation${sitemap ? " and sitemap" : ""}. ${existing} Add a one-line note after each link describing the page.` } }
		}

		const checks = []
		const add = (category, points, max, label, detail, tone, fix) => checks.push({ category, points, max, label, detail, tone: tone ?? (points >= max ? "good" : points > 0 ? "warn" : "bad"), fix })
		const path = `${location.pathname}${location.search}`
		const caps = []

		const robotsStatus = signals.robots?.status ?? null
		const robotsHtml = /html/i.test(signals.robots?.contentType || "") && /<html/i.test(signals.robots?.text || "")
		let robots = { groups: [], sitemaps: [], signals: [] }
		if (robotsStatus && robotsStatus >= 200 && robotsStatus < 300 && !robotsHtml) {
			robots = parseRobots(signals.robots.text)
			add("access", 2, 2, "robots.txt", `Found, ${robots.groups.length} rule group${robots.groups.length === 1 ? "" : "s"}`)
		} else if (robotsStatus >= 500 || (!robotsStatus && signals.robots?.error)) {
			add("access", 0, 2, "robots.txt", `Returned ${robotsStatus ?? signals.robots?.error}; crawlers treat a server error as "do not crawl anything"`, "bad", "Make /robots.txt return 200 (or 404 if you have no rules).")
			caps.push("robots.txt errors block all crawlers")
		} else {
			add("access", 2, 2, "robots.txt", robotsHtml ? "Returns an HTML page instead of rules, so crawlers treat it as missing (everything allowed)" : `Not found (${robotsStatus}); everything is allowed`, robotsHtml ? "warn" : "good")
		}

		const blockedAll = caps.length > 0
		const verdicts = BOTS.map((bot) => ({ ...bot, ...(blockedAll ? { allowed: false, why: "robots.txt server error" } : verdictFor(robots, bot.token, path, bot.fallback)) }))
		const searchBots = verdicts.filter((v) => v.purpose === "search")
		const searchAllowed = searchBots.filter((v) => v.allowed).length
		add("access", Math.round((13 * searchAllowed) / searchBots.length), 13, "AI search crawlers", `${searchAllowed} of ${searchBots.length} can read this page${searchAllowed < searchBots.length ? `; blocked: ${searchBots.filter((v) => !v.allowed).map((v) => v.token).join(", ")}` : ""}`, undefined, searchAllowed < searchBots.length ? "Allow the search crawlers you want to be cited by (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot) in robots.txt. You can still block training bots separately." : null)
		if (searchAllowed === 0) caps.push("every AI search crawler is blocked")

		const directives = robotsDirectives(signals.html?.headers)
		if (directives.noindex) {
			add("access", 0, 6, "Indexing", `noindex is set (${directives.raw.join("; ")}); search engines and AI search drop the page`, "bad", "Remove noindex from the robots meta tag or X-Robots-Tag header if this page should be found.")
			caps.push("the page is noindex")
		} else add("access", 6, 6, "Indexing", "No noindex directive")
		if (directives.nosnippet || directives.nocache || directives.noarchive) {
			add("access", 0, 2, "Snippet controls", `${[directives.nosnippet && "nosnippet / max-snippet:0 keeps text out of Google AI Overviews", directives.nocache && "nocache limits Copilot to the title and URL", directives.noarchive && "noarchive keeps the page out of Copilot answers"].filter(Boolean).join("; ")}`, "warn", "Remove nosnippet, nocache or noarchive unless you mean to stay out of AI answers.")
		} else add("access", 2, 2, "Snippet controls", directives.maxSnippet ? `max-snippet:${directives.maxSnippet}` : "No snippet limits")

		const canonical = document.querySelector('link[rel="canonical"]')?.href
		if (!canonical) add("access", 1, 2, "Canonical URL", "No canonical link; fine for unique pages, risky for duplicates", "warn", 'Add <link rel="canonical" href="..."> pointing at the preferred URL.')
		else {
			let sameHost = false
			try {
				sameHost = new URL(canonical).hostname === location.hostname
			} catch {}
			const self = canonical.replace(/[?#].*$/, "").replace(/\/$/, "") === location.href.replace(/[?#].*$/, "").replace(/\/$/, "")
			add("access", sameHost ? 2 : 1, 2, "Canonical URL", self ? "Points to this page" : `Points to ${canonical}; crawlers may credit that URL instead`, self ? "good" : "info")
		}

		const rendered = mainRoot()
		const renderedText = clean(rendered.innerText)
		const raw = signals.html?.ok ? rawDocument(signals.html.text) : null
		const rawText = raw ? clean(raw.body?.textContent || "") : ""
		const samples = visibleParagraphs(rendered).slice(0, 15).map((p) => clean(p.innerText).slice(0, 80))
		let ratio = null
		if (raw) {
			ratio = samples.length ? samples.filter((s) => rawText.includes(s)).length / samples.length : Math.min(1, rawText.length / Math.max(1, renderedText.length))
			const points = ratio >= 0.8 ? 14 : ratio >= 0.5 ? 8 : 2
			add("content", points, 14, "Text in the initial HTML", `${Math.round(ratio * 100)}% of the visible paragraphs are in the HTML before JavaScript runs${rawText.length < 200 && renderedText.length > 1000 ? " (the HTML is an empty app shell)" : ""}`, undefined, ratio < 0.8 ? "Render the main content on the server (SSR or static generation). GPTBot, ClaudeBot and PerplexityBot download pages but do not run JavaScript." : null)
			const h1Raw = clean(raw.querySelector("h1")?.textContent)
			add("content", h1Raw ? 3 : 0, 3, "Heading in the initial HTML", h1Raw ? `"${h1Raw.slice(0, 80)}"` : "No <h1> before JavaScript runs", undefined, h1Raw ? null : "Server-render the page heading.")
			const titleRaw = clean(raw.querySelector("title")?.textContent)
			const descRaw = raw.querySelector('meta[name="description"]')?.getAttribute("content")
			add("content", (titleRaw ? 1.5 : 0) + (descRaw ? 1.5 : 0), 3, "Title and description in the initial HTML", `${titleRaw ? "title ✓" : "title missing"} · ${descRaw ? "meta description ✓" : "meta description missing"}`, undefined, titleRaw && descRaw ? null : "Put <title> and <meta name=\"description\"> in the server response, not only via JavaScript.")
		} else {
			add("content", 7, 14, "Text in the initial HTML", `Could not fetch the raw page (${signals.html?.status ?? signals.html?.error ?? "unknown"}); checked the rendered page only`, "warn")
			add("content", document.querySelector("h1") ? 3 : 0, 3, "Heading", document.querySelector("h1") ? "Present" : "Missing")
			add("content", 1.5, 3, "Title and description", "Not verified without the raw HTML", "warn")
		}

		const h1s = [...document.querySelectorAll("h1")].filter((n) => clean(n.innerText))
		add("structure", h1s.length === 1 ? 4 : h1s.length > 1 ? 2 : 0, 4, "One main heading (H1)", h1s.length === 1 ? `"${clean(h1s[0].innerText).slice(0, 80)}"` : h1s.length ? `${h1s.length} H1 headings` : "No H1", undefined, h1s.length === 1 ? null : "Use exactly one H1 that states what the page is about.")
		const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((n) => clean(n.innerText))
		let skips = 0
		for (let i = 1; i < headings.length; i++) if (Number(headings[i].tagName[1]) - Number(headings[i - 1].tagName[1]) > 1) skips++
		add("structure", skips === 0 ? 3 : skips <= 2 ? 2 : 0, 3, "Heading order", skips ? `${skips} skipped level${skips === 1 ? "" : "s"} (for example H2 straight to H4)` : "No skipped levels", undefined, skips ? "Nest headings in order (H2, then H3) so sections read as chapters." : null)
		const subheads = headings.filter((n) => /^H[23]$/.test(n.tagName))
		const questions = subheads.filter((n) => /\?\s*$|^(how|what|why|when|which|who|can|does|is|are|should)\b/i.test(clean(n.innerText))).length
		add("structure", subheads.length >= 3 ? 3 : subheads.length ? 2 : 0, 3, "Section headings", `${subheads.length} H2/H3 headings${questions ? `, ${questions} phrased as questions` : ""}`, undefined, subheads.length >= 3 ? null : "Break the content into sections with descriptive H2/H3 headings; question-style headings match how people ask AI.")
		const paragraphs = [...rendered.querySelectorAll("p")].map((p) => clean(p.innerText)).filter((t) => t.length > 40)
		const firstWords = paragraphs[0] ? words(paragraphs[0]) : 0
		add("structure", paragraphs[0] && firstWords <= 80 ? 2 : paragraphs[0] ? 1 : 0, 2, "Answer-first opening", paragraphs[0] ? `First paragraph is ${firstWords} words` : "No opening paragraph found", undefined, paragraphs[0] && firstWords <= 80 ? null : "Open with a short paragraph that directly answers the page's main question.")
		const lists = rendered.querySelectorAll("ul li, ol li").length
		const tables = rendered.querySelectorAll("table").length
		add("structure", lists >= 3 || tables ? 2 : 0, 2, "Lists and tables", `${lists} list items, ${tables} tables`, undefined, lists >= 3 || tables ? null : "Use lists and tables for steps, options and comparisons; AI answers lift them directly.")
		const avg = paragraphs.length ? paragraphs.reduce((n, t) => n + words(t), 0) / paragraphs.length : 0
		add("structure", !paragraphs.length || avg <= 120 ? 2 : 1, 2, "Paragraph length", paragraphs.length ? `${Math.round(avg)} words on average` : "No paragraphs", undefined, avg > 120 ? "Split walls of text into short, factual paragraphs." : null)
		const title = clean(document.title)
		const description = clean(document.querySelector('meta[name="description"]')?.content)
		add("structure", (title.length >= 10 && title.length <= 70 ? 1 : 0.5 * Boolean(title)) + (description.length >= 50 && description.length <= 170 ? 1 : 0.5 * Boolean(description)), 2, "Title and meta description", `Title ${title.length} characters, description ${description.length} characters`, undefined, "Aim for a 10 to 70 character title and a 50 to 170 character description.")
		const images = [...rendered.querySelectorAll("img")].filter((img) => img.getBoundingClientRect().width > 40)
		const withAlt = images.filter((img) => clean(img.getAttribute("alt"))).length
		add("structure", !images.length || withAlt / images.length >= 0.9 ? 1 : 0, 1, "Image alt text", images.length ? `${withAlt} of ${images.length} content images described` : "No content images", undefined, "Describe informative images with alt text; AI cannot read text inside images.")
		const links = linkStats(rendered)
		add("structure", links.vague <= 2 ? 1 : 0, 1, "Descriptive link text", links.vague ? `${links.vague} links say "click here" or "read more"` : "Links describe their target", undefined, links.vague > 2 ? "Make link text say where it goes." : null)

		const authorLd = ld.items.some(({ node }) => node.author)
		const author = authorLd || Boolean(document.querySelector('meta[name="author"], [rel="author"], [itemprop="author"], [class*="author" i], [class*="byline" i]'))
		add("trust", author ? 3 : 0, 3, "Author", author ? "Author or byline found" : "No author or byline", undefined, author ? null : "Show who wrote the page and link to an author or team page.")
		const fresh = freshness(ld)
		const ageDays = fresh.newest ? (Date.now() - fresh.newest.at) / 86400000 : null
		add("trust", fresh.newest ? (ageDays <= 365 ? (fresh.visible ? 3 : 2) : 1) : 0, 3, "Freshness", fresh.newest ? `Newest date ${new Date(fresh.newest.at).toISOString().slice(0, 10)} (${fresh.newest.source})${fresh.visible ? ", shown on the page" : ", not shown on the page"}` : "No published or updated date", undefined, fresh.newest && ageDays <= 365 && fresh.visible ? null : "Show a visible \"Updated\" date that matches dateModified in your structured data, and keep key pages current.")
		add("trust", links.outboundHosts >= 2 ? 3 : links.outboundHosts ? 2 : 0, 3, "Cites sources", `${links.outbound} links to ${links.outboundHosts} other sites`, undefined, links.outboundHosts >= 2 ? null : "Link to the sources behind your claims; in the GEO study, citing sources raised AI visibility by about 27%.")
		const stats = (renderedText.match(/\b\d+(?:[.,]\d+)?\s?%|\$\s?\d[\d,.]*|\b\d{2,}(?:[.,]\d+)?\s?(?:ms|kb|mb|gb|x|times|users|customers|people|million|billion)\b/gi) || []).length
		add("trust", stats >= 3 ? 2 : stats ? 1 : 0, 2, "Statistics", `${stats} figures found`, undefined, stats >= 3 ? null : "Add concrete numbers and data; statistics raised AI visibility by about 32% in the GEO study.")
		const quotes = rendered.querySelectorAll("blockquote, q").length
		add("trust", quotes ? 1 : 0, 1, "Quotations", quotes ? `${quotes} quotes` : "No quotations", quotes ? "good" : "info", quotes ? null : "Where it fits, quote named experts or sources; quotations gave the largest lift in the GEO study.")
		const aboutContact = [...document.querySelectorAll("a[href]")].filter((a) => /about|contact|team|company/i.test(`${a.innerText} ${a.getAttribute("href")}`)).length
		add("trust", aboutContact ? 2 : 0, 2, "About and contact pages", aboutContact ? "Linked" : "Not linked from this page", undefined, aboutContact ? null : "Link to About and Contact pages so assistants can verify who is behind the site.")
		add("trust", location.protocol === "https:" ? 1 : 0, 1, "HTTPS", location.protocol === "https:" ? "Served over HTTPS" : "Not HTTPS")

		const types = [...new Set(ld.items.flatMap((i) => i.types))]
		add("data", ld.items.length && !ld.invalid ? 3 : ld.items.length ? 2 : 0, 3, "JSON-LD", ld.items.length ? `${ld.items.length} items${ld.invalid ? `, ${ld.invalid} blocks that do not parse` : ""}` : "None", undefined, ld.items.length ? (ld.invalid ? "Fix the JSON-LD blocks that do not parse." : null) : "Add schema.org JSON-LD that describes the page (Article, Product, Organization, BreadcrumbList).")
		const relevant = types.filter((t) => RELEVANT_TYPES.test(t))
		add("data", relevant.length ? 4 : 0, 4, "Schema types", relevant.length ? relevant.join(", ") : types.length ? `Only ${types.join(", ")}` : "None", undefined, relevant.length ? null : "Mark up the main entity of the page with a fitting schema.org type.")
		let completeness = 0
		let completenessNote = "No main entity to check"
		const article = ld.items.find((i) => i.types.some((t) => /Article|BlogPosting|Report/.test(t)))
		const product = ld.items.find((i) => i.types.includes("Product"))
		const org = ld.items.find((i) => i.types.some((t) => /Organization|Corporation|LocalBusiness/.test(t)))
		if (article) {
			const has = ["author", "datePublished", "dateModified", "headline"].filter((k) => article.node[k])
			completeness = has.length >= 4 ? 3 : has.length >= 2 ? 2 : 1
			completenessNote = `Article has ${has.join(", ") || "no key fields"}`
		} else if (product) {
			const has = ["offers", "name", "image", "aggregateRating", "brand"].filter((k) => product.node[k])
			completeness = product.node.offers ? (has.length >= 3 ? 3 : 2) : 1
			completenessNote = `Product has ${has.join(", ")}`
		} else if (org) {
			const has = ["name", "url", "logo", "sameAs"].filter((k) => org.node[k])
			completeness = has.length >= 4 ? 3 : has.length >= 2 ? 2 : 1
			completenessNote = `Organization has ${has.join(", ")}`
		}
		add("data", completeness, 3, "Key properties", completenessNote, undefined, completeness >= 3 ? null : "Fill in the key properties (author and dates for articles, offers for products, logo and sameAs for organizations).")
		const ldHeadline = clean(article?.node?.headline)
		if (ldHeadline && !renderedText.toLowerCase().includes(ldHeadline.toLowerCase().slice(0, 40))) {
			add("data", 0, 0, "Facts only in markup", "The JSON-LD headline does not appear in the visible text; ChatGPT and Gemini read only visible text when they fetch a page", "warn", "Make sure every fact in structured data is also visible on the page.")
		}

		const sitemapUrls = [...new Set([...robots.sitemaps, sitemap ? `${location.origin}/sitemap.xml` : null].filter(Boolean))]
		if (sitemap || robots.sitemaps.length) {
			add("discovery", 4, 4, "Sitemap", sitemapUrls.join(", "))
			if (sitemap && !sitemap.index) {
				const here = location.href.replace(/[?#].*$/, "").replace(/\/$/, "")
				const listed = sitemap.locs.some((loc) => loc.replace(/\/$/, "") === here)
				add("discovery", listed ? 1.5 : 0, 1.5, "This page in the sitemap", listed ? "Listed" : `Not among the ${sitemap.locs.length} URLs`, undefined, listed ? null : "List this URL in the sitemap if it should be found.")
				const distinct = new Set(sitemap.lastmods.map((d) => d.slice(0, 10))).size
				add("discovery", sitemap.lastmods.length && distinct > 1 ? 1.5 : sitemap.lastmods.length ? 0.5 : 0, 1.5, "Sitemap lastmod", sitemap.lastmods.length ? `${sitemap.lastmods.length} dates, ${distinct} distinct` : "No lastmod dates", undefined, distinct > 1 ? null : "Give each URL a real ISO 8601 lastmod (Bing uses it for AI freshness); not the time the sitemap was generated.")
			} else add("discovery", 2, 3, "Sitemap contents", sitemap?.index ? "A sitemap index; individual URLs not checked" : "Declared in robots.txt; not fetched", "info")
		} else {
			add("discovery", 0, 4, "Sitemap", "No sitemap at /sitemap.xml or in robots.txt", "bad", "Publish an XML sitemap and reference it in robots.txt.")
			add("discovery", 0, 3, "Sitemap contents", "No sitemap", "bad")
		}
		const llms = signals.llms?.ok ? llmsValid(signals.llms.text) : null
		const llmsBonus = llms?.valid ? (llms.summary && llms.links ? 3 : 2) : 0
		if (llms?.valid) add("discovery", llmsBonus, 3, "llms.txt", `"${llms.title}", ${llms.sections} sections, ${llms.links} links${signals.llmsFull?.ok ? "; llms-full.txt also present" : ""}`, llmsBonus === 3 ? "good" : "warn")
		else add("discovery", 0, 0, "llms.txt", signals.llms?.ok ? "Present but missing the required # title line" : "Not present. Optional: few AI crawlers read it today, but coding agents do. Run this tool with \"Draft llms.txt\" to create one.", "info")

		const categories = [
			["access", "AI access & indexing", 25],
			["content", "Visible without JavaScript", 20],
			["structure", "Structure", 20],
			["trust", "Citability & trust", 15],
			["data", "Structured data", 10],
			["discovery", "Discovery files", llms?.valid ? 10 : 7],
		]
		const earned = checks.reduce((n, c) => n + c.points, 0)
		const possible = checks.reduce((n, c) => n + c.max, 0)
		let score = Math.round((earned / possible) * 100)
		if (caps.length) score = Math.min(score, 30)
		const g = grade(score)

		const summary = [
			{ label: `AI readiness · ${g.label}`, value: `${score}/100`, tone: g.tone },
			{ label: "AI search bots allowed", value: `${searchAllowed}/${searchBots.length}`, tone: searchAllowed === searchBots.length ? "good" : searchAllowed ? "warn" : "bad" },
			{ label: "Visible without JS", value: ratio === null ? "?" : `${Math.round(ratio * 100)}%`, tone: ratio === null ? "warn" : ratio >= 0.8 ? "good" : ratio >= 0.5 ? "warn" : "bad" },
			{ label: "Schema types", value: relevant.length, tone: relevant.length ? "good" : "warn" },
			{ label: "llms.txt", value: llms?.valid ? "Yes" : "No", tone: llms?.valid ? "good" : "info" },
		]
		const fixes = checks.filter((c) => c.fix && c.points < c.max).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, 8)
		const sections = []
		if (caps.length) sections.push({ title: "Score capped at 30", items: caps.map((reason) => ({ label: "Blocker", detail: reason, tone: "bad" })) })
		sections.push({ title: "Top fixes", items: fixes.map((c) => ({ label: `${c.label} (+${Math.round((c.max - c.points) * 10) / 10})`, detail: c.fix, tone: c.tone === "good" ? "warn" : c.tone })) })
		sections.push({
			title: "Score breakdown",
			items: categories.map(([key, label]) => {
				const max = checks.filter((c) => c.category === key).reduce((n, c) => n + c.max, 0)
				const got = checks.filter((c) => c.category === key).reduce((n, c) => n + c.points, 0)
				const pct = max ? got / max : 1
				return { label, detail: `${Math.round(got * 10) / 10} of ${max}`, tone: pct >= 0.85 ? "good" : pct >= 0.5 ? "warn" : "bad" }
			}),
		})
		sections.push({
			title: "AI crawlers on this page",
			items: verdicts.map((v) => ({ label: `${v.token}: ${v.allowed ? "allowed" : "blocked"}`, detail: `${PURPOSE_LABEL[v.purpose]} · ${v.vendor} · ${v.why}`, tone: v.allowed ? "good" : v.purpose === "search" ? "bad" : "info" })),
		})
		for (const [key, label] of categories) {
			sections.push({ title: label, items: checks.filter((c) => c.category === key).map((c) => ({ label: c.label, detail: c.detail, tone: c.tone })) })
		}
		const notes = []
		if (directives.noai) notes.push({ label: "noai / noimageai", detail: "Present; no major AI vendor has committed to honoring it", tone: "info" })
		if (robots.signals.length) notes.push({ label: "Content-Signal", detail: robots.signals.join(" · "), tone: "info" })
		const trainingBlocked = verdicts.filter((v) => v.purpose === "training" && !v.allowed)
		if (trainingBlocked.length) notes.push({ label: "Training bots blocked", detail: `${trainingBlocked.map((v) => v.token).join(", ")}; this does not affect AI search citations`, tone: "info" })
		notes.push({ label: "What this score means", detail: "It measures whether AI assistants can crawl, read and quote this page. Whether they actually cite it also depends on off-page signals such as brand mentions and search rankings.", tone: "info" })
		sections.push({ title: "Notes", items: notes })

		const markdown = [`# AI search readiness: ${location.href}`, `Score **${score}/100** (${g.label}) · ${new Date().toISOString().slice(0, 10)}`, "", "## Top fixes", ...fixes.map((c) => `- **${c.label}**: ${c.fix}`), "", "## Checks", ...checks.map((c) => `- ${c.tone === "good" ? "✅" : c.tone === "bad" ? "❌" : c.tone === "warn" ? "⚠️" : "ℹ️"} ${c.label}: ${c.detail}`), "", "## AI crawlers", ...verdicts.map((v) => `- ${v.allowed ? "✅" : "⛔"} ${v.token} (${PURPOSE_LABEL[v.purpose]}): ${v.why}`)].join("\n")
		return {
			ok: true,
			data: {
				type: "report",
				value: { summary, sections: sections.filter((s) => s.items.length) },
				copy: markdown,
				download: { filename: "ai-readiness.md", mime: "text/markdown", text: markdown },
				meta: `${score}/100`,
			},
		}
	}

	globalThis.__sidekickAiReadiness = audit
})()
