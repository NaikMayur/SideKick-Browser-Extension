import { api, isExtension, sendToPage } from "../lib/browser.js"
import { ROLES, coerceValues, getTool, runTool, searchTools } from "../lib/registry.js"
import { debounce } from "../lib/utils.js"
import { renderRichResult } from "./renderers.js"

const $ = (id) => document.getElementById(id)
const ui = {
	search: $("search"),
	role: $("role"),
	list: $("list"),
	empty: $("empty"),
	listView: $("list-view"),
	detailView: $("detail-view"),
	name: $("tool-name"),
	desc: $("tool-desc"),
	form: $("form"),
	run: $("run"),
	copy: $("copy"),
	download: $("download"),
	pin: $("pin"),
	back: $("back"),
	closeTool: $("close-tool"),
	richOutput: $("rich-output"),
	output: $("output"),
	error: $("error"),
	status: $("status"),
	theme: $("theme"),
	options: $("options-link"),
	tabAll: $("tab-all"),
	tabWorkflows: $("tab-workflows"),
	tabPage: $("tab-page"),
	tabUtils: $("tab-utils"),
}

const CORE_WORKFLOWS = new Set([
	"seo-audit",
	"a11y-audit",
	"color-report",
	"eyedropper",
	"contrast-checker",
	"inspect-element",
	"page-metrics",
	"form-filler",
	"bug-report",
	"jwt-decode",
	"json-format",
	"edit-mode",
	"grid-overlay",
	"link-check",
	"snipping-tool",
])

let activeTab = "all"
let current = null
let cursor = 0
let pinned = []
let lastOutput = ""
let viewportPollTimer = null

function stopViewportPolling() {
	if (viewportPollTimer) {
		clearInterval(viewportPollTimer)
		viewportPollTimer = null
	}
}

function startViewportPolling() {
	stopViewportPolling()
	viewportPollTimer = setInterval(async () => {
		if (current?.id !== "viewport-resize") {
			stopViewportPolling()
			return
		}
		try {
			const res = await sendToPage({ type: "viewport-query" })
			if (res?.ok && res?.data && res.data.enabled !== false) {
				succeed(res.data)
			}
		} catch {}
	}, 200)
}

init().catch((error) => setStatus(`Startup error: ${error.message}`))

async function init() {
	ui.role.innerHTML = ""
	ui.role.append(new Option("All roles", "all"))
	for (const [value, label] of Object.entries(ROLES)) ui.role.append(new Option(label, value))

	const saved = isExtension ? await api.storage.get(["theme", "role", "pinned"]).catch(() => ({})) : {}
	applyTheme(saved.theme ?? "system")
	ui.role.value = saved.role ?? "all"
	pinned = Array.isArray(saved.pinned) ? saved.pinned : []


	render()
	ui.search.focus()

	ui.search.addEventListener("input", debounce(render, 80))
	ui.role.addEventListener("change", async () => {
		await persist({ role: ui.role.value })
		render()
	})
	ui.search.addEventListener("keydown", onListKeys)
	ui.back.addEventListener("click", showList)
	ui.closeTool?.addEventListener("click", () => {
		showList()
	})
	ui.run.addEventListener("click", execute)
	ui.copy.addEventListener("click", copyOutput)
	ui.download.addEventListener("click", saveOutput)
	ui.pin.addEventListener("click", togglePin)
	ui.theme.addEventListener("click", cycleTheme)
	ui.options.addEventListener("click", (event) => {
		event.preventDefault()
		if (isExtension) api.tabs.create({ url: api.runtime.getURL("options/options.html") })
	})
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !ui.detailView.hidden) showList()
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !ui.detailView.hidden) execute()
	})

	if (isExtension && api?.runtime?.onMessage) {
		api.runtime.onMessage.addListener((message) => {
			if (message?.type === "devkit:viewport-update" && current?.id === "viewport-resize") {
				if (message.payload?.enabled === false) {
					stopViewportPolling()
				}
				succeed(message.payload)
			}
		})
	}

	window.addEventListener("resize", async () => {
		if (current?.id === "viewport-resize") {
			try {
				const res = await sendToPage({ type: "viewport-query" })
				if (res?.ok && res?.data) {
					succeed(res.data)
				}
			} catch {}
		}
	})

	const tabs = [
		{ btn: ui.tabAll, id: "all" },
		{ btn: ui.tabWorkflows, id: "workflows" },
		{ btn: ui.tabPage, id: "page" },
		{ btn: ui.tabUtils, id: "utils" },
	]
	for (const tab of tabs) {
		tab.btn?.addEventListener("click", () => {
			activeTab = tab.id
			for (const t of tabs) {
				t.btn?.classList.toggle("active", t.id === activeTab)
				t.btn?.setAttribute("aria-selected", String(t.id === activeTab))
			}
			render()
		})
	}
}

