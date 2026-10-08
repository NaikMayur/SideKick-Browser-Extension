;(() => {
	const UNLIKELY = /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i
	const MAYBE = /and|article|body|column|content|main|mathjax|shadow/i
	const POSITIVE = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i
	const NEGATIVE = /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i
	const CLUTTER = 'nav, aside, header:not(article header):not(main header), footer:not(article footer):not(main footer), [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .sidebar, .modal, .popup, .ad, .ads, .advert, .advertisement, .social, .share, .sharing, .widget, [class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="newsletter" i], [class*="related-" i], [class*="breadcrumb" i], .skip-link, [class*="skip-to" i]'
	const ENTRY = ["#post", ".post-content", ".entry-content", ".article-content", ".article-body", "[itemprop=articleBody]", ".post-body", ".markdown-body", ".prose", ".content", "#content", "article", "main", '[role="main"]', "body"]

	function clean(text) {
		return String(text ?? "").replace(/\s+/g, " ").trim()
	}

	function visible(el) {
		if (typeof el.checkVisibility === "function") {
			try {
				return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })
			} catch {}
		}
		const style = getComputedStyle(el)
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
	}

	function classWeight(el) {
		let weight = 0
		for (const value of [typeof el.className === "string" ? el.className : "", el.id || ""]) {
			if (!value) continue
			if (NEGATIVE.test(value)) weight -= 25
			if (POSITIVE.test(value)) weight += 25
		}
		return weight
	}

	function linkDensity(el) {
		const total = clean(el.innerText).length
		if (!total) return 0
		let linked = 0
		for (const a of el.querySelectorAll("a")) linked += clean(a.innerText).length * ((a.getAttribute("href") || "").startsWith("#") ? 0.3 : 1)
		return Math.min(1, linked / total)
	}

	function unlikely(el) {
		for (let node = el; node && node !== document.body; node = node.parentElement) {
			const role = node.getAttribute("role")
			if (role && /^(menu|menubar|navigation|complementary|dialog|alert|alertdialog|banner|contentinfo)$/.test(role)) return true
			if (node.getAttribute("aria-hidden") === "true" || node.hidden) return true
			const tag = node.tagName
			if (tag === "NAV" || tag === "ASIDE") return true
			const match = `${typeof node.className === "string" ? node.className : ""} ${node.id || ""}`
			if (UNLIKELY.test(match) && !MAYBE.test(match) && !/^(BODY|A|TABLE|CODE|PRE|ARTICLE|MAIN)$/.test(tag) && !node.closest("table, code")) return true
		}
		return false
	}

	function readabilityRoot() {
		const scores = new Map()
		const base = (el) => {
			if (scores.has(el)) return
			let score = classWeight(el)
			const tag = el.tagName
			if (tag === "DIV") score += 5
			else if (/^(PRE|TD|BLOCKQUOTE)$/.test(tag)) score += 3
			else if (/^(ADDRESS|OL|UL|DL|DD|DT|LI|FORM)$/.test(tag)) score -= 3
			else if (/^(H[1-6]|TH)$/.test(tag)) score -= 5
			scores.set(el, score)
		}
		const nodes = document.body.querySelectorAll("p, pre, td, section, h2, h3, h4, h5, h6, blockquote")
		let count = 0
		for (const node of nodes) {
			if (++count > 6000) break
			const text = clean(node.innerText)
			if (text.length < 25 || !visible(node) || unlikely(node)) continue
			const score = 1 + text.split(/[,，、]/).length - 1 + Math.min(Math.floor(text.length / 100), 3)
			let ancestor = node.parentElement
			for (let level = 0; ancestor && level < 5 && ancestor !== document.documentElement; level++, ancestor = ancestor.parentElement) {
				base(ancestor)
				const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3
				scores.set(ancestor, scores.get(ancestor) + score / divider)
			}
		}
		let top = null
		let topScore = -Infinity
		const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
		for (const [el] of ranked.slice(60)) scores.delete(el)
		for (const [el, score] of ranked.slice(0, 60)) {
			const final = score * (1 - linkDensity(el))
			scores.set(el, final)
			if (final > topScore) {
				top = el
				topScore = final
			}
		}
		if (!top) return null
		for (let parent = top.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
			const parentScore = scores.get(parent)
			if (parentScore === undefined) continue
			if (parentScore < topScore / 3) break
			if (parentScore > scores.get(top)) top = parent
		}
		return top
	}

	function entryRoot() {
		let best = null
		let bestScore = -Infinity
		ENTRY.forEach((selector, index) => {
			for (const el of document.querySelectorAll(selector)) {
				if (!visible(el)) continue
				const text = clean(el.innerText)
				const words = text ? text.split(" ").length : 0
				if (words < 40 && selector !== "body") continue
				const paragraphs = el.querySelectorAll("p").length
				const commas = (text.match(/,/g) || []).length
				const score = (ENTRY.length - index) * 40 + (words + 10 * paragraphs + commas) * (1 - Math.min(linkDensity(el), 0.5))
				if (score > bestScore) {
					best = el
					bestScore = score
				}
			}
		})
		return best
	}

	function linkFree(markdown) {
		return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\[\d+\]/g, "$1").replace(/^\[\d+\]: .*$/gm, "").length
	}

	function selectionRoot() {
		const selection = window.getSelection()
		if (!selection || selection.isCollapsed || !clean(selection.toString())) return null
		const box = document.createElement("div")
		for (let i = 0; i < selection.rangeCount; i++) box.appendChild(selection.getRangeAt(i).cloneContents())
		return box
	}

	function contentMode(payload, h) {
		const md = globalThis.__sidekickMd
		const opts = { skipHidden: true, links: payload.links === "none" ? false : payload.links === "refs" ? "refs" : true, images: payload.images ? "markdown" : "alt", headingShift: 0 }
		let markdown = ""
		let source = ""
		if (payload.scope === "selection") {
			const box = selectionRoot()
			if (!box) return { ok: false, error: "Select some text on the page first, then run again." }
			markdown = md.convert(box, { ...opts, skipHidden: false })
			source = "selection"
		} else if (payload.scope === "page") {
			markdown = md.convert(document.body, { ...opts, skip: '[role="dialog"], [aria-modal="true"], [class*="cookie" i], [id*="cookie" i], [class*="consent" i]' })
			source = "whole page"
		} else {
			const candidates = [readabilityRoot(), entryRoot()].filter(Boolean)
			const best = candidates.map((root) => ({ root, md: md.convert(root, { ...opts, skip: CLUTTER }) })).sort((a, b) => linkFree(b.md) - linkFree(a.md))[0]
			const whole = md.convert(document.body, { ...opts, skip: CLUTTER })
			if (!best || linkFree(best.md) < linkFree(whole) * 0.3) {
				markdown = whole
				source = "whole page (no clear main content)"
			} else {
				markdown = best.md
				source = `main content (${best.root.tagName.toLowerCase()}${best.root.id ? `#${best.root.id}` : ""})`
			}
		}
		if (!markdown.trim()) return { ok: false, error: "No readable text found on this page." }
		const title = clean(document.title) || location.hostname
		const description = clean(document.querySelector('meta[name="description"]')?.content)
		const head = /^#s/.test(markdown) ? [`Source: ${location.href}`] : [`# ${title}`, `Source: ${location.href}`]
		if (description && payload.scope !== "selection") head.push(`> ${description}`)
		const text = `${head.join("\n")}\n\n${markdown}\n`
		const tokens = md.estimateTokens(text)
		const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page"
		return {
			ok: true,
			data: {
				type: "text",
				value: text,
				copy: text,
				download: { filename: `${slug}.md`, mime: "text/markdown", text },
				meta: `≈${tokens.toLocaleString()} tokens`,
				note: `Captured the ${source}. About ${tokens.toLocaleString()} tokens for GPT-4o-class models; Claude counts roughly 20 to 40% more.`,
			},
		}
	}

	function clamp(n, lo, hi) {
		return Math.min(hi, Math.max(lo, n))
	}

	function alphaOf(raw) {
		if (raw === undefined) return 1
		return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw)
	}

	function fromLinear(c) {
		const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
		return Math.round(clamp(v, 0, 1) * 255)
	}

	function oklabToRgb(L, a, b, alpha) {
		const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
		const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
		const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
		return {
			r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
			g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
			b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
			a: alpha,
		}
	}

	function parseColor(value) {
		const v = String(value || "").trim().toLowerCase()
		if (!v || v === "transparent" || v === "none" || v === "currentcolor") return null
		let m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
		if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: alphaOf(m[4]) }
		m = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+|none)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) {
			const L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])
			const C = m[2].endsWith("%") ? (parseFloat(m[2]) / 100) * 0.4 : parseFloat(m[2])
			const H = m[3] === "none" ? 0 : (parseFloat(m[3]) * Math.PI) / 180
			return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), alphaOf(m[4]))
		}
		m = v.match(/^oklab\(\s*([\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) {
			const num = (s, scale) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s))
			return oklabToRgb(num(m[1], 1), num(m[2], 0.4), num(m[3], 0.4), alphaOf(m[4]))
		}
		m = v.match(/^color\(srgb\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) return { r: Math.round(clamp(+m[1], 0, 1) * 255), g: Math.round(clamp(+m[2], 0, 1) * 255), b: Math.round(clamp(+m[3], 0, 1) * 255), a: alphaOf(m[4]) }
		m = v.match(/^color\(display-p3\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) {
			const lin = [+m[1], +m[2], +m[3]].map(toLinear)
			return xyzToRgb(multiply(P3_TO_XYZ, lin), alphaOf(m[4]))
		}
		m = v.match(/^lab\(\s*([\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) {
			const num = (s, scale) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s))
			return labToRgb(num(m[1], 100), num(m[2], 125), num(m[3], 125), alphaOf(m[4]))
		}
		m = v.match(/^lch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+|none)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
		if (m) {
			const L = m[1].endsWith("%") ? parseFloat(m[1]) : parseFloat(m[1])
			const C = m[2].endsWith("%") ? (parseFloat(m[2]) / 100) * 150 : parseFloat(m[2])
			const H = m[3] === "none" ? 0 : (parseFloat(m[3]) * Math.PI) / 180
			return labToRgb(L, C * Math.cos(H), C * Math.sin(H), alphaOf(m[4]))
		}
		return null
	}

	const P3_TO_XYZ = [
		[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
		[0.2289745640697488, 0.6917385218365064, 0.079286914093745],
		[0, 0.04511338185890264, 1.043944368900976],
	]
	const XYZ_TO_SRGB = [
		[3.2409699419045226, -1.537383177570094, -0.4986107602930034],
		[-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
		[0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
	]
	const D50_TO_D65 = [
		[0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
		[-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
		[0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
	]

	function multiply(matrix, vector) {
		return matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2])
	}

	function toLinear(c) {
		const sign = c < 0 ? -1 : 1
		const abs = Math.abs(c)
		return abs <= 0.04045 ? c / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4)
	}

	function xyzToRgb(xyz, alpha) {
		const [r, g, b] = multiply(XYZ_TO_SRGB, xyz).map(fromLinear)
		return { r, g, b, a: alpha }
	}

	function labToRgb(L, a, b, alpha) {
		const kappa = 24389 / 27
		const epsilon = 216 / 24389
		const f1 = (L + 16) / 116
		const f0 = a / 500 + f1
		const f2 = f1 - b / 200
		const x = Math.pow(f0, 3) > epsilon ? Math.pow(f0, 3) : (116 * f0 - 16) / kappa
		const y = L > kappa * epsilon ? Math.pow(f1, 3) : L / kappa
		const z = Math.pow(f2, 3) > epsilon ? Math.pow(f2, 3) : (116 * f2 - 16) / kappa
		return xyzToRgb(multiply(D50_TO_D65, [x * 0.3457 / 0.3585, y, z * (1 - 0.3457 - 0.3585) / 0.3585]), alpha)
	}

	function hexOf(color) {
		if (!color) return null
		const part = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")
		const base = `#${part(color.r)}${part(color.g)}${part(color.b)}`
		return color.a < 0.999 ? `${base}${part(color.a * 255)}` : base
	}

	function toHex(value) {
		return hexOf(parseColor(value)) ?? value
	}

	function labOf({ r, g, b }) {
		const lin = (c) => {
			const v = c / 255
			return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
		}
		const R = lin(r)
		const G = lin(g)
		const B = lin(b)
		const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
		const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
		const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
		const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
		return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) }
	}

	function deltaE(c1, c2) {
		const a = labOf(c1)
		const b = labOf(c2)
		return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
	}

	function px(value) {
		const n = parseFloat(value)
		return Number.isFinite(n) ? n : 0
	}

	function fmt(n) {
		return `${Math.round(n * 100) / 100}px`
	}

	const NON_INHERITED = ["display", "position", "top", "right", "bottom", "left", "z-index", "float", "box-sizing", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "align-self", "row-gap", "column-gap", "flex-grow", "flex-shrink", "flex-basis", "order", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-auto-flow", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "background-color", "background-image", "background-size", "background-position", "background-repeat", "box-shadow", "opacity", "transform", "filter", "backdrop-filter", "overflow-x", "overflow-y", "object-fit", "max-width", "min-height", "text-decoration-line", "vertical-align"]
	const INHERITED = ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "white-space", "cursor", "list-style-type"]
	const SIZED = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|INPUT|SELECT|TEXTAREA|BUTTON|HR)$/

	let defaultsFrame = null
	const defaultsCache = new Map()

	function defaultsFor(tag) {
		if (defaultsCache.has(tag)) return defaultsCache.get(tag)
		if (!defaultsFrame) {
			defaultsFrame = document.createElement("iframe")
			defaultsFrame.setAttribute("aria-hidden", "true")
			defaultsFrame.style.cssText = "position:fixed!important;left:-10000px!important;top:0!important;width:1024px!important;height:768px!important;visibility:hidden!important;border:0!important;pointer-events:none!important"
			document.documentElement.appendChild(defaultsFrame)
			const doc = defaultsFrame.contentDocument
			try {
				doc.open()
				doc.write("<!doctype html><html><head></head><body></body></html>")
				doc.close()
			} catch {}
			if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"))
		}
		const doc = defaultsFrame.contentDocument
		let probe
		try {
			probe = doc.createElement(tag)
		} catch {
			probe = doc.createElement("div")
		}
		if (tag === "a") probe.setAttribute("href", "#")
		doc.body.appendChild(probe)
		const style = defaultsFrame.contentWindow.getComputedStyle(probe)
		const out = {}
		for (const prop of NON_INHERITED) out[prop] = style.getPropertyValue(prop)
		probe.remove()
		defaultsCache.set(tag, out)
		return out
	}

	function releaseDefaults() {
		defaultsFrame?.remove()
		defaultsFrame = null
	}

	function quad(t, r, b, l) {
		if (t === r && r === b && b === l) return t
		if (t === b && r === l) return `${t} ${r}`
		if (r === l) return `${t} ${r} ${b}`
		return `${t} ${r} ${b} ${l}`
	}

	const ORDER = ["display", "position", "top", "right", "bottom", "left", "z-index", "float", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "align-self", "gap", "flex-grow", "flex-shrink", "flex-basis", "order", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-auto-flow", "width", "height", "max-width", "min-height", "padding", "margin", "border", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "background-color", "background-image", "background-size", "background-position", "background-repeat", "box-shadow", "opacity", "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "overflow-x", "overflow-y", "object-fit", "transform", "filter", "backdrop-filter", "cursor"]
	const COLOR_TOKEN = /rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)/gi

	function splitTopLevel(text) {
		const parts = []
		let depth = 0
		let current = ""
		for (const char of String(text)) {
			if (char === "(") depth++
			else if (char === ")") depth--
			if (char === "," && depth === 0) {
				parts.push(current.trim())
				current = ""
			} else current += char
		}
		if (current.trim()) parts.push(current.trim())
		return parts
	}

	function shadowValue(value) {
		if (!value || value === "none") return value
		return splitTopLevel(value).map((layer) => {
			const color = layer.match(COLOR_TOKEN)?.[0] || layer.match(/#[0-9a-f]{3,8}\b/i)?.[0]
			if (!color) return layer
			return `${layer.replace(color, "").replace(/\s+/g, " ").trim()} ${toHex(color)}`
		}).join(", ")
	}

	function stateful(selector) {
		return /:(hover|active)\b/.test(String(selector).replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ""))
	}

	function suspendStateRules() {
		const changed = []
		const visit = (list) => {
			for (const rule of list) {
				if (rule.selectorText && stateful(rule.selectorText)) {
					const parts = splitTopLevel(rule.selectorText)
					changed.push([rule, rule.selectorText])
					try {
						rule.selectorText = parts.map((part) => (stateful(part) ? ":not(*)" : part)).join(", ")
					} catch {}
				}
				if (rule.cssRules?.length) visit(rule.cssRules)
			}
		}
		for (const sheet of document.styleSheets) {
			let rules
			try {
				rules = sheet.cssRules
			} catch {
				continue
			}
			visit(rules)
		}
		return () => {
			for (const [rule, selector] of changed) {
				try {
					rule.selectorText = selector
				} catch {}
			}
		}
	}

	function authoredRules() {
		const out = []
		const visit = (list) => {
			for (const rule of list) {
				if (rule.selectorText && rule.style && /margin/.test(rule.style.cssText)) out.push(rule)
				if (rule.cssRules?.length) {
					let applies = true
					try {
						if (rule.media) applies = matchMedia(rule.media.mediaText).matches
					} catch {}
					if (applies) visit(rule.cssRules)
				}
			}
		}
		for (const sheet of document.styleSheets) {
			try {
				visit(sheet.cssRules)
			} catch {}
		}
		return out
	}

	function autoSides(el, rules) {
		const sides = new Set()
		const scan = (style) => {
			for (const side of ["top", "right", "bottom", "left"]) if (style?.getPropertyValue(`margin-${side}`) === "auto") sides.add(side)
		}
		for (const rule of rules) {
			let match = false
			try {
				match = el.matches(rule.selectorText)
			} catch {}
			if (match) scan(rule.style)
		}
		scan(el.style)
		return sides
	}

	function stylesOf(el, parentStyle, rules = []) {
		const style = getComputedStyle(el)
		const defaults = defaultsFor(el.localName)
		const out = {}
		for (const prop of NON_INHERITED) {
			const value = style.getPropertyValue(prop)
			if (!value || value === defaults[prop]) continue
			if (prop === "display" && value === "block" && parentStyle && /flex|grid/.test(parentStyle.display)) continue
			if (/^(top|right|bottom|left|z-index)$/.test(prop) && style.position === "static") continue
			if (/^(flex-|justify|align-items|align-content|row-gap|column-gap|grid-)/.test(prop) && !/flex|grid/.test(style.display) && !/^(flex-grow|flex-shrink|flex-basis|order|align-self|grid-column|grid-row)$/.test(prop)) continue
			if (/-color$/.test(prop) && prop.startsWith("border") && px(style.getPropertyValue(prop.replace("color", "width"))) === 0) continue
			if (/-style$/.test(prop) && px(style.getPropertyValue(prop.replace("style", "width"))) === 0) continue
			out[prop] = /color/.test(prop) ? toHex(value) : prop === "box-shadow" ? shadowValue(value) : value
		}
		for (const prop of INHERITED) {
			const value = style.getPropertyValue(prop)
			if (!value || (parentStyle && value === parentStyle.getPropertyValue(prop))) continue
			if (!parentStyle && !/^(color|font-family|font-size|font-weight|line-height)$/.test(prop) && /^(auto|normal|start|left|none|disc|0px)$/.test(value)) continue
			out[prop] = prop === "color" ? toHex(value) : prop === "font-family" ? value.split(",").slice(0, 3).join(",") : value
		}
		const rect = el.getBoundingClientRect()
		if (SIZED.test(el.tagName) || el.style.width || el.style.height) {
			out.width = fmt(rect.width)
			out.height = fmt(rect.height)
		}
		const compact = {}
		for (const [name, keys] of [
			["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
			["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
			["border-radius", ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]],
		]) {
			if (keys.some((k) => k in out)) {
				const values = keys.map((k) => style.getPropertyValue(k))
				if (name === "margin" && values.some((v) => px(v) > 0)) {
					const auto = autoSides(el, rules)
					;["top", "right", "bottom", "left"].forEach((side, i) => {
						if (auto.has(side) && px(values[i]) > 0) values[i] = "auto"
					})
				}
				if (!values.every((v) => v === "0px")) compact[name] = quad(...values)
				for (const k of keys) delete out[k]
			}
		}
		const sides = ["top", "right", "bottom", "left"]
		if (sides.some((s) => `border-${s}-width` in out || `border-${s}-color` in out || `border-${s}-style` in out)) {
			const widths = sides.map((s) => style.getPropertyValue(`border-${s}-width`))
			const styles = sides.map((s) => style.getPropertyValue(`border-${s}-style`))
			const colors = sides.map((s) => toHex(style.getPropertyValue(`border-${s}-color`)))
			if (new Set(widths).size === 1 && new Set(styles).size === 1 && new Set(colors).size === 1) {
				if (px(widths[0]) > 0 && styles[0] !== "none") compact.border = `${widths[0]} ${styles[0]} ${colors[0]}`
			} else {
				sides.forEach((s, i) => {
					if (px(widths[i]) > 0 && styles[i] !== "none") compact[`border-${s}`] = `${widths[i]} ${styles[i]} ${colors[i]}`
				})
			}
			for (const s of sides) for (const part of ["width", "style", "color"]) delete out[`border-${s}-${part}`]
		}
		if ("row-gap" in out || "column-gap" in out) {
			const row = style.rowGap
			const col = style.columnGap
			compact.gap = row === col ? row : `${row} ${col}`
			delete out["row-gap"]
			delete out["column-gap"]
		}
		const merged = { ...compact, ...out }
		const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length)
		return Object.fromEntries(Object.entries(merged).sort((a, b) => rank(a[0]) - rank(b[0])))
	}

	function twSpace(prefix, value) {
		if (value === "auto") return `${prefix}-auto`
		const n = px(value)
		if (n === 0) return `${prefix}-0`
		if (n === 1) return `${prefix}-px`
		const units = n / 4
		return Number.isInteger(units * 2) ? `${prefix}-${units}` : `${prefix}-[${fmt(n)}]`
	}

	function twSides(prefix, value) {
		const parts = String(value).split(" ")
		const [t, r = t, b = t, l = r] = parts
		const zero = (v) => v !== "auto" && px(v) === 0
		const pick = (pairs) => pairs.filter(([, v]) => !zero(v)).map(([p, v]) => twSpace(p, v))
		if (t === r && r === b && b === l) return pick([[prefix, t]])
		if (t === b && r === l) return pick([[`${prefix}y`, t], [`${prefix}x`, r]])
		return pick([[`${prefix}t`, t], [`${prefix}r`, r], [`${prefix}b`, b], [`${prefix}l`, l]])
	}

	const TW_TEXT = { 12: "xs", 14: "sm", 16: "base", 18: "lg", 20: "xl", 24: "2xl", 30: "3xl", 36: "4xl", 48: "5xl", 60: "6xl", 72: "7xl", 96: "8xl", 128: "9xl" }
	const TW_WEIGHT = { 100: "thin", 200: "extralight", 300: "light", 400: "normal", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" }
	const TW_RADIUS = { 0: "none", 2: "xs", 4: "sm", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl", 32: "4xl" }

	function arbitrary(value) {
		return String(value).trim().replace(/\s+/g, "_")
	}

	function tailwindOf(styles) {
		const cls = []
		const add = (c) => c && cls.push(c)
		for (const [prop, value] of Object.entries(styles)) {
			switch (prop) {
				case "display":
					add({ flex: "flex", "inline-flex": "inline-flex", grid: "grid", "inline-grid": "inline-grid", block: "block", "inline-block": "inline-block", inline: "inline", none: "hidden", contents: "contents", table: "table" }[value] ?? `[display:${arbitrary(value)}]`)
					break
				case "position":
					add(value === "static" ? null : value)
					break
				case "top":
				case "right":
				case "bottom":
				case "left":
					add(value === "auto" ? null : `${prop}-[${arbitrary(value)}]`)
					break
				case "z-index":
					add(value === "auto" ? null : `z-[${value}]`)
					break
				case "flex-direction":
					add({ column: "flex-col", "row-reverse": "flex-row-reverse", "column-reverse": "flex-col-reverse", row: "flex-row" }[value])
					break
				case "flex-wrap":
					add(value === "wrap" ? "flex-wrap" : value === "wrap-reverse" ? "flex-wrap-reverse" : null)
					break
				case "justify-content":
					add({ "flex-start": "justify-start", start: "justify-start", center: "justify-center", "flex-end": "justify-end", end: "justify-end", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly" }[value])
					break
				case "align-items":
					add({ "flex-start": "items-start", start: "items-start", center: "items-center", "flex-end": "items-end", end: "items-end", baseline: "items-baseline", stretch: "items-stretch" }[value])
					break
				case "align-self":
					add({ "flex-start": "self-start", center: "self-center", "flex-end": "self-end", stretch: "self-stretch" }[value])
					break
				case "gap": {
					const [row, col = row] = value.split(" ")
					if (row === col) add(twSpace("gap", row))
					else {
						add(twSpace("gap-y", row))
						add(twSpace("gap-x", col))
					}
					break
				}
				case "flex-grow":
					add(value === "1" ? "grow" : value === "0" ? "grow-0" : `grow-[${value}]`)
					break
				case "flex-shrink":
					add(value === "0" ? "shrink-0" : null)
					break
				case "flex-basis":
					add(value === "auto" ? null : `basis-[${arbitrary(value)}]`)
					break
				case "grid-template-columns": {
					const tracks = value.split(" ").filter(Boolean)
					add(new Set(tracks).size === 1 && tracks.length > 1 ? `grid-cols-${tracks.length}` : `grid-cols-[${arbitrary(value)}]`)
					break
				}
				case "padding":
					cls.push(...twSides("p", value))
					break
				case "margin":
					cls.push(...twSides("m", value))
					break
				case "border": {
					const [w, s, c] = value.split(" ")
					add(px(w) === 1 ? "border" : `border-[${w}]`)
					if (s !== "solid") add(`border-${s}`)
					add(`border-[${c}]`)
					break
				}
				case "border-radius": {
					const n = px(value)
					if (String(value).split(" ").length > 1) add(`rounded-[${arbitrary(value)}]`)
					else add(n >= 9999 ? "rounded-full" : TW_RADIUS[n] ? `rounded-${TW_RADIUS[n]}` : `rounded-[${value}]`)
					break
				}
				case "background-color":
					add(`bg-[${value}]`)
					break
				case "color":
					add(`text-[${value}]`)
					break
				case "font-size":
					add(TW_TEXT[px(value)] ? `text-${TW_TEXT[px(value)]}` : `text-[${value}]`)
					break
				case "font-weight":
					add(`font-${TW_WEIGHT[value] ?? `[${value}]`}`)
					break
				case "font-style":
					add(value === "italic" ? "italic" : null)
					break
				case "line-height": {
					const size = px(styles["font-size"])
					const ratio = size ? Math.round((px(value) / size) * 1000) / 1000 : 0
					add(value === "normal" ? null : { 1: "leading-none", 1.25: "leading-tight", 1.375: "leading-snug", 1.5: "leading-normal", 1.625: "leading-relaxed", 2: "leading-loose" }[ratio] ?? `leading-[${value}]`)
					break
				}
				case "letter-spacing":
					add(value === "normal" ? null : `tracking-[${value}]`)
					break
				case "text-align":
					add({ center: "text-center", right: "text-right", end: "text-right", justify: "text-justify", left: "text-left", start: null }[value])
					break
				case "text-transform":
					add({ uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize" }[value])
					break
				case "text-decoration-line":
					add(value === "none" ? "no-underline" : value === "underline" ? "underline" : value === "line-through" ? "line-through" : null)
					break
				case "white-space":
					add({ nowrap: "whitespace-nowrap", pre: "whitespace-pre", "pre-wrap": "whitespace-pre-wrap", "pre-line": "whitespace-pre-line" }[value])
					break
				case "box-shadow":
					add(value === "none" ? null : `shadow-[${arbitrary(shadowValue(value))}]`)
					break
				case "opacity":
					add(`opacity-${Math.round(parseFloat(value) * 100)}`)
					break
				case "overflow-x":
				case "overflow-y":
					add(value === "visible" ? null : `${prop === "overflow-x" ? "overflow-x" : "overflow-y"}-${value}`)
					break
				case "cursor":
					add(value === "auto" || value === "default" ? null : `cursor-${value}`)
					break
				case "width":
					add(`w-[${value}]`)
					break
				case "height":
					add(`h-[${value}]`)
					break
				case "max-width":
					add(value === "none" ? null : `max-w-[${arbitrary(value)}]`)
					break
				case "min-height":
					add(value === "auto" || value === "0px" ? null : `min-h-[${arbitrary(value)}]`)
					break
				case "object-fit":
					add(`object-${value}`)
					break
				case "font-family":
					add(`[font-family:${arbitrary(value.split(",")[0].replace(/["']/g, ""))}]`)
					break
				case "box-sizing":
				case "list-style-type":
				case "vertical-align":
					break
				default:
					add(`[${prop}:${arbitrary(value)}]`)
			}
		}
		return [...new Set(cls.filter(Boolean))].join(" ")
	}

	function cssText(styles) {
		return Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";")
	}

	function escapeHtml(text) {
		return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
	}

	function declarations(style) {
		return Array.from({ length: style?.length ?? 0 }, (_, i) => style[i]).filter(Boolean)
	}

	function hoverRules(root) {
		const out = []
		const seen = new Set()
		for (const sheet of document.styleSheets) {
			let rules
			try {
				rules = sheet.cssRules
			} catch {
				continue
			}
			const walk = (list) => {
				for (const rule of list) {
					if (out.length >= 12) return
					if (rule.cssRules && !rule.selectorText) {
						walk(rule.cssRules)
						continue
					}
					const selector = rule.selectorText
					if (!selector || !/:hover|:focus-visible|:focus\b|:active/.test(selector)) continue
					for (const part of selector.split(",")) {
						const state = part.match(/:(hover|focus-visible|focus|active)/)?.[1]
						const base = part.replace(/:(hover|focus-visible|focus|active)\b/g, "").trim() || "*"
						let hit = null
						try {
							hit = root.matches(base) ? root : root.querySelector(base)
						} catch {
							continue
						}
						if (!hit) continue
						const decl = (rule.style.cssText || declarations(rule.style).map((p) => `${p}: ${rule.style.getPropertyValue(p)}`).join("; ")).replace(COLOR_TOKEN, (c) => toHex(c)).replace(/;\s*$/, "").trim()
						const key = `${state}|${decl}`
						if (!decl || seen.has(key)) continue
						seen.add(key)
						out.push({ state, target: hit === root ? "component" : hit.tagName.toLowerCase(), decl })
					}
				}
			}
			walk(rules)
		}
		return out
	}

	function looksTailwind() {
		let hits = 0
		let total = 0
		for (const el of document.querySelectorAll("[class]")) {
			if (++total > 400) break
			if (/(^|\s)(flex|grid|items-center|justify-between|p[xytrbl]?-\d|m[xytrbl]?-\d|gap-\d|text-(xs|sm|lg|xl)|rounded(-\w+)?|bg-\w+-\d{2,3})(\s|$)/.test(el.getAttribute("class"))) hits++
		}
		return total > 0 && hits / total > 0.15
	}

	function absolute(url) {
		try {
			return new URL(url, location.href).href
		} catch {
			return url
		}
	}

	function serialize(root, mode, budget) {
		const keepClasses = looksTailwind()
		const rules = authoredRules()
		const fonts = new Map()
		const colors = new Map()
		let count = 0
		const ATTRS = ["href", "src", "alt", "aria-label", "role", "type", "placeholder", "title", "name", "for", "value", "aria-expanded", "aria-checked", "aria-selected", "disabled", "checked"]
		const walk = (el, parentStyle, depth) => {
			if (count >= budget || depth > 14) return ""
			const tag = el.localName
			if (/^(script|style|noscript|template|link|meta)$/.test(tag)) return ""
			if (!visible(el)) return ""
			count++
			const indent = "  ".repeat(depth)
			if (tag === "svg") {
				const html = el.outerHTML.replace(/\s+/g, " ").replace(/>\s+</g, "><")
				const rect = el.getBoundingClientRect()
				return html.length <= 1200 ? `${indent}${html}` : `${indent}<svg width="${Math.round(rect.width)}" height="${Math.round(rect.height)}" viewBox="${el.getAttribute("viewBox") || ""}"><!-- icon, ${html.length} characters of path data left out --></svg>`
			}
			const styles = stylesOf(el, parentStyle, rules)
			const own = getComputedStyle(el)
			const family = own.fontFamily.split(",")[0].replace(/["']/g, "").trim()
			if (family) fonts.set(family, new Set([...(fonts.get(family) ?? []), own.fontWeight]))
			for (const key of ["color", "background-color", "border"]) {
				const value = styles[key]
				const hex = key === "border" ? value?.split(" ").pop() : value
				if (hex && /^#/.test(hex)) colors.set(hex, (colors.get(hex) ?? 0) + 1)
			}
			const attrs = []
			for (const name of ATTRS) {
				if (!el.hasAttribute(name)) continue
				let value = el.getAttribute(name)
				if (name === "href" || name === "src") value = absolute(value)
				if (name === "value" && el.type === "password") value = ""
				attrs.push(`${name}="${escapeHtml(value.slice(0, 300))}"`)
			}
			if (tag === "img" && !el.hasAttribute("src") && el.currentSrc) attrs.push(`src="${escapeHtml(absolute(el.currentSrc))}"`)
			if (mode === "tailwind") {
				const generated = tailwindOf(styles)
				const original = keepClasses && typeof el.className === "string" ? el.className.trim() : ""
				const cls = original || generated
				if (cls) attrs.push(`class="${escapeHtml(cls)}"`)
			} else {
				const css = cssText(styles)
				if (css) attrs.push(`style="${escapeHtml(css)}"`)
			}
			for (const pseudo of ["::before", "::after"]) {
				let ps = null
				try {
					ps = getComputedStyle(el, pseudo)
				} catch {}
				if (ps?.content && ps.content !== "none" && ps.content !== "normal") attrs.push(`data-${pseudo.slice(2)}="${escapeHtml(`content:${ps.content};color:${toHex(ps.color)}${ps.backgroundColor && parseColor(ps.backgroundColor)?.a ? `;background:${toHex(ps.backgroundColor)}` : ""}`)}"`)
			}
			const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`
			if (/^(img|input|br|hr|source|track|wbr|area|col|embed)$/.test(tag)) return `${indent}${open}`
			const children = []
			for (const node of el.childNodes) {
				if (node.nodeType === 3) {
					const text = clean(node.data)
					if (text) children.push(`${indent}  ${escapeHtml(text.slice(0, 300))}`)
				} else if (node.nodeType === 1) {
					const child = walk(node, own, depth + 1)
					if (child) children.push(child)
				}
			}
			if (!children.length) return `${indent}${open}</${tag}>`
			if (children.length === 1 && !children[0].trim().startsWith("<") && children[0].length < 120) return `${indent}${open}${children[0].trim()}</${tag}>`
			return `${indent}${open}\n${children.join("\n")}\n${indent}</${tag}>`
		}
		const html = walk(root, null, 0)
		return { html, fonts, colors, truncated: count >= budget, nodes: count, keepClasses }
	}

	const STACKS = {
		"react-tailwind": { label: "a React function component styled with Tailwind CSS v4", mode: "tailwind", fence: "jsx" },
		"html-tailwind": { label: "semantic HTML styled with Tailwind CSS v4", mode: "tailwind", fence: "html" },
		"vue-tailwind": { label: "a Vue 3 single-file component (script setup) styled with Tailwind CSS v4", mode: "tailwind", fence: "vue" },
		"svelte-tailwind": { label: "a Svelte 5 component styled with Tailwind CSS v4", mode: "tailwind", fence: "svelte" },
		"html-css": { label: "semantic HTML with a separate CSS block (no frameworks)", mode: "css", fence: "html" },
		"react-css": { label: "a React function component with a CSS module", mode: "css", fence: "jsx" },
	}

	async function componentMode(payload, h) {
		const el = await h.pickElement("Sidekick: Component to code", "Click the component to capture · Esc to cancel")
		if (!el) return { ok: false, error: "No component picked." }
		const stack = STACKS[payload.stack] ?? STACKS["react-tailwind"]
		const states = hoverRules(el)
		let snapshot
		const restoreStates = suspendStateRules()
		try {
			snapshot = serialize(el, stack.mode, 220)
		} finally {
			restoreStates()
			releaseDefaults()
		}
		const rect = el.getBoundingClientRect()
		const fonts = [...snapshot.fonts.entries()].map(([family, weights]) => `${family} (${[...weights].sort().join(", ")})`)
		const palette = [...snapshot.colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([hex]) => hex)
		const shot = payload.screenshot === false ? null : await h.screenshotElement(el).catch(() => null)
		const md = globalThis.__sidekickMd
		const out = []
		out.push(`Recreate this UI component as ${stack.label}.`)
		out.push([
			"Match the layout, spacing, colours, typography, borders, radii and shadows exactly as specified below; the values are measured from the live page.",
			"Keep every piece of text and every item; if there are 8 items, render 8.",
			"Use the image and link URLs as given. Use semantic elements and accessible names.",
			`It was captured at ${Math.round(rect.width)}×${Math.round(rect.height)} px in a ${innerWidth} px wide viewport; make it responsive so it still works on narrow screens.`,
			shot ? "A screenshot of the component is attached; use it to check the result." : "",
			"Return one self-contained file and nothing else.",
		].filter(Boolean).map((line) => `- ${line}`).join("\n"))
		out.push(`## Source\n- Page: ${location.href}\n- Fonts: ${fonts.join("; ") || "system default"}\n- Main colours: ${palette.join(", ") || "n/a"}${snapshot.keepClasses && stack.mode === "tailwind" ? "\n- The site already uses Tailwind; the classes below are the site's own." : stack.mode === "tailwind" ? "\n- Classes below were converted from computed styles; arbitrary values like p-[13px] are exact measurements." : ""}`)
		out.push(`## Structure${snapshot.truncated ? ` (first ${snapshot.nodes} elements)` : ""}\n\`\`\`html\n${snapshot.html}\n\`\`\``)
		if (states.length) out.push(`## Interaction states\n${states.map((s) => `- :${s.state} on ${s.target}: ${s.decl}`).join("\n")}`)
		const text = out.join("\n\n")
		const tokens = md.estimateTokens(text)
		return {
			ok: true,
			data: {
				type: "text",
				value: text,
				copy: text,
				download: shot ? { filename: "component.png", mime: "image/png", dataUrl: shot.dataUrl } : { filename: "component-prompt.md", mime: "text/markdown", text },
				meta: `${snapshot.nodes} elements · ≈${tokens.toLocaleString()} tokens`,
				note: shot ? "Copy the prompt, then Save the screenshot and attach both to your AI chat." : "",
			},
		}
	}

	function weightOf(el) {
		const hint = `${typeof el.className === "string" ? el.className : ""} ${el.id || ""} ${el.getAttribute("alt") || ""}`.toLowerCase()
		if (/logo|brand/.test(hint)) return 5
		if (/cta|primary|hero/.test(hint)) return 4
		if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || /\bbtn\b|button/.test(hint)) return 3
		if (el.tagName === "A" || /card|tile/.test(hint)) return 2
		if (el.closest("nav, header, footer")) return 1
		return 1
	}

	function cluster(entries, threshold = 3) {
		const groups = []
		for (const [hex, weight] of [...entries.entries()].sort((a, b) => b[1] - a[1])) {
			const color = parseColor(hex.length === 9 ? `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${parseInt(hex.slice(7, 9), 16) / 255})` : `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`)
			if (!color) continue
			const near = groups.find((g) => Math.abs(g.color.a - color.a) < 0.05 && deltaE(g.color, color) < threshold)
			if (near) near.weight += weight
			else groups.push({ hex, color, weight })
		}
		return groups.sort((a, b) => b.weight - a.weight)
	}

	function chroma(color) {
		const lab = labOf(color)
		return Math.hypot(lab.a, lab.b)
	}

	function rootVariables() {
		const out = {}
		const style = getComputedStyle(document.documentElement)
		for (let i = 0; i < style.length; i++) {
			const name = style[i]
			if (name.startsWith("--")) out[name] = style.getPropertyValue(name).trim()
		}
		if (!Object.keys(out).length) {
			for (const sheet of document.styleSheets) {
				let rules
				try {
					rules = sheet.cssRules
				} catch {
					continue
				}
				for (const rule of rules) {
					if (!/^(:root|html)$/.test(rule.selectorText || "")) continue
					for (const prop of declarations(rule.style)) if (prop.startsWith("--")) out[prop] = rule.style.getPropertyValue(prop).trim()
				}
			}
		}
		return Object.fromEntries(Object.entries(out).filter(([k, v]) => v && v.length < 120 && !/^--tw-|^--wp--preset--(gradient|duotone)/.test(k)).slice(0, 80))
	}

	function designMode(payload) {
		const textColors = new Map()
		const bgColors = new Map()
		const borderColors = new Map()
		const fonts = new Map()
		const sizes = new Map()
		const spacing = new Map()
		const radii = new Map()
		const shadows = new Map()
		const bump = (map, key, weight = 1) => key && map.set(key, (map.get(key) ?? 0) + weight)
		let scanned = 0
		const headingStyles = {}
		for (const el of document.body.querySelectorAll("*")) {
			if (scanned > 5000) break
			if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|META|LINK|BR)$/i.test(el.tagName)) continue
			const rect = el.getBoundingClientRect()
			if (rect.width < 1 || rect.height < 1) continue
			const style = getComputedStyle(el)
			if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue
			scanned++
			const weight = weightOf(el)
			const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
			if (ownText) {
				bump(textColors, hexOf(parseColor(style.color)), weight)
				const family = style.fontFamily.split(",")[0].replace(/["']/g, "").trim()
				bump(fonts, family, clean(el.textContent).length)
				if (px(style.fontSize) >= 8) bump(sizes, `${Math.round(px(style.fontSize))}`, weight)
			}
			const bg = parseColor(style.backgroundColor)
			if (bg && bg.a > 0.05) bump(bgColors, hexOf(bg), weight + Math.min(5, (rect.width * rect.height) / 200000))
			if (px(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") bump(borderColors, hexOf(parseColor(style.borderTopColor)), weight)
			for (const prop of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom", "rowGap", "columnGap"]) {
				const n = Math.round(px(style[prop]))
				if (n > 0 && n <= 160) bump(spacing, String(n))
			}
			const radius = px(style.borderTopLeftRadius)
			if (radius > 0) bump(radii, radius >= 9999 ? "full" : String(Math.round(radius)), weight)
			if (style.boxShadow && style.boxShadow !== "none") bump(shadows, shadowValue(style.boxShadow), weight)
			if (/^H[1-6]$/.test(el.tagName) && !headingStyles[el.tagName]) headingStyles[el.tagName] = { size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, family: style.fontFamily.split(",")[0].replace(/["']/g, ""), color: toHex(style.color) }
		}
		const bodyStyle = getComputedStyle(document.body)
		const pageBg = parseColor(bodyStyle.backgroundColor)?.a ? hexOf(parseColor(bodyStyle.backgroundColor)) : parseColor(getComputedStyle(document.documentElement).backgroundColor)?.a ? toHex(getComputedStyle(document.documentElement).backgroundColor) : "#ffffff"
		const texts = cluster(textColors)
		const bgs = cluster(bgColors)
		const borders = cluster(borderColors)
		const all = cluster(new Map([...textColors, ...bgColors].map(([k, v]) => [k, v])), 8)
		const accents = all.filter((g) => chroma(g.color) > 25 && g.color.a > 0.9)
		const pageColor = parseColor(`rgb(${parseInt(pageBg.slice(1, 3), 16)}, ${parseInt(pageBg.slice(3, 5), 16)}, ${parseInt(pageBg.slice(5, 7), 16)})`)
		const neutralsText = texts.filter((g) => chroma(g.color) <= 25 && deltaE(g.color, pageColor) > 15)
		const roles = {}
		roles.background = pageBg
		const surface = bgs.find((g) => g.hex !== pageBg && chroma(g.color) <= 25 && deltaE(g.color, parseColor(`rgb(${parseInt(pageBg.slice(1, 3), 16)}, ${parseInt(pageBg.slice(3, 5), 16)}, ${parseInt(pageBg.slice(5, 7), 16)})`)) > 2)
		if (surface) roles.surface = surface.hex
		const foreground = neutralsText.find((g) => deltaE(g.color, pageColor) > 40) ?? neutralsText[0]
		if (foreground) roles.foreground = foreground.hex
		const muted = neutralsText.find((g) => g !== foreground && foreground && deltaE(g.color, foreground.color) > 8 && deltaE(g.color, pageColor) < deltaE(foreground.color, pageColor))
		if (muted) roles.muted = muted.hex
		if (accents[0]) roles.primary = accents[0].hex
		const second = accents.find((g) => accents[0] && deltaE(g.color, accents[0].color) > 20)
		if (second) roles.accent = second.hex
		if (borders[0]) roles.border = borders[0].hex
		const fontList = [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f)
		const sizeList = [...sizes.entries()].filter(([, w]) => w >= 2).map(([s]) => Number(s)).sort((a, b) => a - b).slice(0, 12)
		const spaceTop = [...spacing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
		const totalTop = spaceTop.reduce((n, [, c]) => n + c, 0)
		const divisible = (base) => spaceTop.filter(([v]) => Number(v) % base === 0).reduce((n, [, c]) => n + c, 0) / Math.max(1, totalTop)
		const baseUnit = divisible(8) >= 0.6 ? 8 : divisible(4) >= 0.6 ? 4 : null
		const spaceScale = [...new Set(spaceTop.map(([v]) => Number(v)))].sort((a, b) => a - b)
		const radiusList = [...radii.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r]) => r)
		const shadowList = [...shadows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s)
		const vars = rootVariables()
		const site = clean(document.querySelector('meta[property="og:site_name"]')?.content) || clean(document.title.split(/\s[|–—-]\s/).pop()) || location.hostname
		const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl"]
		const bodySize = Math.round(px(bodyStyle.fontSize)) || 16
		const bodyIndex = Math.max(0, sizeList.indexOf(sizeList.reduce((best, s) => (Math.abs(s - bodySize) < Math.abs(best - bodySize) ? s : best), sizeList[0] ?? 16)))
		const sizeNames = Object.fromEntries(sizeList.map((s, i) => [names[clamp(2 + i - bodyIndex, 0, names.length - 1)], `${s}px`]))
		const radiusNames = {}
		for (const r of radiusList) {
			if (r === "full") radiusNames.full = "9999px"
			else radiusNames[Number(r) <= 4 ? (radiusNames.sm ? "xs" : "sm") : Number(r) <= 8 ? (radiusNames.md ? "lg" : "md") : Number(r) <= 16 ? "xl" : "2xl"] ??= `${r}px`
		}
		const format = payload.format || "design-md"
		let text
		let filename
		let mime
		if (format === "tailwind") {
			const lines = ["@theme {"]
			for (const [role, hex] of Object.entries(roles)) lines.push(`  --color-${role}: ${hex};`)
			fontList.forEach((f, i) => lines.push(`  --font-${i === 0 ? "sans" : i === 1 ? "display" : "mono"}: "${f}", ui-sans-serif, system-ui, sans-serif;`))
			for (const [name, value] of Object.entries(sizeNames)) lines.push(`  --text-${name}: ${value};`)
			if (baseUnit) lines.push(`  --spacing: ${baseUnit / 4 === 1 ? "0.25rem" : `${baseUnit / 16}rem`};`)
			for (const [name, value] of Object.entries(radiusNames)) lines.push(`  --radius-${name}: ${value};`)
			shadowList.slice(0, 3).forEach((s, i) => lines.push(`  --shadow-${["sm", "md", "lg"][i]}: ${s};`))
			lines.push("}")
			text = `/* Tailwind CSS v4 theme extracted from ${location.href} */\n@import "tailwindcss";\n\n${lines.join("\n")}\n`
			filename = "theme.css"
			mime = "text/css"
		} else if (format === "tokens") {
			const color = (hex) => {
				const c = parseColor(`rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`)
				return { $type: "color", $value: { colorSpace: "srgb", components: [c.r / 255, c.g / 255, c.b / 255].map((n) => Math.round(n * 1000) / 1000), hex: hex.slice(0, 7) } }
			}
			const dimension = (value) => ({ $type: "dimension", $value: { value: px(value), unit: "px" } })
			const doc = {
				$description: `Design tokens extracted from ${location.href}`,
				color: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, color(v)])),
				font: { family: Object.fromEntries(fontList.map((f, i) => [i === 0 ? "base" : i === 1 ? "display" : "alt", { $type: "fontFamily", $value: [f] }])), size: Object.fromEntries(Object.entries(sizeNames).map(([k, v]) => [k, dimension(v)])) },
				spacing: Object.fromEntries(spaceScale.slice(0, 10).map((v) => [String(v), dimension(v)])),
				radius: Object.fromEntries(Object.entries(radiusNames).map(([k, v]) => [k, dimension(v)])),
				shadow: Object.fromEntries(shadowList.map((s, i) => [String(i + 1), { $type: "shadow", $value: s }])),
			}
			text = JSON.stringify(doc, null, 2)
			filename = "design-tokens.json"
			mime = "application/json"
		} else {
			const yaml = [
				"---",
				`name: ${JSON.stringify(site)}`,
				`source: ${location.href}`,
				"colors:",
				...Object.entries(roles).map(([k, v]) => `  ${k}: "${v}"`),
				"typography:",
				`  fonts: [${fontList.map((f) => JSON.stringify(f)).join(", ")}]`,
				"  sizes:",
				...Object.entries(sizeNames).map(([k, v]) => `    ${k}: ${v}`),
				"spacing:",
				`  base: ${baseUnit ? `${baseUnit}px` : "irregular"}`,
				`  scale: [${spaceScale.map((v) => `${v}px`).join(", ")}]`,
				"radius:",
				...Object.entries(radiusNames).map(([k, v]) => `  ${k}: ${v}`),
				"---",
			]
			const lightness = labOf(parseColor(`rgb(${parseInt(pageBg.slice(1, 3), 16)}, ${parseInt(pageBg.slice(3, 5), 16)}, ${parseInt(pageBg.slice(5, 7), 16)})`)).L
			const prose = [
				`# Design system: ${site}`,
				"## Overview",
				`A ${lightness > 60 ? "light" : "dark"} interface${roles.primary ? ` with ${roles.primary} as the main accent` : ""}, set in ${fontList[0] || "the system font"}${fontList[1] ? ` with ${fontList[1]} for display text` : ""}. Spacing ${baseUnit ? `follows a ${baseUnit}px grid` : "does not follow a strict grid"}.`,
				"## Colors",
				"| Role | Value |",
				"| --- | --- |",
				...Object.entries(roles).map(([k, v]) => `| ${k} | ${v} |`),
				all.length > Object.keys(roles).length ? `Other colours in use: ${all.slice(0, 12).map((g) => g.hex).filter((h) => !Object.values(roles).includes(h)).slice(0, 8).join(", ")}` : "",
				"## Typography",
				`Body text is ${bodySize}px ${clean(bodyStyle.fontFamily.split(",")[0].replace(/["']/g, ""))}, line height ${bodyStyle.lineHeight}.`,
				...Object.entries(headingStyles).sort().map(([tag, s]) => `- ${tag}: ${s.size}, weight ${s.weight}, line height ${s.lineHeight}, ${s.family}, ${s.color}`),
				`Type scale: ${sizeList.map((s) => `${s}px`).join(", ")}`,
				"## Spacing and layout",
				`Most used spacing values: ${spaceScale.map((v) => `${v}px`).join(", ")}.`,
				"## Shape",
				Object.keys(radiusNames).length ? `Corner radii: ${Object.entries(radiusNames).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "Mostly square corners.",
				"## Elevation",
				shadowList.length ? shadowList.map((s) => `- \`${s}\``).join("\n") : "Flat; no shadows in use.",
				Object.keys(vars).length ? `## CSS variables on :root\n${Object.entries(vars).slice(0, 40).map(([k, v]) => `- \`${k}: ${v}\``).join("\n")}` : "",
				"## Rules for AI",
				"- Use only the colours, fonts, sizes, radii and shadows listed here; do not invent new ones.",
				"- Keep spacing on the listed scale.",
			].filter(Boolean)
			text = `${yaml.join("\n")}\n\n${prose.join("\n\n")}\n`
			filename = "DESIGN.md"
			mime = "text/markdown"
		}
		return {
			ok: true,
			data: {
				type: "text",
				value: text,
				copy: text,
				download: { filename, mime, text },
				meta: `${Object.keys(roles).length} colour roles · ${sizeList.length} sizes · ${scanned} elements`,
				note: "Extracted from computed styles of visible elements, weighted by where colours are used (logo, buttons, links). Review roles before relying on them.",
			},
		}
	}

	globalThis.__sidekickAiPage = async function run(payload, h) {
		const mode = payload?.mode || "content"
		if (mode === "component") return componentMode(payload, h)
		if (mode === "design") return designMode(payload, h)
		return contentMode(payload, h)
	}
})()
