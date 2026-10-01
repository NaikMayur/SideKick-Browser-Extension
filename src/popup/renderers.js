import { api, sendToPage, resizeCurrentWindow } from "../lib/browser.js"
import { formatStorageSize, getBreakpointBucket, calculateAspectRatio, buildMediaQuery } from "../tools/testing.js"

function node(tag, className, text) {
	const el = document.createElement(tag)
	if (className) el.className = className
	if (text !== undefined) el.textContent = text
	return el
}

function copyOnClick(element, text, onStatus) {
	element.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(text)
			onStatus?.(`Copied ${text.length > 40 ? text.slice(0, 37) + "…" : text}`)
			element.classList.add("rv-copied")
			setTimeout(() => element.classList.remove("rv-copied"), 1200)
		} catch {  }
	})
}

function pill(text, className) {
	const el = node("span", `rv-pill ${className ?? ""}`.trim(), text)
	return el
}

function copyPill(label, value, onStatus) {
	const el = node("button", "rv-copy-pill", label)
	el.type = "button"
	el.title = `Copy ${value}`
	copyOnClick(el, value, onStatus)
	return el
}

function badge(text, pass) {
	return node("span", `rv-badge ${pass ? "rv-pass" : "rv-fail"}`, text)
}

function statCard(label, value) {
	const card = node("div", "rv-stat-card")
	card.appendChild(node("div", "rv-stat-value", String(value)))
	card.appendChild(node("div", "rv-stat-label", label))
	return card
}

function kvRow(key, value, onStatus) {
	const row = node("div", "rv-kv-row")
	row.appendChild(node("span", "rv-kv-key", key))
	const valEl = node("span", "rv-kv-val", String(value))
	row.appendChild(valEl)
	const btn = copyPill("Copy", String(value), onStatus)
	btn.className = "rv-copy-mini"
	row.appendChild(btn)
	return row
}

function renderColorConvert(value, onStatus) {
	const wrap = node("div", "rv-color-convert")

	const swatchBox = node("div", "rv-color-swatch-large")
	swatchBox.style.backgroundColor = value.hex
	const textPreview = node("span", "rv-color-text-preview", "Aa")
	textPreview.style.color = value.suggestedTextColor ?? "#fff"
	swatchBox.appendChild(textPreview)
	wrap.appendChild(swatchBox)

	const formats = node("div", "rv-color-formats")
	for (const [label, val] of [["HEX", value.hex], ["RGB", value.rgb], ["HSL", value.hsl]]) {
		const row = node("div", "rv-color-format-row")
		row.appendChild(node("span", "rv-color-format-label", label))
		const code = node("code", "rv-color-format-value", val)
		row.appendChild(code)
		row.appendChild(copyPill("Copy", val, onStatus))
		formats.appendChild(row)
	}

	const meta = node("div", "rv-color-meta")
	meta.appendChild(node("span", "rv-color-meta-item", `Luminance: ${value.luminance}`))
	meta.appendChild(node("span", "rv-color-meta-item", `Text: ${value.suggestedTextColor}`))
	formats.appendChild(meta)

	wrap.appendChild(formats)
	return wrap
}

function renderContrastChecker(value, onStatus) {
	const wrap = node("div", "rv-contrast")

	const swatchBar = node("div", "rv-pill-row")
	swatchBar.style.marginBottom = "10px"
	if (value.foreground) {
		const fgBtn = copyPill(`FG: ${value.foreground}`, value.foreground, onStatus)
		fgBtn.style.borderLeft = `12px solid ${value.foreground}`
		swatchBar.appendChild(fgBtn)
	}
	if (value.background) {
		const bgBtn = copyPill(`BG: ${value.background}`, value.background, onStatus)
		bgBtn.style.borderLeft = `12px solid ${value.background}`
		swatchBar.appendChild(bgBtn)
	}
	wrap.appendChild(swatchBar)

	if (value.foreground && value.background) {
		const preview = node("div", "rv-contrast-preview")
		preview.style.backgroundColor = value.background
		preview.style.color = value.foreground
		preview.style.padding = "16px"
		preview.style.borderRadius = "8px"
		preview.style.marginBottom = "12px"
		preview.style.border = "1px solid rgba(128,128,128,0.25)"
		preview.style.display = "flex"
		preview.style.flexDirection = "column"
		preview.style.gap = "8px"

		const heading = node("div", "", "Aa Large Heading (18pt+ bold)")
		heading.style.fontWeight = "700"
		heading.style.fontSize = "16px"

		const body = node("div", "", "Regular paragraph text (14px). Good contrast ensures effortless readability for all users.")
		body.style.fontSize = "13px"
		body.style.lineHeight = "1.4"

		const uiRow = node("div", "")
		uiRow.style.display = "flex"
		uiRow.style.gap = "8px"
		uiRow.style.marginTop = "4px"

		const btn = node("div", "", "Primary Action")
		btn.style.padding = "5px 12px"
		btn.style.borderRadius = "4px"
		btn.style.fontWeight = "600"
		btn.style.fontSize = "12px"
		btn.style.backgroundColor = value.foreground
		btn.style.color = value.background

		const outlineBtn = node("div", "", "Outline Button")
		outlineBtn.style.padding = "4px 10px"
		outlineBtn.style.borderRadius = "4px"
		outlineBtn.style.fontWeight = "500"
		outlineBtn.style.fontSize = "12px"
		outlineBtn.style.border = `1.5px solid ${value.foreground}`
		outlineBtn.style.color = value.foreground

		uiRow.append(btn, outlineBtn)
		preview.append(heading, body, uiRow)
		wrap.appendChild(preview)
	}

	const ratioBlock = node("div", "rv-contrast-ratio")
	ratioBlock.appendChild(node("span", "rv-contrast-ratio-num", `${value.ratio}:1`))
	ratioBlock.appendChild(node("span", "rv-contrast-ratio-label", value.normalTextAA ? "WCAG AA Pass" : "WCAG AA Fail"))
	copyOnClick(ratioBlock, `${value.ratio}:1`, onStatus)
	ratioBlock.style.cursor = "pointer"
	ratioBlock.title = "Click to copy ratio"
	wrap.appendChild(ratioBlock)

	const grid = node("div", "rv-contrast-grid")
	const checks = [
		["Normal text AA", value.normalTextAA, "≥ 4.5:1"],
		["Normal text AAA", value.normalTextAAA, "≥ 7:1"],
		["Large text AA", value.largeTextAA, "≥ 3:1"],
		["Large text AAA", value.largeTextAAA, "≥ 4.5:1"],
		["UI components AA", value.uiComponentsAA, "≥ 3:1"],
	]
	for (const [label, pass, threshold] of checks) {
		const row = node("div", "rv-contrast-row")
		row.appendChild(badge(pass ? "✓ Pass" : "✗ Fail", pass))
		row.appendChild(node("span", "rv-contrast-label", label))
		row.appendChild(node("span", "rv-contrast-threshold", threshold))
		grid.appendChild(row)
	}
	wrap.appendChild(grid)

	if (value.suggestions && (value.suggestions.aa || value.suggestions.aaa)) {
		const sugBox = node("div", "rv-preview-box")
		sugBox.style.marginTop = "12px"
		sugBox.appendChild(node("div", "rv-preview-title", "Accessible Color Alternatives"))
		const sugRow = node("div", "rv-pill-row")
		if (value.suggestions.aa) {
			const aaBtn = copyPill(`AA Compliant: ${value.suggestions.aa}`, value.suggestions.aa, onStatus)
			aaBtn.style.borderLeft = `12px solid ${value.suggestions.aa}`
			sugRow.appendChild(aaBtn)
		}
		if (value.suggestions.aaa) {
			const aaaBtn = copyPill(`AAA Compliant: ${value.suggestions.aaa}`, value.suggestions.aaa, onStatus)
			aaaBtn.style.borderLeft = `12px solid ${value.suggestions.aaa}`
			sugRow.appendChild(aaaBtn)
		}
		sugBox.appendChild(sugRow)
		wrap.appendChild(sugBox)
	}

	return wrap
}

function renderPalette(value, onStatus) {
	if (!Array.isArray(value) || !value.length) return null
	const wrap = node("div", "rv-palette")

	const ramp = node("div", "rv-palette-ramp")
	for (const step of value) {
		const swatch = node("div", "rv-palette-swatch")
		swatch.style.backgroundColor = step.hex
		swatch.title = `${step.step}: ${step.hex}`
		const label = node("span", "rv-palette-label")
		label.appendChild(node("span", "rv-palette-step", String(step.step)))
		label.appendChild(node("span", "rv-palette-hex", step.hex))
		swatch.appendChild(label)
		copyOnClick(swatch, step.hex, onStatus)
		swatch.style.cursor = "pointer"
		ramp.appendChild(swatch)
	}
	wrap.appendChild(ramp)

	const cssBlock = node("div", "rv-palette-css")
	const cssTitle = node("div", "rv-section-title", "CSS variables")
	cssBlock.appendChild(cssTitle)
	const lines = value.map((s) => `  --color-${s.step}: ${s.hex};`).join("\n")
	const code = node("pre", "rv-code", `:root {\n${lines}\n}`)
	cssBlock.appendChild(code)
	const cpBtn = copyPill("Copy CSS", `:root {\n${lines}\n}`, onStatus)
	cssBlock.appendChild(cpBtn)
	wrap.appendChild(cssBlock)

	return wrap
}

function renderUnitConvert(value, onStatus) {
	const wrap = node("div", "rv-units")
	const table = node("div", "rv-units-grid")
	for (const [unit, val] of [["px", value.px], ["rem", value.rem], ["em", value.em], ["pt", value.pt]]) {
		const cell = node("div", "rv-unit-cell")
		cell.appendChild(node("div", "rv-unit-value", String(val)))
		cell.appendChild(node("div", "rv-unit-label", unit))
		copyOnClick(cell, String(val) + unit, onStatus)
		cell.style.cursor = "pointer"
		cell.title = `Copy ${val}${unit}`
		table.appendChild(cell)
	}
	wrap.appendChild(table)
	return wrap
}

function renderTypeScale(value, onStatus) {
	if (!Array.isArray(value) || !value.length) return null
	const wrap = node("div", "rv-type-scale")

	for (const step of value) {
		const row = node("div", "rv-type-row")

		const meta = node("div", "rv-type-meta")
		meta.appendChild(pill(`Step ${step.step}`))
		meta.appendChild(pill(`${step.px}px`))
		meta.appendChild(pill(`${step.rem}rem`))
		meta.appendChild(pill(`lh: ${step.lineHeight}`))
		row.appendChild(meta)

		const specimen = node("div", "rv-type-specimen", "The quick brown fox jumps over the lazy dog")
		const displaySize = Math.max(11, Math.min(step.px, 36))
		specimen.style.fontSize = `${displaySize}px`
		specimen.style.lineHeight = String(step.lineHeight)
		row.appendChild(specimen)

		const css = `font-size: ${step.px}px;\nline-height: ${step.lineHeight};`
		const cpBtn = copyPill("Copy CSS", css, onStatus)
		row.appendChild(cpBtn)

		wrap.appendChild(row)
	}
	return wrap
}