function persist(patch) {
	if (!isExtension) return Promise.resolve()
	return api.storage.set(patch).catch(() => {})
}

function applyTheme(mode) {
	const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
	document.documentElement.dataset.theme = dark ? "dark" : "light"
	document.documentElement.dataset.themeMode = mode
}

async function cycleTheme() {
	const order = ["system", "light", "dark"]
	const next = order[(order.indexOf(document.documentElement.dataset.themeMode ?? "system") + 1) % order.length]
	applyTheme(next)
	await persist({ theme: next })
	setStatus(`Theme: ${next}`)
}

function render() {
	const results = searchTools(ui.search.value, ui.role.value)
	const filtered = results.filter((tool) => {
		if (activeTab === "workflows") return CORE_WORKFLOWS.has(tool.id)
		if (activeTab === "page") return tool.surface === "page"
		if (activeTab === "utils") return !CORE_WORKFLOWS.has(tool.id) && tool.surface !== "page"
		return true
	})
	const sorted = [...filtered].sort((a, b) => {
		const pinA = pinned.includes(a.id)
		const pinB = pinned.includes(b.id)
		if (pinA !== pinB) return Number(pinB) - Number(pinA)
		const wfA = CORE_WORKFLOWS.has(a.id)
		const wfB = CORE_WORKFLOWS.has(b.id)
		if (wfA !== wfB) return Number(wfB) - Number(wfA)
		return 0
	})
	ui.list.innerHTML = ""
	ui.empty.hidden = sorted.length > 0
	cursor = 0

	let group = null
	sorted.forEach((tool, index) => {
		const isWf = CORE_WORKFLOWS.has(tool.id)
		const isPin = pinned.includes(tool.id)
		const label = isPin ? "Pinned" : isWf ? "★ Core Workflows" : tool.category
		if (label !== group) {
			group = label
			const heading = document.createElement("div")
			heading.className = "group-title"
			heading.textContent = label
			ui.list.appendChild(heading)
		}
		const button = document.createElement("button")
		button.type = "button"
		button.className = "tool"
		button.setAttribute("role", "option")
		button.dataset.index = String(index)
		button.dataset.id = tool.id
		button.innerHTML = "<div class=\"tool-header\"><strong></strong><span class=\"tool-badge\"></span></div><span class=\"tool-desc\"></span>"
		button.querySelector("strong").textContent = `${isPin ? "★ " : ""}${tool.name}`
		button.querySelector(".tool-desc").textContent = tool.description
		const badgeEl = button.querySelector(".tool-badge")
		badgeEl.textContent = isWf ? "★ Workflow" : tool.category
		if (isWf) badgeEl.style.cssText = "background: rgba(37,99,235,0.18); color: var(--accent); font-weight: 700;"
		button.addEventListener("click", () => openTool(tool.id))
		ui.list.appendChild(button)
	})
	highlightCursor()
	setStatus(`${sorted.length} tool${sorted.length === 1 ? "" : "s"}`)
}

function items() {
	return [...ui.list.querySelectorAll(".tool")]
}

function highlightCursor() {
	const all = items()
	all.forEach((node, index) => node.classList.toggle("active", index === cursor))
	all[cursor]?.scrollIntoView({ block: "nearest" })
}

function onListKeys(event) {
	const all = items()
	if (!all.length) return
	if (event.key === "ArrowDown") {
		event.preventDefault()
		cursor = (cursor + 1) % all.length
		highlightCursor()
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		cursor = (cursor - 1 + all.length) % all.length
		highlightCursor()
	} else if (event.key === "Enter") {
		event.preventDefault()
		openTool(all[cursor].dataset.id)
	}
}

function showList() {
	stopViewportPolling()
	current = null
	ui.detailView.hidden = true
	ui.listView.hidden = false
	ui.search.focus()
	if (isExtension) {
		sendToPage({ type: "stop-tool" }).catch(() => {})
	}
}

