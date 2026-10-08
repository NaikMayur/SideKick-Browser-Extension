import { copyText, el, flashButton, icon, toast } from "./dom.js"
import { formatBytes, jsonText, mimeFromDataUrl, resultToText, sortRows, stripDataUrls, tableToCsv } from "./helpers.js"
import { jsonBlock, jsonTree } from "./json-view.js"
import { renderRichResult } from "./renderers.js"

const TABLE_ROW_LIMIT = 500
const REPORT_ITEM_LIMIT = 50
const TREE_THRESHOLD = 60 * 1024
const TONE_ICONS = { good: "check-circle", warn: "warning", bad: "error", info: "info" }
const TYPE_LABELS = { text: "Text", json: "JSON", table: "Table", image: "Image", report: "Report", "html-preview": "HTML" }

let preferRaw = false

function smallButton(label, iconName, onClick) {
	const node = el("button", "chip-btn")
	node.type = "button"
	if (iconName) node.appendChild(icon(iconName))
	node.appendChild(el("span", "btn-label", label))
	node.addEventListener("click", onClick)
	return node
}

function copyButton(label, getText, onStatus) {
	const node = smallButton(label, "copy", async () => {
		const ok = await copyText(getText())
		if (ok) flashButton(node)
		onStatus?.(ok ? "Copied to clipboard" : "Copy blocked by the browser")
	})
	return node
}

function textBlock(text) {
	const pre = el("pre", "out code-block", text)
	pre.tabIndex = 0
	return pre
}

function jsonVisual(value) {
	const text = jsonText(value)
	if (typeof value === "object" && value !== null && text.length > TREE_THRESHOLD) return jsonTree(stripDataUrls(value))
	return jsonBlock(text)
}

function cellText(cell) {
	if (cell === null || cell === undefined) return ""
	return typeof cell === "object" ? JSON.stringify(cell) : String(cell)
}

function renderTable(value, onStatus) {
	const columns = Array.isArray(value?.columns) ? value.columns : []
	const rows = Array.isArray(value?.rows) ? value.rows : []
	const wrap = el("div", "table-result")
	const bar = el("div", "result-toolbar")
	bar.appendChild(el("span", "mono-label", `${rows.length} rows · ${columns.length} cols`))
	bar.appendChild(copyButton("Copy CSV", () => tableToCsv(value), onStatus))
	const scroller = el("div", "table-scroll")
	const table = el("table", "data-table")
	const thead = el("thead")
	const headRow = el("tr")
	const tbody = el("tbody")
	const sort = { index: -1, dir: 1 }

	const fillBody = () => {
		const ordered = sort.index < 0 ? rows : sortRows(rows, sort.index, sort.dir)
		const frag = document.createDocumentFragment()
		for (const row of ordered.slice(0, TABLE_ROW_LIMIT)) {
			const tr = el("tr")
			for (let index = 0; index < Math.max(columns.length, 1); index++) {
				const text = cellText(Array.isArray(row) ? row[index] : row)
				const td = el("td", "", text)
				if (text.length > 60) td.title = text
				tr.appendChild(td)
			}
			frag.appendChild(tr)
		}
		tbody.replaceChildren(frag)
	}

	columns.forEach((column, index) => {
		const th = el("th")
		th.setAttribute("aria-sort", "none")
		const sortBtn = el("button", "th-btn")
		sortBtn.type = "button"
		sortBtn.append(el("span", "", column), icon("sort"))
		sortBtn.addEventListener("click", () => {
			sort.dir = sort.index === index ? -sort.dir : 1
			sort.index = index
			for (const cell of headRow.children) cell.setAttribute("aria-sort", "none")
			th.setAttribute("aria-sort", sort.dir === 1 ? "ascending" : "descending")
			fillBody()
		})
		th.appendChild(sortBtn)
		headRow.appendChild(th)
	})
	thead.appendChild(headRow)
	table.append(thead, tbody)
	fillBody()
	scroller.appendChild(table)
	wrap.append(bar, scroller)
	if (rows.length > TABLE_ROW_LIMIT) wrap.appendChild(el("p", "result-note", `Showing the first ${TABLE_ROW_LIMIT} of ${rows.length} rows. Copy CSV or Save include everything.`))
	return wrap
}

async function copyImage(dataUrl, onStatus) {
	try {
		const blob = await (await fetch(dataUrl)).blob()
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
		onStatus?.("Image copied to clipboard")
		return true
	} catch {
		onStatus?.("This browser cannot copy that image format, use Save instead")
		return false
	}
}