function renderShadowGradient(value, onStatus) {
	const wrap = node("div", "rv-shadow")

	if (value.boxShadow) {
		const section = node("div", "rv-shadow-section")
		section.appendChild(node("div", "rv-section-title", "Box shadow"))
		const demo = node("div", "rv-shadow-demo")
		demo.style.boxShadow = value.boxShadow
		section.appendChild(demo)
		const code = node("code", "rv-shadow-code", `box-shadow: ${value.boxShadow};`)
		section.appendChild(code)
		section.appendChild(copyPill("Copy", `box-shadow: ${value.boxShadow};`, onStatus))
		wrap.appendChild(section)
	}

	if (value.gradient) {
		const section = node("div", "rv-shadow-section")
		section.appendChild(node("div", "rv-section-title", "Gradient"))
		const demo = node("div", "rv-gradient-demo")
		demo.style.background = value.gradient
		section.appendChild(demo)
		const code = node("code", "rv-shadow-code", `background: ${value.gradient};`)
		section.appendChild(code)
		section.appendChild(copyPill("Copy", `background: ${value.gradient};`, onStatus))
		wrap.appendChild(section)
	}

	return wrap
}

function renderTimestamp(value, onStatus) {
	const wrap = node("div", "rv-timestamp")
	const grid = node("div", "rv-stats-grid")
	for (const [label, val] of [
		["ISO 8601", value.iso],
		["Epoch (s)", value.epochSeconds],
		["Epoch (ms)", value.epochMillis],
		["UTC", value.utc],
		["Local", value.local],
		["Relative", value.relative],
	]) {
		const card = node("div", "rv-ts-card")
		card.appendChild(node("div", "rv-ts-label", label))
		card.appendChild(node("div", "rv-ts-value", String(val)))
		copyOnClick(card, String(val), onStatus)
		card.style.cursor = "pointer"
		card.title = `Copy ${label}`
		grid.appendChild(card)
	}
	wrap.appendChild(grid)
	return wrap
}

function renderTimezone(value, onStatus) {
	const wrap = node("div", "rv-timezone")
	const table = node("div", "rv-tz-table")
	for (const [zone, time] of Object.entries(value)) {
		const row = node("div", "rv-tz-row")
		row.appendChild(node("span", "rv-tz-zone", zone))
		row.appendChild(node("span", "rv-tz-time", time))
		const cpBtn = copyPill("Copy", time, onStatus)
		cpBtn.className = "rv-copy-mini"
		row.appendChild(cpBtn)
		table.appendChild(row)
	}
	wrap.appendChild(table)
	return wrap
}

function renderPerfBudget(value, onStatus) {
	const wrap = node("div", "rv-perf")
	const grid = node("div", "rv-perf-grid")

	const colorMap = { good: "rv-metric-good", "needs improvement": "rv-metric-warn", poor: "rv-metric-poor" }

	for (const [name, data] of Object.entries(value)) {
		const card = node("div", `rv-metric-card ${colorMap[data.verdict] ?? ""}`)
		card.appendChild(node("div", "rv-metric-name", name))
		card.appendChild(node("div", "rv-metric-value", String(data.value)))
		card.appendChild(badge(data.verdict.charAt(0).toUpperCase() + data.verdict.slice(1), data.verdict === "good"))
		grid.appendChild(card)
	}
	wrap.appendChild(grid)
	return wrap
}

function renderRegex(value, onStatus) {
	const wrap = node("div", "rv-regex")

	const summary = node("div", "rv-regex-summary")
	summary.appendChild(badge(`${value.count} match${value.count === 1 ? "" : "es"}`, value.count > 0))
	wrap.appendChild(summary)

	if (value.matches?.length) {
		const list = node("div", "rv-regex-matches")
		for (const match of value.matches.slice(0, 50)) {
			const row = node("div", "rv-regex-match")
			const matchText = node("code", "rv-regex-match-text", match.match)
			row.appendChild(matchText)
			row.appendChild(node("span", "rv-regex-match-idx", `index ${match.index}`))
			if (match.groups?.length) {
				const groups = node("span", "rv-regex-groups")
				match.groups.forEach((g, i) => {
					groups.appendChild(pill(`$${i + 1}: ${g ?? "∅"}`, "rv-group-pill"))
				})
				row.appendChild(groups)
			}
			copyOnClick(row, match.match, onStatus)
			row.style.cursor = "pointer"
			row.title = "Click to copy match"
			list.appendChild(row)
		}
		wrap.appendChild(list)
	}
	return wrap
}

function renderWordCount(value, onStatus) {
	const wrap = node("div", "rv-word-count")
	const grid = node("div", "rv-stats-grid")
	for (const [label, val] of [
		["Characters", value.characters],
		["No spaces", value.charactersNoSpaces],
		["Words", value.words],
		["Lines", value.lines],
		["Sentences", value.sentences],
		["Reading time", `${value.readingTimeMinutes} min`],
	]) {
		grid.appendChild(statCard(label, val))
	}
	wrap.appendChild(grid)
	return wrap
}

function renderQueryString(value, onStatus) {
	const wrap = node("div", "rv-query")

	if (value.protocol || value.host || value.pathname) {
		const parts = node("div", "rv-query-parts")
		if (value.protocol) parts.appendChild(kvRow("Protocol", value.protocol, onStatus))
		if (value.host) parts.appendChild(kvRow("Host", value.host, onStatus))
		if (value.pathname) parts.appendChild(kvRow("Path", value.pathname, onStatus))
		if (value.hash) parts.appendChild(kvRow("Hash", value.hash, onStatus))
		wrap.appendChild(parts)
	}

	if (value.note) {
		wrap.appendChild(node("div", "rv-query-note", value.note))
	}

	const params = value.params
	if (params && Object.keys(params).length) {
		const section = node("div", "rv-query-params")
		section.appendChild(node("div", "rv-section-title", `Query parameters (${Object.keys(params).length})`))
		for (const [key, val] of Object.entries(params)) {
			const display = Array.isArray(val) ? val.join(", ") : String(val)
			section.appendChild(kvRow(key, display, onStatus))
		}
		wrap.appendChild(section)
	}

	return wrap
}

function renderJwt(value, onStatus) {
	const wrap = node("div", "rv-jwt")

	if (value.rawParts) {
		const tokenBox = node("div", "rv-preview-box")
		tokenBox.appendChild(node("div", "rv-preview-title", "Token Segments (click part to copy)"))
		const tokenLine = node("div", "")
		tokenLine.style.font = "11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace"
		tokenLine.style.wordBreak = "break-all"
		tokenLine.style.padding = "8px 10px"
		tokenLine.style.borderRadius = "6px"
		tokenLine.style.background = "var(--surface-2)"
		tokenLine.style.border = "1px solid var(--border)"

		const segHeader = node("span", "", value.rawParts.header)
		segHeader.style.color = "#ef4444"
		segHeader.style.cursor = "pointer"
		segHeader.title = "Click to copy encoded header"
		copyOnClick(segHeader, value.rawParts.header, onStatus)

		const dot1 = node("span", "", ".")
		dot1.style.color = "var(--muted)"

		const segPayload = node("span", "", value.rawParts.payload)
		segPayload.style.color = "#8b5cf6"
		segPayload.style.cursor = "pointer"
		segPayload.title = "Click to copy encoded payload"
		copyOnClick(segPayload, value.rawParts.payload, onStatus)

		const dot2 = node("span", "", ".")
		dot2.style.color = "var(--muted)"

		const segSig = node("span", "", value.rawParts.signature || "(no-signature)")
		segSig.style.color = "#06b6d4"
		if (value.rawParts.signature) {
			segSig.style.cursor = "pointer"
			segSig.title = "Click to copy signature"
			copyOnClick(segSig, value.rawParts.signature, onStatus)
		}

		tokenLine.append(segHeader, dot1, segPayload, dot2, segSig)
		tokenBox.appendChild(tokenLine)
		wrap.appendChild(tokenBox)
	}

	if (value.expired !== null) {
		const banner = node("div", value.expired ? "rv-jwt-banner rv-jwt-expired" : "rv-jwt-banner rv-jwt-valid")
		const rel = value.relativeExpiry ? ` (${value.relativeExpiry})` : ""
		banner.textContent = value.expired
			? `✗ Expired ${value.expiresAt ? "at " + value.expiresAt : ""}${rel}`
			: `✓ Valid ${value.expiresAt ? "until " + value.expiresAt : ""}${rel}`
		wrap.appendChild(banner)
	} else if (value.expiresAt === null) {
		wrap.appendChild(node("div", "rv-jwt-banner rv-jwt-noexp", "— No expiry claim (token does not expire)"))
	}

	if (Array.isArray(value.warnings) && value.warnings.length) {
		const warnBox = node("div", "rv-preview-box")
		warnBox.style.borderLeft = "3px solid var(--danger)"
		warnBox.appendChild(node("div", "rv-preview-title", `Security & Expiry Alerts (${value.warnings.length})`))
		for (const w of value.warnings) {
			const item = node("div", "rv-issue-item rv-sev-major", `⚠️ ${w}`)
			warnBox.appendChild(item)
		}
		wrap.appendChild(warnBox)
	}

	const headerSection = node("div", "rv-jwt-section")
	const headerTitleRow = node("div", "rv-section-header")
	headerTitleRow.style.display = "flex"
	headerTitleRow.style.justifyContent = "space-between"
	headerTitleRow.style.alignItems = "center"
	headerTitleRow.appendChild(node("div", "rv-section-title", "Header"))
	headerTitleRow.appendChild(copyPill("Copy Header", JSON.stringify(value.header, null, 2), onStatus))
	headerSection.appendChild(headerTitleRow)

	const headerContent = node("div", "rv-jwt-fields")
	for (const [k, v] of Object.entries(value.header ?? {})) {
		headerContent.appendChild(kvRow(k, typeof v === "object" ? JSON.stringify(v) : v, onStatus))
	}
	headerSection.appendChild(headerContent)
	wrap.appendChild(headerSection)

	const payloadSection = node("div", "rv-jwt-section")
	const payloadTitleRow = node("div", "rv-section-header")
	payloadTitleRow.style.display = "flex"
	payloadTitleRow.style.justifyContent = "space-between"
	payloadTitleRow.style.alignItems = "center"
	payloadTitleRow.appendChild(node("div", "rv-section-title", "Payload Claims"))
	payloadTitleRow.appendChild(copyPill("Copy Payload", JSON.stringify(value.payload, null, 2), onStatus))
	payloadSection.appendChild(payloadTitleRow)

	const payloadContent = node("div", "rv-jwt-fields")
	const CLAIM_LABELS = {
		sub: "Subject (User / Client)",
		iss: "Issuer",
		aud: "Audience",
		exp: "Expiration Time",
		nbf: "Not Before",
		iat: "Issued At",
		jti: "JWT ID",
	}
	for (const [k, v] of Object.entries(value.payload ?? {})) {
		const keyLabel = CLAIM_LABELS[k] ? `${k} (${CLAIM_LABELS[k]})` : k
		const display = typeof v === "object" ? JSON.stringify(v) : String(v)
		payloadContent.appendChild(kvRow(keyLabel, display, onStatus))
	}
	payloadSection.appendChild(payloadContent)
	wrap.appendChild(payloadSection)

	const sigLine = node("div", "rv-jwt-sig")
	sigLine.appendChild(badge(
		value.signaturePresent ? "Signature present" : "No signature",
		value.signaturePresent,
	))
	wrap.appendChild(sigLine)

	return wrap
}