function openTool(id) {
	stopViewportPolling()
	const tool = getTool(id)
	current = tool
	ui.listView.hidden = true
	ui.detailView.hidden = false
	ui.name.textContent = tool.name
	ui.desc.textContent = tool.description
	ui.output.textContent = ""
	if (ui.richOutput) {
		ui.richOutput.innerHTML = ""
		ui.richOutput.hidden = true
	}
	ui.output.hidden = false
	ui.error.hidden = true
	ui.pin.textContent = pinned.includes(id) ? "Unpin" : "Pin"
	ui.run.textContent = tool.surface === "page" ? "Run on page" : "Run"
	ui.form.innerHTML = ""

	for (const input of tool.inputs ?? []) {
		const wrap = document.createElement("div")
		wrap.className = `field ${input.type === "checkbox" ? "checkbox" : ""}`
		const label = document.createElement("label")
		label.textContent = input.label
		label.htmlFor = `f-${input.key}`
		let field
		if (input.type === "textarea") field = document.createElement("textarea")
		else if (input.type === "select") {
			field = document.createElement("select")
			for (const option of input.options ?? []) field.append(new Option(option, option))
		} else {
			field = document.createElement("input")
			field.type = input.type === "number" ? "number" : "text"
		}
		field.id = `f-${input.key}`
		field.name = input.key
		if (input.placeholder) field.placeholder = input.placeholder
		if (input.type === "checkbox") {
			field = document.createElement("input")
			field.type = "checkbox"
			field.id = `f-${input.key}`
			field.name = input.key
			field.checked = Boolean(input.default)
			wrap.append(field, label)
		} else {
			if (input.default !== undefined) field.value = String(input.default)
			wrap.append(label, field)
		}
		ui.form.appendChild(wrap)
	}
	;(ui.form.querySelector("textarea, input, select") ?? ui.run).focus()
}

function readForm() {
	const values = {}
	for (const field of ui.form.querySelectorAll("input, select, textarea")) {
		values[field.name] = field.type === "checkbox" ? field.checked : field.value
	}
	return values
}

async function execute() {
	if (!current) return
	ui.error.hidden = true
	setStatus("Running…")
	ui.run.disabled = true
	try {
		if (current.id === "eyedropper") {
			const response = await sendToPage({ type: "eyedropper" })
			if (!response.ok) return fail(response.error ?? "Page command failed")
			setStatus("Eyedropper active on page")
			return succeed(response.data ?? "Color eyedropper active on page")
		}

		if (current.id === "snipping-tool") {
			const formValues = readForm()
			const mode = formValues.mode || "Visible tab"
			if (mode === "Freeform region") {
				setStatus("Draw a region on the page…")
			}
			const response = await sendToPage({ type: "snip", payload: formValues })
			if (!response.ok) return fail(response.error ?? "Screenshot capture failed")
			return succeed(response.data ?? "Screenshot captured")
		}

		if (current.surface === "page") {
			const formValues = readForm()
			const response = await sendToPage({ type: current.command, payload: formValues })
			if (!response.ok) return fail(response.error ?? "Page command failed")
			if (current.id === "inspect-element") {
				setStatus("Inspector active on page")
				if (!window.location.search.includes("drawer") && window.innerHeight < 650) {
					setTimeout(() => window.close(), 350)
				}
			}
			if (current.id === "viewport-resize") {
				if (response.data?.enabled !== false) {
					startViewportPolling()
				} else {
					stopViewportPolling()
				}
			}
			return succeed(response.data ?? "Done")
		}
		let values = readForm()
		if (current.autofill === "environment") {
			const context = await sendToPage({ type: "capture-context" })
			values = { ...values, environment: context.ok ? context.data : { Note: "Page context unavailable" } }
			const result = await (async () => {
				try {
					const coerced = { ...coerceValues(current, values), environment: values.environment }
					return { ok: true, ...(await current.run(coerced)) }
				} catch (error) {
					return { ok: false, error: error.message }
				}
			})()
			return result.ok ? succeed(result.value) : fail(result.error)
		}
		const result = await runTool(current.id, values)
		return result.ok ? succeed(result.value) : fail(result.error)
	} catch (error) {
		return fail(error?.message ?? String(error))
	} finally {
		ui.run.disabled = false
	}
}

function succeed(value) {
	lastOutput = typeof value === "string" ? value : JSON.stringify(value, null, 2)
	ui.output.textContent = lastOutput
	if (ui.richOutput) {
		ui.richOutput.innerHTML = ""
		ui.richOutput.hidden = true
	}
	ui.output.hidden = false
	setStatus("Done")

	if (current?.id === "color-report" && Array.isArray(value) && value.length > 0) {
		renderPaletteOutput(value)
	} else if (current?.id === "font-report" && Array.isArray(value) && value.length > 0) {
		renderFontsOutput(value)
	} else if (current && ui.richOutput) {
		const richNode = renderRichResult(
			current.id,
			value,
			setStatus,
			(selector) => sendToPage({ type: "highlight-element", payload: { selector } })
		)
		if (richNode) {
			ui.richOutput.innerHTML = ""
			ui.richOutput.appendChild(richNode)
			ui.richOutput.hidden = false
			ui.output.hidden = true
			;(ui.richOutput.querySelector("button, a, input, [tabindex]") || ui.output).focus()
		}
	}

	if (isExtension && current) {
		api.runtime.sendMessage({ type: "history:add", entry: { toolId: current.id, name: current.name } }).catch(() => {})
	}
}

