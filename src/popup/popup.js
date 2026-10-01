import { api, isExtension, sendToPage } from "../lib/browser.js"
import { ROLES, coerceValues, getTool, runTool, searchTools } from "../lib/registry.js"
import { debounce } from "../lib/utils.js"
import { computeResize, parseQuality, humanSize, buildPdfFromRgb, compressToTargetSize, findOptimalQuality, FORMAT_MIME, FORMAT_LABELS } from "../tools/image.js"
import { renderRichResult } from "./renderers.js"

const $ = (id) => document.getElementById(id)
const ui = {
	main: $("main"),
	search: $("search"),
	role: $("role"),
	list: $("list"),
	empty: $("empty"),
	listView: $("list-view"),
	detailView: $("detail-view"),
	name: $("tool-name"),
	desc: $("tool-desc"),
	form: $("form"),
	run: $("run"),
	copy: $("copy"),
	download: $("download"),
	pin: $("pin"),
	back: $("back"),
	closeTool: $("close-tool"),
	richOutput: $("rich-output"),
	output: $("output"),
	error: $("error"),
	status: $("status"),
	theme: $("theme"),
	popout: $("popout"),
	options: $("options-link"),
	tabAll: $("tab-all"),
	tabWorkflows: $("tab-workflows"),
	tabPage: $("tab-page"),
	tabUtils: $("tab-utils"),
}

const CORE_WORKFLOWS = new Set([
	"image-converter",
	"snipping-tool",
	"inspect-element",
	"edit-mode",
	"form-filler",
	"eyedropper",
	"json-format",
	"text-diff",
	"jwt-decode",
	"color-report",
	"contrast-checker",
	"tech-stack",
	"seo-audit",
	"a11y-audit",
	"page-metrics",
	"link-check",
	"grid-overlay",
	"outline-all",
	"viewport-resize",
	"storage-inspector",
])

let activeTab = "all"
let current = null
let cursor = 0
let pinned = []
let lastOutput = ""
let savedListScrollTop = 0
let lastOpenedToolId = null
let lastViewportSig = null

init().catch((error) => setStatus(`Startup error: ${error.message}`))

async function init() {
	ui.role.innerHTML = ""
	ui.role.append(new Option("All roles", "all"))
	for (const [value, label] of Object.entries(ROLES)) ui.role.append(new Option(label, value))

	const saved = isExtension ? await api.storage.get(["theme", "role", "pinned", "lastActiveToolId"]).catch(() => ({})) : {}
	applyTheme(saved.theme ?? "system")
	ui.role.value = saved.role ?? "all"
	pinned = Array.isArray(saved.pinned) ? saved.pinned : []

	const isPopoutMode = window.location.search.includes("mode=window")
	if (isPopoutMode && ui.popout) {
		ui.popout.style.display = "none"
	} else if (ui.popout) {
		ui.popout.addEventListener("click", async () => {
			if (!isExtension) return
			try {
				await api.windows.create({
					url: api.runtime.getURL("popup/popup.html?mode=window"),
					type: "popup",
					width: 440,
					height: 720,
				})
				window.close()
			} catch (err) {
				setStatus(`Popout failed: ${err.message}`)
			}
		})
	}

	render()

	let resumeToolId = null
	if (isExtension) {
		try {
			const activeStatus = await sendToPage({ type: "active-tools-query" })
			if (activeStatus?.ok && activeStatus?.data) {
				const d = activeStatus.data
				if (d.viewport || d.deviceFrame?.active) {
					resumeToolId = "viewport-resize"
				} else if (d.inspect) {
					resumeToolId = "inspect-element"
				} else if (d.edit) {
					resumeToolId = "edit-mode"
				} else if (d.grid) {
					resumeToolId = "grid-overlay"
				} else if (d.outline) {
					resumeToolId = "outline-all"
				}
			}
		} catch {}
	}
	if (!resumeToolId && saved.lastActiveToolId && getTool(saved.lastActiveToolId)) {
		resumeToolId = saved.lastActiveToolId
	}

	if (resumeToolId && getTool(resumeToolId)) {
		openTool(resumeToolId)
	} else {
		ui.search.focus()
	}

	ui.main?.addEventListener("scroll", () => {
		if (!ui.listView.hidden) {
			savedListScrollTop = ui.main.scrollTop
		}
	}, { passive: true })

	ui.search.addEventListener("input", debounce(render, 80))
	ui.role.addEventListener("change", async () => {
		await persist({ role: ui.role.value })
		render()
	})
	ui.search.addEventListener("keydown", onListKeys)
	ui.back.addEventListener("click", () => showList(false))
	ui.closeTool?.addEventListener("click", () => {
		showList(true)
	})
	ui.run.addEventListener("click", execute)
	ui.copy.addEventListener("click", copyOutput)
	ui.download.addEventListener("click", saveOutput)
	ui.pin.addEventListener("click", togglePin)
	ui.theme.addEventListener("click", cycleTheme)
	ui.options.addEventListener("click", (event) => {
		event.preventDefault()
		if (isExtension) api.tabs.create({ url: api.runtime.getURL("options/options.html") })
	})
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !ui.detailView.hidden) showList(false)
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !ui.detailView.hidden) execute()
	})

	if (isExtension && api?.runtime?.onMessage) {
		api.runtime.onMessage.addListener((message) => {
			if (message?.type === "devkit:viewport-update" && current?.id === "viewport-resize") {
				const p = message.payload
				const sig = `${p?.enabled}:${p?.width}:${p?.height}:${p?.dpr}`
				if (sig !== lastViewportSig) {
					lastViewportSig = sig
					succeed(p, false)
				}
			}
			if (message?.type === "devkit:device-frame-update" && current?.id === "viewport-resize") {
				if (typeof window.__onDeviceFrameUpdate === "function") {
					window.__onDeviceFrameUpdate(message.payload)
				}
			}
		})
	}

	window.addEventListener("resize", debounce(async () => {
		if (current?.id === "viewport-resize") {
			try {
				const res = await sendToPage({ type: "viewport-query" })
				if (res?.ok && res?.data) {
					const p = res.data
					const sig = `${p?.enabled}:${p?.width}:${p?.height}:${p?.dpr}`
					if (sig !== lastViewportSig) {
						lastViewportSig = sig
						succeed(p, false)
					}
				}
			} catch {}
		}
	}, 200))

	const tabs = [
		{ btn: ui.tabAll, id: "all" },
		{ btn: ui.tabWorkflows, id: "workflows" },
		{ btn: ui.tabPage, id: "page" },
		{ btn: ui.tabUtils, id: "utils" },
	]
	for (const tab of tabs) {
		tab.btn?.addEventListener("click", () => {
			activeTab = tab.id
			for (const t of tabs) {
				t.btn?.classList.toggle("active", t.id === activeTab)
				t.btn?.setAttribute("aria-selected", String(t.id === activeTab))
			}
			render()
		})
	}
}