function renderJsonFormat(value, onStatus) {
	if (typeof value !== "string") return null
	const wrap = node("div", "rv-json")

	const toolbar = node("div", "rv-pill-row")
	toolbar.style.display = "flex"
	toolbar.style.justifyContent = "space-between"
	toolbar.style.alignItems = "center"
	toolbar.style.marginBottom = "8px"

	const lines = value.split("\n")
	const bytes = new TextEncoder().encode(value).length
	const sizeLabel = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
	const stats = node("span", "rv-stat-label", `${lines.length} lines · ${sizeLabel}`)
	toolbar.appendChild(stats)

	const btnRow = node("div", "")
	btnRow.style.display = "flex"
	btnRow.style.gap = "6px"

	const copyBtn = copyPill("Copy JSON", value, onStatus)
	btnRow.appendChild(copyBtn)

	const dlBtn = node("button", "rv-copy-pill", "Download .json")
	dlBtn.type = "button"
	dlBtn.addEventListener("click", () => {
		const blob = new Blob([value], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = "formatted.json"
		a.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
		onStatus?.("Downloaded formatted.json")
	})
	btnRow.appendChild(dlBtn)

	toolbar.appendChild(btnRow)
	wrap.appendChild(toolbar)

	const pre = node("pre", "rv-json-highlighted")
	const highlighted = highlightJson(value)
	pre.appendChild(highlighted)
	wrap.appendChild(pre)

	return wrap
}

function highlightJson(jsonString) {
	const frag = document.createDocumentFragment()

	const pattern = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)/g
	let lastIndex = 0

	for (const match of jsonString.matchAll(pattern)) {

		if (match.index > lastIndex) {
			frag.appendChild(document.createTextNode(jsonString.slice(lastIndex, match.index)))
		}

		const span = document.createElement("span")
		if (match[1] !== undefined) {

			span.className = "rv-json-key"
			span.textContent = match[1]
			frag.appendChild(span)

			const colonEnd = match.index + match[1].length
			const afterKey = jsonString.slice(colonEnd, match.index + match[0].length)
			frag.appendChild(document.createTextNode(afterKey))
		} else if (match[2] !== undefined) {
			span.className = "rv-json-string"
			span.textContent = match[2]
			frag.appendChild(span)
		} else if (match[3] !== undefined) {
			span.className = "rv-json-number"
			span.textContent = match[3]
			frag.appendChild(span)
		} else if (match[4] !== undefined) {
			span.className = "rv-json-boolean"
			span.textContent = match[4]
			frag.appendChild(span)
		} else if (match[5] !== undefined) {
			span.className = "rv-json-null"
			span.textContent = match[5]
			frag.appendChild(span)
		}
		lastIndex = match.index + match[0].length
	}

	if (lastIndex < jsonString.length) {
		frag.appendChild(document.createTextNode(jsonString.slice(lastIndex)))
	}
	return frag
}

function toRgbString(hex) {
	try {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		return `rgb(${r}, ${g}, ${b})`
	} catch {
		return hex
	}
}

function renderEyedropper(value, onStatus) {
	const wrap = node("div", "rv-eyedropper")
	wrap.style.display = "flex"
	wrap.style.flexDirection = "column"
	wrap.style.gap = "12px"
	wrap.style.padding = "4px 0"

	function createSystemPickerBtn(label = "🎨 System Color Picker") {
		const container = node("span", "")
		const input = document.createElement("input")
		input.type = "color"
		input.value = typeof value === "object" && value?.hex ? value.hex : "#3b82f6"
		input.style.display = "none"
		input.addEventListener("input", (e) => {
			const picked = e.target.value
			try { navigator.clipboard?.writeText(picked) } catch {}
			onStatus?.(`Picked & copied ${picked}`)
			wrap.innerHTML = ""
			const newCard = renderEyedropper({ hex: picked, rgb: toRgbString(picked) }, onStatus)
			if (newCard) wrap.appendChild(newCard)
		})
		const btn = node("button", "", label)
		btn.type = "button"
		btn.style.padding = "6px 12px"
		btn.style.fontSize = "12px"
		btn.addEventListener("click", () => input.click())
		container.append(input, btn)
		return container
	}

	const isStatusActive = (typeof value === "string" && (value.includes("active") || value.includes("Click any element"))) ||
		(typeof value === "object" && value?.status === "active")
	if (isStatusActive) {
		const banner = node("div", "rv-preview-box")
		banner.style.textAlign = "center"
		banner.style.padding = "20px"
		banner.style.borderRadius = "8px"
		banner.style.background = "rgba(59, 130, 246, 0.08)"
		banner.style.border = "1px solid rgba(59, 130, 246, 0.3)"

		const title = node("div", "", "🎯 Eyedropper Active on Webpage")
		title.style.fontWeight = "700"
		title.style.fontSize = "14px"
		title.style.color = "#60a5fa"
		title.style.marginBottom = "6px"

		const desc = node("div", "rv-issue-msg", "Hover any element on the page to preview its color, and click to sample and copy its HEX value.")
		desc.style.marginBottom = "14px"

		const btnRow = node("div", "")
		btnRow.style.display = "flex"
		btnRow.style.justifyContent = "center"
		btnRow.style.gap = "8px"
		btnRow.appendChild(createSystemPickerBtn("🎨 System Color Dialog"))

		banner.append(title, desc, btnRow)
		wrap.appendChild(banner)
		return wrap
	}

	if (typeof value === "string" && value.toLowerCase().includes("cancel")) {
		const banner = node("div", "rv-preview-box")
		banner.style.textAlign = "center"
		banner.style.padding = "20px"
		banner.style.borderRadius = "8px"
		banner.style.background = "var(--bg-muted, rgba(128,128,128,0.08))"
		banner.style.border = "1px dashed rgba(128,128,128,0.3)"

		const title = node("div", "", "Eyedropper Cancelled")
		title.style.fontWeight = "600"
		title.style.fontSize = "14px"
		title.style.marginBottom = "6px"

		const desc = node("div", "rv-issue-msg", "Color sampling was cancelled (Escape key pressed or clicked outside).")
		desc.style.marginBottom = "14px"

		const btnRow = node("div", "")
		btnRow.style.display = "flex"
		btnRow.style.justifyContent = "center"
		btnRow.style.gap = "8px"

		const pickBtn = node("button", "primary", "Pick Color on Page")
		pickBtn.type = "button"
		pickBtn.style.padding = "6px 14px"
		pickBtn.style.fontSize = "12px"
		pickBtn.addEventListener("click", () => {
			const runBtn = document.getElementById("run")
			runBtn?.click()
		})

		btnRow.append(pickBtn, createSystemPickerBtn("🎨 System Color Dialog"))
		banner.append(title, desc, btnRow)
		wrap.appendChild(banner)
		return wrap
	}

	const hex = typeof value === "object" ? value.hex : (typeof value === "string" && value.startsWith("#") ? value : null)
	const rgb = typeof value === "object" ? value.rgb : (hex ? toRgbString(hex) : "")

	if (hex) {
		const card = node("div", "rv-preview-box")
		card.style.display = "flex"
		card.style.flexDirection = "column"
		card.style.gap = "14px"

		const swatchRow = node("div", "")
		swatchRow.style.display = "flex"
		swatchRow.style.alignItems = "center"
		swatchRow.style.gap = "16px"

		const swatch = node("div", "rv-color-swatch-large")
		swatch.style.width = "64px"
		swatch.style.height = "64px"
		swatch.style.borderRadius = "8px"
		swatch.style.backgroundColor = hex
		swatch.style.border = "2px solid rgba(128,128,128,0.3)"
		swatch.style.flexShrink = "0"

		const infoCol = node("div", "")
		infoCol.style.display = "flex"
		infoCol.style.flexDirection = "column"
		infoCol.style.gap = "6px"

		const titleRow = node("div", "")
		titleRow.style.display = "flex"
		titleRow.style.alignItems = "center"
		titleRow.style.gap = "8px"

		const hexLabel = node("span", "", hex)
		hexLabel.style.fontSize = "18px"
		hexLabel.style.fontWeight = "700"
		hexLabel.style.fontFamily = "monospace"

		const badgeEl = badge("✓ Copied to clipboard", true)
		titleRow.append(hexLabel, badgeEl)

		const rgbLabel = node("span", "muted", rgb || hex)
		rgbLabel.style.fontSize = "13px"
		rgbLabel.style.fontFamily = "monospace"

		infoCol.append(titleRow, rgbLabel)
		swatchRow.append(swatch, infoCol)
		card.appendChild(swatchRow)

		const actionsRow = node("div", "row")
		actionsRow.style.display = "flex"
		actionsRow.style.gap = "8px"
		actionsRow.style.flexWrap = "wrap"

		const copyHexBtn = copyPill("Copy HEX", hex, onStatus)
		actionsRow.appendChild(copyHexBtn)

		if (rgb) {
			const copyRgbBtn = copyPill("Copy RGB", rgb, onStatus)
			actionsRow.appendChild(copyRgbBtn)
		}

		const pickAgainBtn = node("button", "primary", "Pick Color on Page")
		pickAgainBtn.type = "button"
		pickAgainBtn.style.padding = "6px 12px"
		pickAgainBtn.style.fontSize = "12px"
		pickAgainBtn.addEventListener("click", () => {
			const runBtn = document.getElementById("run")
			runBtn?.click()
		})
		actionsRow.appendChild(pickAgainBtn)
		actionsRow.appendChild(createSystemPickerBtn("🎨 System Color Dialog"))

		card.appendChild(actionsRow)
		wrap.appendChild(card)
		return wrap
	}

	return null
}