function renderImage(value, onStatus) {
	const figure = el("figure", "image-result")
	const stage = el("div", "checker")
	if (value?.dataUrl) {
		const img = el("img")
		img.src = value.dataUrl
		img.alt = "Result image"
		img.decoding = "async"
		stage.appendChild(img)
	}
	const caption = el("figcaption", "kv-list")
	const meta = { Size: `${value?.width ?? "?"} × ${value?.height ?? "?"} px`, Type: value?.dataUrl ? mimeFromDataUrl(value.dataUrl) : "n/a", ...(value?.meta ?? {}) }
	for (const [label, item] of Object.entries(meta)) {
		const row = el("div", "kv")
		row.append(el("span", "kv-k", label), el("span", "kv-v mono", String(item)))
		caption.appendChild(row)
	}
	figure.append(stage, caption)
	const actions = el("div", "result-toolbar")
	if (value?.dataUrl && mimeFromDataUrl(value.dataUrl) === "image/png") {
		const btn = smallButton("Copy image", "copy", async () => {
			if (await copyImage(value.dataUrl, onStatus)) flashButton(btn)
		})
		actions.appendChild(btn)
	}
	for (const file of value?.files ?? []) {
		const link = el("a", "chip-btn")
		link.href = file.dataUrl
		link.download = file.name
		link.append(icon("download"), el("span", "", file.name))
		actions.appendChild(link)
	}
	if (actions.childElementCount) figure.appendChild(actions)
	return figure
}

function reportItem(item, onHighlight) {
	const tone = TONE_ICONS[item.tone] ? item.tone : "info"
	const li = el("li", `report-item tone-${tone}`)
	li.appendChild(icon(TONE_ICONS[tone], "tone-icon"))
	const body = el("div", "report-text")
	body.appendChild(el("div", "report-label", item.label ?? ""))
	if (item.detail) body.appendChild(el("div", "report-detail", item.detail))
	if (item.selector) {
		const line = el("div", "report-selector")
		line.appendChild(el("code", "mono", item.selector))
		const btn = el("button", "chip-btn")
		btn.type = "button"
		btn.append(icon("target"), el("span", "", "Highlight"))
		btn.addEventListener("click", () => onHighlight?.(item.selector))
		line.appendChild(btn)
		body.appendChild(line)
	}
	li.appendChild(body)
	return li
}

function reportSection(section, onHighlight) {
	const items = section.items ?? []
	const box = el("section", "report-section")
	const head = el("header", "report-head")
	head.append(el("h4", "", section.title ?? "Section"), el("span", "count mono", String(items.length)))
	box.appendChild(head)
	if (!items.length) {
		box.appendChild(el("p", "result-note", "Nothing found."))
		return box
	}
	const list = el("ul", "report-items")
	for (const item of items.slice(0, REPORT_ITEM_LIMIT)) list.appendChild(reportItem(item, onHighlight))
	box.appendChild(list)
	if (items.length > REPORT_ITEM_LIMIT) {
		const more = el("button", "link-btn", `Show ${items.length - REPORT_ITEM_LIMIT} more`)
		more.type = "button"
		more.addEventListener("click", () => {
			for (const item of items.slice(REPORT_ITEM_LIMIT)) list.appendChild(reportItem(item, onHighlight))
			more.remove()
		})
		box.appendChild(more)
	}
	return box
}

function renderReport(value, onHighlight) {
	const wrap = el("div", "report")
	if (value?.summary?.length) {
		const pills = el("div", "summary-pills")
		for (const pill of value.summary) {
			const tone = TONE_ICONS[pill.tone] ? pill.tone : "info"
			const long = String(pill.value ?? "").length > 14
			const node = el("div", `summary-pill tone-${tone}${long ? " is-long" : ""}`)
			node.append(el("strong", "", String(pill.value ?? "")), el("span", "", pill.label ?? ""))
			pills.appendChild(node)
		}
		wrap.appendChild(pills)
	}
	for (const section of value?.sections ?? []) wrap.appendChild(reportSection(section, onHighlight))
	return wrap
}

function renderHtmlPreview(value) {
	const frame = el("iframe", "html-frame")
	// An empty sandbox blocks scripts, forms, popups and same origin access.
	frame.setAttribute("sandbox", "")
	frame.setAttribute("referrerpolicy", "no-referrer")
	frame.title = "Rendered preview"
	frame.srcdoc = String(value?.html ?? "")
	return frame
}

