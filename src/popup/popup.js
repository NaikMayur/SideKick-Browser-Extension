import { api, isExtension, sendToPage } from "../lib/browser.js"
import { readDrafts, writeDrafts } from "../lib/vault.js"
import { ROLES, getTool, searchTools, tools } from "../lib/registry.js"
import { applyTheme, copyText, debounce, downloadFile, el, icon, setIcon, toast } from "./dom.js"
import { buildForm } from "./form.js"
import {
	categoryMeta,
	copyTextFor,
	countByTab,
	downloadSpec,
	draftableValues,
	filterByTab,
	formatBytes,
	iconForTool,
	isLiveEligible,
	mergeDraft,
	mimeFromDataUrl,
	normalizeResult,
	recentToolIds,
	restrictedHint,
	splitPinned,
	wrapIndex,
} from "./helpers.js"
import { renderIdle, renderMessage, renderResult } from "./results.js"
import { runLocalTool } from "./runner.js"

const $ = (id) => document.getElementById(id)
const root = document.documentElement
const ui = {
	toolTotal: $("tool-total"),
	role: $("role"),
	theme: $("theme"),
	popout: $("popout"),
	options: $("options-link"),
	listView: $("list-view"),
	search: $("search"),
	tabs: [...document.querySelectorAll(".tab")],
	listScroll: $("list-scroll"),
	recent: $("recent"),
	list: $("list"),
	empty: $("empty"),
	detailView: $("detail-view"),
	back: $("back"),
	toolIcon: $("tool-icon"),
	toolName: $("tool-name"),
	toolCategory: $("tool-category"),
	pin: $("pin"),
	detailScroll: $("detail-scroll"),
	desc: $("tool-desc"),
	form: $("form"),
	liveBadge: $("live-badge"),
	reset: $("reset"),
	result: $("result"),
	run: $("run"),
	stop: $("stop"),
	copy: $("copy"),
	download: $("download"),
	status: $("status"),
	statusDot: $("status-dot"),
}

const OVERLAY_TOOLS = [
	["viewport", "viewport-resize"],
	["inspect", "inspect-element"],
	["edit", "edit-mode"],
	["grid", "grid-overlay"],
	["outline", "outline-all"],
	["measure", "measure"],
]
// Only these tools leave something running on the page; audits and one shot
// tools finish on their own, so offering Stop for them would be misleading.
const STOPPABLE_TOOLS = new Set([...OVERLAY_TOOLS.map(([, id]) => id), "eyedropper"])
const THEME_ORDER = ["system", "light", "dark"]
const THEME_ICONS = { system: "monitor", light: "sun", dark: "moon" }

const state = {
	tab: "all",
	role: "all",
	pinned: [],
	history: [],
	drafts: null,
	liveRun: true,
	current: null,
	form: null,
	result: null,
	live: false,
	options: [],
	cursor: 0,
	runToken: 0,
	openToken: 0,
	running: false,
	interacted: false,
	loggedThisOpen: false,
	lastOpenedId: null,
	listScrollTop: 0,
	activeOnPage: new Set(),
	viewportSig: null,
}

async function init() {
	confirmLayout()
	fillRoles()
	const saved = isExtension
		? await api.storage.get(["theme", "role", "pinned", "history", "liveRun", "lastActiveToolId"]).catch(() => ({}))
		: {}
	setTheme(saved.theme ?? root.dataset.themeMode ?? "system", false)
	state.role = saved.role === "all" || ROLES[saved.role] ? saved.role : "all"
	ui.role.value = state.role
	state.pinned = Array.isArray(saved.pinned) ? saved.pinned.filter((id) => typeof id === "string") : []
	state.history = Array.isArray(saved.history) ? saved.history : []
	state.liveRun = saved.liveRun !== false
	ui.toolTotal.textContent = String(tools.length)
	ui.search.placeholder = `Search ${tools.length} tools`
	if (root.dataset.layout === "window") ui.popout.hidden = true

	bindEvents()
	renderList()
	const resumeId = saved.lastActiveToolId && tools.some((tool) => tool.id === saved.lastActiveToolId) ? saved.lastActiveToolId : null
	if (resumeId) openTool(resumeId)
	else ui.search.focus({ preventScroll: true })
	queryActiveTools()
}

