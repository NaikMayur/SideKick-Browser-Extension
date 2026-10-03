// Small DOM helpers shared by the popup, renderers and options page.

const SVG_NS = "http://www.w3.org/2000/svg"
export const SPRITE_URL = "../assets/icons.svg"

export function el(tag, className, text) {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined && text !== null) node.textContent = String(text)
	return node
}

export function icon(name, className = "") {
	const svg = document.createElementNS(SVG_NS, "svg")
	svg.setAttribute("class", `i ${className}`.trim())
	svg.setAttribute("aria-hidden", "true")
	svg.setAttribute("focusable", "false")
	const use = document.createElementNS(SVG_NS, "use")
	use.setAttribute("href", `${SPRITE_URL}#i-${name}`)
	svg.appendChild(use)
	return svg
}

export function setIcon(svg, name) {
	svg?.querySelector("use")?.setAttribute("href", `${SPRITE_URL}#i-${name}`)
}

export function button(label, { iconName, className = "btn", title, type = "button" } = {}) {
	const node = el("button", className)
	node.type = type
	if (iconName) node.appendChild(icon(iconName))
	if (label) node.appendChild(el("span", "btn-label", label))
	if (title) {
		node.title = title
		if (!label) node.setAttribute("aria-label", title)
	}
	return node
}

export function setButtonLabel(node, label) {
	const span = node.querySelector(".btn-label")
	if (span) span.textContent = label
	else node.textContent = label
}

export function flashButton(node, label = "Copied", ms = 1200) {
	const span = node.querySelector(".btn-label")
	const target = span ?? node
	const previous = target.textContent
	target.textContent = label
	node.classList.add("is-done")
	setTimeout(() => {
		target.textContent = previous
		node.classList.remove("is-done")
	}, ms)
}

export async function copyText(text) {
	try {
		await navigator.clipboard.writeText(String(text ?? ""))
		return true
	} catch {
		const area = el("textarea")
		area.value = String(text ?? "")
		area.setAttribute("readonly", "")
		area.style.position = "fixed"
		area.style.opacity = "0"
		document.body.appendChild(area)
		area.select()
		let ok = false
		try {
			ok = document.execCommand("copy")
		} catch {
			ok = false
		}
		area.remove()
		return ok
	}
}

export function downloadFile({ filename, mime = "text/plain", text, dataUrl, blob }) {
	const link = document.createElement("a")
	link.download = filename
	let objectUrl = null
	if (blob) objectUrl = URL.createObjectURL(blob)
	else if (!dataUrl) objectUrl = URL.createObjectURL(new Blob([text ?? ""], { type: mime }))
	link.href = objectUrl ?? dataUrl
	document.body.appendChild(link)
	link.click()
	link.remove()
	if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
}

let toastTimer = null

export function toast(message, tone = "info") {
	let node = document.getElementById("toast")
	if (!node) {
		node = el("div", "toast")
		node.id = "toast"
		node.setAttribute("role", "status")
		document.body.appendChild(node)
	}
	node.replaceChildren(icon(tone === "bad" ? "error" : tone === "warn" ? "warning" : "check"), el("span", "", message))
	node.dataset.tone = tone
	node.classList.add("show")
	clearTimeout(toastTimer)
	toastTimer = setTimeout(() => node.classList.remove("show"), 1800)
}

export function debounce(fn, ms) {
	let timer = null
	const wrapped = (...args) => {
		clearTimeout(timer)
		timer = setTimeout(() => fn(...args), ms)
	}
	wrapped.cancel = () => clearTimeout(timer)
	return wrapped
}

export function applyTheme(mode) {
	const dark = mode === "dark" || (mode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
	document.documentElement.dataset.theme = dark ? "dark" : "light"
	document.documentElement.dataset.themeMode = mode ?? "system"
	try {
		localStorage.setItem("sk-theme", mode ?? "system")
	} catch {
		// storage unavailable; theme still applies for this view
	}
}