function persist(patch) {
	if (!isExtension) return Promise.resolve()
	return api.storage.set(patch).catch(() => {})
}

function applyTheme(mode) {
	const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
	document.documentElement.dataset.theme = dark ? "dark" : "light"
	document.documentElement.dataset.themeMode = mode
}

async function cycleTheme() {
	const order = ["system", "light", "dark"]
	const next = order[(order.indexOf(document.documentElement.dataset.themeMode ?? "system") + 1) % order.length]
	applyTheme(next)
	await persist({ theme: next })
	setStatus(`Theme: ${next}`)
}

function render() {
	const results = searchTools(ui.search.value, ui.role.value)
	const filtered = results.filter((tool) => {
		if (activeTab === "workflows") return CORE_WORKFLOWS.has(tool.id)
		if (activeTab === "page") return tool.surface === "page"
		if (activeTab === "utils") return tool.surface !== "page"
		return true
	})
	const sorted = [...filtered].sort((a, b) => {
		const pinA = pinned.includes(a.id)
		const pinB = pinned.includes(b.id)
		if (pinA !== pinB) return Number(pinB) - Number(pinA)
		const wfA = CORE_WORKFLOWS.has(a.id)
		const wfB = CORE_WORKFLOWS.has(b.id)
		if (wfA !== wfB) return Number(wfB) - Number(wfA)
		return 0
	})
	ui.list.innerHTML = ""
	ui.empty.hidden = sorted.length > 0
	cursor = 0

	let group = null
	sorted.forEach((tool, index) => {
		const isWf = CORE_WORKFLOWS.has(tool.id)
		const isPin = pinned.includes(tool.id)
		let label
		if (isPin) {
			label = "Pinned"
		} else if (activeTab === "workflows") {
			label = "★ Core Workflows"
		} else if (activeTab === "page") {
			label = "Active Tab Tools"
		} else if (activeTab === "utils") {
			label = "Utilities"
		} else if (isWf) {
			label = "★ Core Workflows"
		} else {
			label = "All Tools & Utilities"
		}
		if (label !== group) {
			group = label
			const heading = document.createElement("div")
			heading.className = "group-title"
			heading.textContent = label
			ui.list.appendChild(heading)
		}
		const button = document.createElement("button")
		button.type = "button"
		button.className = "tool"
		button.setAttribute("role", "option")
		button.dataset.index = String(index)
		button.dataset.id = tool.id
		button.innerHTML = "<div class=\"tool-header\"><strong></strong><span class=\"tool-badge\"></span></div><span class=\"tool-desc\"></span>"
		button.querySelector("strong").textContent = `${isPin ? "★ " : ""}${tool.name}`
		button.querySelector(".tool-desc").textContent = tool.description
		const badgeEl = button.querySelector(".tool-badge")
		badgeEl.textContent = isWf ? "★ Workflow" : tool.category
		if (isWf) badgeEl.style.cssText = "background: rgba(37,99,235,0.18); color: var(--accent); font-weight: 700;"
		button.addEventListener("click", () => openTool(tool.id))
		ui.list.appendChild(button)
	})
	highlightCursor()
	setStatus(`${sorted.length} tool${sorted.length === 1 ? "" : "s"}`)
}

function items() {
	return [...ui.list.querySelectorAll(".tool")]
}

function highlightCursor() {
	const all = items()
	all.forEach((node, index) => node.classList.toggle("active", index === cursor))
	all[cursor]?.scrollIntoView({ block: "nearest" })
}

function onListKeys(event) {
	const all = items()
	if (!all.length) return
	if (event.key === "ArrowDown") {
		event.preventDefault()
		cursor = (cursor + 1) % all.length
		highlightCursor()
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		cursor = (cursor - 1 + all.length) % all.length
		highlightCursor()
	} else if (event.key === "Enter") {
		event.preventDefault()
		openTool(all[cursor].dataset.id)
	}
}

