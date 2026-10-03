import { resizeCurrentWindow, sendToPage } from "../lib/browser.js"
import { calculateAspectRatio, formatStorageSize, getBreakpointBucket } from "../tools/testing.js"
import { copyText, downloadFile, el as node, icon } from "./dom.js"
import { formatBytes } from "./helpers.js"
import { highlightJson } from "./json-view.js"

function shorten(text, max = 40) {
	const value = String(text ?? "")
	return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function copyOnClick(element, text, onStatus) {
	element.addEventListener("click", async () => {
		const ok = await copyText(text)
		onStatus?.(ok ? `Copied ${shorten(text)}` : "Copy blocked by the browser")
		if (!ok) return
		element.classList.add("rv-copied")
		setTimeout(() => element.classList.remove("rv-copied"), 1200)
	})
}

function iconButton(label, iconName, className = "rv-copy-pill") {
	const btn = node("button", className)
	btn.type = "button"
	if (iconName) btn.appendChild(icon(iconName))
	btn.appendChild(node("span", "btn-label", label))
	return btn
}

function setLabel(btn, label) {
	const span = btn.querySelector(".btn-label")
	if (span) span.textContent = label
}

function copyPill(label, value, onStatus) {
	const btn = iconButton(label, "copy")
	btn.title = `Copy ${shorten(value, 80)}`
	copyOnClick(btn, String(value), onStatus)
	return btn
}

function copyMini(value, onStatus) {
	const btn = copyPill("Copy", value, onStatus)
	btn.className = "rv-copy-mini"
	return btn
}

function pill(text, className) {
	return node("span", `rv-pill ${className ?? ""}`.trim(), text)
}

const TONE_ICON = { good: "check", bad: "close", warn: "warning", info: "info" }

function badge(text, tone) {
	const cls = tone === "good" ? "rv-pass" : tone === "bad" ? "rv-fail" : tone === "warn" ? "rv-warn" : ""
	const el = node("span", `rv-badge ${cls}`.trim())
	el.append(icon(TONE_ICON[tone] ?? "info"), node("span", "", text))
	return el
}

function statCard(label, value, tone) {
	const card = node("div", `rv-stat-card${tone ? ` tone-${tone}` : ""}`)
	card.append(node("div", "rv-stat-value", String(value)), node("div", "rv-stat-label", label))
	card.title = `${label}: ${value}`
	return card
}

function kvRow(key, value, onStatus) {
	const row = node("div", "rv-kv-row")
	row.append(node("span", "rv-kv-key", key), node("span", "rv-kv-val", String(value)), copyMini(String(value), onStatus))
	row.firstChild.title = key
	return row
}

function box(title) {
	const wrap = node("div", "rv-preview-box")
	if (title) wrap.appendChild(node("div", "rv-preview-title", title))
	return wrap
}

function banner(tone, iconName, text) {
	const wrap = node("div", "rv-banner")
	wrap.style.setProperty("--tone", `var(--${tone})`)
	wrap.append(icon(iconName), node("span", "grow", text))
	return wrap
}

function emptyState(iconName, title, detail, actions = []) {
	const wrap = node("div", "rv-empty-state")
	wrap.append(icon(iconName), node("strong", "", title))
	if (detail) wrap.appendChild(node("p", "", detail))
	if (actions.length) {
		const row = node("div", "rv-row")
		row.append(...actions)
		wrap.appendChild(row)
	}
	return wrap
}

function rerunButton(label, iconName = "play") {
	const btn = iconButton(label, iconName, "primary")
	btn.addEventListener("click", () => document.getElementById("run")?.click())
	return btn
}

function stack(className) {
	return node("div", `rv-stack ${className ?? ""}`.trim())
}

async function openImage(dataUrl, onStatus) {
	try {
		const blob = await (await fetch(dataUrl)).blob()
		const url = URL.createObjectURL(blob)
		window.open(url, "_blank", "noopener")
		setTimeout(() => URL.revokeObjectURL(url), 60000)
	} catch {
		onStatus?.("Could not open the image")
	}
}

async function copyImage(source, onStatus) {
	try {
		const blob = source instanceof Blob ? source : await (await fetch(source)).blob()
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
		onStatus?.("Image copied to clipboard")
		return true
	} catch {
		onStatus?.("This browser cannot copy that format, use Save instead")
		return false
	}
}

function copyImageButton(source, onStatus, label = "Copy image") {
	const btn = iconButton(label, "copy")
	btn.addEventListener("click", async () => {
		if (!(await copyImage(source, onStatus))) return
		setLabel(btn, "Copied")
		setTimeout(() => setLabel(btn, label), 1400)
	})
	return btn
}

function previewImage(src, alt, onStatus) {
	const img = node("img", "rv-shot")
	img.src = src
	img.alt = alt
	img.title = "Open full size"
	img.addEventListener("click", () => openImage(src, onStatus))
	return img
}

function renderColorConvert(value, onStatus) {
	if (!value?.hex) return null
	const wrap = node("div", "rv-color-convert")
	const swatch = node("div", "rv-color-swatch-large")
	swatch.style.backgroundColor = value.hex
	const sample = node("span", "rv-color-text-preview", "Aa")
	sample.style.color = value.suggestedTextColor ?? "#fff"
	swatch.appendChild(sample)
	const formats = node("div", "rv-color-formats")
	for (const [label, val] of [["HEX", value.hex], ["RGB", value.rgb], ["HSL", value.hsl], ["OKLCH", value.oklch]]) {
		if (!val) continue
		const row = node("div", "rv-color-format-row")
		row.append(node("span", "rv-color-format-label", label), node("code", "rv-color-format-value", val), copyMini(val, onStatus))
		formats.appendChild(row)
	}
	const meta = node("div", "rv-color-meta")
	if (value.luminance !== undefined) meta.appendChild(node("span", "", `Luminance ${value.luminance}`))
	if (value.suggestedTextColor) meta.appendChild(node("span", "", `Text on it: ${value.suggestedTextColor}`))
	formats.appendChild(meta)
	wrap.append(swatch, formats)
	return wrap
}

function colorPill(label, color, onStatus) {
	const btn = copyPill(label, color, onStatus)
	const chip = node("span", "rv-swatch-chip")
	chip.style.background = color
	btn.prepend(chip)
	return btn
}

function renderContrastChecker(value, onStatus) {
	if (!value || value.ratio === undefined) return null
	const wrap = stack("rv-contrast")
	const colors = node("div", "rv-pill-row")
	if (value.foreground) colors.appendChild(colorPill(`Text ${value.foreground}`, value.foreground, onStatus))
	if (value.background) colors.appendChild(colorPill(`Background ${value.background}`, value.background, onStatus))
	wrap.appendChild(colors)

	if (value.foreground && value.background) {
		const preview = node("div", "rv-contrast-preview")
		preview.style.backgroundColor = value.background
		preview.style.color = value.foreground
		const ui = node("div", "ui-row")
		const solid = node("span", "fake-btn", "Primary action")
		solid.style.background = value.foreground
		solid.style.color = value.background
		const outline = node("span", "fake-btn", "Outline")
		outline.style.border = `1.5px solid ${value.foreground}`
		ui.append(solid, outline)
		preview.append(node("div", "big", "Large heading text"), node("div", "", "Body copy at 13px. Good contrast keeps it readable for everyone."), ui)
		wrap.appendChild(preview)
	}

	const ratio = node("div", "rv-contrast-ratio")
	ratio.title = "Click to copy the ratio"
	ratio.append(node("span", "rv-contrast-ratio-num", `${value.ratio}:1`), badge(value.normalTextAA ? "Passes AA" : "Fails AA", value.normalTextAA ? "good" : "bad"))
	copyOnClick(ratio, `${value.ratio}:1`, onStatus)
	wrap.appendChild(ratio)

	const grid = node("div", "rv-contrast-grid")
	const checks = [
		["Normal text AA", value.normalTextAA, "4.5:1"],
		["Normal text AAA", value.normalTextAAA, "7:1"],
		["Large text AA", value.largeTextAA, "3:1"],
		["Large text AAA", value.largeTextAAA, "4.5:1"],
		["UI components AA", value.uiComponentsAA, "3:1"],
	]
	for (const [label, pass, threshold] of checks) {
		if (pass === undefined) continue
		const row = node("div", "rv-contrast-row")
		row.append(badge(pass ? "Pass" : "Fail", pass ? "good" : "bad"), node("span", "rv-contrast-label", label), node("span", "rv-contrast-threshold", `≥ ${threshold}`))
		grid.appendChild(row)
	}
	wrap.appendChild(grid)

	if (value.suggestions?.aa || value.suggestions?.aaa) {
		const tips = box("Accessible alternatives")
		const row = node("div", "rv-pill-row")
		if (value.suggestions.aa) row.appendChild(colorPill(`AA ${value.suggestions.aa}`, value.suggestions.aa, onStatus))
		if (value.suggestions.aaa) row.appendChild(colorPill(`AAA ${value.suggestions.aaa}`, value.suggestions.aaa, onStatus))
		tips.appendChild(row)
		wrap.appendChild(tips)
	}
	return wrap
}

function cssBlock(title, css, onStatus) {
	const section = node("div")
	const head = node("div", "rv-section-header")
	head.append(node("div", "rv-section-title", title), copyPill("Copy CSS", css, onStatus))
	section.append(head, node("pre", "rv-code", css))
	return section
}

function renderPalette(value, onStatus) {
	if (!Array.isArray(value) || !value.length) return null
	const wrap = stack("rv-palette")
	const ramp = node("div", "rv-palette-ramp")
	for (const step of value) {
		const swatch = node("div", "rv-palette-swatch")
		swatch.style.backgroundColor = step.hex
		swatch.title = `${step.step}: ${step.hex} (click to copy)`
		const label = node("span", "rv-palette-label")
		label.append(node("span", "", String(step.step)), node("span", "", step.hex))
		swatch.appendChild(label)
		copyOnClick(swatch, step.hex, onStatus)
		ramp.appendChild(swatch)
	}
	const css = `:root {\n${value.map((s) => `  --color-${s.step}: ${s.hex};`).join("\n")}\n}`
	wrap.append(ramp, cssBlock("CSS variables", css, onStatus))
	return wrap
}

function renderUnitConvert(value, onStatus) {
	if (!value || value.px === undefined) return null
	const grid = node("div", "rv-units-grid")
	for (const unit of ["px", "rem", "em", "pt"]) {
		if (value[unit] === undefined) continue
		const cell = node("div", "rv-unit-cell")
		cell.title = `Copy ${value[unit]}${unit}`
		cell.append(node("div", "rv-unit-value", String(value[unit])), node("div", "rv-unit-label", unit))
		copyOnClick(cell, `${value[unit]}${unit}`, onStatus)
		grid.appendChild(cell)
	}
	return grid
}

function renderTypeScale(value, onStatus) {
	if (!Array.isArray(value) || !value.length) return null
	const wrap = node("div", "rv-type-scale")
	for (const step of value) {
		const row = node("div", "rv-type-row")
		const meta = node("div", "rv-type-meta")
		meta.append(pill(`Step ${step.step}`, "rv-pill-active"), pill(`${step.px}px`), pill(`${step.rem}rem`), pill(`lh ${step.lineHeight}`))
		meta.appendChild(copyMini(`font-size: ${step.rem}rem;\nline-height: ${step.lineHeight};`, onStatus))
		const specimen = node("div", "rv-type-specimen", "The quick brown fox jumps over the lazy dog")
		specimen.style.fontSize = `${Math.max(11, Math.min(Number(step.px) || 16, 36))}px`
		specimen.style.lineHeight = String(step.lineHeight)
		row.append(meta, specimen)
		wrap.appendChild(row)
	}
	return wrap
}

function renderShadowGradient(value, onStatus) {
	if (!value?.boxShadow && !value?.gradient) return null
	const wrap = stack("rv-shadow")
	if (value.boxShadow) {
		const section = box("Box shadow")
		const demo = node("div", "rv-shadow-demo")
		demo.style.boxShadow = value.boxShadow
		const css = `box-shadow: ${value.boxShadow};`
		section.append(demo, node("code", "rv-shadow-code", css), copyPill("Copy CSS", css, onStatus))
		wrap.appendChild(section)
	}
	if (value.gradient) {
		const section = box("Gradient")
		const demo = node("div", "rv-gradient-demo")
		demo.style.background = value.gradient
		const css = `background: ${value.gradient};`
		section.append(demo, node("code", "rv-shadow-code", css), copyPill("Copy CSS", css, onStatus))
		wrap.appendChild(section)
	}
	return wrap
}

function renderTimestamp(value, onStatus) {
	if (!value?.iso) return null
	const grid = node("div", "rv-stats-grid")
	const rows = [
		["ISO 8601", value.iso],
		["Epoch seconds", value.epochSeconds],
		["Epoch ms", value.epochMillis],
		["UTC", value.utc],
		["Local", value.local],
		["Relative", value.relative],
	]
	for (const [label, val] of rows) {
		if (val === undefined) continue
		const card = node("div", "rv-ts-card")
		card.title = `Copy ${label}`
		card.append(node("div", "rv-ts-label", label), node("div", "rv-ts-value", String(val)))
		copyOnClick(card, String(val), onStatus)
		grid.appendChild(card)
	}
	return grid
}

function renderTimezone(value, onStatus) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null
	const table = node("div", "rv-tz-table")
	for (const [zone, time] of Object.entries(value)) {
		const row = node("div", "rv-tz-row")
		row.append(node("span", "rv-tz-zone", zone), node("span", "rv-tz-time", String(time)), copyMini(String(time), onStatus))
		table.appendChild(row)
	}
	return table
}