function confirmLayout() {
	if (root.dataset.layout !== "fluid") return
	try {
		const views = api.raw?.extension?.getViews?.({ type: "popup" }) ?? []
		if (views.includes(window)) root.dataset.layout = "popup"
	} catch {
		// getViews is unavailable in some contexts; keep the fluid layout
	}
}

function fillRoles() {
	ui.role.replaceChildren(new Option("All roles", "all"))
	for (const [value, label] of Object.entries(ROLES)) ui.role.append(new Option(label, value))
}

function persist(patch) {
	if (!isExtension) return Promise.resolve()
	return api.storage.set(patch).catch(() => {})
}

function setStatus(message, tone = "idle") {
	ui.status.textContent = message
	ui.statusDot.dataset.tone = tone
}

function setTheme(mode, save = true) {
	const next = THEME_ORDER.includes(mode) ? mode : "system"
	applyTheme(next)
	setIcon(ui.theme.querySelector("svg"), THEME_ICONS[next])
	const label = `Theme: ${next}`
	ui.theme.title = label
	ui.theme.setAttribute("aria-label", label)
	if (save) persist({ theme: next })
}

function cycleTheme() {
	const currentMode = root.dataset.themeMode ?? "system"
	const next = THEME_ORDER[(THEME_ORDER.indexOf(currentMode) + 1) % THEME_ORDER.length]
	setTheme(next)
	setStatus(`Theme: ${next}`)
}

function bindEvents() {
	const markInteracted = () => (state.interacted = true)
	document.addEventListener("pointerdown", markInteracted, { once: true, capture: true })
	document.addEventListener("keydown", markInteracted, { once: true, capture: true })

	ui.search.addEventListener("input", debounce(() => renderList(), 60))
	ui.search.addEventListener("keydown", onSearchKeys)
	ui.role.addEventListener("change", () => {
		state.role = ui.role.value
		persist({ role: state.role })
		renderList()
	})
	for (const tab of ui.tabs) {
		tab.addEventListener("click", () => selectTab(tab.dataset.tab))
		tab.addEventListener("keydown", onTabKeys)
	}
	ui.list.addEventListener("click", (event) => {
		const row = event.target.closest(".tool")
		if (row) openTool(row.dataset.id)
	})
	ui.recent.addEventListener("click", (event) => {
		const chip = event.target.closest("[data-id]")
		if (chip) openTool(chip.dataset.id)
	})
	ui.listScroll.addEventListener("scroll", () => (state.listScrollTop = ui.listScroll.scrollTop), { passive: true })

	ui.back.addEventListener("click", showList)
	ui.run.addEventListener("click", () => execute())
	ui.stop.addEventListener("click", stopPageTool)
	ui.copy.addEventListener("click", copyResult)
	ui.download.addEventListener("click", saveResult)
	ui.pin.addEventListener("click", togglePin)
	ui.reset.addEventListener("click", () => state.form?.reset())
	ui.theme.addEventListener("click", cycleTheme)
	ui.popout.addEventListener("click", popOut)
	ui.options.addEventListener("click", openOptions)
	document.addEventListener("keydown", onGlobalKeys)

	window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
		if ((root.dataset.themeMode ?? "system") === "system") applyTheme("system")
	})
	window.addEventListener("resize", debounce(refreshViewportResult, 200))
	if (isExtension) {
		api.runtime.onMessage?.addListener(onRuntimeMessage)
		api.raw?.storage?.onChanged?.addListener(onStorageChanged)
	}
}

function onStorageChanged(changes, area) {
	if (area && area !== "local") return
	if (changes.history) {
		state.history = Array.isArray(changes.history.newValue) ? changes.history.newValue : []
		if (!ui.listView.hidden) renderRecent(currentVisible())
	}
	if (changes.pinned) {
		state.pinned = Array.isArray(changes.pinned.newValue) ? changes.pinned.newValue : []
		renderList({ keepCursor: true })
		if (state.current) syncPinButton()
	}
	if (changes.theme && changes.theme.newValue !== root.dataset.themeMode) setTheme(changes.theme.newValue ?? "system", false)
	if (changes.liveRun) state.liveRun = changes.liveRun.newValue !== false
	if ((changes.drafts && !changes.drafts.newValue) || (changes["vault:drafts"] && !changes["vault:drafts"].newValue)) state.drafts = {}
}

