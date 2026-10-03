import { optionValue } from "../lib/registry.js"
import { el, icon, toast } from "./dom.js"
import { UPLOAD_MAX_BYTES, UPLOAD_WARN_BYTES, formatBytes, isFieldVisible, stripHidden } from "./helpers.js"

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function fieldId(key) {
	return `f-${key}`
}

function initialValue(input, initial) {
	if (initial && initial[input.key] !== undefined) return initial[input.key]
	if (input.type === "checkbox") return Boolean(input.default)
	return input.default === undefined ? "" : String(input.default)
}

function expandHex(value) {
	const text = String(value ?? "").trim()
	if (!HEX_COLOR.test(text)) return null
	if (text.length === 4) return `#${[...text.slice(1)].map((char) => char + char).join("")}`.toLowerCase()
	return text.toLowerCase()
}

function baseControl(control, input) {
	control.id = fieldId(input.key)
	control.name = input.key
	if (input.placeholder) control.placeholder = input.placeholder
	return control
}

function textControl(input, value) {
	const control = baseControl(el("input", "input"), input)
	control.type = "text"
	control.autocomplete = "off"
	control.spellcheck = false
	control.value = value
	return { control, node: control, get: () => control.value, set: (next) => (control.value = next ?? "") }
}

function textareaControl(input, value) {
	const control = baseControl(el("textarea", "input textarea"), input)
	control.rows = input.rows ?? 5
	control.spellcheck = false
	control.value = value
	return { control, node: control, get: () => control.value, set: (next) => (control.value = next ?? "") }
}

function numberControl(input, value) {
	const control = baseControl(el("input", "input"), input)
	control.type = "number"
	control.inputMode = "decimal"
	if (typeof input.min === "number") control.min = String(input.min)
	if (typeof input.max === "number") control.max = String(input.max)
	control.step = input.step === undefined ? "any" : String(input.step)
	control.value = value
	return { control, node: control, get: () => control.value, set: (next) => (control.value = next ?? "") }
}

function selectControl(input, value) {
	const control = baseControl(el("select", "input select"), input)
	for (const option of input.options ?? []) {
		const optValue = optionValue(option)
		const label = option && typeof option === "object" ? String(option.label ?? option.value) : String(option)
		control.append(new Option(label, optValue))
	}
	if (value !== "") control.value = String(value)
	return { control, node: control, get: () => control.value, set: (next) => (control.value = next ?? "") }
}

function checkboxControl(input, value) {
	const control = baseControl(el("input", "switch-input"), input)
	control.type = "checkbox"
	control.setAttribute("role", "switch")
	control.checked = Boolean(value)
	const node = el("label", "switch")
	node.htmlFor = control.id
	node.append(control, el("span", "switch-track"), el("span", "switch-label", input.label))
	return { control, node, get: () => control.checked, set: (next) => (control.checked = Boolean(next)) }
}

function colorControl(input, value) {
	const control = baseControl(el("input", "input mono"), input)
	control.type = "text"
	control.autocomplete = "off"
	control.spellcheck = false
	control.value = value
	const picker = el("input", "color-swatch")
	picker.type = "color"
	picker.value = expandHex(value) ?? "#000000"
	picker.setAttribute("aria-label", `${input.label} picker`)
	picker.addEventListener("input", () => {
		control.value = picker.value
		control.dispatchEvent(new Event("input", { bubbles: true }))
	})
	control.addEventListener("input", () => {
		const hex = expandHex(control.value)
		if (hex) picker.value = hex
	})
	const node = el("div", "color-field")
	node.append(picker, control)
	const set = (next) => {
		control.value = next ?? ""
		picker.value = expandHex(next) ?? picker.value
	}
	return { control, node, get: () => control.value, set }
}