function renderViewportResize(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-viewport-resize")
	wrap.style.display = "flex"
	wrap.style.flexDirection = "column"
	wrap.style.gap = "12px"

	if (value.enabled === false) {
		const banner = node("div", "rv-preview-box")
		banner.style.textAlign = "center"
		banner.style.padding = "20px"
		banner.style.borderRadius = "8px"
		banner.style.background = "var(--bg-muted, rgba(128,128,128,0.08))"
		banner.style.border = "1px dashed rgba(128,128,128,0.3)"

		const title = node("div", "", "Viewport Tester Deactivated")
		title.style.fontWeight = "600"
		title.style.fontSize = "14px"
		title.style.marginBottom = "6px"

		const desc = node("div", "rv-issue-msg", "The in-page viewport dimension HUD has been removed from the active page.")
		desc.style.marginBottom = "14px"

		const reactivateBtn = node("button", "primary", "Reactivate Viewport HUD")
		reactivateBtn.type = "button"
		reactivateBtn.style.padding = "6px 14px"
		reactivateBtn.style.fontSize = "12px"
		reactivateBtn.addEventListener("click", async () => {
			try {
				const res = await sendToPage({ type: "viewport", payload: { enable: true } })
				if (res?.ok) onStatus?.("Viewport HUD activated")
			} catch (err) {
				onStatus?.(`Error: ${err.message}`)
			}
		})

		banner.append(title, desc, reactivateBtn)
		wrap.appendChild(banner)
		return wrap
	}

	const width = Number(value.width) || window.innerWidth || 1024
	const height = Number(value.height) || window.innerHeight || 768
	const dpr = value.dpr !== undefined ? Number(value.dpr).toFixed(2).replace(/\.00$/, "") : (window.devicePixelRatio ? window.devicePixelRatio.toFixed(2).replace(/\.00$/, "") : "1")

	let activeSim = null
	const presetEntries = []

	const passBanner = node("div", "rv-pass-banner")
	passBanner.style.display = "flex"
	passBanner.style.alignItems = "center"
	passBanner.style.justifyContent = "space-between"
	passBanner.style.padding = "10px 14px"

	const statusText = node("span", "", "● Viewport HUD Active on Page")
	statusText.style.fontWeight = "600"
	passBanner.appendChild(statusText)

	const bannerActions = node("div", "")
	bannerActions.style.display = "flex"
	bannerActions.style.gap = "6px"

	const closeFrameBtn = node("button", "rv-copy-mini", "✕ Close Frame")
	closeFrameBtn.type = "button"
	closeFrameBtn.title = "Close in-page device frame"
	closeFrameBtn.style.cursor = "pointer"
	closeFrameBtn.style.display = "none"
	closeFrameBtn.addEventListener("click", async () => {
		try {
			await sendToPage({ type: "device-frame", payload: { close: true } })
			activeSim = null
			updateSimIndicators()
			onStatus?.("Closed in-page device frame")
		} catch {}
	})
	bannerActions.appendChild(closeFrameBtn)

	const closeBtn = node("button", "rv-copy-mini", "✕ Hide HUD")
	closeBtn.type = "button"
	closeBtn.style.cursor = "pointer"
	closeBtn.addEventListener("click", async () => {
		try {
			const res = await sendToPage({ type: "viewport", payload: { enable: false } })
			if (res?.ok) onStatus?.("Viewport HUD hidden")
		} catch (err) {
			onStatus?.(`Error: ${err.message}`)
		}
	})
	bannerActions.appendChild(closeBtn)
	passBanner.appendChild(bannerActions)
	wrap.appendChild(passBanner)

	function updateSimIndicators() {
		if (activeSim?.active) {
			statusText.textContent = `📱 Simulating ${activeSim.label || "Device"} (${activeSim.width} × ${activeSim.height})`
			closeFrameBtn.style.display = "inline-flex"
		} else {
			statusText.textContent = "● Viewport HUD Active on Page"
			closeFrameBtn.style.display = "none"
		}

		for (const entry of presetEntries) {
			const isMatch = activeSim?.active && activeSim.width === entry.p.w && activeSim.height === entry.p.h
			if (isMatch) {
				entry.card.classList.add("is-simulating")
				entry.simBadge.style.display = "inline-flex"
				entry.frameBtn.textContent = "✓ In Frame"
				entry.frameBtn.classList.add("is-success")
				entry.frameBtn.title = `Simulating ${entry.p.label} (click to close frame)`
			} else {
				entry.card.classList.remove("is-simulating")
				entry.simBadge.style.display = "none"
				entry.frameBtn.textContent = "📱 Frame"
				entry.frameBtn.classList.remove("is-success")
				entry.frameBtn.title = `Simulate ${entry.p.label} (${entry.p.size}) inside page without resizing window`
			}
		}
	}

	sendToPage({ type: "device-frame-query" }).then((res) => {
		if (res?.ok && res?.data?.active) {
			activeSim = res.data
			updateSimIndicators()
		}
	}).catch(() => {})

	window.__onDeviceFrameUpdate = (payload) => {
		activeSim = payload?.active ? payload : null
		updateSimIndicators()
	}

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Viewport Width", `${width}px`))
	statGrid.appendChild(statCard("Viewport Height", `${height}px`))
	statGrid.appendChild(statCard("Breakpoint", getBreakpointBucket(width)))
	statGrid.appendChild(statCard("Pixel Ratio", `${dpr}x DPR`))
	statGrid.appendChild(statCard("Aspect Ratio", calculateAspectRatio(width, height)))
	statGrid.appendChild(statCard("Orientation", width >= height ? "Landscape" : "Portrait"))
	wrap.appendChild(statGrid)

	const mqBox = node("div", "rv-preview-box")
	mqBox.appendChild(node("div", "rv-preview-title", "CSS @media Queries for Current Size"))

	const mqList = node("div", "rv-mq-list")

	const maxMqSnippet = `@media (max-width: ${width}px) {\n  /* Styles for viewports up to ${width}px */\n}`
	const minMqSnippet = `@media (min-width: ${width}px) {\n  /* Styles for viewports from ${width}px */\n}`

	const maxItem = node("div", "rv-mq-item")
	const maxHeader = node("div", "rv-mq-header")
	const maxBadge = node("span", "rv-mq-badge", "max-width")
	const maxCopy = copyPill("Copy", maxMqSnippet, onStatus)
	maxHeader.append(maxBadge, maxCopy)
	const maxCode = node("code", "rv-mq-code", `@media (max-width: ${width}px)`)
	maxItem.append(maxHeader, maxCode)
	mqList.appendChild(maxItem)

	const minItem = node("div", "rv-mq-item")
	const minHeader = node("div", "rv-mq-header")
	const minBadge = node("span", "rv-mq-badge", "min-width")
	const minCopy = copyPill("Copy", minMqSnippet, onStatus)
	minHeader.append(minBadge, minCopy)
	const minCode = node("code", "rv-mq-code", `@media (min-width: ${width}px)`)
	minItem.append(minHeader, minCode)
	mqList.appendChild(minItem)

	mqBox.appendChild(mqList)
	wrap.appendChild(mqBox)

	const refBox = node("div", "rv-preview-box")
	refBox.appendChild(node("div", "rv-preview-title", "Common Device Breakpoint Reference"))

	const presets = [
		{ label: "Mobile (iPhone SE)", icon: "📱", size: "375 × 667", w: 375, h: 667, mq: "@media (max-width: 375px)" },
		{ label: "Mobile Lg (iPhone 14)", icon: "📱", size: "390 × 844", w: 390, h: 844, mq: "@media (max-width: 390px)" },
		{ label: "Tablet (iPad Mini)", icon: "📱", size: "768 × 1024", w: 768, h: 1024, mq: "@media (max-width: 768px)" },
		{ label: "Laptop (MacBook 13)", icon: "💻", size: "1280 × 800", w: 1280, h: 800, mq: "@media (max-width: 1280px)" },
		{ label: "Desktop (HD)", icon: "🖥️", size: "1440 × 900", w: 1440, h: 900, mq: "@media (min-width: 1440px)" },
		{ label: "Full HD (1080p)", icon: "🖥️", size: "1920 × 1080", w: 1920, h: 1080, mq: "@media (min-width: 1920px)" },
	]

	const presetList = node("div", "rv-preset-list")

	for (const p of presets) {
		const isCurrent = (p.w <= 375 && width <= 375) ||
			(p.w === 390 && width > 375 && width <= 430) ||
			(p.w === 768 && width > 430 && width <= 820) ||
			(p.w === 1280 && width > 820 && width <= 1366) ||
			(p.w === 1440 && width > 1366 && width <= 1600) ||
			(p.w === 1920 && width > 1600)

		const card = node("div", `rv-preset-card ${isCurrent ? "is-active" : ""}`)

		const topRow = node("div", "rv-preset-top")
		const titleArea = node("div", "rv-preset-title")
		const iconEl = node("span", "rv-preset-icon", p.icon)
		const nameEl = node("span", "rv-preset-name", p.label)
		titleArea.append(iconEl, nameEl)

		const badgeArea = node("div", "")
		badgeArea.style.display = "flex"
		badgeArea.style.alignItems = "center"
		badgeArea.style.gap = "6px"

		const simBadge = node("span", "rv-sim-badge", "● In Frame")
		simBadge.style.display = "none"
		badgeArea.appendChild(simBadge)

		const dimBadge = node("span", `rv-preset-dim ${isCurrent ? "rv-pill-active" : "rv-pill-dim"}`, p.size)
		badgeArea.appendChild(dimBadge)
		topRow.append(titleArea, badgeArea)
		card.appendChild(topRow)

		const botRow = node("div", "rv-preset-bot")
		const mqCode = node("code", "rv-preset-mq", p.mq)
		mqCode.title = `Media query: ${p.mq}`

		const actions = node("div", "rv-preset-actions")

		const frameBtn = node("button", "rv-btn-resize", "📱 Frame")
		frameBtn.type = "button"
		frameBtn.title = `Simulate ${p.label} (${p.size}) centered in page without resizing window`
		frameBtn.addEventListener("click", async () => {
			const isMatch = activeSim?.active && activeSim.width === p.w && activeSim.height === p.h
			frameBtn.disabled = true

			if (isMatch) {
				try {
					await sendToPage({ type: "device-frame", payload: { close: true } })
					activeSim = null
					updateSimIndicators()
					onStatus?.(`Closed in-page device frame for ${p.label}`)
				} catch (err) {
					onStatus?.(`Error: ${err?.message || String(err)}`)
				}
				frameBtn.disabled = false
				return
			}

			frameBtn.textContent = "Opening…"
			try {
				const res = await sendToPage({
					type: "device-frame",
					payload: { width: p.w, height: p.h, label: p.label, icon: p.icon },
				})
				if (res?.ok) {
					activeSim = { active: true, width: p.w, height: p.h, label: p.label, icon: p.icon }
					updateSimIndicators()
					onStatus?.(`Opened ${p.label} (${p.size}) in-page device frame`)
				} else {
					frameBtn.textContent = "⚠️ Failed"
					onStatus?.(`Could not open frame: ${res?.error || "unsupported page"}`)
					setTimeout(() => updateSimIndicators(), 2000)
				}
			} catch (err) {
				frameBtn.textContent = "⚠️ Failed"
				onStatus?.(`Could not open frame: ${err?.message || String(err)}`)
				setTimeout(() => updateSimIndicators(), 2000)
			}
			frameBtn.disabled = false
		})
		actions.appendChild(frameBtn)

		const resizeBtn = node("button", "rv-copy-pill", "⤢ Window")
		resizeBtn.type = "button"
		resizeBtn.title = `Resize OS browser window to ${p.w} × ${p.h} (closes in-page frame)`
		resizeBtn.addEventListener("click", async () => {
			resizeBtn.disabled = true
			const originalText = resizeBtn.textContent
			resizeBtn.textContent = "Resizing…"
			try {
				try {
					await sendToPage({ type: "device-frame", payload: { close: true } })
					activeSim = null
					updateSimIndicators()
				} catch {}

				const result = await resizeCurrentWindow(p.w, p.h)
				if (result.ok) {
					resizeBtn.textContent = "✓ Resized!"
					onStatus?.(`Resized window to ${p.label} (${p.size})`)
					setTimeout(() => {
						resizeBtn.textContent = originalText
						resizeBtn.disabled = false
					}, 1500)
				} else {
					resizeBtn.textContent = "⚠️ Failed"
					onStatus?.(`Could not resize window: ${result.error}`)
					setTimeout(() => {
						resizeBtn.textContent = originalText
						resizeBtn.disabled = false
					}, 2000)
				}
			} catch (err) {
				resizeBtn.textContent = "⚠️ Failed"
				onStatus?.(`Could not resize window: ${err?.message || String(err)}`)
				setTimeout(() => {
					resizeBtn.textContent = originalText
					resizeBtn.disabled = false
				}, 2000)
			}
		})
		actions.appendChild(resizeBtn)

		const copyBtn = copyPill("Copy MQ", `${p.mq} {\n  /* ${p.label} */\n}`, onStatus)
		actions.appendChild(copyBtn)

		botRow.append(mqCode, actions)
		card.appendChild(botRow)

		presetEntries.push({ p, card, simBadge, frameBtn })
		presetList.appendChild(card)
	}

	updateSimIndicators()

	refBox.appendChild(presetList)
	wrap.appendChild(refBox)

	return wrap
}

