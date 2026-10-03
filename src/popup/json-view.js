import { el } from "./dom.js"

const TOKEN = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)/g
const HIGHLIGHT_LIMIT = 400 * 1024

export function highlightJson(jsonString) {
	const text = String(jsonString ?? "")
	const frag = document.createDocumentFragment()
	if (text.length > HIGHLIGHT_LIMIT) {
		frag.appendChild(document.createTextNode(text))
		return frag
	}
	let lastIndex = 0
	for (const match of text.matchAll(TOKEN)) {
		if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
		if (match[1] !== undefined) {
			frag.appendChild(el("span", "j-key", match[1]))
			frag.appendChild(document.createTextNode(match[0].slice(match[1].length)))
		} else if (match[2] !== undefined) frag.appendChild(el("span", "j-str", match[2]))
		else if (match[3] !== undefined) frag.appendChild(el("span", "j-num", match[3]))
		else if (match[4] !== undefined) frag.appendChild(el("span", "j-bool", match[4]))
		else frag.appendChild(el("span", "j-null", match[5]))
		lastIndex = match.index + match[0].length
	}
	if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
	return frag
}

export function jsonBlock(text, className = "out") {
	const pre = el("pre", `${className} code-block`)
	pre.tabIndex = 0
	pre.appendChild(highlightJson(text))
	return pre
}

function primitiveNode(value) {
	if (value === null) return el("span", "j-null", "null")
	if (typeof value === "string") return el("span", "j-str", JSON.stringify(value.length > 2000 ? `${value.slice(0, 2000)}…` : value))
	if (typeof value === "number") return el("span", "j-num", String(value))
	if (typeof value === "boolean") return el("span", "j-bool", String(value))
	return el("span", "", String(value))
}

function keyNode(key) {
	if (key === undefined) return null
	const node = el("span", "j-key", typeof key === "number" ? String(key) : JSON.stringify(key))
	return node
}

function treeNode(value, key, depth) {
	if (value === null || typeof value !== "object") {
		const row = el("div", "jt-row")
		const label = keyNode(key)
		if (label) row.append(label, document.createTextNode(": "))
		row.appendChild(primitiveNode(value))
		return row
	}
	const isArray = Array.isArray(value)
	const entries = isArray ? value.map((item, index) => [index, item]) : Object.entries(value)
	const details = el("details", "jt-node")
	const summary = el("summary", "jt-summary")
	const label = keyNode(key)
	if (label) summary.append(label, document.createTextNode(": "))
	summary.appendChild(el("span", "jt-type", isArray ? `[ ${entries.length} ]` : `{ ${entries.length} }`))
	details.appendChild(summary)
	let built = false
	// Children are built on first open so huge payloads stay cheap to display.
	const build = () => {
		if (built) return
		built = true
		const box = el("div", "jt-children")
		const limit = 500
		for (const [childKey, child] of entries.slice(0, limit)) box.appendChild(treeNode(child, childKey, depth + 1))
		if (entries.length > limit) box.appendChild(el("div", "jt-more", `… ${entries.length - limit} more`))
		details.appendChild(box)
	}
	details.addEventListener("toggle", () => details.open && build())
	if (depth < 1) {
		details.open = true
		build()
	}
	return details
}

export function jsonTree(value) {
	const wrap = el("div", "json-tree code-block")
	wrap.tabIndex = 0
	wrap.appendChild(treeNode(value, undefined, 0))
	return wrap
}