function visualFor(result, ctx) {
	const { type, value } = result
	if (type === "text" || type === "json") {
		const custom = renderRichResult(ctx.toolId, value, ctx.onStatus, ctx.onHighlight)
		if (custom) return custom
	}
	if (type === "table") return renderTable(value, ctx.onStatus)
	if (type === "image") return renderImage(value, ctx.onStatus)
	if (type === "report") return renderReport(value, ctx.onHighlight)
	if (type === "html-preview") return renderHtmlPreview(value)
	return null
}

function rawFor(result) {
	if (result.type === "html-preview") return textBlock(String(result.value?.source ?? result.value?.html ?? ""))
	if (result.type === "json") return jsonVisual(result.value)
	return textBlock(resultToText(result))
}

function metaFor(result) {
	if (typeof result.meta === "string" && result.meta) return result.meta
	if (result.type === "table") return `${result.value?.rows?.length ?? 0} rows`
	if (result.type === "image") return `${result.value?.width ?? "?"}×${result.value?.height ?? "?"}`
	const text = resultToText(result)
	return formatBytes(new TextEncoder().encode(text).length)
}

function segmented(labels, onPick, rawFirst) {
	const seg = el("div", "seg")
	seg.setAttribute("role", "group")
	seg.setAttribute("aria-label", "Result view")
	const buttons = labels.map((label, index) => {
		const btn = el("button", "seg-btn", label)
		btn.type = "button"
		btn.addEventListener("click", () => {
			buttons.forEach((other, otherIndex) => other.setAttribute("aria-pressed", String(otherIndex === index)))
			onPick(index === 1)
		})
		seg.appendChild(btn)
		return btn
	})
	buttons.forEach((btn, index) => btn.setAttribute("aria-pressed", String(index === (rawFirst ? 1 : 0))))
	return seg
}

export function renderResult(container, result, ctx = {}) {
	const card = el("section", "result")
	card.setAttribute("aria-label", "Result")
	const head = el("div", "result-head")
	head.append(el("span", "eyebrow", "Output"), el("span", "tag", TYPE_LABELS[result.type] ?? result.type), el("span", "result-meta", metaFor(result)))
	card.appendChild(head)
	if (typeof result.note === "string" && result.note) card.appendChild(el("p", "result-note", result.note))

	let visual = null
	try {
		visual = visualFor(result, ctx)
	} catch {
		visual = null
	}
	if (!visual) {
		card.appendChild(rawFor(result))
		container.replaceChildren(card)
		return card
	}

	const visualBox = el("div", "result-body")
	visualBox.appendChild(visual)
	const rawBox = el("div", "result-body")
	let rawBuilt = false
	const show = (raw) => {
		preferRaw = raw
		if (raw && !rawBuilt) {
			rawBox.appendChild(rawFor(result))
			rawBuilt = true
		}
		visualBox.hidden = raw
		rawBox.hidden = !raw
	}
	const labels = result.type === "html-preview" ? ["Preview", "Source"] : ["Visual", "Raw"]
	head.appendChild(segmented(labels, show, preferRaw))
	card.append(visualBox, rawBox)
	show(preferRaw)
	container.replaceChildren(card)
	return card
}

export function renderMessage(container, { tone = "info", title, detail, hint, iconName }) {
	const box = el("div", `callout tone-${tone}`)
	box.setAttribute("role", tone === "bad" ? "alert" : "status")
	box.appendChild(icon(iconName ?? TONE_ICONS[tone] ?? "info", "callout-icon"))
	const body = el("div", "callout-body")
	if (title) body.appendChild(el("strong", "callout-title", title))
	if (detail) body.appendChild(el("p", "callout-detail", detail))
	if (hint) body.appendChild(el("p", "callout-hint", hint))
	box.appendChild(body)
	container.replaceChildren(box)
	return box
}

export function renderIdle(container, { live, page, hasInputs }) {
	const box = el("div", "idle")
	box.appendChild(icon(page ? "cursor" : live ? "zap" : "play", "idle-icon"))
	let text = "Press Run to see the output here."
	if (page) text = "Runs on the current tab. Press Run, then look at the page."
	else if (live) text = hasInputs ? "Results update as you type." : "Press Run to generate."
	box.appendChild(el("p", "", text))
	const keys = el("p", "kbd-hint")
	keys.append(el("kbd", "", "Ctrl"), document.createTextNode(" + "), el("kbd", "", "Enter"), document.createTextNode(" to run"))
	box.appendChild(keys)
	container.replaceChildren(box)
}

export function toastCopy(ok) {
	toast(ok ? "Copied to clipboard" : "Copy blocked, select the text manually", ok ? "good" : "bad")
}