function showList(stopTools = false) {
	current = null
	lastViewportSig = null
	if (isExtension) {
		api.storage.remove("lastActiveToolId").catch(() => {})
	}
	ui.detailView.hidden = true
	ui.listView.hidden = false

	if (ui.main) {
		ui.main.scrollTop = savedListScrollTop
		requestAnimationFrame(() => {
			if (ui.main) ui.main.scrollTop = savedListScrollTop
		})
		setTimeout(() => {
			if (ui.main && !ui.listView.hidden) ui.main.scrollTop = savedListScrollTop
		}, 10)
	}

	if (lastOpenedToolId) {
		const all = items()
		const idx = all.findIndex((btn) => btn.dataset.id === lastOpenedToolId)
		if (idx >= 0) {
			cursor = idx
			all.forEach((node, index) => node.classList.toggle("active", index === cursor))
		}
	}

	ui.search.focus({ preventScroll: true })
	if (isExtension && stopTools) {
		sendToPage({ type: "stop-tool" }).catch(() => {})
	}
}

function openTool(id) {
	lastViewportSig = null
	if (ui.main && !ui.listView.hidden) {
		savedListScrollTop = ui.main.scrollTop
	}
	lastOpenedToolId = id
	if (isExtension) {
		api.storage.set({ lastActiveToolId: id }).catch(() => {})
	}
	const tool = getTool(id)
	current = tool
	ui.listView.hidden = true
	ui.detailView.hidden = false
	ui.name.textContent = tool.name
	ui.desc.textContent = tool.description
	ui.output.textContent = ""
	if (ui.richOutput) {
		ui.richOutput.innerHTML = ""
		ui.richOutput.hidden = true
	}
	ui.output.hidden = false
	ui.error.hidden = true
	ui.pin.textContent = pinned.includes(id) ? "Unpin" : "Pin"
	ui.run.textContent = tool.surface === "page" ? "Run on page" : "Run"
	ui.form.innerHTML = ""

	for (const input of tool.inputs ?? []) {
		const wrap = document.createElement("div")
		wrap.className = `field ${input.type === "checkbox" ? "checkbox" : ""}`
		const label = document.createElement("label")
		label.textContent = input.label
		label.htmlFor = `f-${input.key}`
		let field
		if (input.type === "file") {
			field = document.createElement("input")
			field.type = "file"
			if (input.accept) field.accept = input.accept
		} else if (input.type === "textarea") field = document.createElement("textarea")
		else if (input.type === "select") {
			field = document.createElement("select")
			for (const option of input.options ?? []) field.append(new Option(option, option))
		} else {
			field = document.createElement("input")
			field.type = input.type === "number" ? "number" : "text"
		}
		field.id = `f-${input.key}`
		field.name = input.key
		if (input.placeholder) field.placeholder = input.placeholder
		if (input.type === "checkbox") {
			field = document.createElement("input")
			field.type = "checkbox"
			field.id = `f-${input.key}`
			field.name = input.key
			field.checked = Boolean(input.default)
			wrap.append(field, label)
		} else {
			if (input.default !== undefined) field.value = String(input.default)
			wrap.append(label, field)
		}
		ui.form.appendChild(wrap)
	}

	if (id === "viewport-resize") {
		checkAndShowActiveViewport()
	}

	;(ui.form.querySelector("textarea, input, select") ?? ui.run).focus()
}

async function checkAndShowActiveViewport() {
	try {
		const [vRes, fRes] = await Promise.all([
			sendToPage({ type: "viewport-query" }).catch(() => null),
			sendToPage({ type: "device-frame-query" }).catch(() => null),
		])
		if (vRes?.ok && vRes?.data) {
			const isVpActive = vRes.data.enabled !== false
			const isFrameActive = fRes?.ok && fRes?.data?.active
			if (isVpActive || isFrameActive) {
				succeed(vRes.data, false)
				ui.run.textContent = "Refresh Viewport"
				setStatus(isFrameActive ? "In-page device frame active" : "Viewport HUD active on page")
			}
		}
	} catch {}
}

function readForm() {
	const values = {}
	for (const field of ui.form.querySelectorAll("input, select, textarea")) {
		if (field.type === "file") {
			values[field.name] = field.files?.[0] ?? null
		} else {
			values[field.name] = field.type === "checkbox" ? field.checked : field.value
		}
	}
	return values
}

async function execute() {
	if (!current) return
	ui.error.hidden = true
	setStatus("Running…")
	ui.run.disabled = true
	try {
		if (current.id === "image-converter") {
			return await executeImageConverter()
		}

		if (current.id === "eyedropper") {
			const response = await sendToPage({ type: "eyedropper" })
			if (!response.ok) return fail(response.error ?? "Page command failed")
			setStatus("Eyedropper active on page")
			return succeed(response.data ?? "Color eyedropper active on page", true)
		}

		if (current.id === "snipping-tool") {
			const formValues = readForm()
			const mode = formValues.mode || "Visible tab"
			if (mode === "Freeform region") {
				setStatus("Draw a region on the page…")
			}
			const response = await sendToPage({ type: "snip", payload: formValues })
			if (!response.ok) return fail(response.error ?? "Screenshot capture failed")
			return succeed(response.data ?? "Screenshot captured", true)
		}

		if (current.surface === "page") {
			const formValues = readForm()
			let payload = formValues
			if (current.id === "viewport-resize") {
				payload = { ...formValues, enable: true }
			}
			const response = await sendToPage({ type: current.command, payload })
			if (!response.ok) return fail(response.error ?? "Page command failed")
			if (current.id === "inspect-element") {
				setStatus("Inspector active on page")
				if (!window.location.search.includes("drawer") && window.innerHeight < 650) {
					setTimeout(() => window.close(), 350)
				}
			}
			if (current.id === "viewport-resize") {
				ui.run.textContent = "Refresh Viewport"
			}
			return succeed(response.data ?? "Done", true)
		}
		let values = readForm()
		if (current.autofill === "environment") {
			const context = await sendToPage({ type: "capture-context" })
			values = { ...values, environment: context.ok ? context.data : { Note: "Page context unavailable" } }
			const result = await (async () => {
				try {
					const coerced = { ...coerceValues(current, values), environment: values.environment }
					return { ok: true, ...(await current.run(coerced)) }
				} catch (error) {
					return { ok: false, error: error.message }
				}
			})()
			return result.ok ? succeed(result.value, true) : fail(result.error)
		}
		const result = await runTool(current.id, values)
		return result.ok ? succeed(result.value, true) : fail(result.error)
	} catch (error) {
		return fail(error?.message ?? String(error))
	} finally {
		ui.run.disabled = false
	}
}