function renderPaletteOutput(colors) {
	if (!ui.richOutput) return
	ui.output.hidden = true
	ui.richOutput.hidden = false
	ui.richOutput.innerHTML = ""

	const header = document.createElement("div")
	header.className = "rich-header"

	const title = document.createElement("span")
	title.className = "rich-title"
	title.textContent = `Page Palette (${colors.length} colors)`

	const tabs = document.createElement("div")
	tabs.className = "rich-tabs"

	const swatchesTab = document.createElement("button")
	swatchesTab.className = "rich-tab-btn active"
	swatchesTab.type = "button"
	swatchesTab.textContent = "Swatches"

	const cssVarsTab = document.createElement("button")
	cssVarsTab.className = "rich-tab-btn"
	cssVarsTab.type = "button"
	cssVarsTab.textContent = "CSS Vars"

	const jsonTab = document.createElement("button")
	jsonTab.className = "rich-tab-btn"
	jsonTab.type = "button"
	jsonTab.textContent = "Raw JSON"

	tabs.append(swatchesTab, cssVarsTab, jsonTab)
	header.append(title, tabs)
	ui.richOutput.appendChild(header)

	const swatchGrid = document.createElement("div")
	swatchGrid.className = "swatch-grid"

	const cssVarsBox = document.createElement("pre")
	cssVarsBox.hidden = true
	const cssVarsLines = [":root {"]
	colors.forEach((c, idx) => {
		const varName = `--color-${idx + 1}`
		cssVarsLines.push(`  ${varName}: ${c.hex};`)
	})
	cssVarsLines.push("}")
	cssVarsBox.textContent = cssVarsLines.join("\n")

	colors.forEach((item) => {
		const card = document.createElement("div")
		card.className = "swatch-card"
		card.title = `Click to copy ${item.hex}`

		const preview = document.createElement("div")
		preview.className = "swatch-preview"
		preview.style.backgroundColor = item.hex

		const info = document.createElement("div")
		info.className = "swatch-info"

		const hexEl = document.createElement("div")
		hexEl.className = "swatch-hex"
		hexEl.textContent = item.hex

		const rgbEl = document.createElement("div")
		rgbEl.className = "swatch-rgb"
		rgbEl.textContent = item.rgb || item.raw || ""

		const countEl = document.createElement("div")
		countEl.className = "swatch-count"
		countEl.textContent = `${item.count} element${item.count === 1 ? "" : "s"}`

		info.append(hexEl, rgbEl, countEl)
		card.append(preview, info)

		card.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(item.hex)
				setStatus(`Copied ${item.hex}`)
				const badge = document.createElement("div")
				badge.className = "swatch-copied-badge"
				badge.textContent = "Copied!"
				card.appendChild(badge)
				setTimeout(() => badge.remove(), 1000)
			} catch {}
		})

		swatchGrid.appendChild(card)
	})

	ui.richOutput.append(swatchGrid, cssVarsBox)

	swatchesTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn active"
		cssVarsTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn"
		swatchGrid.hidden = false
		cssVarsBox.hidden = true
		ui.output.hidden = true
	})

	cssVarsTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn"
		cssVarsTab.className = "rich-tab-btn active"
		jsonTab.className = "rich-tab-btn"
		swatchGrid.hidden = true
		cssVarsBox.hidden = false
		ui.output.hidden = true
	})

	jsonTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn"
		cssVarsTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn active"
		swatchGrid.hidden = true
		cssVarsBox.hidden = true
		ui.output.hidden = false
	})
}