function renderEditMode(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-edit-mode")
	wrap.style.display = "flex"
	wrap.style.flexDirection = "column"
	wrap.style.gap = "12px"

	if (value.enabled === false) {
		const banner = node("div", "rv-preview-box")
		banner.style.textAlign = "center"
		banner.style.padding = "20px"
		banner.style.borderRadius = "8px"
		banner.style.background = "var(--bg-muted, rgba(128,128,128,0.08))"
		banner.style.border = "1px dashed rgba(128,128,128,0.3)"

		const title = node("div", "", "Design & Edit Mode Turned Off")
		title.style.fontWeight = "600"
		title.style.fontSize = "14px"
		title.style.marginBottom = "6px"

		const desc = node("div", "rv-issue-msg", "Interactive Figma canvas mode has been deactivated.")
		desc.style.marginBottom = "14px"

		const reactivateBtn = node("button", "primary", "Turn On Design Mode")
		reactivateBtn.type = "button"
		reactivateBtn.style.padding = "6px 14px"
		reactivateBtn.style.fontSize = "12px"
		reactivateBtn.addEventListener("click", () => {
			const runBtn = document.getElementById("run")
			runBtn?.click()
		})

		banner.append(title, desc, reactivateBtn)
		wrap.appendChild(banner)
		return wrap
	}

	const banner = node("div", "rv-pass-banner")
	banner.style.display = "flex"
	banner.style.alignItems = "center"
	banner.style.justifyContent = "space-between"
	banner.style.padding = "10px 14px"
	banner.style.background = "rgba(59, 130, 246, 0.12)"
	banner.style.borderColor = "rgba(59, 130, 246, 0.35)"
	banner.style.color = "#93c5fd"

	const statusText = node("span", "", "● Figma Canvas & Move Active")
	statusText.style.fontWeight = "600"
	banner.appendChild(statusText)

	const closeBtn = node("button", "rv-copy-mini", "✕ Exit Mode")
	closeBtn.type = "button"
	closeBtn.style.cursor = "pointer"
	closeBtn.addEventListener("click", () => {
		const runBtn = document.getElementById("run")
		runBtn?.click()
	})
	banner.appendChild(closeBtn)
	wrap.appendChild(banner)

	const guideBox = node("div", "rv-preview-box")
	guideBox.appendChild(node("div", "rv-preview-title", "How to Use Figma Mode on the Page"))

	const features = [
		["🖱️ Click to Select", "Click any element or container. A blue Figma bounding box with 4 corner handles appears."],
		["▲ Parent Container", "Click '▲ Parent' in the floating toolbar to select outer container divs, hero wrappers, or cards."],
		["⠿ Freeform Dragging", "Click and hold the block, handles, or '⠿ Drag' in the toolbar to move it anywhere on the page."],
		["✏️ Edit Copy / Text", "Double-click any text or click '✏️ Edit' to edit copy and typography directly inline."],
		["⧉ Duplicate Block", "Click '⧉ Duplicate' to clone any block and drag the copy to test new layout proposals."],
		["⌨️ Keyboard Nudge", "Use Arrow keys to nudge by 1px (or 10px with Shift). Press Escape to deselect."],
		["↺ Revert / Reset", "Click '↺ Reset' in the floating toolbar to return any moved element to its original position."],
	]

	for (const [title, detail] of features) {
		const row = node("div", "rv-kv-row")
		row.style.alignItems = "flex-start"
		row.style.padding = "6px 4px"
		row.style.gap = "8px"

		const key = node("span", "rv-kv-key", title)
		key.style.minWidth = "125px"
		key.style.color = "#60a5fa"
		key.style.fontSize = "12px"
		key.style.fontWeight = "600"

		const val = node("span", "rv-issue-msg", detail)
		val.style.fontSize = "11.5px"
		val.style.lineHeight = "1.4"
		val.style.color = "var(--text)"

		row.append(key, val)
		guideBox.appendChild(row)
	}
	wrap.appendChild(guideBox)

	return wrap
}

function renderSnippingTool(value, onStatus) {
	const wrap = node("div", "rv-snipping-tool")
	wrap.style.display = "flex"
	wrap.style.flexDirection = "column"
	wrap.style.gap = "12px"

	if (value?.cancelled) {
		const banner = node("div", "rv-preview-box")
		banner.style.textAlign = "center"
		banner.style.padding = "20px"
		banner.style.borderRadius = "8px"
		banner.style.background = "var(--bg-muted, rgba(128,128,128,0.08))"
		banner.style.border = "1px dashed rgba(128,128,128,0.3)"

		const title = node("div", "", "Screenshot cancelled")
		title.style.fontWeight = "600"
		title.style.fontSize = "14px"
		title.style.marginBottom = "6px"

		const desc = node("div", "rv-issue-msg", "Region selection was cancelled. Click Run to try again.")
		desc.style.marginBottom = "14px"

		const retryBtn = node("button", "primary", "Capture again")
		retryBtn.type = "button"
		retryBtn.style.padding = "6px 14px"
		retryBtn.style.fontSize = "12px"
		retryBtn.addEventListener("click", () => {
			const runBtn = document.getElementById("run")
			runBtn?.click()
		})

		banner.append(title, desc, retryBtn)
		wrap.appendChild(banner)
		return wrap
	}

	if (!value?.dataUrl) return null

	const modeName = value.mode || "Screenshot"
	const capW = value.width || 0
	const capH = value.height || 0

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Mode", modeName))
	statGrid.appendChild(statCard("Size", `${capW} × ${capH}`))
	statGrid.appendChild(statCard("Format", "PNG"))
	statGrid.appendChild(statCard("Captured", new Date().toLocaleTimeString()))
	wrap.appendChild(statGrid)

	const previewBox = node("div", "rv-preview-box")
	previewBox.style.padding = "8px"
	previewBox.style.textAlign = "center"

	const previewTitle = node("div", "rv-preview-title", "Screenshot preview")
	previewBox.appendChild(previewTitle)

	const img = document.createElement("img")
	img.src = value.dataUrl
	img.alt = `${modeName} screenshot`
	img.style.cssText = "max-width: 100%; max-height: 360px; border-radius: 6px; border: 1px solid var(--border, rgba(128,128,128,0.2)); box-shadow: 0 4px 16px rgba(0,0,0,0.12); margin-top: 8px; cursor: zoom-in;"

	img.addEventListener("click", () => {
		const w = window.open("")
		if (w) {
			w.document.write(`<!doctype html><html><head><title>Sidekick Screenshot</title><style>body{margin:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${value.dataUrl}" alt="Screenshot"></body></html>`)
			w.document.close()
		}
	})

	previewBox.appendChild(img)
	wrap.appendChild(previewBox)

	const actionsRow = node("div", "rv-pill-row")
	actionsRow.style.display = "flex"
	actionsRow.style.gap = "8px"
	actionsRow.style.flexWrap = "wrap"
	actionsRow.style.marginTop = "4px"

	const copyImgBtn = node("button", "primary", "📋 Copy image")
	copyImgBtn.type = "button"
	copyImgBtn.style.padding = "6px 14px"
	copyImgBtn.style.fontSize = "12px"
	copyImgBtn.addEventListener("click", async () => {
		try {
			const response = await fetch(value.dataUrl)
			const blob = await response.blob()
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": blob })
			])
			copyImgBtn.textContent = "✓ Copied!"
			onStatus?.("Screenshot copied to clipboard")
			setTimeout(() => { copyImgBtn.textContent = "📋 Copy image" }, 1500)
		} catch {
			onStatus?.("Copy failed — try Save instead")
		}
	})
	actionsRow.appendChild(copyImgBtn)

	const saveBtn = node("button", "", "💾 Save PNG")
	saveBtn.type = "button"
	saveBtn.style.padding = "6px 14px"
	saveBtn.style.fontSize = "12px"
	saveBtn.addEventListener("click", () => {
		const link = document.createElement("a")
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
		link.download = `devkit-screenshot-${timestamp}.png`
		link.href = value.dataUrl
		link.click()
		onStatus?.("Screenshot saved")
	})
	actionsRow.appendChild(saveBtn)

	const copyUrlBtn = node("button", "", "🔗 Copy data URL")
	copyUrlBtn.type = "button"
	copyUrlBtn.style.padding = "6px 14px"
	copyUrlBtn.style.fontSize = "12px"
	copyUrlBtn.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(value.dataUrl)
			copyUrlBtn.textContent = "✓ Copied!"
			onStatus?.("Data URL copied")
			setTimeout(() => { copyUrlBtn.textContent = "🔗 Copy data URL" }, 1500)
		} catch {
			onStatus?.("Copy failed")
		}
	})
	actionsRow.appendChild(copyUrlBtn)

	const againBtn = node("button", "", "📸 Capture again")
	againBtn.type = "button"
	againBtn.style.padding = "6px 14px"
	againBtn.style.fontSize = "12px"
	againBtn.addEventListener("click", () => {
		const runBtn = document.getElementById("run")
		runBtn?.click()
	})
	actionsRow.appendChild(againBtn)

	wrap.appendChild(actionsRow)

	return wrap
}

function humanSize(bytes) {
	const units = ["B", "KB", "MB", "GB"]
	let value = Number(bytes)
	if (Number.isNaN(value) || value <= 0) return "0 B"
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	return `${Math.round(value * 100) / 100} ${units[unit]}`
}