const FORMAT_KEY_MAP = {}
for (const [k, label] of Object.entries(FORMAT_LABELS)) FORMAT_KEY_MAP[label] = k

async function executeImageConverter() {
	const values = readForm()
	const file = values.file
	if (!file) return fail("Image file is required")
	if (!file.type?.startsWith("image/")) return fail("Selected file is not an image")
	if (file.size > 50 * 1024 * 1024) return fail("File exceeds 50 MB limit")

	const formatLabel = values.format || "Auto (Best quality & size)"
	let formatKey = FORMAT_KEY_MAP[formatLabel] || "auto"
	const strategyLabel = values.strategy || "True color & high sharpness (crisp details, gentle scale if needed)"
	const isStrictResolution = strategyLabel.startsWith("Strict")
	const isSmallestSize = strategyLabel.startsWith("Smallest")
	const quality = parseQuality(values.quality)
	const targetSizeKb = values.targetSizeKb ? Number(values.targetSizeKb) : 0
	const targetW = values.width ? Number(values.width) : 0
	const targetH = values.height ? Number(values.height) : 0
	const resizeModeRaw = values.resizeMode || "Contain (fit inside)"
	const resizeMode = resizeModeRaw.startsWith("Cover") ? "cover" : resizeModeRaw.startsWith("Exact") ? "exact" : "contain"

	setStatus("Reading image…")

	try {
		let imgSource = null
		let origW = 0
		let origH = 0
		let objectUrl = null

		try {
			imgSource = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" })
			origW = imgSource.width
			origH = imgSource.height
		} catch {
			try {
				imgSource = await createImageBitmap(file)
				origW = imgSource.width
				origH = imgSource.height
			} catch {
				objectUrl = URL.createObjectURL(file)
				const img = await new Promise((resolve, reject) => {
					const image = new Image()
					image.onload = () => resolve(image)
					image.onerror = () => reject(new Error("Failed to decode image — the file may be corrupted"))
					image.src = objectUrl
				})
				imgSource = img
				origW = img.naturalWidth
				origH = img.naturalHeight
			}
		}

		if (origW === 0 || origH === 0) {
			if (objectUrl) URL.revokeObjectURL(objectUrl)
			return fail("Image has zero dimensions")
		}

		let { width: outW, height: outH } = computeResize(origW, origH, targetW, targetH, resizeMode)
		const manualResizeRequested = targetW > 0 || targetH > 0
		const isOpaqueSource = file.type === "image/jpeg" || file.type === "image/bmp"

		// Halve dimensions in steps to prevent canvas downscaling artifacts
		function renderToCanvas(w, h, fillWhite = false) {
			const srcW = origW
			const srcH = origH
			let cur = document.createElement("canvas")
			cur.width = srcW
			cur.height = srcH
			let ctx = cur.getContext("2d", { colorSpace: "srgb" })
			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"
			if (fillWhite && !isOpaqueSource) {
				ctx.fillStyle = "#ffffff"
				ctx.fillRect(0, 0, srcW, srcH)
			}
			ctx.drawImage(imgSource, 0, 0, srcW, srcH)

			let curW = srcW
			let curH = srcH
			while (curW > w * 2 || curH > h * 2) {
				const nextW = Math.max(w, Math.round(curW / 2))
				const nextH = Math.max(h, Math.round(curH / 2))
				const next = document.createElement("canvas")
				next.width = nextW
				next.height = nextH
				const nctx = next.getContext("2d", { colorSpace: "srgb" })
				nctx.imageSmoothingEnabled = true
				nctx.imageSmoothingQuality = "high"
				nctx.drawImage(cur, 0, 0, curW, curH, 0, 0, nextW, nextH)
				cur = next
				curW = nextW
				curH = nextH
			}

			if (curW !== w || curH !== h) {
				const final = document.createElement("canvas")
				final.width = w
				final.height = h
				const fctx = final.getContext("2d", { colorSpace: "srgb" })
				fctx.imageSmoothingEnabled = true
				fctx.imageSmoothingQuality = "high"
				fctx.drawImage(cur, 0, 0, curW, curH, 0, 0, w, h)
				cur = final
			}

			if (w < origW || h < origH) {
				applyUnsharpMask(cur, 0.5, 40, 2)
			}

			return cur
		}

		// Lightweight unsharp mask to restore edge contrast lost during downsampling
		function applyUnsharpMask(canvas, radius, amount, threshold) {
			const w = canvas.width
			const h = canvas.height
			const ctx = canvas.getContext("2d")
			const imageData = ctx.getImageData(0, 0, w, h)
			const src = imageData.data

			const blurCanvas = document.createElement("canvas")
			blurCanvas.width = w
			blurCanvas.height = h
			const bctx = blurCanvas.getContext("2d")
			bctx.filter = `blur(${radius}px)`
			bctx.drawImage(canvas, 0, 0)
			const blurData = bctx.getImageData(0, 0, w, h).data

			const factor = amount / 100
			for (let i = 0; i < src.length; i += 4) {
				for (let c = 0; c < 3; c++) {
					const diff = src[i + c] - blurData[i + c]
					if (Math.abs(diff) >= threshold) {
						src[i + c] = Math.max(0, Math.min(255, Math.round(src[i + c] + diff * factor)))
					}
				}
			}

			ctx.putImageData(imageData, 0, 0)
		}

		let resultDataUrl
		let resultBlob = null
		let usedQuality = null
		let chosenFormatKey = formatKey
		let tip = null
		let notice = null

		if (formatKey === "pdf") {
			setStatus("Building PDF…")
			const canvas = renderToCanvas(outW, outH, true)
			const imageData = canvas.getContext("2d").getImageData(0, 0, outW, outH)
			const rgba = imageData.data
			const rgb = new Uint8Array(outW * outH * 3)
			for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
				rgb[j] = rgba[i]
				rgb[j + 1] = rgba[i + 1]
				rgb[j + 2] = rgba[i + 2]
			}
			const pdfBytes = buildPdfFromRgb(outW, outH, rgb)
			resultBlob = new Blob([pdfBytes], { type: "application/pdf" })
			resultDataUrl = URL.createObjectURL(resultBlob)
			chosenFormatKey = "pdf"
		} else if (formatKey === "ico") {
			const icoSize = Math.min(outW, 256)
			const canvas = renderToCanvas(icoSize, icoSize, false)
			resultDataUrl = canvas.toDataURL("image/png", 1.0)
			chosenFormatKey = "ico"
		} else if (targetSizeKb > 0) {
			const targetBytes = targetSizeKb * 1024
			setStatus(`Optimizing for ≤ ${targetSizeKb} KB…`)

			let candidateFormats = []
			if (formatKey === "auto") {
				candidateFormats = ["webp", "jpeg"]
			} else if (formatKey === "webp" || formatKey === "jpeg") {
				candidateFormats = [formatKey, formatKey === "webp" ? "jpeg" : "webp"]
			} else {
				candidateFormats = ["webp", "jpeg"]
				notice = `Lossless ${FORMAT_LABELS[formatKey] || formatKey} cannot be compressed via quality; optimizing via modern codecs.`
			}

			async function measureBlob(canvas, mime, q) {
				const blob = await new Promise((res) => canvas.toBlob(res, mime, q))
				return blob ? blob.size : Infinity
			}

			// Quick probe at Q=0.5 and Q=0.01 to prune unfeasible scale/format combos
			async function coarseProbe(canvas, mime) {
				const midSize = await measureBlob(canvas, mime, 0.50)
				if (midSize <= targetBytes) return { feasible: true, highQuality: true, midSize }
				const minSize = await measureBlob(canvas, mime, 0.01)
				return { feasible: minSize <= targetBytes, highQuality: false, midSize, minSize }
			}

			async function fullSearch(canvas, fKey) {
				const mime = FORMAT_MIME[fKey]
				const measure = async (q) => measureBlob(canvas, mime, q)
				const opt = await findOptimalQuality(measure, targetBytes, {
					minQuality: 0.01,
					maxQuality: 1.0,
					maxIter: 16,
				})
				const blob = await new Promise((res) => canvas.toBlob(res, mime, opt.quality))
				return {
					formatKey: fKey,
					quality: opt.quality,
					blob,
					size: blob ? blob.size : opt.size,
					underTarget: opt.underTarget,
				}
			}

			async function evaluateScale(w, h) {
				const canvas = renderToCanvas(w, h, true)
				let best = null

				for (const fKey of candidateFormats) {
					const mime = FORMAT_MIME[fKey]
					const probe = await coarseProbe(canvas, mime)

					if (!probe.feasible) {
						if (!best || probe.minSize < best.size) {
							const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.01))
							best = { formatKey: fKey, quality: 0.01, blob, size: blob ? blob.size : probe.minSize, underTarget: false, width: w, height: h }
						}
						continue
					}

					const sol = await fullSearch(canvas, fKey)
					sol.width = w
					sol.height = h

					if (!best || (sol.underTarget && !best.underTarget) || (sol.underTarget && best.underTarget && sol.quality > best.quality) || (!sol.underTarget && !best.underTarget && sol.size < best.size)) {
						best = sol
					}

					if (sol.underTarget && sol.quality >= 0.40) break
				}

				return best
			}

			let bestSolution = null

			if (isStrictResolution || manualResizeRequested) {
				bestSolution = await evaluateScale(outW, outH)

				if (bestSolution.underTarget) {
					notice = `Preserved 100% resolution (${outW}×${outH}) at ${humanSize(bestSolution.size)} (${Math.round(bestSolution.quality * 100)}% quality).`
				} else {
					notice = `100% resolution preserved (${outW}×${outH}). Best effort: ${humanSize(bestSolution.size)} (${Math.round(bestSolution.quality * 100)}% quality). Target may be too aggressive for this resolution.`
				}

			} else if (isSmallestSize) {
				const SCALE_STEPS = [1.0, 0.88, 0.75, 0.60, 0.50, 0.40, 0.30]
				for (const scale of SCALE_STEPS) {
					const sw = Math.max(1, Math.round(outW * scale))
					const sh = Math.max(1, Math.round(outH * scale))
					const sol = await evaluateScale(sw, sh)
					sol.scale = scale
					sol.scaled = scale < 1.0
					if (!bestSolution || (sol.underTarget && !bestSolution.underTarget) || (sol.underTarget && sol.quality > bestSolution.quality) || (!sol.underTarget && sol.size < bestSolution.size)) {
						bestSolution = sol
					}
					if (bestSolution.underTarget) break
				}
				if (bestSolution.scaled) {
					notice = `Scaled to ${bestSolution.width}×${bestSolution.height} (${Math.round(bestSolution.scale * 100)}%) to meet ${targetSizeKb} KB limit.`
				}

			} else {
				// Try full resolution first, downscale if quality drops below 30%
				const fullRes = await evaluateScale(outW, outH)
				if (fullRes.underTarget && fullRes.quality >= 0.30) {
					bestSolution = fullRes
				}

				if (!bestSolution || !bestSolution.underTarget || bestSolution.quality < 0.30) {
					const SCALES = [0.92, 0.85, 0.78, 0.72, 0.65, 0.58, 0.50]
					for (const scale of SCALES) {
						const sw = Math.max(1, Math.round(outW * scale))
						const sh = Math.max(1, Math.round(outH * scale))
						const sol = await evaluateScale(sw, sh)
						sol.scale = scale
						sol.scaled = true

						if (sol.underTarget && sol.quality >= 0.35) {
							bestSolution = sol
							break
						}
						if (sol.underTarget && (!bestSolution || !bestSolution.underTarget || sol.quality > bestSolution.quality)) {
							bestSolution = sol
						}
					}

					if (!bestSolution) bestSolution = fullRes
				}

				if (bestSolution.scaled) {
					notice = `Optimized to ${bestSolution.width}×${bestSolution.height} (${Math.round(bestSolution.scale * 100)}%) to preserve crisp ${Math.round(bestSolution.quality * 100)}% quality and true colors.`
				}
			}

			chosenFormatKey = bestSolution.formatKey
			usedQuality = bestSolution.quality
			resultBlob = bestSolution.blob
			if (bestSolution.width) {
				outW = bestSolution.width
				outH = bestSolution.height
			}

			resultDataUrl = await new Promise((resolve) => {
				const reader = new FileReader()
				reader.onload = () => resolve(reader.result)
				reader.readAsDataURL(resultBlob)
			})

			if (!notice) {
				if (bestSolution.underTarget) {
					setStatus(`Target reached: ${humanSize(resultBlob.size)} at ${Math.round(usedQuality * 100)}% quality (${outW}×${outH})`)
				} else {
					setStatus(`Best effort: ${humanSize(resultBlob.size)} at ${outW}×${outH}`)
				}
			}
		} else {
			if (formatKey === "auto") formatKey = "webp"
			chosenFormatKey = formatKey
			const mime = FORMAT_MIME[chosenFormatKey] || "image/png"
			let useQuality = (chosenFormatKey === "jpeg" || chosenFormatKey === "webp") ? quality : undefined
			const canvas = renderToCanvas(outW, outH, chosenFormatKey === "jpeg" || chosenFormatKey === "bmp")
			resultBlob = await new Promise((resolve) => canvas.toBlob(resolve, mime, useQuality))

			// Prevent re-encoding from expanding file size beyond original
			if (resultBlob && resultBlob.size > file.size && !manualResizeRequested && (chosenFormatKey === "jpeg" || chosenFormatKey === "webp")) {
				const measure = async (q) => {
					const blob = await new Promise((res) => canvas.toBlob(res, mime, q))
					return blob ? blob.size : Infinity
				}
				const opt = await findOptimalQuality(measure, file.size, { minQuality: 0.10, maxQuality: quality, maxIter: 8 })
				if (opt.underTarget) {
					resultBlob = await new Promise((res) => canvas.toBlob(res, mime, opt.quality))
					useQuality = opt.quality
					notice = `Quality calibrated to ${Math.round(opt.quality * 100)}% to prevent file size from expanding past original ${humanSize(file.size)}.`
				}
			}

			if (resultBlob) {
				resultDataUrl = await new Promise((resolve) => {
					const reader = new FileReader()
					reader.onload = () => resolve(reader.result)
					reader.readAsDataURL(resultBlob)
				})
			} else {
				resultDataUrl = canvas.toDataURL(mime, useQuality)
			}
			if (chosenFormatKey === "jpeg" || chosenFormatKey === "webp") usedQuality = useQuality
		}

		if (imgSource.close) imgSource.close()
		if (objectUrl) URL.revokeObjectURL(objectUrl)

		const resultFileName = `converted.${chosenFormatKey === "jpeg" ? "jpg" : chosenFormatKey}`
		const actualFormatLabel = FORMAT_LABELS[chosenFormatKey] || chosenFormatKey

		const result = {
			dataUrl: resultDataUrl,
			blob: resultBlob,
			fileName: resultFileName,
			format: actualFormatLabel,
			formatKey: chosenFormatKey,
			originalWidth: origW,
			originalHeight: origH,
			outputWidth: chosenFormatKey === "ico" ? Math.min(outW, 256) : outW,
			outputHeight: chosenFormatKey === "ico" ? Math.min(outH, 256) : outH,
			originalSize: file.size,
			outputSize: resultBlob ? resultBlob.size : Math.round((resultDataUrl.split(",")[1] || "").length * 0.75),
			originalName: file.name,
			quality: usedQuality,
			targetSizeKb: targetSizeKb || null,
			notice,
			tip,
		}

		return succeed(result)
	} catch (error) {
		return fail(error?.message ?? String(error))
	}
}