const VERDICT_TONES = { good: "good", "needs improvement": "warn", poor: "bad" }

function renderPerfBudget(value) {
	if (!value || typeof value !== "object") return null
	const grid = node("div", "rv-perf-grid")
	for (const [name, data] of Object.entries(value)) {
		if (!data || typeof data !== "object") continue
		const verdict = String(data.verdict ?? "unknown")
		const tone = VERDICT_TONES[verdict] ?? "info"
		const card = node("div", `rv-metric-card rv-metric-${tone === "bad" ? "poor" : tone}`)
		card.append(node("div", "rv-metric-name", name), node("div", "rv-metric-value", String(data.value)), badge(verdict.charAt(0).toUpperCase() + verdict.slice(1), tone))
		grid.appendChild(card)
	}
	return grid.childElementCount ? grid : null
}

function renderRegex(value, onStatus) {
	if (!value || typeof value.count !== "number") return null
	const wrap = stack("rv-regex")
	wrap.appendChild(badge(`${value.count} match${value.count === 1 ? "" : "es"}`, value.count > 0 ? "good" : "warn"))
	const matches = value.matches ?? []
	if (matches.length) {
		const list = node("div", "rv-regex-matches")
		for (const match of matches.slice(0, 100)) {
			const row = node("div", "rv-regex-match")
			row.title = "Click to copy the match"
			row.append(node("code", "rv-regex-match-text", match.match), node("span", "rv-regex-match-idx", `@${match.index}`))
			if (match.groups?.length) {
				const groups = node("span", "rv-regex-groups")
				match.groups.forEach((group, index) => groups.appendChild(pill(`$${index + 1} ${group ?? "∅"}`, "rv-pill-dim")))
				row.appendChild(groups)
			}
			copyOnClick(row, match.match, onStatus)
			list.appendChild(row)
		}
		wrap.appendChild(list)
		if (matches.length > 100) wrap.appendChild(node("p", "rv-query-note", `Showing 100 of ${matches.length} matches. Raw view has them all.`))
	}
	return wrap
}