function renderImageConverter(value, onStatus) {
	if (!value || typeof value !== "object" || !value.dataUrl) return null
	const wrap = node("div", "rv-image-converter")
	wrap.style.display = "flex"
	wrap.style.flexDirection = "column"
	wrap.style.gap = "12px"

	if (value.notice || value.autoSwitched) {
		const notice = node("div", "rv-pass-banner")
		notice.style.padding = "8px 12px"
		notice.style.fontSize = "12px"
		notice.style.background = "rgba(251, 191, 36, 0.12)"
		notice.style.borderColor = "rgba(251, 191, 36, 0.3)"
		notice.style.color = "#fbbf24"
		notice.textContent = value.notice || `Format auto-switched to ${value.format} — preserves resolution dimensions and transparency while compressing to target size`
		wrap.appendChild(notice)
	}

	if (value.tip) {
		const tipBox = node("div", "rv-pass-banner")
		tipBox.style.padding = "8px 12px"
		tipBox.style.fontSize = "12px"
		tipBox.style.background = "rgba(59, 130, 246, 0.12)"
		tipBox.style.borderColor = "rgba(59, 130, 246, 0.3)"
		tipBox.style.color = "#60a5fa"
		tipBox.textContent = value.tip
		wrap.appendChild(tipBox)
	}

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Input", `${value.originalWidth}×${value.originalHeight}`))
	statGrid.appendChild(statCard("Output", `${value.outputWidth}×${value.outputHeight}`))
	statGrid.appendChild(statCard("Format", value.format))
	statGrid.appendChild(statCard("Input size", humanSize(value.originalSize)))
	statGrid.appendChild(statCard("Output size", humanSize(value.outputSize)))
	if (value.quality !== null && value.quality !== undefined) {
		statGrid.appendChild(statCard("Quality", `${Math.round(value.quality * 100)}%`))
	}
	if (value.targetSizeKb) {
		statGrid.appendChild(statCard("Target", `≤ ${value.targetSizeKb} KB`))
	}
	const ratio = value.originalSize > 0
		? Math.round((value.outputSize / value.originalSize) * 100)
		: 0
	const saved = value.originalSize > value.outputSize
		? humanSize(value.originalSize - value.outputSize)
		: null
	statGrid.appendChild(statCard("Size ratio", `${ratio}%`))
	if (saved) {
		statGrid.appendChild(statCard("Saved", saved))
	}
	wrap.appendChild(statGrid)

	const isPdf = value.formatKey === "pdf"
	if (!isPdf && value.dataUrl) {
		const previewBox = node("div", "rv-preview-box")
		previewBox.style.padding = "8px"
		previewBox.style.textAlign = "center"

		const previewTitle = node("div", "rv-preview-title", "Output preview")
		previewBox.appendChild(previewTitle)

		const img = document.createElement("img")
		img.src = value.dataUrl
		img.alt = `Converted ${value.format} image`
		img.style.cssText = "max-width: 100%; max-height: 360px; border-radius: 6px; border: 1px solid var(--border, rgba(128,128,128,0.2)); box-shadow: 0 4px 16px rgba(0,0,0,0.12); margin-top: 8px; cursor: zoom-in;"

		img.addEventListener("click", () => {
			const w = window.open("")
			if (w) {
				w.document.write(`<!doctype html><html><head><title>Sidekick Image Converter</title><style>body{margin:0;background:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${value.dataUrl}" alt="Converted image"></body></html>`)
				w.document.close()
			}
		})

		previewBox.appendChild(img)
		wrap.appendChild(previewBox)
	} else if (isPdf) {
		const pdfBox = node("div", "rv-preview-box")
		pdfBox.style.padding = "20px"
		pdfBox.style.textAlign = "center"
		pdfBox.appendChild(node("div", "rv-preview-title", "📄 PDF generated successfully"))
		const desc = node("div", "rv-issue-msg", `The image has been embedded into a ${value.outputWidth}×${value.outputHeight} PDF document. Click Save below to download.`)
		desc.style.marginTop = "8px"
		pdfBox.appendChild(desc)
		wrap.appendChild(pdfBox)
	}

	const actionsRow = node("div", "rv-pill-row")
	actionsRow.style.display = "flex"
	actionsRow.style.gap = "8px"
	actionsRow.style.flexWrap = "wrap"
	actionsRow.style.marginTop = "4px"

	const saveBtn = node("button", "primary", `💾 Save ${value.format}`)
	saveBtn.type = "button"
	saveBtn.style.padding = "6px 14px"
	saveBtn.style.fontSize = "12px"
	saveBtn.addEventListener("click", () => {
		const link = document.createElement("a")
		link.download = value.fileName
		if (value.blob) {
			link.href = URL.createObjectURL(value.blob)
		} else {
			link.href = value.dataUrl
		}
		link.click()
		if (value.blob) setTimeout(() => URL.revokeObjectURL(link.href), 3000)
		onStatus?.(`Saved ${value.fileName}`)
	})
	actionsRow.appendChild(saveBtn)

	if (!isPdf) {
		const copyBtn = node("button", "", "📋 Copy image")
		copyBtn.type = "button"
		copyBtn.style.padding = "6px 14px"
		copyBtn.style.fontSize = "12px"
		copyBtn.addEventListener("click", async () => {
			try {
				const response = await fetch(value.dataUrl)
				const blob = await response.blob()
				await navigator.clipboard.write([
					new ClipboardItem({ [blob.type]: blob })
				])
				copyBtn.textContent = "✓ Copied!"
				onStatus?.("Image copied to clipboard")
				setTimeout(() => { copyBtn.textContent = "📋 Copy image" }, 1500)
			} catch {
				onStatus?.("Copy failed — try Save instead")
			}
		})
		actionsRow.appendChild(copyBtn)

		const copyUrlBtn = node("button", "", "🔗 Copy data URL")
		copyUrlBtn.type = "button"
		copyUrlBtn.style.padding = "6px 14px"
		copyUrlBtn.style.fontSize = "12px"
		copyUrlBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(value.dataUrl)
				copyUrlBtn.textContent = "✓ Copied!"
				onStatus?.("Data URL copied")
				setTimeout(() => { copyUrlBtn.textContent = "🔗 Copy data URL" }, 1500)
			} catch {
				onStatus?.("Copy failed")
			}
		})
		actionsRow.appendChild(copyUrlBtn)
	}

	wrap.appendChild(actionsRow)

	return wrap
}

const renderers = {
	"color-convert": renderColorConvert,
	"contrast-checker": renderContrastChecker,
	"palette": renderPalette,
	"unit-convert": renderUnitConvert,
	"type-scale": renderTypeScale,
	"shadow-generator": renderShadowGradient,
	"timestamp": renderTimestamp,
	"timezone": renderTimezone,
	"perf-budget": renderPerfBudget,
	"regex-tester": renderRegex,
	"word-count": renderWordCount,
	"query-string": renderQueryString,
	"jwt-decode": renderJwt,
	"json-format": renderJsonFormat,
	"text-diff": renderTextDiff,
	"seo-audit": renderSeoAudit,
	"a11y-audit": renderA11yAudit,
	"page-metrics": renderPageMetrics,
	"link-check": renderLinkCheck,
	"tech-stack": renderTechStack,
	"eyedropper": renderEyedropper,
	"viewport-resize": renderViewportResize,
	"edit-mode": renderEditMode,
	"snipping-tool": renderSnippingTool,
	"image-converter": renderImageConverter,
	"storage-inspector": renderStorageInspector,
}

function renderStorageInspector(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-storage-wrap")

	function normalize(raw) {
		if (!raw) return { items: [], totalBytes: 0 }
		if (Array.isArray(raw.items)) return raw
		if (Array.isArray(raw)) {
			const items = raw.map((item) => {
				if (typeof item === "string") {
					const eqIdx = item.indexOf("=")
					const key = eqIdx === -1 ? item : item.slice(0, eqIdx).trim()
					const val = eqIdx === -1 ? "" : item.slice(eqIdx + 1).trim()
					return { key, value: val, bytes: item.length }
				}
				return item
			})
			return { items, totalBytes: items.reduce((acc, i) => acc + (i.bytes || 0), 0) }
		}
		if (typeof raw === "object") {
			const map = raw.map || raw
			const items = Object.entries(map)
				.filter(([k]) => k !== "__error")
				.map(([key, val]) => {
					const strVal = String(val)
					return { key, value: strVal, bytes: (key.length + strVal.length) * 2 }
				})
			return { items, totalBytes: raw.totalBytes || items.reduce((acc, i) => acc + i.bytes, 0) }
		}
		return { items: [], totalBytes: 0 }
	}

	const stores = {
		localStorage: normalize(value.localStorage),
		sessionStorage: normalize(value.sessionStorage),
		cookies: normalize(value.cookies),
	}

	let activeStore = "localStorage"
	let searchQuery = ""

	const statGrid = node("div", "rv-stat-grid")
	statGrid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))"
	statGrid.style.marginBottom = "8px"

	const localStat = statCard("Local", `${stores.localStorage.items.length} · ${formatStorageSize(stores.localStorage.totalBytes)}`)
	const sessionStat = statCard("Session", `${stores.sessionStorage.items.length} · ${formatStorageSize(stores.sessionStorage.totalBytes)}`)
	const cookieStat = statCard("Cookies", `${stores.cookies.items.length} · ${formatStorageSize(stores.cookies.totalBytes)}`)
	statGrid.append(localStat, sessionStat, cookieStat)
	wrap.appendChild(statGrid)

	const tabsRow = node("div", "rv-storage-tabs")
	const tabBtns = {}
	const tabLabels = [
		["localStorage", "Local", stores.localStorage.items.length],
		["sessionStorage", "Session", stores.sessionStorage.items.length],
		["cookies", "Cookies", stores.cookies.items.length],
	]

	for (const [key, shortName, count] of tabLabels) {
		const btn = node("button", `rv-storage-tab ${key === activeStore ? "active" : ""}`, `${shortName} (${count})`)
		btn.type = "button"
		btn.addEventListener("click", () => {
			activeStore = key
			for (const [k, b] of Object.entries(tabBtns)) {
				b.className = `rv-storage-tab ${k === activeStore ? "active" : ""}`
			}
			renderList()
		})
		tabBtns[key] = btn
		tabsRow.appendChild(btn)
	}
	wrap.appendChild(tabsRow)

	const toolbar = node("div", "rv-storage-toolbar")

	const searchInput = node("input", "rv-storage-search")
	searchInput.type = "search"
	searchInput.placeholder = "Filter keys and values…"
	searchInput.addEventListener("input", (e) => {
		searchQuery = e.target.value.toLowerCase().trim()
		renderList()
	})
	toolbar.appendChild(searchInput)

	const subbar = node("div", "rv-storage-subbar")
	const countLabel = node("span", "rv-storage-count", "")
	subbar.appendChild(countLabel)

	const subActions = node("div", "rv-storage-subbar-actions")

	const exportBtn = node("button", "rv-copy-pill", "Export JSON")
	exportBtn.type = "button"
	exportBtn.addEventListener("click", () => {
		const exportData = {
			localStorage: Object.fromEntries(stores.localStorage.items.map((i) => [i.key, i.value])),
			sessionStorage: Object.fromEntries(stores.sessionStorage.items.map((i) => [i.key, i.value])),
			cookies: stores.cookies.items.map((i) => `${i.key}=${i.value}`),
			exportedAt: new Date().toISOString(),
		}
		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `storage-dump-${Date.now()}.json`
		a.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
		onStatus?.("Storage dump exported as JSON")
	})
	subActions.appendChild(exportBtn)

	const clearBtn = node("button", "rv-copy-pill", "Clear Store")
	clearBtn.type = "button"
	clearBtn.style.color = "var(--danger)"
	clearBtn.style.borderColor = "var(--danger-soft)"
	clearBtn.addEventListener("click", async () => {
		if (activeStore === "cookies") {
			onStatus?.("Cookie clearing requires browser devtools")
			return
		}
		try {
			await sendToPage({ type: "storage-clear", payload: { store: activeStore } })
			stores[activeStore].items = []
			stores[activeStore].totalBytes = 0
			const shortName = activeStore === "localStorage" ? "Local" : "Session"
			tabBtns[activeStore].textContent = `${shortName} (0)`
			onStatus?.(`Cleared ${activeStore}`)
			renderList()
		} catch (err) {
			onStatus?.(`Error clearing storage: ${err.message}`)
		}
	})
	subActions.appendChild(clearBtn)
	subbar.appendChild(subActions)
	toolbar.appendChild(subbar)

	wrap.appendChild(toolbar)

	const listContainer = node("div", "rv-storage-list")
	listContainer.style.display = "flex"
	listContainer.style.flexDirection = "column"
	listContainer.style.gap = "8px"
	wrap.appendChild(listContainer)

	function renderList() {
		listContainer.innerHTML = ""
		const currentStore = stores[activeStore]
		let filtered = currentStore.items
		if (searchQuery) {
			filtered = filtered.filter((i) =>
				i.key.toLowerCase().includes(searchQuery) ||
				String(i.value).toLowerCase().includes(searchQuery)
			)
		}

		countLabel.textContent = `${filtered.length} of ${currentStore.items.length} ${activeStore} items`

		if (filtered.length === 0) {
			const emptyBox = node("div", "rv-preview-box", currentStore.items.length === 0
				? `No entries in ${activeStore} on this page`
				: "No entries match search query"
			)
			emptyBox.style.textAlign = "center"
			emptyBox.style.padding = "20px"
			emptyBox.style.color = "var(--muted)"
			listContainer.appendChild(emptyBox)
			return
		}

		for (const item of filtered) {
			const row = node("div", "rv-storage-item")

			const header = node("div", "rv-storage-item-header")
			const keyName = node("span", "rv-storage-key", item.key)
			keyName.title = item.key
			header.appendChild(keyName)

			const badges = node("div", "rv-storage-badges")
			const sizeBadge = node("span", "rv-pill-dim", formatStorageSize(item.bytes))
			sizeBadge.style.fontSize = "10px"
			badges.appendChild(sizeBadge)

			if (typeof item.value === "string" && (item.value.startsWith("{") || item.value.startsWith("["))) {
				const jsonTag = node("span", "rv-pill-active", "JSON")
				jsonTag.style.fontSize = "10px"
				jsonTag.style.padding = "1px 4px"
				badges.appendChild(jsonTag)
			}
			header.appendChild(badges)
			row.appendChild(header)

			const valBox = node("div", "rv-storage-val", item.value)
			valBox.title = "Click to expand/collapse"
			valBox.addEventListener("click", () => {
				valBox.classList.toggle("expanded")
			})
			row.appendChild(valBox)

			const footer = node("div", "rv-storage-item-footer")
			const hint = node("span", "rv-storage-hint", "Click value to toggle full view")
			footer.appendChild(hint)

			const actions = node("div", "rv-storage-actions")
			actions.appendChild(copyPill("Copy Key", item.key, onStatus))
			actions.appendChild(copyPill("Copy Val", item.value, onStatus))

			if (activeStore !== "cookies") {
				const delBtn = node("button", "rv-storage-del-btn", "✕ Delete")
				delBtn.type = "button"
				delBtn.addEventListener("click", async (e) => {
					e.stopPropagation()
					try {
						await sendToPage({ type: "storage-remove-key", payload: { store: activeStore, key: item.key } })
						currentStore.items = currentStore.items.filter((i) => i.key !== item.key)
						currentStore.totalBytes = Math.max(0, currentStore.totalBytes - item.bytes)
						const shortName = activeStore === "localStorage" ? "Local" : "Session"
						tabBtns[activeStore].textContent = `${shortName} (${currentStore.items.length})`
						onStatus?.(`Deleted key "${item.key}"`)
						renderList()
					} catch (err) {
						onStatus?.(`Error deleting: ${err.message}`)
					}
				})
				actions.appendChild(delBtn)
			}
			footer.appendChild(actions)
			row.appendChild(footer)

			listContainer.appendChild(row)
		}
	}

	renderList()
	return wrap
}