function onRuntimeMessage(message) {
	if (state.current?.id !== "viewport-resize") return
	if (message?.type === "devkit:viewport-update") applyViewportData(message.payload)
	if (message?.type === "devkit:device-frame-update" && typeof window.__onDeviceFrameUpdate === "function") {
		window.__onDeviceFrameUpdate(message.payload)
	}
}

function selectTab(tab) {
	state.tab = tab
	for (const button of ui.tabs) button.setAttribute("aria-selected", String(button.dataset.tab === tab))
	renderList()
}

function onTabKeys(event) {
	if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
	const index = ui.tabs.indexOf(event.currentTarget)
	const next = ui.tabs[wrapIndex(index, event.key === "ArrowRight" ? 1 : -1, ui.tabs.length)]
	next.focus()
	selectTab(next.dataset.tab)
}

function currentMatches() {
	return searchTools(ui.search.value, state.role)
}

function currentVisible() {
	return filterByTab(currentMatches(), state.tab)
}

const TAB_HEADINGS = { all: "All tools", ai: "AI tools", page: "On this page", utils: "Utilities" }

function renderList({ keepCursor = false } = {}) {
	const query = ui.search.value.trim()
	const matches = currentMatches()
	const counts = countByTab(matches)
	for (const tab of ui.tabs) tab.querySelector(".tab-count").textContent = String(counts[tab.dataset.tab])
	const visible = filterByTab(matches, state.tab)
	const previousId = state.options[state.cursor]?.dataset.id
	state.options = []
	const frag = document.createDocumentFragment()
	if (query) {
		if (visible.length) frag.appendChild(toolGroup(`${visible.length} result${visible.length === 1 ? "" : "s"}`, visible))
	} else {
		const { pinned, rest } = splitPinned(visible, state.pinned)
		if (pinned.length) frag.appendChild(toolGroup("Pinned", pinned, "pin"))
		if (rest.length) frag.appendChild(toolGroup(TAB_HEADINGS[state.tab], rest))
	}
	ui.list.replaceChildren(frag)
	renderRecent(query ? [] : visible)
	renderEmpty(query, visible.length)
	const keep = keepCursor ? state.options.findIndex((row) => row.dataset.id === previousId) : -1
	moveCursor(keep >= 0 ? keep : 0, false)
}

