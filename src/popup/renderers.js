

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

	if (value.foreground && value.background) {
		const preview = node("div", "rv-contrast-preview")
		preview.style.backgroundColor = value.background
		preview.style.color = value.foreground
		preview.style.padding = "14px 16px"
		preview.style.borderRadius = "8px"
		preview.style.marginBottom = "12px"
		preview.style.border = "1px solid rgba(128,128,128,0.25)"
		preview.style.display = "flex"
		preview.style.flexDirection = "column"
		preview.style.gap = "4px"

		const heading = node("span", "", "Aa Large Text (18pt+)")
		heading.style.fontWeight = "700"
		heading.style.fontSize = "16px"
		const body = node("span", "", "The quick brown fox jumps over the lazy dog.")
		body.style.fontSize = "13px"
		preview.appendChild(heading)
		preview.appendChild(body)
		wrap.appendChild(preview)
	}

	const ratioBlock = node("div", "rv-contrast-ratio")
	ratioBlock.appendChild(node("span", "rv-contrast-ratio-num", `${value.ratio}:1`))
	ratioBlock.appendChild(node("span", "rv-contrast-ratio-label", "Contrast ratio"))
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

	copyOnClick(ratioBlock, `${value.ratio}:1`, onStatus)
	ratioBlock.style.cursor = "pointer"
	ratioBlock.title = "Click to copy ratio"
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

	if (value.expired !== null) {
		const banner = node("div", value.expired ? "rv-jwt-banner rv-jwt-expired" : "rv-jwt-banner rv-jwt-valid")
		banner.textContent = value.expired
			? `✗ Expired ${value.expiresAt ? "at " + value.expiresAt : ""}`
			: `✓ Valid ${value.expiresAt ? "until " + value.expiresAt : ""}`
		wrap.appendChild(banner)
	} else if (value.expiresAt === null) {
		wrap.appendChild(node("div", "rv-jwt-banner rv-jwt-noexp", "— No expiry claim"))
	}

	const headerSection = node("div", "rv-jwt-section")
	headerSection.appendChild(node("div", "rv-section-title", "Header"))
	const headerContent = node("div", "rv-jwt-fields")
	for (const [k, v] of Object.entries(value.header ?? {})) {
		headerContent.appendChild(kvRow(k, typeof v === "object" ? JSON.stringify(v) : v, onStatus))
	}
	headerSection.appendChild(headerContent)
	wrap.appendChild(headerSection)

	const payloadSection = node("div", "rv-jwt-section")
	payloadSection.appendChild(node("div", "rv-section-title", "Payload"))
	const payloadContent = node("div", "rv-jwt-fields")
	for (const [k, v] of Object.entries(value.payload ?? {})) {
		const display = typeof v === "object" ? JSON.stringify(v) : String(v)
		payloadContent.appendChild(kvRow(k, display, onStatus))
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

function renderJsonFormat(value) {
	if (typeof value !== "string") return null
	const wrap = node("div", "rv-json")
	const pre = node("pre", "rv-json-highlighted")

	const highlighted = highlightJson(value)
	pre.appendChild(highlighted)
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
		reactivateBtn.addEventListener("click", () => {
			const runBtn = document.getElementById("run")
			runBtn?.click()
		})

		banner.append(title, desc, reactivateBtn)
		wrap.appendChild(banner)
		return wrap
	}

	const width = Number(value.width) || window.innerWidth || 1024
	const height = Number(value.height) || window.innerHeight || 768
	const dpr = value.dpr !== undefined ? Number(value.dpr).toFixed(2).replace(/\.00$/, "") : (window.devicePixelRatio ? window.devicePixelRatio.toFixed(2).replace(/\.00$/, "") : "1")

	function getBucket(w) {
		if (w < 480) return "xs (Mobile)"
		if (w < 768) return "sm (Mobile Lg)"
		if (w < 1024) return "md (Tablet)"
		if (w < 1280) return "lg (Laptop)"
		if (w < 1536) return "xl (Desktop)"
		return "2xl (Wide)"
	}

	function calcRatio(w, h) {
		const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
		const g = gcd(w, h)
		const rw = Math.round(w / g)
		const rh = Math.round(h / g)
		if (rw > 32 || rh > 32) {
			return (w / h).toFixed(2) + ":1"
		}
		return `${rw}:${rh}`
	}

	const passBanner = node("div", "rv-pass-banner")
	passBanner.style.display = "flex"
	passBanner.style.alignItems = "center"
	passBanner.style.justifyContent = "space-between"
	passBanner.style.padding = "10px 14px"

	const statusText = node("span", "", "● Viewport HUD Active on Page")
	statusText.style.fontWeight = "600"
	passBanner.appendChild(statusText)

	const closeBtn = node("button", "rv-copy-mini", "✕ Hide HUD")
	closeBtn.type = "button"
	closeBtn.style.cursor = "pointer"
	closeBtn.addEventListener("click", () => {
		const runBtn = document.getElementById("run")
		runBtn?.click()
	})
	passBanner.appendChild(closeBtn)
	wrap.appendChild(passBanner)

	const statGrid = node("div", "rv-stat-grid")
	statGrid.appendChild(statCard("Viewport Width", `${width}px`))
	statGrid.appendChild(statCard("Viewport Height", `${height}px`))
	statGrid.appendChild(statCard("Breakpoint", getBucket(width)))
	statGrid.appendChild(statCard("Pixel Ratio", `${dpr}x DPR`))
	statGrid.appendChild(statCard("Aspect Ratio", calcRatio(width, height)))
	statGrid.appendChild(statCard("Orientation", width >= height ? "Landscape" : "Portrait"))
	wrap.appendChild(statGrid)

	const mqBox = node("div", "rv-preview-box")
	mqBox.appendChild(node("div", "rv-preview-title", "CSS @media Queries for Current Size"))

	const maxMq = `@media (max-width: ${width}px) {\n}`
	const minMq = `@media (min-width: ${width}px) {\n}`

	const maxRow = node("div", "rv-kv-row")
	maxRow.appendChild(node("span", "rv-kv-key", "max-width"))
	maxRow.appendChild(node("code", "rv-kv-val", `@media (max-width: ${width}px)`))
	maxRow.appendChild(copyPill("Copy", maxMq, onStatus))
	mqBox.appendChild(maxRow)

	const minRow = node("div", "rv-kv-row")
	minRow.appendChild(node("span", "rv-kv-key", "min-width"))
	minRow.appendChild(node("code", "rv-kv-val", `@media (min-width: ${width}px)`))
	minRow.appendChild(copyPill("Copy", minMq, onStatus))
	mqBox.appendChild(minRow)

	wrap.appendChild(mqBox)

	const refBox = node("div", "rv-preview-box")
	refBox.appendChild(node("div", "rv-preview-title", "Common Device Breakpoint Reference"))
	const pillRow = node("div", "rv-pill-row")
	const presets = [
		["Mobile: 375×812", "@media (max-width: 375px)"],
		["Mobile Lg: 414×896", "@media (max-width: 414px)"],
		["Tablet: 768×1024", "@media (max-width: 768px)"],
		["Laptop: 1280×800", "@media (max-width: 1280px)"],
		["Desktop: 1440×900", "@media (min-width: 1440px)"],
		["Full HD: 1920×1080", "@media (min-width: 1920px)"],
	]
	for (const [pLabel, pQuery] of presets) {
		const isCurrent = (pLabel.includes("375") && width <= 375) ||
			(pLabel.includes("768") && width > 414 && width <= 768) ||
			(pLabel.includes("1280") && width > 768 && width <= 1280) ||
			(pLabel.includes("1440") && width > 1280 && width <= 1440) ||
			(pLabel.includes("1920") && width > 1440)
		const p = pill(pLabel, isCurrent ? "rv-pill-active" : "rv-pill-dim")
		p.style.cursor = "pointer"
		p.title = `Click to copy ${pQuery}`
		copyOnClick(p, pQuery, onStatus)
		pillRow.appendChild(p)
	}
	refBox.appendChild(pillRow)
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
	if (og.title || og.image || og.description) {
		const ogBox = node("div", "rv-preview-box")
		ogBox.appendChild(node("div", "rv-preview-title", "Social Share Preview (Open Graph)"))
		const ogCard = node("div", "rv-og-card")
		if (og.image) {
			const img = document.createElement("img")
			img.className = "rv-og-img"
			img.src = og.image
			img.alt = og.title || "Preview image"
			ogCard.appendChild(img)
		}
		const ogMeta = node("div", "rv-og-meta")
		ogMeta.appendChild(node("div", "rv-og-title", og.title || value.title || "No og:title"))
		ogMeta.appendChild(node("div", "rv-og-desc", og.description || value.description || "No og:description"))
		ogCard.appendChild(ogMeta)
		ogBox.appendChild(ogCard)
		wrap.appendChild(ogBox)
	}

	if (value.headings) {
		const hBox = node("div", "rv-preview-box")
		hBox.appendChild(node("div", "rv-preview-title", "Heading Hierarchy"))
		const hRow = node("div", "rv-pill-row")
		for (const [tag, count] of Object.entries(value.headings.counts || {})) {
			hRow.appendChild(pill(`${tag.toUpperCase()}: ${count}`, count > 0 ? "rv-pill-active" : "rv-pill-dim"))
		}
		hBox.appendChild(hRow)
		if (Array.isArray(value.headings.h1) && value.headings.h1.length) {
			const h1List = node("div", "rv-h1-list")
			for (const h1 of value.headings.h1) {
				h1List.appendChild(node("div", "rv-h1-item", `H1: ${h1}`))
			}
			hBox.appendChild(h1List)
		}
		wrap.appendChild(hBox)
	}

	if (Array.isArray(value.warnings) && value.warnings.length) {
		const warnBox = node("div", "rv-warn-box")
		warnBox.appendChild(node("div", "rv-warn-title", `SEO Advisory (${value.warnings.length})`))
		for (const w of value.warnings) {
			warnBox.appendChild(node("div", "rv-warn-item", `• ${w}`))
		}
		wrap.appendChild(warnBox)
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
	statGrid.appendChild(statCard("Moderate/Minor", (summary.moderate || 0) + (summary.minor || 0)))
	wrap.appendChild(statGrid)

	const issues = Array.isArray(value.issues) ? value.issues : []
	if (issues.length) {
		const issueList = node("div", "rv-issue-list")
		for (const issue of issues.slice(0, 50)) {
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

	const lcpVal = value.lcp !== null && value.lcp !== undefined ? `${value.lcp}ms` : "N/A"
	cwvGrid.appendChild(statCard("LCP (Main Content)", lcpVal))

	const clsVal = value.cls !== null && value.cls !== undefined ? value.cls : "N/A"
	cwvGrid.appendChild(statCard("CLS (Visual Shift)", clsVal))

	const ttfbVal = value.ttfbMs !== null && value.ttfbMs !== undefined ? `${value.ttfbMs}ms` : "N/A"
	cwvGrid.appendChild(statCard("TTFB (Server Resp)", ttfbVal))

	const loadVal = value.loadMs !== null && value.loadMs !== undefined ? `${value.loadMs}ms` : "N/A"
	cwvGrid.appendChild(statCard("Window Load", loadVal))

	cwvBox.appendChild(cwvGrid)
	wrap.appendChild(cwvBox)

	const navBox = node("div", "rv-preview-box")
	navBox.appendChild(node("div", "rv-preview-title", "Navigation Timings"))
	const navTable = node("div", "rv-kv-table")
	navTable.appendChild(kvRow("Ready State", value.readyState || "complete", onStatus))
	navTable.appendChild(kvRow("DOM Content Loaded", `${value.domContentLoadedMs ?? "N/A"}ms`, onStatus))
	navTable.appendChild(kvRow("Page Load Time", `${value.loadMs ?? "N/A"}ms`, onStatus))
	if (value.longTasks) {
		navTable.appendChild(kvRow("Long Tasks (Main Thread)", `${value.longTasks.count} (${value.longTasks.totalMs}ms total)`, onStatus))
	}
	navBox.appendChild(navTable)
	wrap.appendChild(navBox)

	if (Array.isArray(value.largest) && value.largest.length) {
		const resBox = node("div", "rv-preview-box")
		resBox.appendChild(node("div", "rv-preview-title", "Top Heavy Resources"))
		for (const res of value.largest) {
			const rRow = node("div", "rv-res-row")
			rRow.appendChild(node("span", "rv-res-name", res.name))
			rRow.appendChild(node("span", "rv-res-size", res.size))
			rRow.appendChild(node("span", "rv-res-type", res.type))
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
		box.appendChild(node("div", "rv-preview-title", `Link Issues & Warnings (${value.problems.length})`))
		for (const p of value.problems.slice(0, 30)) {
			const row = node("div", "rv-issue-item rv-sev-minor")
			row.appendChild(node("div", "rv-issue-msg", `${p.issue}${p.text ? ` ("${p.text}")` : ""}`))
			if (p.selector && onInspect) {
				const bot = node("div", "rv-issue-bot")
				bot.appendChild(node("code", "rv-issue-selector", p.selector))
				const btn = node("button", "rv-inspect-btn", "⊙ Highlight")
				btn.type = "button"
				btn.addEventListener("click", () => onInspect(p.selector))
				bot.appendChild(btn)
				row.appendChild(bot)
			}
			box.appendChild(row)
		}
		wrap.appendChild(box)
	}

	return wrap
}

function renderTechStack(value) {
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
		"Preact": "⚛️",
		"Solid": "🔷",
		"Tailwind CSS": "🌊",
		"Tailwind": "🌊",
		"Radix UI": "🧩",
		"Bootstrap": "🅱️",
		"Material UI": "Ⓜ️",
		"Lucide Icons": "✨",
		"Font Awesome": "🚩",
		"Framer Motion": "🎬",
		"GSAP": "🟩",
		"Three.js": "🔺",
		"Google Tag Manager": "🏷️",
		"Google Analytics": "📊",
		"Meta (Facebook) Pixel": "♾️",
		"Twitter (X) Ads": "🐦",
		"Clerk": "🔐",
		"Stripe": "💳",
		"Tolt": "🤝",
		"Sentry": "🛡️",
		"Hotjar": "🔥",
		"Segment": "🔀",
		"PostHog": "🦔",
		"WordPress": "📝",
		"Shopify": "🛍️",
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

function renderTextDiff(value) {
	if (typeof value !== "string") return null
	const lines = value.split("\n")
	if (lines.length < 2) return null

	const wrap = node("div", "rv-diff")

	const summary = lines[0]
	if (summary) {
		wrap.appendChild(node("div", "rv-diff-summary", summary))
	}

	const body = node("div", "rv-diff-body")
	for (const line of lines.slice(1)) {
		if (!line && !line.trim()) continue
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
