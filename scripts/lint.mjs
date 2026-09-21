/**
 * Dependency-free static checks:
 *  - every source file parses as valid JS/JSON
 *  - manifests stay in sync (name, version, permissions)
 *  - no leftover debugging statements or TODOs in shipped code
 *  - every file referenced by a manifest actually exists
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = fileURLToPath(new URL("..", import.meta.url))
const src = join(root, "src")
const problems = []

function walk(dir) {
	const out = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) out.push(...walk(full))
		else out.push(full)
	}
	return out
}

const files = walk(src)

for (const file of files) {
	const ext = extname(file)
	if (ext !== ".json" && ext !== ".js" && ext !== ".html") continue
	const text = readFileSync(file, "utf8")
	if (ext === ".json") {
		try {
			JSON.parse(text)
		} catch (error) {
			problems.push(`${file}: invalid JSON - ${error.message}`)
		}
	}
	if (ext === ".js") {
		if (/console\.log\(/.test(text) && !file.includes("panel")) problems.push(`${file}: stray console.log`)
		if (/\bdebugger\b/.test(text)) problems.push(`${file}: stray debugger statement`)
		if (/TODO|FIXME/.test(text)) problems.push(`${file}: unresolved TODO/FIXME`)
		if (/\beval\(|new Function\(/.test(text)) problems.push(`${file}: eval/new Function violates MV3 CSP`)
	}
	if (ext === ".html" && /<script(?![^>]*src=)/.test(text)) {
		problems.push(`${file}: inline <script> violates MV3 CSP`)
	}
}

// Pure layers must import cleanly in Node (catches broken exports at runtime).
const importable = files.filter((f) => f.endsWith(".js") && (/[\\/]lib[\\/]/.test(f) || /[\\/]tools[\\/]/.test(f)))
for (const file of importable) {
	try {
		await import(pathToFileURL(file).href)
	} catch (error) {
		problems.push(`${file}: failed to import - ${error.message}`)
	}
}

// UI and content entry points touch document/chrome, so they are parsed, never executed.
for (const file of files.filter((f) => f.endsWith(".js") && !importable.includes(f))) {
	try {
		execFileSync(process.execPath, ["--input-type=module", "--check"], {
			input: readFileSync(file, "utf8"),
			stdio: ["pipe", "pipe", "pipe"],
		})
	} catch (error) {
		const message = String(error.stderr ?? error.message).split("\n").find((line) => /Error/.test(line))
		problems.push(`${file}: syntax error - ${message ?? "parse failed"}`)
	}
}

// Manifest consistency + referenced-file existence.
const chrome = JSON.parse(readFileSync(join(src, "manifest.chrome.json"), "utf8"))
const firefox = JSON.parse(readFileSync(join(src, "manifest.firefox.json"), "utf8"))
if (chrome.version !== firefox.version) problems.push("manifest version mismatch between Chrome and Firefox")
if (chrome.name !== firefox.name) problems.push("manifest name mismatch")
for (const permission of chrome.permissions) {
	if (!firefox.permissions.includes(permission)) problems.push(`Firefox manifest missing permission: ${permission}`)
}

const referenced = new Set(
	[
		chrome.action.default_popup,
		chrome.devtools_page,
		chrome.options_ui?.page,
		chrome.background.service_worker,
		...chrome.content_scripts.flatMap((cs) => [...cs.js, ...cs.css]),
		...Object.values(chrome.icons ?? {}),
	].filter(Boolean),
)
for (const path of referenced) {
	if (!existsSync(join(src, path))) problems.push(`manifest references missing file: ${path}`)
}

if (problems.length) {
	for (const problem of problems) console.error(`  x ${problem}`)
	console.error(`\nLint failed with ${problems.length} problem(s)`)
	process.exit(1)
}
console.error(`Lint passed: ${files.length} files checked`)