function renderSeoAudit(value) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-seo-audit")

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Title Length", `${value.titleLength ?? 0} chars`))
	statGrid.appendChild(statCard("Meta Desc", `${(value.description || "").length} chars`))
	const imgAlt = value.images ? `${value.images.total - value.images.missingAlt}/${value.images.total}` : "0/0"
	statGrid.appendChild(statCard("Images Alt", imgAlt))
	statGrid.appendChild(statCard("Structured Data", `${value.structuredData ?? 0} schemas`))
	statGrid.appendChild(statCard("Indexation", value.isNoIndex ? "Blocked (noindex)" : "Indexable (OK)"))
	wrap.appendChild(statGrid)

	const googleBox = node("div", "rv-preview-box")
	googleBox.appendChild(node("div", "rv-preview-title", "Google Search Result Preview"))
	const gCard = node("div", "rv-google-card")
	const gUrl = node("div", "rv-google-url", value.canonical || "https://example.com")
	const gTitle = node("div", "rv-google-title", value.title || "Untitled Document")
	const gDesc = node("div", "rv-google-desc", value.description || "No meta description provided for this page.")
	gCard.append(gUrl, gTitle, gDesc)
	googleBox.appendChild(gCard)
	wrap.appendChild(googleBox)

	const og = value.openGraph || {}
	const tw = value.twitter || {}
	if (og.title || og.image || og.description || tw.image || tw.title) {
		const socialBox = node("div", "rv-preview-box")
		socialBox.appendChild(node("div", "rv-preview-title", "Social Share Preview (Open Graph / X)"))
		const socialCard = node("div", "rv-og-card")
		const previewImg = og.image || tw.image
		if (previewImg) {
			const img = document.createElement("img")
			img.className = "rv-og-img"
			img.src = previewImg
			img.alt = og.title || tw.title || "Social Preview Image"
			socialCard.appendChild(img)
		}
		const ogMeta = node("div", "rv-og-meta")
		ogMeta.appendChild(node("div", "rv-og-title", og.title || tw.title || value.title || "No Title"))
		ogMeta.appendChild(node("div", "rv-og-desc", og.description || tw.description || value.description || "No Description"))
		socialCard.appendChild(ogMeta)
		socialBox.appendChild(socialCard)
		wrap.appendChild(socialBox)
	}

	if (value.headings) {
		const hBox = node("div", "rv-preview-box")
		hBox.appendChild(node("div", "rv-preview-title", "Heading Hierarchy (H1 – H6)"))
		const hRow = node("div", "rv-pill-row")
		for (const [tag, count] of Object.entries(value.headings.counts || {})) {
			hRow.appendChild(pill(`${tag.toUpperCase()}: ${count}`, count > 0 ? "rv-pill-active" : "rv-pill-dim"))
		}
		hBox.appendChild(hRow)
		if (Array.isArray(value.headings.h1) && value.headings.h1.length) {
			const h1List = node("div", "rv-h1-list")
			for (const h1 of value.headings.h1) {
				h1List.appendChild(node("div", "rv-h1-item", `H1: "${h1}"`))
			}
			hBox.appendChild(h1List)
		}
		wrap.appendChild(hBox)
	}

	if (Array.isArray(value.warnings) && value.warnings.length) {
		const warnBox = node("div", "rv-warn-box")
		warnBox.appendChild(node("div", "rv-warn-title", `SEO Audit Recommendations (${value.warnings.length})`))
		for (const w of value.warnings) {
			warnBox.appendChild(node("div", "rv-warn-item", `• ${w}`))
		}
		wrap.appendChild(warnBox)
	} else {
		wrap.appendChild(node("div", "rv-pass-banner", "✓ All core SEO meta tags, title length, and canonicals pass!"))
	}

	return wrap
}

function renderA11yAudit(value, onStatus, onInspect) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-a11y-audit")

	const summary = value.summary || {}
	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Total Issues", value.total ?? 0))
	statGrid.appendChild(statCard("Critical", summary.critical ?? 0))
	statGrid.appendChild(statCard("Serious", summary.serious ?? 0))
	statGrid.appendChild(statCard("Moderate", summary.moderate ?? 0))
	statGrid.appendChild(statCard("Minor", summary.minor ?? 0))
	wrap.appendChild(statGrid)

	const issues = Array.isArray(value.issues) ? value.issues : []
	if (issues.length) {
		const filterBar = node("div", "rv-pill-row")
		filterBar.style.margin = "8px 0"
		let activeFilter = "all"

		const issueList = node("div", "rv-issue-list")

		const renderItems = (filter) => {
			issueList.innerHTML = ""
			const filtered = filter === "all" ? issues : issues.filter((i) => i.severity === filter)
			for (const issue of filtered.slice(0, 60)) {
				const item = node("div", `rv-issue-item rv-sev-${issue.severity || "minor"}`)
				const top = node("div", "rv-issue-top")
				top.appendChild(badge(issue.severity?.toUpperCase() || "ISSUE", issue.severity === "minor"))
				top.appendChild(node("span", "rv-issue-rule", issue.rule || "Accessibility"))
				item.appendChild(top)

				item.appendChild(node("div", "rv-issue-msg", issue.message || "Accessibility violation"))

				if (issue.selector) {
					const bot = node("div", "rv-issue-bot")
					const selCode = node("code", "rv-issue-selector", issue.selector)
					bot.appendChild(selCode)
					if (onInspect) {
						const btn = node("button", "rv-inspect-btn", "⊙ Highlight on Page")
						btn.type = "button"
						btn.addEventListener("click", () => {
							onInspect(issue.selector)
							onStatus?.(`Inspecting ${issue.selector.slice(0, 30)}…`)
						})
						bot.appendChild(btn)
					}
					item.appendChild(bot)
				}
				issueList.appendChild(item)
			}
		}

		for (const sev of ["all", "critical", "serious", "moderate", "minor"]) {
			const count = sev === "all" ? issues.length : (summary[sev] || 0)
			if (sev !== "all" && count === 0) continue
			const btn = node("button", `rv-pill ${sev === activeFilter ? "rv-pill-active" : "rv-pill-dim"}`, `${sev.toUpperCase()} (${count})`)
			btn.type = "button"
			btn.style.cursor = "pointer"
			btn.addEventListener("click", () => {
				activeFilter = sev
				filterBar.querySelectorAll(".rv-pill").forEach((p) => p.classList.replace("rv-pill-active", "rv-pill-dim"))
				btn.classList.replace("rv-pill-dim", "rv-pill-active")
				renderItems(sev)
			})
			filterBar.appendChild(btn)
		}

		wrap.appendChild(filterBar)
		renderItems("all")
		wrap.appendChild(issueList)
	} else {
		wrap.appendChild(node("div", "rv-pass-banner", "✓ No automated accessibility violations detected on this page!"))
	}

	return wrap
}

function renderPageMetrics(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-page-metrics")

	const cwvBox = node("div", "rv-preview-box")
	cwvBox.appendChild(node("div", "rv-preview-title", "Core Web Vitals & Real Performance"))
	const cwvGrid = node("div", "rv-stat-grid")

	if (value.vitals) {
		const v = value.vitals
		for (const [key, item] of Object.entries(v)) {
			const display = item.value !== null && item.value !== undefined ? `${item.value}${item.unit}` : "N/A"
			const card = statCard(`${item.label} (${item.rating})`, display)
			if (item.rating === "good") card.style.borderTop = "3px solid var(--success)"
			else if (item.rating === "needs-improvement") card.style.borderTop = "3px solid #f59e0b"
			else if (item.rating === "poor") card.style.borderTop = "3px solid var(--danger)"
			cwvGrid.appendChild(card)
		}
	} else {
		const lcpVal = value.lcpMs !== null && value.lcpMs !== undefined ? `${value.lcpMs}ms` : "N/A"
		cwvGrid.appendChild(statCard("LCP (Main Content)", lcpVal))
		const clsVal = value.cls !== null && value.cls !== undefined ? value.cls : "N/A"
		cwvGrid.appendChild(statCard("CLS (Visual Shift)", clsVal))
		const ttfbVal = value.ttfbMs !== null && value.ttfbMs !== undefined ? `${value.ttfbMs}ms` : "N/A"
		cwvGrid.appendChild(statCard("TTFB (Server Resp)", ttfbVal))
		const loadVal = value.loadMs !== null && value.loadMs !== undefined ? `${value.loadMs}ms` : "N/A"
		cwvGrid.appendChild(statCard("Window Load", loadVal))
	}
	cwvBox.appendChild(cwvGrid)
	wrap.appendChild(cwvBox)

	const sumGrid = node("div", "rv-stat-grid")
	sumGrid.appendChild(statCard("Transfer Size", value.transferReadable || `${Math.round((value.transferBytes || 0) / 1024)} KB`))
	sumGrid.appendChild(statCard("Resources", value.resourceCount ?? 0))
	sumGrid.appendChild(statCard("DOM Nodes", value.domNodes ?? 0))
	if (value.memory?.usedJsHeap) {
		sumGrid.appendChild(statCard("JS Heap", `${value.memory.usedJsHeap} / ${value.memory.totalJsHeap}`))
	}
	wrap.appendChild(sumGrid)

	const navBox = node("div", "rv-preview-box")
	navBox.appendChild(node("div", "rv-preview-title", "Navigation & Milestones"))
	const navTable = node("div", "rv-kv-table")
	navTable.appendChild(kvRow("DOM Content Loaded", `${value.domContentLoadedMs ?? "N/A"}ms`, onStatus))
	navTable.appendChild(kvRow("Page Load Time", `${value.loadMs ?? "N/A"}ms`, onStatus))
	if (value.longTasks) {
		navTable.appendChild(kvRow("Long Tasks (Main Thread)", `${value.longTasks.count} (${value.longTasks.totalMs}ms total)`, onStatus))
	}
	navBox.appendChild(navTable)
	wrap.appendChild(navBox)

	if (value.resourcesByType && Object.keys(value.resourcesByType).length) {
		const typeBox = node("div", "rv-preview-box")
		typeBox.appendChild(node("div", "rv-preview-title", "Resource Distribution by Type"))
		const typeRow = node("div", "rv-pill-row")
		for (const [type, count] of Object.entries(value.resourcesByType)) {
			typeRow.appendChild(pill(`${type}: ${count}`, "rv-pill-active"))
		}
		typeBox.appendChild(typeRow)
		wrap.appendChild(typeBox)
	}

	const largest = value.largestResources || value.largest
	if (Array.isArray(largest) && largest.length) {
		const resBox = node("div", "rv-preview-box")
		resBox.appendChild(node("div", "rv-preview-title", "Top Heavy Network Payloads"))
		for (const res of largest) {
			const rRow = node("div", "rv-res-row")
			rRow.style.display = "flex"
			rRow.style.justifyContent = "space-between"
			rRow.style.alignItems = "center"
			rRow.style.padding = "4px 0"
			rRow.style.borderBottom = "1px solid var(--border)"
			rRow.appendChild(node("span", "rv-res-name", res.name))
			const rightPart = node("div", "")
			rightPart.style.display = "flex"
			rightPart.style.gap = "6px"
			rightPart.appendChild(node("span", "rv-res-size", res.size))
			rightPart.appendChild(node("span", "rv-res-type", res.type || ""))
			if (res.fullUrl) {
				rightPart.appendChild(copyPill("URL", res.fullUrl, onStatus))
			}
			rRow.appendChild(rightPart)
			resBox.appendChild(rRow)
		}
		wrap.appendChild(resBox)
	}

	return wrap
}