function renderFontsOutput(fonts) {
	if (!ui.richOutput) return
	ui.output.hidden = true
	ui.richOutput.hidden = false
	ui.richOutput.innerHTML = ""

	const header = document.createElement("div")
	header.className = "rich-header"

	const title = document.createElement("span")
	title.className = "rich-title"
	title.textContent = `Typography Report (${fonts.length} styles)`

	const tabs = document.createElement("div")
	tabs.className = "rich-tabs"

	const visualTab = document.createElement("button")
	visualTab.className = "rich-tab-btn active"
	visualTab.type = "button"
	visualTab.textContent = "Specimens"

	const jsonTab = document.createElement("button")
	jsonTab.className = "rich-tab-btn"
	jsonTab.type = "button"
	jsonTab.textContent = "Raw JSON"

	tabs.append(visualTab, jsonTab)
	header.append(title, tabs)
	ui.richOutput.appendChild(header)

	const fontList = document.createElement("div")
	fontList.className = "font-list"

	fonts.forEach((item) => {
		const card = document.createElement("div")
		card.className = "font-card"

		let family = item.family
		let size = item.size
		let weight = item.weight
		let lineHeight = item.lineHeight
		if (!family && typeof item.style === "string") {
			const parts = item.style.split("|").map((p) => p.trim())
			family = parts[0] || "sans-serif"
			size = parts[1] || "16px"
			weight = parts[2] || "400"
			lineHeight = parts[3] || "normal"
		}

		const cardHeader = document.createElement("div")
		cardHeader.className = "font-card-header"

		const pills = document.createElement("div")
		pills.className = "font-pills"

		const famPill = document.createElement("span")
		famPill.className = "font-pill font-name"
		famPill.textContent = family

		const sizePill = document.createElement("span")
		sizePill.className = "font-pill"
		sizePill.textContent = size

		const weightPill = document.createElement("span")
		weightPill.className = "font-pill"
		weightPill.textContent = `w:${weight}`

		const linePill = document.createElement("span")
		linePill.className = "font-pill"
		linePill.textContent = `lh:${lineHeight}`

		const countPill = document.createElement("span")
		countPill.className = "font-pill font-count"
		countPill.textContent = `${item.count} elements`

		pills.append(famPill, sizePill, weightPill, linePill, countPill)

		const copyBtn = document.createElement("button")
		copyBtn.type = "button"
		copyBtn.className = "font-copy-btn"
		copyBtn.textContent = "Copy CSS"
		const cssSnippet = `font-family: ${item.fullFamily || family};\nfont-size: ${size};\nfont-weight: ${weight};\nline-height: ${lineHeight};`
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(cssSnippet)
				copyBtn.textContent = "Copied!"
				setStatus(`Copied CSS: ${family} ${size}`)
				setTimeout(() => {
					copyBtn.textContent = "Copy CSS"
				}, 1200)
			} catch {}
		})

		cardHeader.append(pills, copyBtn)

		const specimen = document.createElement("div")
		specimen.className = "font-specimen-box"
		specimen.style.fontFamily = item.fullFamily || family
		specimen.style.fontSize = `${Math.max(12, Math.min(parseInt(size) || 16, 20))}px`
		specimen.style.fontWeight = weight
		specimen.textContent = item.sampleText || "The quick brown fox jumps over the lazy dog"

		card.append(cardHeader, specimen)
		fontList.appendChild(card)
	})

	ui.richOutput.appendChild(fontList)

	visualTab.addEventListener("click", () => {
		visualTab.className = "rich-tab-btn active"
		jsonTab.className = "rich-tab-btn"
		fontList.hidden = false
		ui.output.hidden = true
	})

	jsonTab.addEventListener("click", () => {
		visualTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn active"
		fontList.hidden = true
		ui.output.hidden = false
	})
}

function fail(message) {
	ui.error.textContent = message
	ui.error.hidden = false
	if (ui.richOutput) {
		ui.richOutput.hidden = true
	}
	setStatus("Error")
}

async function copyOutput() {
	if (!lastOutput) return setStatus("Nothing to copy")
	try {
		await navigator.clipboard.writeText(lastOutput)
		setStatus("Copied to clipboard")
	} catch {
		ui.output.focus()
		setStatus("Copy blocked — select the text manually")
	}
}

function saveOutput() {
	if (!lastOutput) return setStatus("Nothing to save")
	const blob = new Blob([lastOutput], { type: "text/plain" })
	const url = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = url
	link.download = `devkit-${current?.id ?? "output"}.txt`
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 2000)
	setStatus("Saved")
}

async function togglePin() {
	if (!current) return
	pinned = pinned.includes(current.id) ? pinned.filter((id) => id !== current.id) : [...pinned, current.id]
	ui.pin.textContent = pinned.includes(current.id) ? "Unpin" : "Pin"
	await persist({ pinned })
	setStatus(pinned.includes(current.id) ? "Pinned" : "Unpinned")
}

function setStatus(message) {
	ui.status.textContent = message
}