function renderWordCount(value) {
	if (!value || value.words === undefined) return null
	const grid = node("div", "rv-stats-grid")
	const rows = [
		["Characters", value.characters],
		["Without spaces", value.charactersNoSpaces],
		["Words", value.words],
		["Lines", value.lines],
		["Sentences", value.sentences],
		["Reading time", `${value.readingTimeMinutes} min`],
	]
	for (const [label, val] of rows) if (val !== undefined) grid.appendChild(statCard(label, val))
	return grid
}

function renderQueryString(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-query")
	if (value.protocol || value.host || value.pathname) {
		const parts = box("URL parts")
		for (const [label, key] of [["Protocol", "protocol"], ["Host", "host"], ["Path", "pathname"], ["Hash", "hash"]]) {
			if (value[key]) parts.appendChild(kvRow(label, value[key], onStatus))
		}
		wrap.appendChild(parts)
	}
	if (value.note) wrap.appendChild(node("p", "rv-query-note", value.note))
	const params = value.params && typeof value.params === "object" ? Object.entries(value.params) : []
	const section = box(`Query parameters (${params.length})`)
	if (!params.length) section.appendChild(node("p", "rv-query-note", "No query parameters."))
	for (const [key, val] of params) section.appendChild(kvRow(key, Array.isArray(val) ? val.join(", ") : String(val), onStatus))
	wrap.appendChild(section)
	return wrap
}

const CLAIM_LABELS = {
	sub: "subject",
	iss: "issuer",
	aud: "audience",
	exp: "expires",
	nbf: "not before",
	iat: "issued at",
	jti: "token id",
}

function jwtSegments(parts, onStatus) {
	const section = box("Token segments (click to copy)")
	const line = node("div", "rv-jwt-segments")
	const segment = (text, cls, copyValue) => {
		const span = node("span", cls, text)
		if (copyValue) {
			span.title = "Copy this segment"
			copyOnClick(span, copyValue, onStatus)
		}
		return span
	}
	line.append(
		segment(parts.header, "seg-header", parts.header),
		segment(".", "seg-dot"),
		segment(parts.payload, "seg-payload", parts.payload),
		segment(".", "seg-dot"),
		segment(parts.signature || "(no signature)", "seg-signature", parts.signature),
	)
	section.appendChild(line)
	return section
}

function jwtClaims(title, data, onStatus, labels = {}) {
	const section = box()
	const head = node("div", "rv-section-header")
	head.append(node("div", "rv-section-title", title), copyPill("Copy JSON", JSON.stringify(data ?? {}, null, 2), onStatus))
	section.appendChild(head)
	const fields = node("div", "rv-jwt-fields")
	for (const [key, val] of Object.entries(data ?? {})) {
		const label = labels[key] ? `${key} · ${labels[key]}` : key
		fields.appendChild(kvRow(label, typeof val === "object" ? JSON.stringify(val) : String(val), onStatus))
	}
	section.appendChild(fields)
	return section
}

function renderJwt(value, onStatus) {
	if (!value?.payload && !value?.header) return null
	const wrap = stack("rv-jwt")
	if (value.rawParts) wrap.appendChild(jwtSegments(value.rawParts, onStatus))
	const rel = value.relativeExpiry ? ` (${value.relativeExpiry})` : ""
	if (typeof value.expired === "boolean") {
		wrap.appendChild(
			value.expired
				? banner("bad", "error", `Expired${value.expiresAt ? ` at ${value.expiresAt}` : ""}${rel}`)
				: banner("good", "check-circle", `Valid${value.expiresAt ? ` until ${value.expiresAt}` : ""}${rel}`),
		)
	} else if (value.expiresAt === null) {
		wrap.appendChild(banner("warn", "info", "No exp claim, this token never expires"))
	}
	if (Array.isArray(value.warnings) && value.warnings.length) {
		const warn = node("div", "rv-warn-box")
		warn.appendChild(node("div", "rv-warn-title", `Warnings (${value.warnings.length})`))
		for (const text of value.warnings) warn.appendChild(node("div", "rv-warn-item", text))
		wrap.appendChild(warn)
	}
	wrap.appendChild(jwtClaims("Header", value.header, onStatus))
	wrap.appendChild(jwtClaims("Payload claims", value.payload, onStatus, CLAIM_LABELS))
	wrap.appendChild(badge(value.signaturePresent ? "Signature present (not verified)" : "No signature", value.signaturePresent ? "info" : "warn"))
	return wrap
}

function renderJsonFormat(value, onStatus) {
	if (typeof value !== "string") return null
	const wrap = node("div", "rv-json")
	const bar = node("div", "rv-row spread")
	const bytes = new TextEncoder().encode(value).length
	bar.append(node("span", "rv-stat-label", `${value.split("\n").length} lines · ${formatBytes(bytes)}`), copyPill("Copy JSON", value, onStatus))
	const pre = node("pre", "rv-json-highlighted")
	pre.appendChild(highlightJson(value))
	pre.style.maxHeight = "360px"
	wrap.append(bar, pre)
	return wrap
}

function systemPickerButton(initial, onPick) {
	const input = document.createElement("input")
	input.type = "color"
	input.value = /^#[0-9a-f]{6}$/i.test(initial ?? "") ? initial : "#ff5a1f"
	input.className = "visually-hidden"
	input.tabIndex = -1
	input.addEventListener("input", () => onPick(input.value))
	const btn = iconButton("System picker", "palette")
	btn.addEventListener("click", () => input.click())
	const holder = node("span")
	holder.append(input, btn)
	return holder
}

function toRgbString(hex) {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? "")
	if (!match) return hex
	return `rgb(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)})`
}

function renderEyedropper(value, onStatus) {
	const wrap = stack("rv-eyedropper")
	const repaint = (picked) => {
		copyText(picked)
		onStatus?.(`Picked and copied ${picked}`)
		wrap.replaceWith(renderEyedropper({ hex: picked, rgb: toRgbString(picked) }, onStatus))
	}
	const text = typeof value === "string" ? value : ""
	const active = /active|click any element/i.test(text) || value?.status === "active"
	if (active) {
		wrap.appendChild(emptyState("pipette", "Eyedropper active on the page", "Hover the page to preview, click to sample and copy the hex value.", [systemPickerButton(null, repaint)]))
		return wrap
	}
	if (/cancel/i.test(text) || value?.cancelled) {
		wrap.appendChild(emptyState("pipette", "Sampling cancelled", "Escape was pressed or the picker closed.", [rerunButton("Pick on page", "pipette"), systemPickerButton(null, repaint)]))
		return wrap
	}
	const hex = typeof value === "object" ? value?.hex : text.startsWith("#") ? text : null
	if (!hex) return null
	const rgb = (typeof value === "object" && value?.rgb) || toRgbString(hex)
	const card = node("div", "rv-color-convert")
	const swatch = node("div", "rv-color-swatch-large")
	swatch.style.backgroundColor = hex
	const info = node("div", "rv-color-formats")
	const title = node("div", "rv-row")
	const hexLabel = node("strong", "mono", hex)
	hexLabel.style.fontSize = "17px"
	title.append(hexLabel, badge("Copied", "good"))
	info.append(title, node("span", "mono muted", rgb))
	const actions = node("div", "rv-row")
	actions.append(copyPill("HEX", hex, onStatus), copyPill("RGB", rgb, onStatus))
	info.appendChild(actions)
	card.append(swatch, info)
	const again = node("div", "rv-row")
	again.append(rerunButton("Pick again", "pipette"), systemPickerButton(hex, repaint))
	wrap.append(card, again)
	return wrap
}

