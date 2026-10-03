// Runs potentially slow local tools off the popup thread so a runaway regex can be terminated.
import { coerceValues, getTool } from "../lib/registry.js"
import { stripHidden } from "./helpers.js"

self.addEventListener("message", async (event) => {
	const { id, toolId, values } = event.data ?? {}
	try {
		const tool = getTool(toolId)
		const coerced = stripHidden(tool, coerceValues(tool, values ?? {}))
		const result = await tool.run(coerced)
		self.postMessage({ id, ok: true, result })
	} catch (error) {
		self.postMessage({ id, ok: false, error: error?.message ?? String(error) })
	}
})