function fileControl(input, state) {
	const control = baseControl(el("input", "visually-hidden"), input)
	control.type = "file"
	if (input.accept) control.accept = input.accept
	const zone = el("label", "dropzone")
	zone.htmlFor = control.id
	const copy = el("span", "dropzone-copy")
	copy.append(el("strong", "", "Drop a file"), el("span", "", " or click to browse"))
	zone.append(icon("upload"), copy)
	if (input.accept) zone.appendChild(el("span", "dropzone-hint mono", input.accept))

	const chip = el("div", "file-chip")
	chip.hidden = true
	const thumb = el("span", "file-thumb")
	const name = el("span", "file-name")
	const size = el("span", "file-size mono")
	const remove = el("button", "icon-btn sm")
	remove.type = "button"
	remove.setAttribute("aria-label", "Remove file")
	remove.title = "Remove file"
	remove.appendChild(icon("close"))
	chip.append(thumb, name, size, remove)

	let thumbUrl = null
	const show = (file) => {
		if (thumbUrl) URL.revokeObjectURL(thumbUrl)
		thumbUrl = null
		thumb.replaceChildren()
		if (!file) {
			chip.hidden = true
			zone.hidden = false
			return
		}
		if (file.type?.startsWith("image/") && file.size < 30 * 1024 * 1024) {
			thumbUrl = URL.createObjectURL(file)
			const img = el("img")
			img.alt = ""
			img.src = thumbUrl
			thumb.appendChild(img)
		} else {
			thumb.appendChild(icon("file"))
		}
		name.textContent = file.name
		name.title = file.name
		size.textContent = formatBytes(file.size)
		chip.hidden = false
		zone.hidden = true
	}
	const setFile = (file) => {
		if (file) state.files.set(input.key, file)
		else state.files.delete(input.key)
		if (!file) control.value = ""
		show(file)
		control.dispatchEvent(new Event("input", { bubbles: true }))
	}
	control.addEventListener("change", () => setFile(control.files?.[0] ?? null))
	remove.addEventListener("click", () => {
		setFile(null)
		control.focus()
	})
	bindDrop(zone, (file) => setFile(file))

	const node = el("div", "file-field")
	node.append(control, zone, chip)
	return { control, node, get: () => state.files.get(input.key) ?? null, set: (next) => setFile(next instanceof Blob ? next : null) }
}

function bindDrop(target, onFile) {
	target.addEventListener("dragover", (event) => {
		if (!event.dataTransfer?.types?.includes("Files")) return
		event.preventDefault()
		target.classList.add("is-drop")
	})
	target.addEventListener("dragleave", () => target.classList.remove("is-drop"))
	target.addEventListener("drop", (event) => {
		const file = event.dataTransfer?.files?.[0]
		target.classList.remove("is-drop")
		if (!file) return
		event.preventDefault()
		onFile(file)
	})
}

async function loadTextInto(file, field) {
	if (file.size > UPLOAD_MAX_BYTES) {
		toast(`${file.name} is ${formatBytes(file.size)}, too large to load as text`, "bad")
		return
	}
	if (file.size > UPLOAD_WARN_BYTES) toast(`Large file (${formatBytes(file.size)}), the popup may slow down`, "warn")
	try {
		field.set(await file.text())
		field.control.dispatchEvent(new Event("input", { bubbles: true }))
		toast(`Loaded ${file.name}`)
	} catch (error) {
		toast(`Could not read ${file.name}: ${error.message}`, "bad")
	}
}

function uploadButton(input, field) {
	const picker = el("input", "visually-hidden")
	picker.type = "file"
	picker.tabIndex = -1
	if (input.upload?.accept) picker.accept = input.upload.accept
	const trigger = el("button", "link-btn")
	trigger.type = "button"
	trigger.title = "Load a file as text (or drop it on the field)"
	trigger.append(icon("upload"), el("span", "", "Upload"))
	trigger.addEventListener("click", () => picker.click())
	picker.addEventListener("change", () => {
		const file = picker.files?.[0]
		if (file) loadTextInto(file, field)
		picker.value = ""
	})
	bindDrop(field.control, (file) => loadTextInto(file, field))
	const wrap = el("span", "upload")
	wrap.append(picker, trigger)
	return wrap
}