const DEVICE_PRESETS = [
	{ label: "iPhone SE", icon: "phone", w: 375, h: 667, mq: "@media (max-width: 375px)" },
	{ label: "iPhone 14", icon: "phone", w: 390, h: 844, mq: "@media (max-width: 390px)" },
	{ label: "iPad Mini", icon: "tablet", w: 768, h: 1024, mq: "@media (max-width: 768px)" },
	{ label: "Laptop 13", icon: "laptop", w: 1280, h: 800, mq: "@media (max-width: 1280px)" },
	{ label: "Desktop HD", icon: "monitor", w: 1440, h: 900, mq: "@media (min-width: 1440px)" },
	{ label: "Full HD", icon: "monitor", w: 1920, h: 1080, mq: "@media (min-width: 1920px)" },
]

function presetIsCurrent(preset, width) {
	if (preset.w === 375) return width <= 375
	if (preset.w === 390) return width > 375 && width <= 430
	if (preset.w === 768) return width > 430 && width <= 820
	if (preset.w === 1280) return width > 820 && width <= 1366
	if (preset.w === 1440) return width > 1366 && width <= 1600
	return width > 1600
}

function flashLabel(btn, label, restore, ms = 1600) {
	setLabel(btn, label)
	setTimeout(() => {
		setLabel(btn, restore)
		btn.disabled = false
	}, ms)
}

function renderViewportResize(value, onStatus) {
	if (!value || typeof value !== "object") return null
	if (value.enabled === false) {
		const reactivate = iconButton("Show viewport HUD", "devices", "primary")
		reactivate.addEventListener("click", async () => {
			const res = await sendToPage({ type: "viewport", payload: { enable: true } }).catch(() => null)
			onStatus?.(res?.ok ? "Viewport HUD shown" : res?.error ?? "Could not reach the page")
		})
		return emptyState("devices", "Viewport HUD is off", "The size overlay was removed from the page.", [reactivate])
	}

	const width = Number(value.width) || window.innerWidth || 1024
	const height = Number(value.height) || window.innerHeight || 768
	const dpr = Number(value.dpr ?? window.devicePixelRatio ?? 1).toFixed(2).replace(/\.?0+$/, "")
	const wrap = stack("rv-viewport-resize")
	let activeSim = null
	const entries = []

	const head = node("div", "rv-banner")
	head.style.setProperty("--tone", "var(--good)")
	const statusText = node("span", "grow", "Viewport HUD active on the page")
	const closeFrame = iconButton("Close frame", "close", "rv-copy-mini")
	closeFrame.hidden = true
	closeFrame.addEventListener("click", async () => {
		await sendToPage({ type: "device-frame", payload: { close: true } }).catch(() => null)
		activeSim = null
		sync()
		onStatus?.("Closed the device frame")
	})
	const hideHud = iconButton("Hide HUD", "close", "rv-copy-mini")
	hideHud.addEventListener("click", async () => {
		const res = await sendToPage({ type: "viewport", payload: { enable: false } }).catch(() => null)
		onStatus?.(res?.ok ? "Viewport HUD hidden" : res?.error ?? "Could not reach the page")
	})
	head.append(icon("devices"), statusText, closeFrame, hideHud)
	wrap.appendChild(head)

	function sync() {
		const simulating = Boolean(activeSim?.active)
		statusText.textContent = simulating ? `Simulating ${activeSim.label || "device"} (${activeSim.width} × ${activeSim.height})` : "Viewport HUD active on the page"
		closeFrame.hidden = !simulating
		for (const entry of entries) {
			const match = simulating && activeSim.width === entry.preset.w && activeSim.height === entry.preset.h
			entry.card.classList.toggle("is-simulating", match)
			entry.simBadge.hidden = !match
			entry.frameBtn.classList.toggle("is-success", match)
			setLabel(entry.frameBtn, match ? "In frame" : "Frame")
			entry.frameBtn.title = match ? `Close the ${entry.preset.label} frame` : `Simulate ${entry.preset.label} inside the page`
		}
	}

	sendToPage({ type: "device-frame-query" }, { inject: false })
		.then((res) => {
			if (res?.ok && res.data?.active) {
				activeSim = res.data
				sync()
			}
		})
		.catch(() => {})
	// popup.js forwards live device frame updates from the content script through this hook.
	window.__onDeviceFrameUpdate = (payload) => {
		activeSim = payload?.active ? payload : null
		sync()
	}

	const stats = node("div", "rv-stat-grid")
	stats.append(
		statCard("Width", `${width}px`),
		statCard("Height", `${height}px`),
		statCard("Breakpoint", getBreakpointBucket(width)),
		statCard("Pixel ratio", `${dpr}x`),
		statCard("Aspect", calculateAspectRatio(width, height)),
		statCard("Orientation", width >= height ? "Landscape" : "Portrait"),
	)
	wrap.appendChild(stats)

	const mq = box("Media queries for this size")
	const mqList = node("div", "rv-mq-list")
	for (const kind of ["max-width", "min-width"]) {
		const item = node("div", "rv-mq-item")
		const header = node("div", "rv-mq-header")
		header.append(node("span", "rv-mq-badge", kind), copyMini(`@media (${kind}: ${width}px) {\n\t\n}`, onStatus))
		item.append(header, node("code", "rv-mq-code", `@media (${kind}: ${width}px)`))
		mqList.appendChild(item)
	}
	mq.appendChild(mqList)
	wrap.appendChild(mq)

	const ref = box("Device presets")
	const list = node("div", "rv-preset-list")
	for (const preset of DEVICE_PRESETS) {
		const size = `${preset.w} × ${preset.h}`
		const current = presetIsCurrent(preset, width)
		const card = node("div", `rv-preset-card${current ? " is-active" : ""}`)
		const top = node("div", "rv-preset-top")
		const title = node("div", "rv-preset-title")
		title.append(icon(preset.icon), node("span", "", preset.label))
		const right = node("div", "rv-row")
		const simBadge = node("span", "rv-sim-badge", "In frame")
		simBadge.hidden = true
		right.append(simBadge, pill(size, `rv-preset-dim ${current ? "rv-pill-active" : "rv-pill-dim"}`))
		top.append(title, right)

		const bottom = node("div", "rv-preset-bot")
		const actions = node("div", "rv-preset-actions")
		const frameBtn = iconButton("Frame", "phone", "rv-btn-resize")
		frameBtn.addEventListener("click", async () => {
			frameBtn.disabled = true
			const match = activeSim?.active && activeSim.width === preset.w && activeSim.height === preset.h
			const payload = match ? { close: true } : { width: preset.w, height: preset.h, label: preset.label }
			const res = await sendToPage({ type: "device-frame", payload }).catch((error) => ({ ok: false, error: error.message }))
			frameBtn.disabled = false
			if (!res?.ok) {
				onStatus?.(`Could not open the frame: ${res?.error ?? "unsupported page"}`)
				return
			}
			activeSim = match ? null : { active: true, width: preset.w, height: preset.h, label: preset.label }
			sync()
			onStatus?.(match ? `Closed the ${preset.label} frame` : `Simulating ${preset.label} (${size})`)
		})
		const resizeBtn = iconButton("Window", "resize")
		resizeBtn.title = `Resize the browser window to ${size}`
		resizeBtn.addEventListener("click", async () => {
			resizeBtn.disabled = true
			await sendToPage({ type: "device-frame", payload: { close: true } }, { inject: false }).catch(() => null)
			activeSim = null
			sync()
			const result = await resizeCurrentWindow(preset.w, preset.h).catch((error) => ({ ok: false, error: error.message }))
			onStatus?.(result.ok ? `Resized the window to ${size}` : `Could not resize: ${result.error}`)
			flashLabel(resizeBtn, result.ok ? "Resized" : "Failed", "Window")
		})
		actions.append(frameBtn, resizeBtn, copyMini(`${preset.mq} {\n\t\n}`, onStatus))
		bottom.append(node("code", "rv-preset-mq", preset.mq), actions)
		card.append(top, bottom)
		entries.push({ preset, card, simBadge, frameBtn })
		list.appendChild(card)
	}
	ref.appendChild(list)
	wrap.appendChild(ref)
	sync()
	return wrap
}