function toolGroup(title, list, iconName) {
	const group = el("div", "group")
	group.setAttribute("role", "group")
	const head = el("div", "group-title")
	head.id = `g-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
	if (iconName) head.appendChild(icon(iconName))
	head.append(el("span", "", title), el("span", "group-count", String(list.length)))
	group.setAttribute("aria-labelledby", head.id)
	group.appendChild(head)
	for (const tool of list) group.appendChild(toolRow(tool))
	return group
}

function toolRow(tool) {
	const row = el("div", "tool")
	row.id = `opt-${tool.id}`
	row.dataset.id = tool.id
	row.setAttribute("role", "option")
	row.setAttribute("aria-selected", "false")
	row.style.setProperty("--hue", categoryMeta(tool.category).hue)
	const tile = el("span", "tile")
	tile.appendChild(icon(iconForTool(tool)))
	const text = el("span", "tool-text")
	const name = el("span", "tool-name", tool.name)
	if (state.activeOnPage.has(tool.id)) name.appendChild(el("span", "running-dot", ""))
	text.append(name, el("span", "tool-sub", tool.description))
	row.append(tile, text, el("span", "cat mono", tool.category))
	if (state.pinned.includes(tool.id)) row.classList.add("is-pinned")
	state.options.push(row)
	return row
}

function renderRecent(visible) {
	const ids = recentToolIds(state.history, new Set(visible.map((tool) => tool.id)), 6)
	ui.recent.hidden = ids.length === 0
	if (!ids.length) return ui.recent.replaceChildren()
	const frag = document.createDocumentFragment()
	const label = el("span", "recent-label")
	label.append(icon("history"), el("span", "", "Recent"))
	frag.appendChild(label)
	for (const id of ids) {
		const tool = getTool(id)
		const chip = el("button", "recent-chip")
		chip.type = "button"
		chip.dataset.id = id
		chip.title = tool.name
		chip.style.setProperty("--hue", categoryMeta(tool.category).hue)
		chip.append(icon(iconForTool(tool)), el("span", "", tool.name))
		frag.appendChild(chip)
	}
	ui.recent.replaceChildren(frag)
}

function renderEmpty(query, count) {
	ui.empty.hidden = count > 0
	if (count > 0) return
	const box = el("div", "empty-box")
	box.appendChild(icon("search", "empty-icon"))
	box.appendChild(el("strong", "", query ? `Nothing matches “${query}”` : "No tools in this view"))
	const tips = []
	if (state.role !== "all") tips.push("set the role filter to All roles")
	if (state.tab !== "all") tips.push("switch to the All tab")
	if (query) tips.push("try a shorter word")
	box.appendChild(el("p", "", tips.length ? `Try to ${tips.join(", or ")}.` : "Try another search."))
	ui.empty.replaceChildren(box)
}

function moveCursor(index, scroll = true) {
	const previous = state.options[state.cursor]
	previous?.classList.remove("is-active")
	previous?.setAttribute("aria-selected", "false")
	state.cursor = state.options.length ? Math.max(0, Math.min(index, state.options.length - 1)) : 0
	const row = state.options[state.cursor]
	if (!row) {
		ui.search.removeAttribute("aria-activedescendant")
		return
	}
	row.classList.add("is-active")
	row.setAttribute("aria-selected", "true")
	ui.search.setAttribute("aria-activedescendant", row.id)
	if (scroll) row.scrollIntoView({ block: "nearest" })
}

function onSearchKeys(event) {
	const total = state.options.length
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault()
		if (total) moveCursor(wrapIndex(state.cursor, event.key === "ArrowDown" ? 1 : -1, total))
	} else if (event.key === "Home" && event.ctrlKey) {
		event.preventDefault()
		moveCursor(0)
	} else if (event.key === "End" && event.ctrlKey) {
		event.preventDefault()
		moveCursor(total - 1)
	} else if (event.key === "PageDown" || event.key === "PageUp") {
		event.preventDefault()
		moveCursor(state.cursor + (event.key === "PageDown" ? 6 : -6))
	} else if (event.key === "Enter") {
		event.preventDefault()
		const row = state.options[state.cursor]
		if (row) openTool(row.dataset.id)
	} else if (event.key === "Escape" && ui.search.value) {
		event.preventDefault()
		ui.search.value = ""
		renderList()
	}
}

function isTypingTarget(node) {
	return node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.isContentEditable)
}

function onGlobalKeys(event) {
	const inDetail = !ui.detailView.hidden
	if (inDetail && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
		event.preventDefault()
		execute()
		return
	}
	if (inDetail && event.key === "Escape") {
		event.preventDefault()
		const active = document.activeElement
		if (isTypingTarget(active)) active.blur()
		else showList()
		return
	}
	if (!inDetail && event.key === "/" && !isTypingTarget(document.activeElement)) {
		event.preventDefault()
		ui.search.focus()
		ui.search.select()
	}
}

async function loadDrafts() {
	if (state.drafts) return state.drafts
	state.drafts = isExtension ? await readDrafts().catch(() => ({})) : {}
	return state.drafts
}

async function openTool(id) {
	let tool
	try {
		tool = getTool(id)
	} catch {
		return
	}
	const openToken = ++state.openToken
	state.runToken++
	if (!ui.listView.hidden) state.listScrollTop = ui.listScroll.scrollTop
	const drafts = await loadDrafts()
	if (openToken !== state.openToken) return

	state.current = tool
	state.lastOpenedId = id
	state.result = null
	state.loggedThisOpen = false
	state.viewportSig = null
	state.live = isLiveEligible(tool, state.liveRun)
	if (isExtension) api.storage.set({ lastActiveToolId: id }).catch(() => {})

	paintToolHeader(tool)
	state.form = buildForm(tool, ui.form, { initial: drafts[id] ?? {}, onChange: onFormChange })
	ui.form.hidden = !state.form.hasFields
	ui.reset.hidden = !state.form.hasFields
	ui.liveBadge.hidden = !state.live
	setResultActions(false)
	renderIdle(ui.result, { live: state.live, page: tool.surface === "page", hasInputs: state.form.hasFields })

	ui.listView.hidden = true
	ui.detailView.hidden = false
	ui.detailScroll.scrollTop = 0
	setStatus(tool.surface === "page" ? "Ready to run on this tab" : "Ready")
	if (!state.form.focusFirst()) ui.run.focus({ preventScroll: true })
	if (state.live && state.form.hasFields) execute({ live: true, silent: true })
	if (tool.id === "viewport-resize") checkActiveViewport()
}

function paintToolHeader(tool) {
	const meta = categoryMeta(tool.category)
	ui.detailView.style.setProperty("--hue", meta.hue)
	ui.toolIcon.replaceChildren(icon(iconForTool(tool)))
	ui.toolName.textContent = tool.name
	ui.toolCategory.textContent = tool.category
	ui.desc.textContent = tool.description
	ui.run.querySelector(".btn-label").textContent = tool.surface === "page" ? "Run on page" : "Run"
	syncStopButton()
	syncPinButton()
}

function syncStopButton() {
	const id = state.current?.id
	ui.stop.hidden = !(id && STOPPABLE_TOOLS.has(id) && state.activeOnPage.has(id))
}

function syncPinButton() {
	const pinned = state.pinned.includes(state.current?.id)
	ui.pin.setAttribute("aria-pressed", String(pinned))
	const label = pinned ? "Unpin" : "Pin to top"
	ui.pin.title = label
	ui.pin.setAttribute("aria-label", label)
}

function showList() {
	state.openToken++
	state.runToken++
	state.current = null
	state.form = null
	state.result = null
	saveDraftSoon.cancel()
	liveSoon.cancel()
	if (isExtension) api.storage.remove("lastActiveToolId").catch(() => {})
	ui.detailView.hidden = true
	ui.listView.hidden = false
	ui.form.replaceChildren()
	ui.result.replaceChildren()
	renderList()
	const index = state.options.findIndex((row) => row.dataset.id === state.lastOpenedId)
	ui.listScroll.scrollTop = state.listScrollTop
	if (index >= 0) moveCursor(index, false)
	ui.search.focus({ preventScroll: true })
	setStatus("Ready")
}

const saveDraftSoon = debounce(saveDraft, 400)
const liveSoon = debounce(() => execute({ live: true }), 250)

function onFormChange() {
	if (!state.current) return
	saveDraftSoon()
	if (state.live) liveSoon()
}

function saveDraft() {
	if (!state.current || !state.form || !state.drafts) return
	const draft = draftableValues(state.current, state.form.readRaw())
	const had = Boolean(state.drafts[state.current.id])
	if (!draft && !had) return
	state.drafts = mergeDraft(state.drafts, state.current.id, draft)
	if (isExtension) writeDrafts(state.drafts).catch(() => {})
}

function setRunning(running) {
	state.running = running
	ui.run.classList.toggle("is-busy", running)
	ui.run.setAttribute("aria-busy", String(running))
}

function setResultActions(enabled) {
	ui.copy.disabled = !enabled
	ui.download.disabled = !enabled
}

async function execute({ live = false, silent = false } = {}) {
	const tool = state.current
	if (!tool || !state.form) return
	const token = ++state.runToken
	if (!live) {
		liveSoon.cancel()
		setRunning(true)
		setStatus("Running…", "busy")
	}
	try {
		const result = await produceResult(tool)
		if (token !== state.runToken || state.current !== tool) return
		showResult(result)
		setStatus(live ? "Updated" : "Done", "good")
		if (!live || !state.loggedThisOpen) logHistory(tool)
	} catch (error) {
		if (token !== state.runToken || state.current !== tool || error?.code === "stale") return
		if (silent) {
			renderIdle(ui.result, { live: state.live, page: false, hasInputs: true })
			setStatus("Ready")
			return
		}
		showError(error)
	} finally {
		if (!live) setRunning(false)
	}
}

function produceResult(tool) {
	if (tool.id === "image-converter") return runImageConverter()
	if (tool.surface === "page") return runPageTool(tool)
	return runUtility(tool)
}

async function captureEnvironment() {
	const context = isExtension ? await sendToPage({ type: "capture-context" }).catch(() => null) : null
	return context?.ok ? context.data : { Note: "Page context unavailable" }
}

async function runUtility(tool) {
	const values = await state.form.collect()
	const extra = tool.autofill === "environment" ? { environment: await captureEnvironment() } : {}
	return normalizeResult(await runLocalTool(tool, values, extra))
}

function pageError(message) {
	const error = new Error(message || "The page did not answer")
	error.page = true
	return error
}

async function runPageTool(tool) {
	if (!isExtension) throw pageError("Page tools need the extension runtime")
	const values = await state.form.collect({ forPage: true })
	let payload = tool.id === "viewport-resize" ? { ...values, enable: true } : values
	if (tool.autofill === "environment") payload = { ...payload, environment: await captureEnvironment() }
	if (tool.id === "snipping-tool" && values.mode === "Freeform region") setStatus("Draw a region on the page…", "busy")
	const response = await sendToPage({ type: tool.command, payload })
	if (!response?.ok) throw pageError(response?.error)
	afterPageRun(tool, response.data)
	if (tool.id === "viewport-resize") state.viewportSig = viewportSig(response.data)
	const data = typeof tool.finish === "function" ? await tool.finish(response.data, values) : response.data
	return normalizeResult(data ?? "Done")
}

function afterPageRun(tool, data) {
	// Toggle commands answer enabled:false when the run switched the overlay off.
	if (STOPPABLE_TOOLS.has(tool.id)) {
		if (data?.enabled === false) state.activeOnPage.delete(tool.id)
		else state.activeOnPage.add(tool.id)
	}
	syncStopButton()
	if (tool.id === "inspect-element") {
		setStatus("Inspector active, hover the page", "good")
		// The toolbar popup would cover the page; the side panel and window stay open.
		if (root.dataset.layout === "popup") setTimeout(() => window.close(), 350)
	}
	if (tool.id === "viewport-resize") ui.run.querySelector(".btn-label").textContent = "Refresh viewport"
}

async function runImageConverter() {
	const file = state.form.rawFile("file")
	if (!file) throw new Error("Choose an image file first.")
	let convertImage
	try {
		;({ convertImage } = await import("./image-converter.js"))
	} catch {
		throw new Error("Image converter module is not available yet")
	}
	if (typeof convertImage !== "function") throw new Error("Image converter module is not available yet")
	const value = await convertImage(file, state.form.readRaw(), (message) => setStatus(message, "busy"))
	const mime = value.blob?.type || mimeFromDataUrl(value.dataUrl)
	return {
		type: "json",
		value,
		legacy: true,
		copy: `${value.originalName} → ${value.fileName}: ${value.outputWidth}×${value.outputHeight}, ${formatBytes(value.outputSize)} (${value.format})`,
		download: value.blob ? { filename: value.fileName, mime, blob: value.blob } : { filename: value.fileName, mime, dataUrl: value.dataUrl },
	}
}

function highlightOnPage(selector) {
	if (!isExtension) return
	sendToPage({ type: "highlight-element", payload: { selector } })
		.then((response) => setStatus(response?.ok ? `Highlighted ${selector.slice(0, 40)}` : response?.error ?? "Could not highlight", response?.ok ? "good" : "bad"))
		.catch(() => setStatus("Could not highlight", "bad"))
}

function showResult(result) {
	state.result = result
	renderResult(ui.result, result, { toolId: state.current?.id, onStatus: (message) => setStatus(message), onHighlight: highlightOnPage })
	setResultActions(true)
}

function showError(error) {
	const message = error?.message ?? String(error)
	const hint = restrictedHint(message)
	const blocked = hint.startsWith("Browsers block")
	if (blocked) state.activeOnPage.clear()
	syncStopButton()
	state.result = null
	setResultActions(false)
	renderMessage(ui.result, {
		tone: "bad",
		iconName: blocked ? "ban" : "error",
		title: blocked ? "This page is off limits" : error?.page ? "The page tool could not run" : "Could not run this tool",
		// The hint already explains a blocked page in plain words, so the raw message would only repeat it.
		detail: blocked ? hint : message,
		hint: blocked ? "" : hint,
	})
	setStatus(blocked ? "Restricted page" : "Error", "bad")
}

function logHistory(tool) {
	state.loggedThisOpen = true
	if (!isExtension) return
	api.runtime.sendMessage({ type: "history:add", entry: { toolId: tool.id, name: tool.name } }).catch(() => {})
}

async function copyResult() {
	if (!state.result) return setStatus("Nothing to copy yet")
	const ok = await copyText(copyTextFor(state.result))
	toast(ok ? "Copied to clipboard" : "Copy blocked, select the text manually", ok ? "good" : "bad")
	setStatus(ok ? "Copied" : "Copy blocked", ok ? "good" : "bad")
}

function saveResult() {
	if (!state.result) return setStatus("Nothing to save yet")
	const spec = downloadSpec(state.result, state.current?.id ?? "output")
	try {
		downloadFile(spec)
		toast(`Saved ${spec.filename}`, "good")
		setStatus(`Saved ${spec.filename}`, "good")
	} catch (error) {
		setStatus(`Save failed: ${error.message}`, "bad")
	}
}

async function togglePin() {
	const id = state.current?.id
	if (!id) return
	state.pinned = state.pinned.includes(id) ? state.pinned.filter((item) => item !== id) : [...state.pinned, id]
	syncPinButton()
	await persist({ pinned: state.pinned })
	toast(state.pinned.includes(id) ? "Pinned to the top of the list" : "Unpinned")
}

async function stopPageTool() {
	if (!isExtension) return
	const response = await sendToPage({ type: "stop-tool" }, { inject: false }).catch(() => null)
	state.activeOnPage.clear()
	syncStopButton()
	if (response?.ok) {
		toast("Page overlays removed", "good")
		setStatus("Stopped", "good")
	} else {
		const quiet = response?.error === "not-injected" || response?.error === "restricted"
		setStatus(quiet ? "Nothing is running on this page" : response?.error ?? "Could not reach the page")
	}
	if (state.current?.id === "viewport-resize") ui.run.querySelector(".btn-label").textContent = "Run on page"
}

async function popOut() {
	if (!isExtension) return
	try {
		await api.windows.create({ url: api.runtime.getURL("popup/popup.html?mode=window"), type: "popup", width: 440, height: 720 })
		if (root.dataset.layout === "popup") window.close()
	} catch (error) {
		setStatus(`Pop out failed: ${error.message}`, "bad")
	}
}

function openOptions() {
	if (!isExtension) return
	api.tabs.create({ url: api.runtime.getURL("options/options.html") }).catch(() => {})
}

async function queryActiveTools() {
	if (!isExtension) return
	const response = await sendToPage({ type: "active-tools-query" }, { inject: false }).catch(() => null)
	if (!response?.ok || !response.data) return
	const data = response.data
	for (const [flag, id] of OVERLAY_TOOLS) {
		if (data[flag] || (flag === "viewport" && data.deviceFrame?.active)) state.activeOnPage.add(id)
	}
	if (data.eyedropper) state.activeOnPage.add("eyedropper")
	syncStopButton()
	if (!state.activeOnPage.size) return
	for (const id of state.activeOnPage) document.getElementById(`opt-${id}`)?.querySelector(".tool-name")?.appendChild(el("span", "running-dot", ""))
	const resumeId = OVERLAY_TOOLS.map(([, id]) => id).find((id) => state.activeOnPage.has(id))
	if (!state.interacted && resumeId && state.current?.id !== resumeId) openTool(resumeId)
}

function viewportSig(data) {
	return `${data?.enabled}:${data?.width}:${data?.height}:${data?.dpr}`
}

function applyViewportData(data) {
	if (!data || state.current?.id !== "viewport-resize") return
	const sig = viewportSig(data)
	if (sig === state.viewportSig) return
	state.viewportSig = sig
	showResult(normalizeResult(data))
}

async function checkActiveViewport() {
	if (!isExtension) return
	const [viewport, frame] = await Promise.all([
		sendToPage({ type: "viewport-query" }, { inject: false }).catch(() => null),
		sendToPage({ type: "device-frame-query" }, { inject: false }).catch(() => null),
	])
	if (state.current?.id !== "viewport-resize" || !viewport?.ok || !viewport.data) return
	const frameActive = Boolean(frame?.ok && frame.data?.active)
	if (viewport.data.enabled === false && !frameActive) return
	applyViewportData(viewport.data)
	ui.run.querySelector(".btn-label").textContent = "Refresh viewport"
	setStatus(frameActive ? "Device frame active on the page" : "Viewport HUD active on the page", "good")
}

async function refreshViewportResult() {
	if (state.current?.id !== "viewport-resize" || !state.result || !isExtension) return
	const response = await sendToPage({ type: "viewport-query" }, { inject: false }).catch(() => null)
	if (response?.ok) applyViewportData(response.data)
}

// Started last so every module level constant above is initialised first.
init().catch((error) => setStatus(`Startup error: ${error.message}`, "bad"))