function succeed(value, autoFocus = false) {
	lastOutput = typeof value === "string" ? value : JSON.stringify(value, null, 2)
	ui.output.textContent = lastOutput
	if (ui.richOutput) {
		ui.richOutput.innerHTML = ""
		ui.richOutput.hidden = true
	}
	ui.output.hidden = false
	setStatus("Done")

	if (current?.id === "color-report" && Array.isArray(value) && value.length > 0) {
		renderPaletteOutput(value)
	} else if (current?.id === "font-report" && Array.isArray(value) && value.length > 0) {
		renderFontsOutput(value)
	} else if (current && ui.richOutput) {
		const richNode = renderRichResult(
			current.id,
			value,
			setStatus,
			(selector) => sendToPage({ type: "highlight-element", payload: { selector } })
		)
		if (richNode) {
			ui.richOutput.innerHTML = ""
			ui.richOutput.appendChild(richNode)
			ui.richOutput.hidden = false
			ui.output.hidden = true
			if (autoFocus) {
				;(ui.richOutput.querySelector("button, a, input, [tabindex]") || ui.output).focus()
			}
		}
	}

	if (isExtension && current && autoFocus) {
		api.runtime.sendMessage({ type: "history:add", entry: { toolId: current.id, name: current.name } }).catch(() => {})
	}
}

