/**
 * Dependency-free build: produces per-browser folders and zips in /dist.
 *   node scripts/build.mjs            -> chrome, firefox, edge, safari-resources
 * Chrome/Edge/Brave/Opera/Arc share the Chromium MV3 manifest.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { zipDirectory } from "./zip.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const src = join(root, "src")
const dist = join(root, "dist")

const TARGETS = [
	{ name: "chrome", manifest: "manifest.chrome.json" },
	{ name: "edge", manifest: "manifest.chrome.json" },
	{ name: "opera", manifest: "manifest.chrome.json" },
	{ name: "firefox", manifest: "manifest.firefox.json" },
	{ name: "safari-resources", manifest: "manifest.chrome.json" },
]

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version

for (const target of TARGETS) {
	const out = join(dist, target.name)
	cpSync(src, out, { recursive: true })
	const manifest = JSON.parse(readFileSync(join(out, target.manifest), "utf8"))
	manifest.version = version
	if (target.name === "safari-resources") delete manifest.side_panel
	writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
	rmSync(join(out, "manifest.chrome.json"), { force: true })
	rmSync(join(out, "manifest.firefox.json"), { force: true })
	zipDirectory(out, join(dist, `sidekick-${target.name}-${version}.zip`))
	console.warn(`built ${target.name}`)
}

if (!existsSync(join(src, "assets", "icon-128.png"))) {
	console.warn("warning: icons missing from src/assets")
}
console.warn(`\nBuild complete → ${dist}`)
