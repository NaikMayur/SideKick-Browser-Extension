import { api, isExtension } from "../lib/browser.js"
import { ROLES, categories, tools } from "../lib/registry.js"

const $ = (id) => document.getElementById(id)

function applyTheme(mode) {
	const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
	document.documentElement.dataset.theme = dark ? "dark" : "light"
}

async function init() {
	const roleSelect = $("role")
	roleSelect.append(new Option("All roles", "all"))
	for (const [value, label] of Object.entries(ROLES)) roleSelect.append(new Option(label, value))

	const saved = isExtension ? await api.storage.get(["theme", "role"]).catch(() => ({})) : {}
	$("theme").value = saved.theme ?? "system"
	roleSelect.value = saved.role ?? "all"
	applyTheme($("theme").value)

	const manifest = api.runtime.getManifest?.() ?? {}
	$("env").textContent = `v${manifest.version ?? "dev"} · ${api.flavor} runtime · ${tools.length} tools · ${categories.length} categories`
	$("count").textContent = `${tools.length} tools across ${categories.length} categories.`

	const table = $("catalogue")
	table.innerHTML = "<tr><th>Tool</th><th>Category</th><th>Made for</th></tr>"
	for (const tool of tools) {
		const row = table.insertRow()
		row.insertCell().textContent = tool.name
		row.insertCell().textContent = tool.category
		row.insertCell().textContent = (tool.roles ?? []).map((role) => ROLES[role] ?? role).join(", ")
	}

	$("theme").addEventListener("change", async (event) => {
		applyTheme(event.target.value)
		await save({ theme: event.target.value })
	})
	roleSelect.addEventListener("change", (event) => save({ role: event.target.value }))

	$("export").addEventListener("click", async () => {
		const all = isExtension ? await api.storage.get(null).catch(() => ({})) : {}
		const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" })
		const link = document.createElement("a")
		link.href = URL.createObjectURL(blob)
		link.download = "sidekick-settings.json"
		link.click()
	})

	$("clear").addEventListener("click", async () => {
		if (!confirm("Clear all Sidekick settings, pins and history?")) return
		if (isExtension) await api.storage.clear().catch(() => {})
		$("saved").textContent = "All local data cleared."
	})
}

async function save(patch) {
	if (isExtension) await api.storage.set(patch).catch(() => {})
	$("saved").textContent = `Saved at ${new Date().toLocaleTimeString()}`
}

init().catch((error) => {
	$("env").textContent = `Failed to load settings: ${error.message}`
})
