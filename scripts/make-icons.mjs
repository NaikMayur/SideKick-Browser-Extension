// Generates PNG icons from logo.svg using headless Chrome or Edge.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const assets = join(root, "src", "assets")
const SIZES = [16, 32, 48, 128, 256]
const PORT = 9345

const CANDIDATES = [
	process.argv[2],
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/microsoft-edge",
].filter(Boolean)

// Adjust stroke and glyph details to keep small icons crisp.
function svgForSize(size) {
	const svg = readFileSync(join(assets, "logo.svg"), "utf8")
	if (size > 32) return svg
	const small = size === 16 ? svg.replace('<path d="M7 14h4"/>', "") : svg
	return small
		.replace('translate(25 25) scale(3.25)', 'translate(19 19) scale(3.75)')
		.replace('stroke-width="2.1"', `stroke-width="${size === 16 ? 2.9 : 2.5}"`)
		.replace(/<rect x="4\.75"[^>]*\/>/, "")
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connect(url) {
	const ws = new WebSocket(url)
	let id = 0
	const pending = new Map()
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data)
		pending.get(msg.id)?.(msg)
		pending.delete(msg.id)
	}
	const ready = new Promise((resolve) => (ws.onopen = resolve))
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			id += 1
			pending.set(id, resolve)
			ws.send(JSON.stringify({ id, method, params }))
		})
	return { ready, send, close: () => ws.close() }
}

const browserPath = CANDIDATES.find((path) => existsSync(path))
if (!browserPath) {
	console.error("No Chrome or Edge found; pass its path as the first argument")
	process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), "sidekick-icons-"))
const browser = spawn(browserPath, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "about:blank"], { stdio: "ignore" })

try {
	let page
	for (let i = 0; i < 40 && !page; i += 1) {
		await sleep(250)
		try {
			page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((target) => target.type === "page")
		} catch {}
	}
	if (!page) throw new Error("Browser did not start")
	const cdp = connect(page.webSocketDebuggerUrl)
	await cdp.ready
	await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } })
	for (const size of SIZES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false })
		const markup = svgForSize(size).replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)
		const html = `<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`
		await cdp.send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` })
		await sleep(300)
		const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } })
		writeFileSync(join(assets, `icon-${size}.png`), Buffer.from(shot.result.data, "base64"))
		console.error(`wrote icon-${size}.png`)
	}
	cdp.close()
} finally {
	browser.kill()
}