function renderLinkCheck(value, onStatus, onInspect) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-link-check")

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Total Links", value.links ?? 0))
	statGrid.appendChild(statCard("Total Images", value.images ?? 0))
	statGrid.appendChild(statCard("Broken Links", value.brokenLinks?.length ?? 0))
	statGrid.appendChild(statCard("Broken Images", value.brokenImages?.length ?? 0))
	wrap.appendChild(statGrid)

	if (Array.isArray(value.brokenLinks) && value.brokenLinks.length) {
		const box = node("div", "rv-warn-box")
		box.appendChild(node("div", "rv-warn-title", `Broken Links (${value.brokenLinks.length})`))
		for (const item of value.brokenLinks) {
			const row = node("div", "rv-warn-item")
			row.textContent = `${item.status || "ERR"}: ${item.url}`
			box.appendChild(row)
		}
		wrap.appendChild(box)
	}

	if (Array.isArray(value.brokenImages) && value.brokenImages.length) {
		const box = node("div", "rv-warn-box")
		box.appendChild(node("div", "rv-warn-title", `Broken Images (${value.brokenImages.length})`))
		for (const item of value.brokenImages) {
			const src = typeof item === "string" ? item : item.src
			const row = node("div", "rv-warn-item")
			row.textContent = `Broken: ${src.slice(0, 60)}…`
			box.appendChild(row)
		}
		wrap.appendChild(box)
	}

	if (Array.isArray(value.problems) && value.problems.length) {
		const box = node("div", "rv-preview-box")
		box.appendChild(node("div", "rv-preview-title", `Link & Anchor Issues (${value.problems.length})`))
		for (const p of value.problems.slice(0, 40)) {
			const row = node("div", "rv-issue-item rv-sev-minor")
			row.appendChild(node("div", "rv-issue-msg", `${p.issue}${p.text ? ` ("${p.text}")` : ""}`))
			if (p.selector && onInspect) {
				const bot = node("div", "rv-issue-bot")
				bot.appendChild(node("code", "rv-issue-selector", p.selector))
				const btn = node("button", "rv-inspect-btn", "⊙ Highlight")
				btn.type = "button"
				btn.addEventListener("click", () => {
					onInspect(p.selector)
					onStatus?.(`Highlighting ${p.selector.slice(0, 25)}…`)
				})
				bot.appendChild(btn)
				row.appendChild(bot)
			}
			box.appendChild(row)
		}
		wrap.appendChild(box)
	} else if (!value.brokenLinks?.length && !value.brokenImages?.length) {
		wrap.appendChild(node("div", "rv-pass-banner", "✓ All scanned page links, anchors, and images are healthy!"))
	}

	return wrap
}

function renderTechStack(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = node("div", "rv-tech-stack")

	const statGrid = node("div", "rv-stat-grid")
	const count = value.count ?? (Array.isArray(value.detected) ? value.detected.length : 0)
	statGrid.appendChild(statCard("Detected Tech", `${count}`))
	statGrid.appendChild(statCard("Script Domains", `${value.scriptDomains?.length ?? 0}`))
	const pwaStatus = value.serviceWorker
		? "Service Worker"
		: value.detected?.includes?.("PWA Manifest")
			? "PWA Manifest"
			: "None"
	statGrid.appendChild(statCard("PWA / Offline", pwaStatus))
	wrap.appendChild(statGrid)

	const toolbar = node("div", "rv-pill-row")
	toolbar.style.display = "flex"
	toolbar.style.justifyContent = "space-between"
	toolbar.style.alignItems = "center"
	toolbar.style.margin = "6px 0"
	toolbar.appendChild(node("span", "rv-stat-label", `${count} technologies identified`))
	toolbar.appendChild(copyPill("Copy Tech List", (value.detected || []).join(", "), onStatus))
	wrap.appendChild(toolbar)

	const TECH_ICONS = {
		"Next.js": "▲",
		"React": "⚛️",
		"Vue": "🟢",
		"Nuxt": "▲",
		"Angular": "🅰️",
		"Svelte": "🔥",
		"SvelteKit": "🔥",
		"Remix": "💿",
		"Astro": "🚀",
		"Qwik": "⚡",
		"Preact": "⚛️",
		"Solid": "🔷",
		"Tailwind CSS": "🌊",
		"Tailwind": "🌊",
		"Radix UI": "🧩",
		"Shadcn UI": "🖤",
		"Bootstrap": "🅱️",
		"Material UI": "Ⓜ️",
		"Chakra UI": "⚡",
		"Mantine": "🔷",
		"Ant Design": "🐜",
		"Styled Components": "💅",
		"Lucide Icons": "✨",
		"Font Awesome": "🚩",
		"Framer Motion": "🎬",
		"GSAP": "🟩",
		"Three.js": "🔺",
		"Redux": "🔄",
		"TanStack Query": "📡",
		"Apollo GraphQL": "🚀",
		"Google Tag Manager": "🏷️",
		"Google Analytics": "📊",
		"Meta (Facebook) Pixel": "♾️",
		"Twitter (X) Ads": "🐦",
		"Clerk": "🔐",
		"Stripe": "💳",
		"Supabase": "⚡",
		"Firebase": "🔥",
		"Tolt": "🤝",
		"Sentry": "🛡️",
		"Hotjar": "🔥",
		"Segment": "🔀",
		"PostHog": "🦔",
		"Cloudflare Insights": "☁️",
		"Vercel Analytics": "▲",
		"Microsoft Clarity": "🔍",
		"WordPress": "📝",
		"Shopify": "🛍️",
		"Webflow": "🌐",
		"Squarespace": "⬛",
		"Webpack": "📦",
		"Vite": "⚡",
		"Turbopack": "⚡",
		"Service Worker": "⚙️",
		"PWA Manifest": "📱",
	}

	if (value.categories && Object.keys(value.categories).length) {
		for (const [category, techList] of Object.entries(value.categories)) {
			if (!techList || !techList.length) continue
			const box = node("div", "rv-preview-box")
			box.appendChild(node("div", "rv-preview-title", category))
			const pillRow = node("div", "rv-pill-row")
			for (const item of techList) {
				const icon = item.icon || TECH_ICONS[item.name] || "⚙️"
				const name = item.name || item
				pillRow.appendChild(pill(`${icon}  ${name}`, "rv-pill-active"))
			}
			box.appendChild(pillRow)
			wrap.appendChild(box)
		}
	} else if (Array.isArray(value.detected) && value.detected.length) {
		const box = node("div", "rv-preview-box")
		box.appendChild(node("div", "rv-preview-title", "Detected Technologies"))
		const pillRow = node("div", "rv-pill-row")
		for (const name of value.detected) {
			const icon = TECH_ICONS[name] || "⚙️"
			pillRow.appendChild(pill(`${icon}  ${name}`, "rv-pill-active"))
		}
		box.appendChild(pillRow)
		wrap.appendChild(box)
	}

	if (Array.isArray(value.scriptDomains) && value.scriptDomains.length) {
		const domainBox = node("div", "rv-preview-box")
		domainBox.appendChild(node("div", "rv-preview-title", `Script Domains (${value.scriptDomains.length})`))
		const domainRow = node("div", "rv-pill-row")
		for (const d of value.scriptDomains) {
			domainRow.appendChild(pill(d, "rv-pill-dim"))
		}
		domainBox.appendChild(domainRow)
		wrap.appendChild(domainBox)
	}

	return wrap
}

function renderTextDiff(value, onStatus) {
	if (typeof value !== "string") return null
	const lines = value.split("\n")
	if (lines.length < 2) return null

	const wrap = node("div", "rv-diff")

	const summary = lines[0]
	const contentLines = lines.slice(1).filter((l) => l && l.trim())

	let addedCount = 0
	let delCount = 0
	let ctxCount = 0
	for (const line of contentLines) {
		const op = line.charAt(0)
		if (op === "+") addedCount++
		else if (op === "-") delCount++
		else if (op === "=") ctxCount++
	}

	const statGrid = node("div", "rv-stat-grid")
	statGrid.style.gridTemplateColumns = "repeat(3, 1fr)"
	statGrid.appendChild(statCard("Added (+)", `+${addedCount}`))
	statGrid.appendChild(statCard("Deleted (-)", `-${delCount}`))
	statGrid.appendChild(statCard("Unchanged", `${ctxCount}`))
	wrap.appendChild(statGrid)

	const toolRow = node("div", "rv-pill-row")
	toolRow.style.display = "flex"
	toolRow.style.justifyContent = "space-between"
	toolRow.style.alignItems = "center"
	toolRow.style.margin = "6px 0"

	if (summary) {
		toolRow.appendChild(node("div", "rv-diff-summary", summary))
	}
	toolRow.appendChild(copyPill("Copy Diff", value, onStatus))
	wrap.appendChild(toolRow)

	const body = node("div", "rv-diff-body")
	for (const line of contentLines) {
		const row = node("div", "rv-diff-line")
		const op = line.charAt(0)
		const text = line.slice(2)
		if (op === "-") {
			row.className = "rv-diff-line rv-diff-del"
		} else if (op === "+") {
			row.className = "rv-diff-line rv-diff-add"
		} else {
			row.className = "rv-diff-line rv-diff-ctx"
		}
		const marker = node("span", "rv-diff-marker", op === "=" ? " " : op)
		const content = node("span", "rv-diff-text", text)
		row.appendChild(marker)
		row.appendChild(content)
		body.appendChild(row)
	}
	wrap.appendChild(body)
	return wrap
}

export function renderRichResult(toolId, value, onStatus, onInspect) {
	const renderer = renderers[toolId]
	if (!renderer) return null
	try {
		return renderer(value, onStatus, onInspect)
	} catch {
		return null
	}
}