function renderPaletteOutput(colors) {
	if (!ui.richOutput) return
	ui.output.hidden = true
	ui.richOutput.hidden = false
	ui.richOutput.innerHTML = ""

	const header = document.createElement("div")
	header.className = "rich-header"

	const title = document.createElement("span")
	title.className = "rich-title"
	title.textContent = `Page Palette (${colors.length} colors)`

	const tabs = document.createElement("div")
	tabs.className = "rich-tabs"

	const swatchesTab = document.createElement("button")
	swatchesTab.className = "rich-tab-btn active"
	swatchesTab.type = "button"
	swatchesTab.textContent = "Swatches"

	const cssVarsTab = document.createElement("button")
	cssVarsTab.className = "rich-tab-btn"
	cssVarsTab.type = "button"
	cssVarsTab.textContent = "CSS Vars"

	const jsonTab = document.createElement("button")
	jsonTab.className = "rich-tab-btn"
	jsonTab.type = "button"
	jsonTab.textContent = "Raw JSON"

	tabs.append(swatchesTab, cssVarsTab, jsonTab)
	header.append(title, tabs)
	ui.richOutput.appendChild(header)

	const swatchGrid = document.createElement("div")
	swatchGrid.className = "swatch-grid"

	const cssVarsContainer = document.createElement("div")
	cssVarsContainer.hidden = true

	const cssVarsToolbar = document.createElement("div")
	cssVarsToolbar.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
	const cssVarsLabel = document.createElement("span")
	cssVarsLabel.style.fontSize = "11.5px"
	cssVarsLabel.style.color = "var(--text-secondary)"
	cssVarsLabel.textContent = `${colors.length} CSS Custom Properties`

	const copyVarsBtn = document.createElement("button")
	copyVarsBtn.type = "button"
	copyVarsBtn.className = "rv-copy-pill"
	copyVarsBtn.textContent = "Copy All CSS"

	const cssVarsLines = [":root {"]
	colors.forEach((c, idx) => {
		const varName = `--color-${idx + 1}`
		cssVarsLines.push(`  ${varName}: ${c.hex};`)
	})
	cssVarsLines.push("}")
	const cssText = cssVarsLines.join("\n")

	copyVarsBtn.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(cssText)
			setStatus("Copied CSS variables to clipboard")
			copyVarsBtn.textContent = "Copied!"
			setTimeout(() => { copyVarsBtn.textContent = "Copy All CSS" }, 1200)
		} catch {}
	})

	cssVarsToolbar.append(cssVarsLabel, copyVarsBtn)
	const cssVarsBox = document.createElement("pre")
	cssVarsBox.className = "rv-json-highlighted"
	cssVarsBox.textContent = cssText
	cssVarsContainer.append(cssVarsToolbar, cssVarsBox)

	colors.forEach((item) => {
		const card = document.createElement("div")
		card.className = "swatch-card"
		card.title = `Click to copy ${item.hex}`

		const preview = document.createElement("div")
		preview.className = "swatch-preview"
		preview.style.backgroundColor = item.hex

		const info = document.createElement("div")
		info.className = "swatch-info"

		const hexEl = document.createElement("div")
		hexEl.className = "swatch-hex"
		hexEl.textContent = item.hex

		const rgbEl = document.createElement("div")
		rgbEl.className = "swatch-rgb"
		rgbEl.textContent = item.rgb || item.raw || ""

		const countEl = document.createElement("div")
		countEl.className = "swatch-count"
		countEl.textContent = `${item.count} element${item.count === 1 ? "" : "s"}`

		info.append(hexEl, rgbEl, countEl)
		card.append(preview, info)

		card.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(item.hex)
				setStatus(`Copied ${item.hex}`)
				const badge = document.createElement("div")
				badge.className = "swatch-copied-badge"
				badge.textContent = "Copied!"
				card.appendChild(badge)
				setTimeout(() => badge.remove(), 1000)
			} catch {}
		})

		swatchGrid.appendChild(card)
	})

	ui.richOutput.append(swatchGrid, cssVarsContainer)

	swatchesTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn active"
		cssVarsTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn"
		swatchGrid.hidden = false
		cssVarsContainer.hidden = true
		ui.output.hidden = true
	})

	cssVarsTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn"
		cssVarsTab.className = "rich-tab-btn active"
		jsonTab.className = "rich-tab-btn"
		swatchGrid.hidden = true
		cssVarsContainer.hidden = false
		ui.output.hidden = true
	})

	jsonTab.addEventListener("click", () => {
		swatchesTab.className = "rich-tab-btn"
		cssVarsTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn active"
		swatchGrid.hidden = true
		cssVarsContainer.hidden = true
		ui.output.hidden = false
	})
}