const BUILDERS = {
	text: textControl,
	textarea: textareaControl,
	number: numberControl,
	select: selectControl,
	checkbox: checkboxControl,
	color: colorControl,
}

function buildField(input, initial, state) {
	const value = initialValue(input, initial)
	const field = input.type === "file" ? fileControl(input, state) : (BUILDERS[input.type] ?? textControl)(input, value)
	const wrap = el("div", `field field-${input.type}`)
	wrap.dataset.key = input.key
	if (input.type !== "checkbox") {
		const head = el("div", "field-head")
		const label = el("label", "field-label", input.label)
		label.htmlFor = field.control.id
		head.appendChild(label)
		if (input.upload && (input.type === "text" || input.type === "textarea")) head.appendChild(uploadButton(input, field))
		wrap.appendChild(head)
	}
	wrap.appendChild(field.node)
	if (input.help) {
		const help = el("p", "help", input.help)
		help.id = `help-${input.key}`
		field.control.setAttribute("aria-describedby", help.id)
		wrap.appendChild(help)
	}
	return { input, wrap, ...field }
}

function readFileAs(file, mode) {
	if (mode === "text") return file.text().then((text) => ({ text }))
	if (mode === "bytes") return file.arrayBuffer().then((buffer) => ({ bytes: new Uint8Array(buffer) }))
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve({ dataUrl: reader.result })
		reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
		reader.readAsDataURL(file)
	})
}

export function buildForm(tool, container, { initial = {}, onChange } = {}) {
	const inputs = tool.inputs ?? []
	const state = { files: new Map(), cache: new WeakMap() }
	const fields = new Map()
	// A fresh root per tool keeps listeners from piling up on the shared container.
	const root = el("div", "form-fields")
	for (const input of inputs) {
		const field = buildField(input, initial, state)
		fields.set(input.key, field)
		root.appendChild(field.wrap)
	}
	container.replaceChildren(root)

	function readRaw() {
		const values = {}
		for (const [key, field] of fields) values[key] = field.get()
		return values
	}

	function refreshVisibility() {
		const values = readRaw()
		for (const field of fields.values()) field.wrap.hidden = !isFieldVisible(field.input, values, inputs)
	}

	async function fileValue(input, file, forPage) {
		const mode = forPage && input.read === "bytes" ? "dataUrl" : input.read ?? "dataUrl"
		let byMode = state.cache.get(file)
		if (!byMode) {
			byMode = {}
			state.cache.set(file, byMode)
		}
		byMode[mode] ??= readFileAs(file, mode)
		return { name: file.name, size: file.size, mime: file.type, ...(await byMode[mode]) }
	}

	async function collect({ forPage = false } = {}) {
		const values = stripHidden(tool, readRaw())
		for (const input of inputs) {
			if (input.type !== "file" || !(input.key in values)) continue
			const file = values[input.key]
			values[input.key] = file ? await fileValue(input, file, forPage) : null
		}
		return values
	}

	function reset() {
		for (const field of fields.values()) {
			if (field.input.type === "file") field.set(null)
			else field.set(initialValue(field.input, null))
		}
		refreshVisibility()
		onChange?.(null)
	}

	function focusFirst() {
		const first = [...fields.values()].find((field) => !field.wrap.hidden)
		first?.control.focus({ preventScroll: true })
		return Boolean(first)
	}

	const handle = (event) => {
		const key = event.target?.name
		if (!key || !fields.has(key)) return
		refreshVisibility()
		onChange?.(key)
	}
	root.addEventListener("input", handle)
	refreshVisibility()

	return {
		readRaw,
		collect,
		reset,
		focusFirst,
		rawFile: (key) => state.files.get(key) ?? null,
		hasFields: inputs.length > 0,
		destroy: () => container.replaceChildren(),
	}
}