const EDIT_GUIDE = [
	["cursor", "Click to select", "Click any element; a frame with corner handles appears."],
	["arrow-up", "Parent", "Use Parent in the floating toolbar to grab the outer container."],
	["move", "Drag", "Hold the block or the Drag handle to move it anywhere."],
	["edit", "Edit text", "Double click text, or press Edit, to change copy inline."],
	["duplicate", "Duplicate", "Clone a block and drag the copy to try a new layout."],
	["keyboard", "Nudge", "Arrow keys move 1px, with Shift 10px. Escape deselects."],
	["undo", "Reset", "Reset in the toolbar returns an element to where it started."],
]

function renderEditMode(value) {
	if (!value || typeof value !== "object") return null
	if (value.enabled === false) {
		return emptyState("edit", "Design edit mode is off", "The page is back to normal.", [rerunButton("Turn it on", "edit")])
	}
	const wrap = stack("rv-edit-mode")
	const head = banner("good", "edit", "Edit mode active on the page")
	const exit = iconButton("Exit", "close", "rv-copy-mini")
	exit.addEventListener("click", () => document.getElementById("run")?.click())
	head.appendChild(exit)
	const guide = box("How to use it")
	for (const [iconName, title, detail] of EDIT_GUIDE) {
		const row = node("div", "rv-guide-row")
		const text = node("div")
		text.append(node("strong", "", title), node("span", "", detail))
		row.append(icon(iconName), text)
		guide.appendChild(row)
	}
	wrap.append(head, guide)
	return wrap
}

function renderSnippingTool(value, onStatus) {
	if (value?.cancelled) {
		return emptyState("scissors", "Screenshot cancelled", "Region selection was cancelled.", [rerunButton("Capture again", "camera")])
	}
	if (!value?.dataUrl) return null
	const wrap = stack("rv-snipping-tool")
	const stats = node("div", "rv-stat-grid")
	stats.append(statCard("Mode", value.mode || "Screenshot"), statCard("Size", `${value.width || 0} × ${value.height || 0}`), statCard("Format", "PNG"))
	const preview = box("Preview, click to open full size")
	preview.style.textAlign = "center"
	preview.appendChild(previewImage(value.dataUrl, `${value.mode || "Page"} screenshot`, onStatus))
	const actions = node("div", "rv-row")
	const save = iconButton("Save PNG", "download", "primary")
	save.addEventListener("click", () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
		downloadFile({ filename: `sidekick-screenshot-${stamp}.png`, dataUrl: value.dataUrl })
		onStatus?.("Screenshot saved")
	})
	actions.append(save, copyImageButton(value.dataUrl, onStatus), rerunButton("Capture again", "camera"))
	actions.lastChild.className = "rv-copy-pill"
	wrap.append(stats, preview, actions)
	return wrap
}

function renderImageConverter(value, onStatus) {
	if (!value || typeof value !== "object" || !value.dataUrl) return null
	const wrap = stack("rv-image-converter")
	if (value.notice || value.autoSwitched) {
		wrap.appendChild(banner("warn", "info", value.notice || `Format switched to ${value.format} to reach the target size while keeping transparency.`))
	}
	if (value.tip) wrap.appendChild(banner("info", "info", value.tip))

	const saved = value.originalSize > value.outputSize ? value.originalSize - value.outputSize : 0
	const ratio = value.originalSize > 0 ? Math.round((value.outputSize / value.originalSize) * 100) : 0
	const stats = node("div", "rv-stat-grid")
	stats.append(
		statCard("Input", `${value.originalWidth}×${value.originalHeight}`),
		statCard("Output", `${value.outputWidth}×${value.outputHeight}`),
		statCard("Format", value.format),
		statCard("Input size", formatBytes(value.originalSize)),
		statCard("Output size", formatBytes(value.outputSize), saved ? "good" : ratio > 100 ? "warn" : undefined),
	)
	if (value.quality !== null && value.quality !== undefined) stats.appendChild(statCard("Quality", `${Math.round(value.quality * 100)}%`))
	if (value.targetSizeKb) stats.appendChild(statCard("Target", `≤ ${value.targetSizeKb} KB`))
	stats.appendChild(saved ? statCard("Saved", `${formatBytes(saved)} (${100 - ratio}%)`, "good") : statCard("Size ratio", `${ratio}%`))
	wrap.appendChild(stats)

	const isPdf = value.formatKey === "pdf"
	if (isPdf) {
		wrap.appendChild(emptyState("file", "PDF ready", `The image is embedded in a ${value.outputWidth}×${value.outputHeight} page. Use Save to download it.`))
	} else {
		const preview = box("Output preview, click to open full size")
		preview.style.textAlign = "center"
		preview.appendChild(previewImage(value.dataUrl, `Converted ${value.format} image`, onStatus))
		wrap.appendChild(preview)
	}

	const actions = node("div", "rv-row")
	const save = iconButton(`Save ${value.format}`, "download", "primary")
	save.addEventListener("click", () => {
		downloadFile(value.blob ? { filename: value.fileName, blob: value.blob } : { filename: value.fileName, dataUrl: value.dataUrl })
		onStatus?.(`Saved ${value.fileName}`)
	})
	actions.appendChild(save)
	if (!isPdf) actions.appendChild(copyImageButton(value.blob ?? value.dataUrl, onStatus))
	wrap.appendChild(actions)
	return wrap
}

function normalizeStore(raw) {
	if (!raw) return { items: [], totalBytes: 0 }
	if (Array.isArray(raw.items)) return { items: raw.items, totalBytes: raw.totalBytes ?? 0 }
	if (Array.isArray(raw)) {
		const items = raw.map((item) => {
			if (typeof item !== "string") return item
			const eq = item.indexOf("=")
			return { key: eq === -1 ? item : item.slice(0, eq).trim(), value: eq === -1 ? "" : item.slice(eq + 1).trim(), bytes: item.length }
		})
		return { items, totalBytes: items.reduce((sum, item) => sum + (item.bytes || 0), 0) }
	}
	if (typeof raw === "object") {
		const map = raw.map || raw
		const items = Object.entries(map)
			.filter(([key]) => key !== "__error" && key !== "totalBytes")
			.map(([key, val]) => ({ key, value: String(val), bytes: (key.length + String(val).length) * 2 }))
		return { items, totalBytes: raw.totalBytes || items.reduce((sum, item) => sum + item.bytes, 0) }
	}
	return { items: [], totalBytes: 0 }
}

const STORE_NAMES = { localStorage: "Local", sessionStorage: "Session", cookies: "Cookies" }