function renderFontsOutput(fonts) {
	if (!ui.richOutput) return
	ui.output.hidden = true
	ui.richOutput.hidden = false
	ui.richOutput.innerHTML = ""

	const header = document.createElement("div")
	header.className = "rich-header"

	const title = document.createElement("span")
	title.className = "rich-title"
	title.textContent = `Typography Report (${fonts.length} styles)`

	const tabs = document.createElement("div")
	tabs.className = "rich-tabs"

	const visualTab = document.createElement("button")
	visualTab.className = "rich-tab-btn active"
	visualTab.type = "button"
	visualTab.textContent = "Specimens"

	const jsonTab = document.createElement("button")
	jsonTab.className = "rich-tab-btn"
	jsonTab.type = "button"
	jsonTab.textContent = "Raw JSON"

	tabs.append(visualTab, jsonTab)
	header.append(title, tabs)
	ui.richOutput.appendChild(header)

	const fontList = document.createElement("div")
	fontList.className = "font-list"

	fonts.forEach((item) => {
		const card = document.createElement("div")
		card.className = "font-card"

		let family = item.family
		let size = item.size
		let weight = item.weight
		let lineHeight = item.lineHeight
		if (!family && typeof item.style === "string") {
			const parts = item.style.split("|").map((p) => p.trim())
			family = parts[0] || "sans-serif"
			size = parts[1] || "16px"
			weight = parts[2] || "400"
			lineHeight = parts[3] || "normal"
		}

		const cardHeader = document.createElement("div")
		cardHeader.className = "font-card-header"

		const pills = document.createElement("div")
		pills.className = "font-pills"

		const famPill = document.createElement("span")
		famPill.className = "font-pill font-name"
		famPill.textContent = family

		const sizePill = document.createElement("span")
		sizePill.className = "font-pill"
		sizePill.textContent = size

		const weightPill = document.createElement("span")
		weightPill.className = "font-pill"
		weightPill.textContent = `w:${weight}`

		const linePill = document.createElement("span")
		linePill.className = "font-pill"
		linePill.textContent = `lh:${lineHeight}`

		const countPill = document.createElement("span")
		countPill.className = "font-pill font-count"
		countPill.textContent = `${item.count} elements`

		pills.append(famPill, sizePill, weightPill, linePill, countPill)

		const copyBtn = document.createElement("button")
		copyBtn.type = "button"
		copyBtn.className = "font-copy-btn"
		copyBtn.textContent = "Copy CSS"
		const cssSnippet = `font-family: ${item.fullFamily || family};\nfont-size: ${size};\nfont-weight: ${weight};\nline-height: ${lineHeight};`
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(cssSnippet)
				copyBtn.textContent = "Copied!"
				setStatus(`Copied CSS: ${family} ${size}`)
				setTimeout(() => {
					copyBtn.textContent = "Copy CSS"
				}, 1200)
			} catch {}
		})

		cardHeader.append(pills, copyBtn)

		const specimen = document.createElement("div")
		specimen.className = "font-specimen-box"
		specimen.style.fontFamily = item.fullFamily || family
		specimen.style.fontSize = `${Math.max(12, Math.min(parseInt(size) || 16, 20))}px`
		specimen.style.fontWeight = weight
		specimen.textContent = item.sampleText || "The quick brown fox jumps over the lazy dog"

		card.append(cardHeader, specimen)
		fontList.appendChild(card)
	})

	ui.richOutput.appendChild(fontList)

	visualTab.addEventListener("click", () => {
		visualTab.className = "rich-tab-btn active"
		jsonTab.className = "rich-tab-btn"
		fontList.hidden = false
		ui.output.hidden = true
	})

	jsonTab.addEventListener("click", () => {
		visualTab.className = "rich-tab-btn"
		jsonTab.className = "rich-tab-btn active"
		fontList.hidden = true
		ui.output.hidden = false
	})
}

function fail(message) {
	ui.error.textContent = message
	ui.error.hidden = false
	if (ui.richOutput) {
		ui.richOutput.hidden = true
	}
	setStatus("Error")
}

async function copyOutput() {
	if (!lastOutput) return setStatus("Nothing to copy")
	try {
		await navigator.clipboard.writeText(lastOutput)
		setStatus("Copied to clipboard")
	} catch {
		ui.output.focus()
		setStatus("Copy blocked — select the text manually")
	}
}

function saveOutput() {
	if (!lastOutput) return setStatus("Nothing to save")
	const blob = new Blob([lastOutput], { type: "text/plain" })
	const url = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = url
	link.download = `devkit-${current?.id ?? "output"}.txt`
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 2000)
	setStatus("Saved")
}

async function togglePin() {
	if (!current) return
	pinned = pinned.includes(current.id) ? pinned.filter((id) => id !== current.id) : [...pinned, current.id]
	ui.pin.textContent = pinned.includes(current.id) ? "Unpin" : "Pin"
	await persist({ pinned })
	setStatus(pinned.includes(current.id) ? "Pinned" : "Unpinned")
}

function setStatus(message) {
	ui.status.textContent = message
}
