import { pageTools } from "../tools/page-actions.js"

const runtime = typeof browser !== "undefined" && browser.devtools ? browser : chrome
const output = document.getElementById("output")
const status = document.getElementById("status")

// Read only audits that return data; the rest toggle overlays on the inspected page.
const AUDITS = new Set(["audit-a11y", "audit-seo", "scan-links", "security-check", "image-audit", "metrics", "zindex", "stack", "fonts", "colors", "console-log", "scan-animations"])
// Tools that need popup only interaction (file pickers, region drawing) stay out of the panel.
const SKIP = new Set(["snip", "fill-form", "eyedropper"])

// The service worker relays to the inspected tab and injects the content script on demand.
function send(command, payload = {}) {
	const tabId = runtime.devtools?.inspectedWindow?.tabId
	if (!tabId) return Promise.resolve({ ok: false, error: "No inspected tab" })
	try {
		return Promise.resolve(runtime.runtime.sendMessage({ type: "relay", tabId, command, payload })).then(
			(response) => response ?? { ok: false, error: "No response" },
			(error) => ({ ok: false, error: error?.message ?? String(error) }),
		)
	} catch (error) {
		return Promise.resolve({ ok: false, error: error.message })
	}
}

function show(value) {
	output.classList.remove("error")
	output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

async function run(tool, button) {
	button.setAttribute("aria-busy", "true")
	status.textContent = `Running ${tool.name}…`
	const response = await send(tool.command)
	button.removeAttribute("aria-busy")
	if (response.ok) show(response.data ?? "Done")
	else {
		output.textContent = `Error: ${response.error}`
		output.classList.add("error")
	}
	status.textContent = response.ok ? `${tool.name} complete` : `${tool.name} failed`
}

for (const tool of pageTools) {
	if (SKIP.has(tool.command)) continue
	const button = document.createElement("button")
	button.type = "button"
	button.textContent = tool.name
	button.title = tool.description
	button.addEventListener("click", () => run(tool, button))
	document.getElementById(AUDITS.has(tool.command) ? "audits" : "overlays").appendChild(button)
}

document.getElementById("refresh").addEventListener("click", async () => {
	status.textContent = "Running all audits…"
	const report = {}
	for (const tool of pageTools.filter((item) => AUDITS.has(item.command))) {
		const response = await send(tool.command)
		report[tool.id] = response.ok ? response.data : { error: response.error }
	}
	show(report)
	status.textContent = "All audits complete"
})

document.getElementById("copy").addEventListener("click", async () => {
	try {
		await navigator.clipboard.writeText(output.textContent)
		status.textContent = "Output copied"
	} catch {
		status.textContent = "Copy failed, select the output and copy manually"
	}
})