function renderStorageInspector(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const stores = {
		localStorage: normalizeStore(value.localStorage),
		sessionStorage: normalizeStore(value.sessionStorage),
		cookies: normalizeStore(value.cookies),
	}
	let active = "localStorage"
	let query = ""
	const wrap = node("div", "rv-storage-wrap")
	const stats = node("div", "rv-stat-grid")
	const tabs = node("div", "rv-storage-tabs")
	const tabButtons = {}
	const statCards = {}
	const refreshCounts = () => {
		for (const key of Object.keys(stores)) {
			tabButtons[key].textContent = `${STORE_NAMES[key]} (${stores[key].items.length})`
			statCards[key].querySelector(".rv-stat-value").textContent = `${stores[key].items.length} · ${formatStorageSize(stores[key].totalBytes)}`
		}
	}
	for (const key of Object.keys(stores)) {
		statCards[key] = statCard(STORE_NAMES[key], "")
		stats.appendChild(statCards[key])
		const btn = node("button", `rv-storage-tab${key === active ? " active" : ""}`)
		btn.type = "button"
		btn.addEventListener("click", () => {
			active = key
			for (const [name, other] of Object.entries(tabButtons)) other.classList.toggle("active", name === active)
			renderList()
		})
		tabButtons[key] = btn
		tabs.appendChild(btn)
	}
	refreshCounts()

	const toolbar = node("div", "rv-storage-toolbar")
	const search = node("input", "rv-storage-search")
	search.type = "search"
	search.placeholder = "Filter keys and values"
	search.setAttribute("aria-label", "Filter storage entries")
	search.addEventListener("input", () => {
		query = search.value.toLowerCase().trim()
		renderList()
	})
	const subbar = node("div", "rv-storage-subbar")
	const count = node("span", "rv-storage-count")
	const subActions = node("div", "rv-storage-subbar-actions")
	const exportBtn = iconButton("Export JSON", "download")
	exportBtn.addEventListener("click", () => {
		const dump = {
			localStorage: Object.fromEntries(stores.localStorage.items.map((item) => [item.key, item.value])),
			sessionStorage: Object.fromEntries(stores.sessionStorage.items.map((item) => [item.key, item.value])),
			cookies: stores.cookies.items.map((item) => `${item.key}=${item.value}`),
			exportedAt: new Date().toISOString(),
		}
		downloadFile({ filename: `sidekick-storage-${Date.now()}.json`, mime: "application/json", text: JSON.stringify(dump, null, 2) })
		onStatus?.("Storage exported")
	})
	const clearBtn = iconButton("Clear store", "trash", "rv-storage-del-btn")
	clearBtn.addEventListener("click", async () => {
		if (active === "cookies") return onStatus?.("Clear cookies from the browser's site settings")
		const res = await sendToPage({ type: "storage-clear", payload: { store: active } }).catch((error) => ({ ok: false, error: error.message }))
		if (!res?.ok) return onStatus?.(`Could not clear: ${res?.error ?? "no response"}`)
		stores[active] = { items: [], totalBytes: 0 }
		refreshCounts()
		renderList()
		onStatus?.(`Cleared ${active}`)
	})
	subActions.append(exportBtn, clearBtn)
	subbar.append(count, subActions)
	toolbar.append(search, subbar)
	const list = node("div", "rv-storage-list")
	wrap.append(stats, tabs, toolbar, list)

	async function removeKey(item) {
		const res = await sendToPage({ type: "storage-remove-key", payload: { store: active, key: item.key } }).catch((error) => ({ ok: false, error: error.message }))
		if (!res?.ok) return onStatus?.(`Could not delete: ${res?.error ?? "no response"}`)
		const store = stores[active]
		store.items = store.items.filter((entry) => entry.key !== item.key)
		store.totalBytes = Math.max(0, store.totalBytes - (item.bytes || 0))
		refreshCounts()
		renderList()
		onStatus?.(`Deleted ${shorten(item.key)}`)
	}

	function itemRow(item) {
		const row = node("div", "rv-storage-item")
		const header = node("div", "rv-storage-item-header")
		const key = node("span", "rv-storage-key", item.key)
		key.title = item.key
		const badges = node("div", "rv-storage-badges")
		badges.appendChild(pill(formatStorageSize(item.bytes || 0), "rv-pill-dim"))
		if (/^\s*[[{]/.test(String(item.value))) badges.appendChild(pill("JSON", "rv-pill-active"))
		header.append(key, badges)
		const val = node("div", "rv-storage-val", item.value)
		val.title = "Click to expand"
		val.addEventListener("click", () => val.classList.toggle("expanded"))
		const footer = node("div", "rv-storage-item-footer")
		const actions = node("div", "rv-storage-actions")
		actions.append(copyPill("Key", item.key, onStatus), copyPill("Value", String(item.value), onStatus))
		if (active !== "cookies") {
			const del = iconButton("Delete", "trash", "rv-storage-del-btn")
			del.addEventListener("click", () => removeKey(item))
			actions.appendChild(del)
		}
		footer.append(node("span", "rv-storage-hint", ""), actions)
		row.append(header, val, footer)
		return row
	}

	function renderList() {
		const store = stores[active]
		const filtered = query ? store.items.filter((item) => item.key.toLowerCase().includes(query) || String(item.value).toLowerCase().includes(query)) : store.items
		count.textContent = `${filtered.length} of ${store.items.length}`
		if (!filtered.length) {
			list.replaceChildren(emptyState("database", store.items.length ? "No entries match" : `${STORE_NAMES[active]} storage is empty`, ""))
			return
		}
		const frag = document.createDocumentFragment()
		for (const item of filtered.slice(0, 300)) frag.appendChild(itemRow(item))
		list.replaceChildren(frag)
	}

	renderList()
	return wrap
}

function warnList(title, items) {
	const warn = node("div", "rv-warn-box")
	warn.appendChild(node("div", "rv-warn-title", title))
	for (const text of items) warn.appendChild(node("div", "rv-warn-item", text))
	return warn
}

function renderSeoAudit(value) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-seo-audit")
	const stats = node("div", "rv-stat-grid")
	const titleLength = value.titleLength ?? (value.title ?? "").length
	const descLength = (value.description || "").length
	stats.append(
		statCard("Title", `${titleLength} chars`, titleLength >= 30 && titleLength <= 60 ? "good" : "warn"),
		statCard("Description", `${descLength} chars`, descLength >= 70 && descLength <= 160 ? "good" : "warn"),
		statCard("Images with alt", value.images ? `${value.images.total - value.images.missingAlt}/${value.images.total}` : "0/0"),
		statCard("Structured data", `${value.structuredData ?? 0}`),
		statCard("Indexing", value.isNoIndex ? "noindex" : "Indexable", value.isNoIndex ? "bad" : "good"),
	)
	wrap.appendChild(stats)

	const serp = box("Search result preview")
	const card = node("div", "rv-google-card")
	card.append(
		node("div", "rv-google-url", value.canonical || value.url || "No canonical URL"),
		node("div", "rv-google-title", value.title || "Untitled page"),
		node("div", "rv-google-desc", value.description || "No meta description."),
	)
	serp.appendChild(card)
	wrap.appendChild(serp)

	const og = value.openGraph || {}
	const tw = value.twitter || {}
	if (og.title || og.image || og.description || tw.image || tw.title) {
		const social = box("Social share preview")
		const socialCard = node("div", "rv-og-card")
		const image = og.image || tw.image
		if (image && /^https?:|^data:image\//.test(image)) {
			const img = node("img", "rv-og-img")
			img.src = image
			img.alt = ""
			img.referrerPolicy = "no-referrer"
			socialCard.appendChild(img)
		}
		const meta = node("div", "rv-og-meta")
		meta.append(node("div", "rv-og-title", og.title || tw.title || value.title || "No title"), node("div", "rv-og-desc", og.description || tw.description || value.description || "No description"))
		socialCard.appendChild(meta)
		social.appendChild(socialCard)
		wrap.appendChild(social)
	}

	if (value.headings) {
		const headings = box("Headings")
		const row = node("div", "rv-pill-row")
		for (const [tag, count] of Object.entries(value.headings.counts || {})) row.appendChild(pill(`${tag.toUpperCase()} ${count}`, count > 0 ? "rv-pill-active" : "rv-pill-dim"))
		headings.appendChild(row)
		for (const h1 of value.headings.h1 ?? []) headings.appendChild(node("div", "rv-h1-item", `H1 “${h1}”`))
		wrap.appendChild(headings)
	}

	if (Array.isArray(value.warnings) && value.warnings.length) wrap.appendChild(warnList(`Recommendations (${value.warnings.length})`, value.warnings))
	else wrap.appendChild(banner("good", "check-circle", "Title, description and canonical all look healthy"))
	return wrap
}

const SEVERITIES = ["critical", "serious", "moderate", "minor"]
const SEVERITY_TONES = { critical: "bad", serious: "bad", moderate: "warn", minor: "info" }

function highlightButton(selector, onInspect, onStatus) {
	const btn = iconButton("Highlight", "target", "rv-inspect-btn")
	btn.addEventListener("click", () => {
		onInspect(selector)
		onStatus?.(`Highlighting ${shorten(selector, 30)}`)
	})
	return btn
}

function renderA11yAudit(value, onStatus, onInspect) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-a11y-audit")
	const summary = value.summary || {}
	const issues = Array.isArray(value.issues) ? value.issues : []
	const stats = node("div", "rv-stat-grid")
	stats.appendChild(statCard("Issues", value.total ?? issues.length, issues.length ? "warn" : "good"))
	for (const sev of SEVERITIES) stats.appendChild(statCard(sev[0].toUpperCase() + sev.slice(1), summary[sev] ?? 0, summary[sev] ? SEVERITY_TONES[sev] : undefined))
	wrap.appendChild(stats)
	if (!issues.length) {
		wrap.appendChild(banner("good", "check-circle", "No automated accessibility violations found. Manual checks still matter."))
		return wrap
	}
	const filters = node("div", "rv-pill-row")
	const list = node("div", "rv-issue-list")
	const renderItems = (filter) => {
		const filtered = filter === "all" ? issues : issues.filter((issue) => issue.severity === filter)
		const frag = document.createDocumentFragment()
		for (const issue of filtered.slice(0, 80)) {
			const sev = SEVERITIES.includes(issue.severity) ? issue.severity : "minor"
			const item = node("div", `rv-issue-item rv-sev-${sev}`)
			const top = node("div", "rv-issue-top")
			top.append(badge(sev, SEVERITY_TONES[sev]), node("span", "rv-issue-rule", issue.rule || "Accessibility"))
			item.append(top, node("div", "rv-issue-msg", issue.message || "Accessibility violation"))
			if (issue.selector) {
				const bottom = node("div", "rv-issue-bot")
				bottom.appendChild(node("code", "rv-issue-selector", issue.selector))
				if (onInspect) bottom.appendChild(highlightButton(issue.selector, onInspect, onStatus))
				item.appendChild(bottom)
			}
			frag.appendChild(item)
		}
		list.replaceChildren(frag)
	}
	for (const sev of ["all", ...SEVERITIES]) {
		const count = sev === "all" ? issues.length : summary[sev] || issues.filter((issue) => issue.severity === sev).length
		if (sev !== "all" && !count) continue
		const btn = node("button", `rv-pill ${sev === "all" ? "rv-pill-active" : "rv-pill-dim"}`, `${sev} ${count}`)
		btn.type = "button"
		btn.setAttribute("aria-pressed", String(sev === "all"))
		btn.addEventListener("click", () => {
			for (const other of filters.children) {
				other.classList.replace("rv-pill-active", "rv-pill-dim")
				other.setAttribute("aria-pressed", "false")
			}
			btn.classList.replace("rv-pill-dim", "rv-pill-active")
			btn.setAttribute("aria-pressed", "true")
			renderItems(sev)
		})
		filters.appendChild(btn)
	}
	renderItems("all")
	wrap.append(filters, list)
	return wrap
}

