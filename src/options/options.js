import { api, isExtension } from "../lib/browser.js"
import { clearDrafts, readDrafts, wipeEverything, writeDrafts } from "../lib/vault.js"
import { ROLES, categories, tools } from "../lib/registry.js"
import { applyTheme, downloadFile, el, icon } from "../popup/dom.js"
import { SETTINGS_KEYS, categoryMeta, iconForTool, validateSettings } from "../popup/helpers.js"

const $ = (id) => document.getElementById(id)

function storageGet(keys) {
	return isExtension ? api.storage.get(keys).catch(() => ({})) : Promise.resolve({})
}

function storageSet(patch) {
	return isExtension ? api.storage.set(patch).catch(() => {}) : Promise.resolve()
}

function notice(id, text, tone = "muted") {
	const node = $(id)
	node.textContent = text
	node.style.color = tone === "bad" ? "var(--bad)" : tone === "good" ? "var(--good)" : "var(--muted)"
}

async function save(patch) {
	await storageSet(patch)
	notice("saved", `Saved at ${new Date().toLocaleTimeString()}`, "good")
}

function paintTheme(mode) {
	for (const button of $("theme").querySelectorAll(".seg-btn")) {
		const on = button.dataset.value === mode
		button.setAttribute("aria-checked", String(on))
		button.setAttribute("aria-pressed", String(on))
		button.tabIndex = on ? 0 : -1
	}
}

function setTheme(mode) {
	applyTheme(mode)
	paintTheme(mode)
	save({ theme: mode })
}

function bindTheme() {
	const group = $("theme")
	group.addEventListener("click", (event) => {
		const button = event.target.closest(".seg-btn")
		if (button) setTheme(button.dataset.value)
	})
	group.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
		const buttons = [...group.querySelectorAll(".seg-btn")]
		const index = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true")
		const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]
		next.focus()
		setTheme(next.dataset.value)
	})
}

async function refreshCounts() {
	const saved = await storageGet(["pinned", "history"])
	const drafts = isExtension ? await readDrafts().catch(() => ({})) : {}
	$("count-pinned").textContent = String(Array.isArray(saved.pinned) ? saved.pinned.length : 0)
	$("count-history").textContent = String(Array.isArray(saved.history) ? saved.history.length : 0)
	$("count-drafts").textContent = String(Object.keys(drafts).length)
}

function bindClear(id, key, empty, label) {
	$(id).addEventListener("click", async () => {
		await storageSet({ [key]: empty })
		await refreshCounts()
		notice("data-notice", `${label} cleared.`, "good")
	})
}

async function exportSettings() {
	const keys = SETTINGS_KEYS.filter((key) => key !== "drafts")
	const saved = await storageGet(keys)
	const data = Object.fromEntries(keys.filter((key) => saved[key] !== undefined).map((key) => [key, saved[key]]))
	downloadFile({ filename: "sidekick-settings.json", mime: "application/json", text: JSON.stringify(data, null, 2) })
	notice("data-notice", "Exported sidekick-settings.json. Drafts stay encrypted on this device and are not exported.", "good")
}

async function importSettings(file) {
	let parsed
	try {
		parsed = JSON.parse(await file.text())
	} catch {
		notice("data-notice", `${file.name} is not valid JSON.`, "bad")
		return
	}
	const { ok, values, errors } = validateSettings(parsed)
	if (!ok) {
		notice("data-notice", `Nothing imported. ${errors.join("; ")}`, "bad")
		return
	}
	const { drafts, ...plain } = values
	if (drafts && isExtension) await writeDrafts({ ...(await readDrafts().catch(() => ({}))), ...drafts })
	await storageSet(plain)
	await loadPreferences()
	await refreshCounts()
	const imported = Object.keys(values).join(", ")
	notice("data-notice", `Imported ${imported}.${errors.length ? ` Skipped: ${errors.join("; ")}.` : ""}`, errors.length ? "muted" : "good")
}

async function loadPreferences() {
	const saved = await storageGet(["theme", "role", "liveRun"])
	const mode = ["system", "light", "dark"].includes(saved.theme) ? saved.theme : "system"
	applyTheme(mode)
	paintTheme(mode)
	$("role").value = saved.role === "all" || ROLES[saved.role] ? saved.role : "all"
	$("live-run").checked = saved.liveRun !== false
}

function catalogueRow(tool) {
	const row = el("tr")
	row.dataset.search = `${tool.name} ${tool.category} ${tool.id} ${(tool.roles ?? []).join(" ")}`.toLowerCase()
	const nameCell = el("td")
	const wrap = el("div", "cat-tool")
	const tile = el("span", "tile")
	tile.style.setProperty("--hue", categoryMeta(tool.category).hue)
	tile.appendChild(icon(iconForTool(tool)))
	const text = el("div")
	text.append(el("strong", "", tool.name))
	wrap.append(tile, text)
	nameCell.appendChild(wrap)
	const catCell = el("td")
	catCell.appendChild(el("span", "cat mono", tool.category))
	row.append(nameCell, catCell, el("td", "cat-roles", (tool.roles ?? []).map((role) => ROLES[role] ?? role).join(", ")))
	return row
}

function renderCatalogue() {
	const frag = document.createDocumentFragment()
	for (const tool of tools) frag.appendChild(catalogueRow(tool))
	$("catalogue").replaceChildren(frag)
	$("catalogue-filter").addEventListener("input", (event) => {
		const query = event.target.value.toLowerCase().trim()
		for (const row of $("catalogue").rows) row.hidden = Boolean(query) && !row.dataset.search.includes(query)
	})
}

async function init() {
	const role = $("role")
	role.append(new Option("All roles", "all"))
	for (const [value, label] of Object.entries(ROLES)) role.append(new Option(label, value))
	await loadPreferences()
	bindTheme()
	role.addEventListener("change", () => save({ role: role.value }))
	$("live-run").addEventListener("change", (event) => save({ liveRun: event.target.checked }))

	const manifest = api.runtime.getManifest?.() ?? {}
	$("env").textContent = `v${manifest.version ?? "dev"} · ${api.flavor} · ${tools.length} tools · ${categories.length} categories`
	$("count").textContent = `${tools.length} tools across ${categories.length} categories, in the order the popup lists them.`
	$("welcome").hidden = location.hash !== "#welcome"
	renderCatalogue()
	await refreshCounts()

	bindClear("clear-pinned", "pinned", [], "Pins")
	bindClear("clear-history", "history", [], "History")
	$("clear-drafts").addEventListener("click", async () => {
		if (isExtension) await clearDrafts().catch(() => {})
		await refreshCounts()
		notice("data-notice", "Drafts cleared.", "good")
	})
	$("export").addEventListener("click", exportSettings)
	$("import").addEventListener("click", () => $("import-file").click())
	$("import-file").addEventListener("change", (event) => {
		const file = event.target.files?.[0]
		if (file) importSettings(file)
		event.target.value = ""
	})
	$("clear").addEventListener("click", async () => {
		if (!confirm("Reset all Sidekick settings, pins, drafts and history?")) return
		if (isExtension) await wipeEverything().catch(() => {})
		await loadPreferences()
		await refreshCounts()
		notice("data-notice", "All local data cleared and the encryption keys destroyed.", "good")
	})
	api.raw?.storage?.onChanged?.addListener(() => refreshCounts())
}

init().catch((error) => {
	$("env").textContent = `Failed to load settings: ${error.message}`
})
