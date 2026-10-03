import { coerceValues } from "../lib/registry.js"
import { stripHidden } from "./helpers.js"

const WORKER_TOOLS = new Set(["regex-tester", "text-diff", "json-to-ts", "csv-json"])
const TIMEOUT_MS = 3000

let worker = null
let pending = null
let sequence = 0
let workerBroken = false

function codedError(message, code) {
	const error = new Error(message)
	error.code = code
	return error
}

function kill() {
	worker?.terminate()
	worker = null
}

function settle(handler) {
	if (!pending) return
	const current = pending
	pending = null
	clearTimeout(current.timer)
	handler(current)
}

function onMessage(event) {
	if (!pending || event.data?.id !== pending.id) return
	settle((current) => (event.data.ok ? current.resolve(event.data.result) : current.reject(new Error(event.data.error))))
}

function onError(event) {
	event.preventDefault?.()
	workerBroken = true
	kill()
	settle((current) => current.reject(codedError("Worker unavailable", "worker-unavailable")))
}

function getWorker() {
	if (!worker) {
		worker = new Worker(new URL("./tool-worker.js", import.meta.url), { type: "module" })
		worker.addEventListener("message", onMessage)
		worker.addEventListener("error", onError)
	}
	return worker
}

function runInWorker(toolId, values) {
	// A newer run supersedes the old one; restarting the worker also kills a stuck regex.
	if (pending) {
		settle((current) => current.reject(codedError("Superseded", "stale")))
		kill()
	}
	return new Promise((resolve, reject) => {
		const id = ++sequence
		const timer = setTimeout(() => {
			if (pending?.id !== id) return
			pending = null
			kill()
			reject(new Error(`Stopped after ${TIMEOUT_MS / 1000} s. The input is too expensive to process; for regular expressions look for nested quantifiers such as (a+)+.`))
		}, TIMEOUT_MS)
		pending = { id, resolve, reject, timer }
		try {
			getWorker().postMessage({ id, toolId, values })
		} catch {
			workerBroken = true
			settle((current) => current.reject(codedError("Worker unavailable", "worker-unavailable")))
		}
	})
}

function usesWorker(tool) {
	return !workerBroken && typeof Worker !== "undefined" && (tool.worker === true || WORKER_TOOLS.has(tool.id))
}

async function runInline(tool, values, extra) {
	const coerced = { ...stripHidden(tool, coerceValues(tool, values)), ...extra }
	return tool.run(coerced)
}

export async function runLocalTool(tool, values, extra = {}) {
	if (usesWorker(tool) && !Object.keys(extra).length) {
		try {
			return await runInWorker(tool.id, values)
		} catch (error) {
			if (error.code !== "worker-unavailable") throw error
		}
	}
	return runInline(tool, values, extra)
}