const RATING_TONES = { good: "good", "needs-improvement": "warn", poor: "bad" }

function msValue(value) {
	return value === null || value === undefined ? "n/a" : `${value}ms`
}

function renderPageMetrics(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-page-metrics")
	const vitals = box("Core Web Vitals")
	const grid = node("div", "rv-stat-grid")
	if (value.vitals) {
		for (const item of Object.values(value.vitals)) {
			const display = item.value === null || item.value === undefined ? "n/a" : `${item.value}${item.unit ?? ""}`
			grid.appendChild(statCard(`${item.label}${item.rating ? ` · ${item.rating}` : ""}`, display, RATING_TONES[item.rating]))
		}
	} else {
		grid.append(statCard("LCP", msValue(value.lcpMs)), statCard("CLS", value.cls ?? "n/a"), statCard("TTFB", msValue(value.ttfbMs)), statCard("Load", msValue(value.loadMs)))
	}
	vitals.appendChild(grid)
	wrap.appendChild(vitals)

	const totals = node("div", "rv-stat-grid")
	totals.append(statCard("Transfer", value.transferReadable || formatBytes(value.transferBytes || 0)), statCard("Resources", value.resourceCount ?? 0), statCard("DOM nodes", value.domNodes ?? 0))
	if (value.memory?.usedJsHeap) totals.appendChild(statCard("JS heap", `${value.memory.usedJsHeap} / ${value.memory.totalJsHeap}`))
	wrap.appendChild(totals)

	const nav = box("Milestones")
	const table = node("div", "rv-kv-table")
	table.append(kvRow("DOM content loaded", msValue(value.domContentLoadedMs), onStatus), kvRow("Load", msValue(value.loadMs), onStatus))
	if (value.longTasks) table.appendChild(kvRow("Long tasks", `${value.longTasks.count} (${value.longTasks.totalMs}ms)`, onStatus))
	nav.appendChild(table)
	wrap.appendChild(nav)

	if (value.resourcesByType && Object.keys(value.resourcesByType).length) {
		const types = box("Resources by type")
		const row = node("div", "rv-pill-row")
		for (const [type, count] of Object.entries(value.resourcesByType)) row.appendChild(pill(`${type} ${count}`, "rv-pill-active"))
		types.appendChild(row)
		wrap.appendChild(types)
	}
	const largest = value.largestResources || value.largest
	if (Array.isArray(largest) && largest.length) {
		const heavy = box("Heaviest resources")
		for (const res of largest) {
			const row = node("div", "rv-res-row")
			const name = node("span", "rv-res-name", res.name)
			name.title = res.fullUrl || res.name
			const right = node("div", "rv-row")
			right.append(node("span", "rv-res-size", res.size), node("span", "rv-res-type", res.type || ""))
			if (res.fullUrl) right.appendChild(copyMini(res.fullUrl, onStatus))
			row.append(name, right)
			heavy.appendChild(row)
		}
		wrap.appendChild(heavy)
	}
	return wrap
}

function renderLinkCheck(value, onStatus, onInspect) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-link-check")
	const brokenLinks = Array.isArray(value.brokenLinks) ? value.brokenLinks : []
	const brokenImages = Array.isArray(value.brokenImages) ? value.brokenImages : []
	const problems = Array.isArray(value.problems) ? value.problems : []
	const stats = node("div", "rv-stat-grid")
	stats.append(
		statCard("Links", value.links ?? 0),
		statCard("Images", value.images ?? 0),
		statCard("Broken links", brokenLinks.length, brokenLinks.length ? "bad" : "good"),
		statCard("Broken images", brokenImages.length, brokenImages.length ? "bad" : "good"),
	)
	wrap.appendChild(stats)
	if (brokenLinks.length) wrap.appendChild(warnList(`Broken links (${brokenLinks.length})`, brokenLinks.map((item) => `${item.status || "ERR"} ${item.url}`)))
	if (brokenImages.length) wrap.appendChild(warnList(`Broken images (${brokenImages.length})`, brokenImages.map((item) => shorten(typeof item === "string" ? item : item?.src, 90))))
	if (problems.length) {
		const section = box(`Link issues (${problems.length})`)
		const list = node("div", "rv-issue-list")
		for (const problem of problems.slice(0, 60)) {
			const item = node("div", "rv-issue-item rv-sev-moderate")
			item.appendChild(node("div", "rv-issue-msg", `${problem.issue}${problem.text ? ` (“${shorten(problem.text, 50)}”)` : ""}`))
			if (problem.selector) {
				const bottom = node("div", "rv-issue-bot")
				bottom.appendChild(node("code", "rv-issue-selector", problem.selector))
				if (onInspect) bottom.appendChild(highlightButton(problem.selector, onInspect, onStatus))
				item.appendChild(bottom)
			}
			list.appendChild(item)
		}
		section.appendChild(list)
		wrap.appendChild(section)
	}
	if (!brokenLinks.length && !brokenImages.length && !problems.length) wrap.appendChild(banner("good", "check-circle", "Every scanned link, anchor and image looks healthy"))
	return wrap
}

