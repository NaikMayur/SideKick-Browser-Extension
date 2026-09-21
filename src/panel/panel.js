import { pageTools } from "../tools/page-actions.js"

const runtime = typeof browser !== "undefined" && browser.devtools ? browser : chrome
const output = document.getElementById("output")
const status = document.getElementById("status")
const actions = document.getElementById("actions")

const AUDITS = ["audit-a11y", "audit-seo", "scan-links", "metrics", "zindex", "stack", "fonts", "colors", "console-log"]

function send(command) {
	return new Promise((resolve) => {
		const tabId = runtime.devtools?.inspectedWindow?.tabId
		if (!tabId) return resolve({ ok: false, error: "No inspected tab" })
		try {
			runtime.tabs.sendMessage(tabId, { type: command }, (response) => {
				const error = runtime.runtime.lastError
				resolve(error ? { ok: false, error: error.message } : (response ?? { ok: false, error: "No response" }))
			})
		} catch (error) {
			resolve({ ok: false, error: error.message })
		}
	})
}

async function run(command, label) {
	status.textContent = `Running ${label}…`
	const response = await send(command)
	output.textContent = response.ok
		? JSON.stringify(response.data ?? "Done", null, 2)
		: `Error: ${response.error}`
	status.textContent = response.ok ? `${label} complete` : `${label} failed`
}

for (const tool of pageTools) {
	const button = document.createElement("button")
	button.type = "button"
	button.textContent = tool.name
	button.title = tool.description
	button.addEventListener("click", () => run(tool.command, tool.name))
	actions.appendChild(button)
}

document.getElementById("refresh").addEventListener("click", async () => {
	status.textContent = "Running full audit sweep…"
	const report = {}
	for (const command of AUDITS) {
		const response = await send(command)
		report[command] = response.ok ? response.data : { error: response.error }
	}
	output.textContent = JSON.stringify(report, null, 2)
	status.textContent = "Full audit sweep complete"
})