function techPill(name) {
	const el = pill("", "rv-pill-active rv-tech-pill")
	el.append(icon("cpu"), node("span", "", name))
	return el
}

function renderTechStack(value, onStatus) {
	if (!value || typeof value !== "object") return null
	const wrap = stack("rv-tech-stack")
	const detected = Array.isArray(value.detected) ? value.detected : []
	const count = value.count ?? detected.length
	const stats = node("div", "rv-stat-grid")
	const pwa = value.serviceWorker ? "Service worker" : detected.includes("PWA Manifest") ? "Manifest" : "None"
	stats.append(statCard("Technologies", count), statCard("Script domains", value.scriptDomains?.length ?? 0), statCard("PWA / offline", pwa))
	wrap.appendChild(stats)
	const bar = node("div", "rv-row spread")
	bar.append(node("span", "rv-stat-label", `${count} technologies identified`), copyPill("Copy list", detected.join(", "), onStatus))
	wrap.appendChild(bar)
	const categories = value.categories && typeof value.categories === "object" ? Object.entries(value.categories).filter(([, list]) => list?.length) : []
	if (categories.length) {
		for (const [category, list] of categories) {
			const section = box(category)
			const row = node("div", "rv-pill-row")
			for (const item of list) row.appendChild(techPill(item?.name ?? String(item)))
			section.appendChild(row)
			wrap.appendChild(section)
		}
	} else if (detected.length) {
		const section = box("Detected")
		const row = node("div", "rv-pill-row")
		for (const name of detected) row.appendChild(techPill(name))
		section.appendChild(row)
		wrap.appendChild(section)
	} else {
		wrap.appendChild(emptyState("cpu", "Nothing recognised", "No known frameworks or libraries were detected on this page."))
	}
	if (Array.isArray(value.scriptDomains) && value.scriptDomains.length) {
		const section = box(`Script domains (${value.scriptDomains.length})`)
		const row = node("div", "rv-pill-row")
		for (const domain of value.scriptDomains) row.appendChild(pill(domain, "rv-pill-dim"))
		section.appendChild(row)
		wrap.appendChild(section)
	}
	return wrap
}

function renderTextDiff(value, onStatus) {
	if (typeof value !== "string") return null
	const lines = value.split("\n")
	if (lines.length < 2) return null
	const summary = lines[0]
	const content = lines.slice(1).filter((line) => line.length > 0)
	let added = 0
	let removed = 0
	let same = 0
	for (const line of content) {
		if (line[0] === "+") added++
		else if (line[0] === "-") removed++
		else same++
	}
	const wrap = stack("rv-diff")
	const stats = node("div", "rv-stat-grid")
	stats.append(statCard("Added", `+${added}`, added ? "good" : undefined), statCard("Removed", `-${removed}`, removed ? "bad" : undefined), statCard("Unchanged", same))
	const bar = node("div", "rv-row spread")
	bar.append(node("span", "rv-diff-summary", summary), copyPill("Copy diff", value, onStatus))
	const body = node("div", "rv-diff-body")
	const frag = document.createDocumentFragment()
	for (const line of content.slice(0, 5000)) {
		const op = line[0]
		const row = node("div", `rv-diff-line ${op === "+" ? "rv-diff-add" : op === "-" ? "rv-diff-del" : "rv-diff-ctx"}`)
		row.append(node("span", "rv-diff-marker", op === "+" || op === "-" ? op : " "), node("span", "rv-diff-text", line.slice(2)))
		frag.appendChild(row)
	}
	body.appendChild(frag)
	wrap.append(stats, bar, body)
	return wrap
}

function renderColorReport(colors, onStatus) {
	if (!Array.isArray(colors) || !colors.length) return null
	const wrap = stack("rv-color-report")
	const bar = node("div", "rv-row spread")
	const css = `:root {\n${colors.map((color, index) => `  --color-${index + 1}: ${color.hex};`).join("\n")}\n}`
	bar.append(node("span", "rv-stat-label", `${colors.length} colors, ranked by use. Click a swatch to copy.`), copyPill("Copy CSS vars", css, onStatus))
	const grid = node("div", "swatch-grid")
	for (const item of colors) {
		const card = node("div", "swatch-card")
		card.title = `Copy ${item.hex}`
		const preview = node("div", "swatch-preview")
		preview.style.backgroundColor = item.hex
		const info = node("div", "swatch-info")
		info.append(node("div", "swatch-hex", item.hex), node("div", "swatch-rgb", item.rgb || item.raw || ""), node("div", "swatch-count", `${item.count} element${item.count === 1 ? "" : "s"}`))
		card.append(preview, info)
		copyOnClick(card, item.hex, onStatus)
		grid.appendChild(card)
	}
	wrap.append(bar, grid)
	return wrap
}

function fontParts(item) {
	if (item.family || typeof item.style !== "string") return { family: item.family, size: item.size, weight: item.weight, lineHeight: item.lineHeight }
	const [family = "sans-serif", size = "16px", weight = "400", lineHeight = "normal"] = item.style.split("|").map((part) => part.trim())
	return { family, size, weight, lineHeight }
}

function renderFontReport(fonts, onStatus) {
	if (!Array.isArray(fonts) || !fonts.length) return null
	const list = node("div", "font-list")
	for (const item of fonts) {
		const { family, size, weight, lineHeight } = fontParts(item)
		const card = node("div", "font-card")
		const header = node("div", "font-card-header")
		const pills = node("div", "font-pills")
		pills.append(node("span", "font-pill font-name", family), node("span", "font-pill", size), node("span", "font-pill", `w ${weight}`), node("span", "font-pill", `lh ${lineHeight}`), node("span", "font-pill", `${item.count} el`))
		const css = `font-family: ${item.fullFamily || family};\nfont-size: ${size};\nfont-weight: ${weight};\nline-height: ${lineHeight};`
		header.append(pills, copyMini(css, onStatus))
		const specimen = node("div", "font-specimen-box", item.sampleText || "The quick brown fox jumps over the lazy dog")
		specimen.style.fontFamily = item.fullFamily || family
		specimen.style.fontSize = `${Math.max(12, Math.min(parseInt(size, 10) || 16, 22))}px`
		specimen.style.fontWeight = weight
		card.append(header, specimen)
		list.appendChild(card)
	}
	return list
}

const renderers = {
	"color-convert": renderColorConvert,
	"contrast-checker": renderContrastChecker,
	palette: renderPalette,
	"unit-convert": renderUnitConvert,
	"type-scale": renderTypeScale,
	"shadow-generator": renderShadowGradient,
	timestamp: renderTimestamp,
	timezone: renderTimezone,
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
	eyedropper: renderEyedropper,
	"viewport-resize": renderViewportResize,
	"edit-mode": renderEditMode,
	"snipping-tool": renderSnippingTool,
	"image-converter": renderImageConverter,
	"storage-inspector": renderStorageInspector,
	"color-report": renderColorReport,
	"font-report": renderFontReport,
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
