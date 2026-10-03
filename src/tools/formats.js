import { ToolError, escapeHtml, required } from "../lib/utils.js"
import { JsonNumber, JsonObject, fromPlain, parseJsonNode, parseJsonWithDiagnostics, stringifyJson } from "./text.js"

function yamlError(line, message) {
	return new ToolError(`YAML error on line ${line?.no ?? "?"}: ${message}`)
}

// Finds a # that starts a comment: at the start or after whitespace, and outside quotes.
export function stripYamlComment(text) {
	let quote = null
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i]
		if (quote) {
			if (quote === "\"" && char === "\\") i += 1
			else if (char === quote) quote = null
		} else if ((char === "\"" || char === "'") && (i === 0 || /[\s[{,:]/.test(text[i - 1]))) quote = char
		else if (char === "#" && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd()
	}
	return text.trimEnd()
}

function isSeqItem(content) {
	return content === "-" || content.startsWith("- ") || content.startsWith("-\t")
}

// Returns the key and the raw rest of a "key: value" line, or null when the line is not a mapping entry.
export function splitYamlKey(content) {
	if (/^[[{]/.test(content)) return null
	if (content[0] === "\"" || content[0] === "'") {
		const quote = content[0]
		let i = 1
		while (i < content.length) {
			if (quote === "\"" && content[i] === "\\") i += 2
			else if (content[i] === quote && quote === "'" && content[i + 1] === "'") i += 2
			else if (content[i] === quote) break
			else i += 1
		}
		const after = content.slice(i + 1).match(/^\s*:(\s|$)/)
		if (!after) return null
		const raw = content.slice(0, i + 1)
		return { key: quote === "\"" ? unescapeDoubleQuoted(raw.slice(1, -1)) : raw.slice(1, -1).replace(/''/g, "'"), rest: content.slice(i + 1 + after[0].length - after[1].length), quoted: true }
	}
	for (let i = 0; i < content.length; i += 1) {
		if (content[i] === "#" && i > 0 && /\s/.test(content[i - 1])) return null
		if (content[i] === ":" && (i + 1 === content.length || /\s/.test(content[i + 1]))) {
			const key = content.slice(0, i).trim()
			if (!key) return null
			return { key, rest: content.slice(i + 1), quoted: false }
		}
	}
	return null
}

const DOUBLE_ESCAPES = { 0: "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", "\"": "\"", "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: "\u2028", P: "\u2029" }

export function unescapeDoubleQuoted(body) {
	return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (whole, esc) => {
		if (esc.length > 1) return String.fromCodePoint(parseInt(esc.slice(1), 16))
		if (Object.hasOwn(DOUBLE_ESCAPES, esc)) return DOUBLE_ESCAPES[esc]
		throw new ToolError(`Unknown escape sequence ${whole} in a double quoted string`)
	})
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

export function resolveYamlScalar(text) {
	const s = text.trim()
	if (s === "" || s === "~" || /^(null|Null|NULL)$/.test(s)) return null
	if (/^(true|True|TRUE)$/.test(s)) return true
	if (/^(false|False|FALSE)$/.test(s)) return false
	if (/^[-+]?(0|[1-9]\d*)$/.test(s)) return new JsonNumber(s.replace(/^\+/, ""))
	if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16)
	if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8)
	if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(s)) {
		const clean = s.replace(/^\+/, "")
		return JSON_NUMBER.test(clean) ? new JsonNumber(clean) : Number(clean)
	}
	if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity
	if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN
	return s
}

function foldBlock(lines) {
	let out = ""
	let blanks = 0
	let previous = null
	for (const line of lines) {
		if (line === "") {
			blanks += 1
			continue
		}
		const kind = /^[ \t]/.test(line) ? "indented" : "normal"
		if (previous === null) out += "\n".repeat(blanks)
		else if (previous === "normal" && kind === "normal") out += blanks ? "\n".repeat(blanks) : " "
		else out += "\n".repeat(blanks + 1)
		out += line
		blanks = 0
		previous = kind
	}
	return out
}

function setEntry(target, key, value, line) {
	if (target.index.has(key)) throw yamlError(line, `Duplicate key "${key}"`)
	target.index.set(key, target.entries.length)
	target.entries.push([key, value])
}

class YamlParser {
	constructor(lines) {
		this.lines = lines
		this.i = 0
		this.anchors = new Map()
	}

	peek() {
		while (this.i < this.lines.length && !stripYamlComment(this.lines[this.i].content).trim()) this.i += 1
		return this.lines[this.i] ?? null
	}

	parseBlock(indent) {
		const line = this.peek()
		if (/^\t/.test(line.content)) throw yamlError(line, "Tabs are not allowed for indentation")
		if (line.content.startsWith("? ")) throw yamlError(line, "Complex keys (?) are not supported")
		if (isSeqItem(line.content)) return this.parseSequence(indent)
		if (splitYamlKey(line.content)) return this.parseMapping(indent)
		this.i += 1
		return this.parseValue(line.content, indent - 1, line, false)
	}

	parseSequence(indent) {
		const items = []
		for (;;) {
			const line = this.peek()
			if (!line || line.indent < indent) break
			if (line.indent > indent) throw yamlError(line, "Unexpected indentation inside a list")
			if (!isSeqItem(line.content)) break
			const rest = line.content.slice(1)
			const trimmed = rest.replace(/^[ \t]+/, "")
			if (!stripYamlComment(trimmed)) {
				this.i += 1
				const next = this.peek()
				items.push(next && next.indent > indent ? this.parseBlock(next.indent) : null)
				continue
			}
			// Treat a list item with inline content as a virtual line indented to where content starts, so nested maps line up.
			const virtualIndent = indent + 1 + (rest.length - trimmed.length)
			this.lines[this.i] = { ...line, indent: virtualIndent, content: trimmed }
			const isNested = isSeqItem(trimmed) || splitYamlKey(trimmed)
			if (isNested) items.push(this.parseBlock(virtualIndent))
			else {
				this.i += 1
				items.push(this.parseValue(trimmed, indent, line, false))
			}
		}
		return items
	}

	parseMapping(indent) {
		const target = { entries: [], index: new Map() }
		const merges = []
		for (;;) {
			const line = this.peek()
			if (!line || line.indent < indent) break
			if (line.indent > indent) throw yamlError(line, "Unexpected indentation")
			if (isSeqItem(line.content)) throw yamlError(line, "A list item cannot appear here; check the indentation")
			const pair = splitYamlKey(line.content)
			if (!pair) throw yamlError(line, `Expected "key: value" but found "${line.content.trim()}"`)
			this.i += 1
			const value = this.parseValue(pair.rest, indent, line, true)
			if (pair.key === "<<" && !pair.quoted) merges.push(...(Array.isArray(value) ? value : [value]))
			else setEntry(target, pair.key, value, line)
		}
		for (const source of merges) {
			if (!(source instanceof JsonObject)) throw yamlError(this.lines[this.i - 1], "Merge key << needs a mapping or a list of mappings")
			for (const [key, value] of source.entries) {
				if (!target.index.has(key)) setEntry(target, key, value, null)
			}
		}
		return new JsonObject(target.entries)
	}

	parseNested(parentIndent, inMapping) {
		const next = this.peek()
		if (next && next.indent > parentIndent) return this.parseBlock(next.indent)
		if (inMapping && next && next.indent === parentIndent && isSeqItem(next.content)) return this.parseSequence(parentIndent)
		return null
	}

	parseValue(text, parentIndent, line, inMapping) {
		let rest = text.trim()
		let anchor = null
		let forceString = false
		for (;;) {
			const anchorMatch = rest.match(/^&([^\s,[\]{}]+)\s*/)
			const tagMatch = rest.match(/^(!\S*)\s*/)
			if (anchorMatch) {
				anchor = anchorMatch[1]
				rest = rest.slice(anchorMatch[0].length)
			} else if (tagMatch) {
				forceString = tagMatch[1] === "!!str"
				rest = rest.slice(tagMatch[0].length)
			} else break
		}
		let value
		if (!stripYamlComment(rest)) value = this.parseNested(parentIndent, inMapping)
		else if (rest[0] === "*") {
			const name = rest.slice(1).match(/^[^\s,[\]{}]+/)?.[0]
			if (!name || !this.anchors.has(name)) throw yamlError(line, `Unknown alias *${name ?? ""}`)
			value = this.anchors.get(name)
		} else if (/^[|>]/.test(rest)) value = this.parseBlockScalar(rest, parentIndent, line)
		else if (rest[0] === "[" || rest[0] === "{") value = this.parseFlowValue(rest, line)
		else if (rest[0] === "\"" || rest[0] === "'") value = this.parseQuoted(rest, line)
		else value = this.parsePlain(stripYamlComment(rest).trim(), parentIndent, forceString)
		if (anchor) this.anchors.set(anchor, value)
		return value
	}

	parsePlain(first, parentIndent, forceString) {
		let text = first
		let blanks = 0
		while (this.i < this.lines.length) {
			const line = this.lines[this.i]
			const content = stripYamlComment(line.content).trim()
			if (!content) {
				blanks += 1
				this.i += 1
				continue
			}
			if (line.indent <= parentIndent) break
			text += blanks ? "\n".repeat(blanks) : " "
			text += content
			blanks = 0
			this.i += 1
		}
		if (blanks) this.i -= blanks
		return forceString ? text : resolveYamlScalar(text)
	}

	parseBlockScalar(header, parentIndent, line) {
		const match = header.match(/^([|>])([+-]?)([1-9]?)([+-]?)\s*(#.*)?$/)
		if (!match) throw yamlError(line, `Invalid block scalar header "${header}"`)
		const chomp = match[2] || match[4]
		let contentIndent = match[3] ? parentIndent + Number(match[3]) + (parentIndent < 0 ? 1 : 0) : null
		const collected = []
		while (this.i < this.lines.length) {
			const current = this.lines[this.i]
			if (!current.raw.trim()) {
				collected.push("")
				this.i += 1
				continue
			}
			if (contentIndent === null) {
				if (current.indent <= parentIndent) break
				contentIndent = current.indent
			}
			if (current.rawIndent < contentIndent) break
			collected.push(current.raw.slice(contentIndent))
			this.i += 1
		}
		let trailing = 0
		while (collected.length && collected[collected.length - 1] === "") {
			collected.pop()
			trailing += 1
		}
		const body = match[1] === "|" ? collected.join("\n") : foldBlock(collected)
		if (!collected.length) return chomp === "+" ? "\n".repeat(trailing) : ""
		if (chomp === "-") return body
		if (chomp === "+") return `${body}\n${"\n".repeat(trailing)}`
		return `${body}\n`
	}

	gatherUntil(first, isComplete, line) {
		let text = first
		while (!isComplete(text)) {
			if (this.i >= this.lines.length) throw yamlError(line, "Unterminated flow collection or quoted string")
			text += `\n${this.lines[this.i].raw.trim()}`
			this.i += 1
		}
		return text
	}

	parseFlowValue(first, line) {
		const text = this.gatherUntil(first, (t) => flowBalanced(t), line)
		const parsed = parseFlow(text, this.anchors, line)
		if (stripYamlComment(text.slice(parsed.end)).trim()) throw yamlError(line, "Unexpected text after a flow collection")
		return parsed.value
	}

	parseQuoted(first, line) {
		const quote = first[0]
		const text = this.gatherUntil(first, (t) => quotedEnd(t, quote) >= 0, line)
		const end = quotedEnd(text, quote)
		if (stripYamlComment(text.slice(end + 1)).trim()) throw yamlError(line, "Unexpected text after a quoted string")
		return decodeQuoted(text.slice(1, end), quote)
	}
}

function quotedEnd(text, quote) {
	for (let i = 1; i < text.length; i += 1) {
		if (quote === "\"" && text[i] === "\\") i += 1
		else if (text[i] === quote) {
			if (quote === "'" && text[i + 1] === "'") i += 1
			else return i
		}
	}
	return -1
}

function foldQuotedLines(body) {
	const lines = body.split("\n")
	if (lines.length === 1) return body
	let out = lines[0].trimEnd()
	let blanks = 0
	for (let i = 1; i < lines.length; i += 1) {
		const part = lines[i].trim()
		if (!part && i < lines.length - 1) {
			blanks += 1
			continue
		}
		if (out.endsWith("\\") && !out.endsWith("\\\\")) out = out.slice(0, -1)
		else out += blanks ? "\n".repeat(blanks) : " "
		out += part
		blanks = 0
	}
	return out
}

function decodeQuoted(body, quote) {
	const folded = foldQuotedLines(body)
	return quote === "\"" ? unescapeDoubleQuoted(folded) : folded.replace(/''/g, "'")
}

function flowBalanced(text) {
	let depth = 0
	let quote = null
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i]
		if (quote) {
			if (quote === "\"" && char === "\\") i += 1
			else if (char === quote) quote = null
		} else if (char === "\"" || char === "'") quote = char
		else if (char === "[" || char === "{") depth += 1
		else if (char === "]" || char === "}") {
			depth -= 1
			if (depth === 0) return true
		} else if (char === "#" && /\s/.test(text[i - 1] ?? "")) {
			const newline = text.indexOf("\n", i)
			if (newline < 0) return false
			i = newline
		}
	}
	return false
}

export function parseFlow(text, anchors = new Map(), line = null) {
	let pos = 0
	const fail = (message) => {
		throw yamlError(line, message)
	}
	const skip = () => {
		while (pos < text.length) {
			if (/\s/.test(text[pos])) pos += 1
			else if (text[pos] === "#" && (pos === 0 || /\s/.test(text[pos - 1]))) {
				while (pos < text.length && text[pos] !== "\n") pos += 1
			} else break
		}
	}
	const scalar = (isKey) => {
		const char = text[pos]
		if (char === "\"" || char === "'") {
			const end = quotedEnd(text.slice(pos), char)
			if (end < 0) fail("Unterminated quoted string")
			const body = text.slice(pos + 1, pos + end)
			pos += end + 1
			return decodeQuoted(body, char)
		}
		if (char === "*") {
			const name = text.slice(pos + 1).match(/^[^\s,[\]{}]+/)?.[0] ?? ""
			pos += name.length + 1
			if (!anchors.has(name)) fail(`Unknown alias *${name}`)
			return anchors.get(name)
		}
		const start = pos
		while (pos < text.length && !",[]{}".includes(text[pos])) {
			if (isKey && text[pos] === ":" && /[\s,[\]{}]/.test(text[pos + 1] ?? " ")) break
			if (!isKey && text[pos] === ":" && /\s/.test(text[pos + 1] ?? " ") && /^\s*\{/.test(text.slice(0, start))) break
			pos += 1
		}
		return resolveYamlScalar(text.slice(start, pos).replace(/\s*\n\s*/g, " "))
	}
	const value = (isKey = false) => {
		skip()
		const anchor = text.slice(pos).match(/^&([^\s,[\]{}]+)\s*/)
		if (anchor) pos += anchor[0].length
		let result
		if (text[pos] === "[") result = sequence()
		else if (text[pos] === "{") result = mapping()
		else result = scalar(isKey)
		if (anchor) anchors.set(anchor[1], result)
		return result
	}
	const sequence = () => {
		pos += 1
		const items = []
		for (;;) {
			skip()
			if (text[pos] === "]") {
				pos += 1
				return items
			}
			items.push(value())
			skip()
			if (text[pos] === ",") pos += 1
			else if (text[pos] !== "]") fail("Expected , or ] in a flow list")
		}
	}
	const mapping = () => {
		pos += 1
		const target = { entries: [], index: new Map() }
		for (;;) {
			skip()
			if (text[pos] === "}") {
				pos += 1
				return new JsonObject(target.entries)
			}
			const key = value(true)
			skip()
			let val = null
			if (text[pos] === ":") {
				pos += 1
				skip()
				val = text[pos] === "," || text[pos] === "}" ? null : value()
			}
			setEntry(target, String(key instanceof JsonNumber ? key.raw : key), val, line)
			skip()
			if (text[pos] === ",") pos += 1
			else if (text[pos] !== "}") fail("Expected , or } in a flow mapping")
		}
	}
	const result = value()
	return { value: result, end: pos }
}

function prepareYamlLines(text) {
	return String(text)
		.replace(/^\uFEFF/, "")
		.split(/\r\n|\r|\n/)
		.map((raw, index) => {
			const indent = raw.match(/^ */)[0].length
			return { no: index + 1, raw, indent, rawIndent: indent, content: raw.slice(indent) }
		})
}

function splitDocuments(lines) {
	const docs = []
	let current = []
	let started = false
	for (const line of lines) {
		if (/^---(\s|$)/.test(line.raw)) {
			if (started || current.some((l) => stripYamlComment(l.content).trim())) docs.push(current)
			current = []
			started = true
			const rest = line.raw.slice(3).trim()
			if (rest && !rest.startsWith("#")) current.push({ ...line, raw: rest, indent: 0, rawIndent: 0, content: rest })
		} else if (/^\.\.\.(\s|$)/.test(line.raw)) {
			docs.push(current)
			current = []
			started = false
		} else if (!(line.raw.startsWith("%") && !started)) current.push(line)
	}
	if (started || current.some((l) => stripYamlComment(l.content).trim())) docs.push(current)
	return docs
}

// Returns JSON nodes (JsonObject, JsonNumber) so key order and big integers survive.
export function parseYamlDocuments(text) {
	return splitDocuments(prepareYamlLines(text)).map((lines) => {
		const parser = new YamlParser(lines)
		const first = parser.peek()
		if (!first) return null
		const value = parser.parseBlock(first.indent)
		const leftover = parser.peek()
		if (leftover) throw yamlError(leftover, "Unexpected content; check the indentation")
		return value
	})
}

export function parseYaml(text) {
	const docs = parseYamlDocuments(text)
	return docs.length > 1 ? docs : (docs[0] ?? null)
}

const YAML_11_WORDS = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|true|True|TRUE|false|False|FALSE|null|Null|NULL|~)$/

function needsQuotes(text) {
	if (text === "") return true
	if (YAML_11_WORDS.test(text)) return true
	if (/^[\s]|[\s]$/.test(text)) return true
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true
	if (/: |:$| #|\t/.test(text)) return true
	if (/[\x00-\x1f\x7f\u2028\u2029\uFEFF]/.test(text)) return true
	if (/^[-+]?[.\d][\d._:eE+-]*$/.test(text) || /^0[xob]/i.test(text) || /^[-+]?\.(inf|nan)$/i.test(text)) return true
	return /^\d{4}-\d\d-\d\d/.test(text)
}

function emitString(text, childPad) {
	const multiline = text.includes("\n") && !/[\x00-\x08\x0b-\x1f\x7f\u2028\u2029\uFEFF]/.test(text) && !/^[ \t]/.test(text) && !/ +\n/.test(text)
	if (!multiline) return needsQuotes(text) ? JSON.stringify(text) : text
	let chomp = "-"
	let body = text
	if (text.endsWith("\n")) {
		body = text.slice(0, -1)
		chomp = body.endsWith("\n") || body === "" ? "+" : ""
	}
	if (chomp === "+" && /^\n*$/.test(body)) return JSON.stringify(text)
	return `|${chomp}\n${body.split("\n").map((l) => (l ? childPad + l : "")).join("\n")}`
}

function emitScalar(value, childPad) {
	if (value === null || value === undefined) return "null"
	if (value instanceof JsonNumber) return value.raw
	if (typeof value === "number") {
		if (Number.isNaN(value)) return ".nan"
		if (!Number.isFinite(value)) return value > 0 ? ".inf" : "-.inf"
		return String(value)
	}
	if (typeof value === "boolean") return String(value)
	if (Array.isArray(value)) return "[]"
	if (value instanceof JsonObject) return "{}"
	return emitString(String(value), childPad)
}

function isCollection(value) {
	return (Array.isArray(value) && value.length > 0) || (value instanceof JsonObject && value.entries.length > 0)
}

function emitYamlBlock(value, pad, unit) {
	const lines = []
	if (Array.isArray(value)) {
		for (const item of value) {
			if (isCollection(item)) {
				const inner = emitYamlBlock(item, `${pad}  `, unit)
				lines.push(`${pad}- ${inner[0].slice(pad.length + 2)}`, ...inner.slice(1))
			} else lines.push(`${pad}- ${emitScalar(item, `${pad}  `)}`)
		}
		return lines
	}
	for (const [key, child] of value.entries) {
		const name = needsQuotes(key) || key.includes("\n") ? JSON.stringify(key) : key
		if (isCollection(child)) lines.push(`${pad}${name}:`, ...emitYamlBlock(child, pad + unit, unit))
		else lines.push(`${pad}${name}: ${emitScalar(child, pad + unit)}`)
	}
	return lines
}

export function toYaml(value, indent = 2) {
	const node = fromPlain(value)
	const unit = " ".repeat(Math.max(2, Number(indent) || 2))
	if (!isCollection(node)) return `${emitScalar(node, unit)}\n`
	return `${emitYamlBlock(node, "", unit).join("\n")}\n`
}

function hasNonFinite(node) {
	if (typeof node === "number") return !Number.isFinite(node)
	if (Array.isArray(node)) return node.some(hasNonFinite)
	if (node instanceof JsonObject) return node.entries.some(([, v]) => hasNonFinite(v))
	return false
}

export function convertJsonYaml(text, mode = "auto", indent = "2") {
	const input = required(text, "Input")
	let direction = mode
	if (mode === "auto") {
		try {
			JSON.parse(input.replace(/^\uFEFF/, ""))
			direction = "json-to-yaml"
		} catch {
			direction = "yaml-to-json"
		}
	}
	if (direction === "json-to-yaml") {
		const yaml = toYaml(parseJsonNode(input), indent)
		return { type: "text", value: yaml, download: { filename: "converted.yaml", mime: "text/yaml", text: yaml } }
	}
	const docs = parseYamlDocuments(input)
	const node = docs.length > 1 ? docs : (docs[0] ?? null)
	const json = stringifyJson(node, Number(indent) || 2)
	const notes = []
	if (docs.length > 1) notes.push(`${docs.length} YAML documents were combined into a JSON array`)
	if (hasNonFinite(node)) notes.push(".inf and .nan have no JSON equivalent and were written as null")
	const value = notes.length ? `${json}\n\n// ${notes.join("; ")}` : json
	return { type: "text", value, copy: json, download: { filename: "converted.json", mime: "application/json", text: json } }
}

const INDENT_UNITS = { 2: "  ", 4: "    ", tab: "\t" }

function tokenizeCss(src) {
	const tokens = []
	let text = ""
	let parens = 0
	const flush = () => {
		if (text) tokens.push({ type: "text", value: text })
		text = ""
	}
	for (let i = 0; i < src.length; i += 1) {
		const char = src[i]
		if (char === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2)
			const stop = end < 0 ? src.length : end + 2
			flush()
			tokens.push({ type: "comment", value: src.slice(i, stop) })
			i = stop - 1
		} else if (char === "\"" || char === "'") {
			let j = i + 1
			while (j < src.length && src[j] !== char && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
			flush()
			tokens.push({ type: "string", value: src.slice(i, j + 1) })
			i = j
		} else if (parens === 0 && (char === "{" || char === "}" || char === ";")) {
			flush()
			tokens.push({ type: char })
		} else {
			if (char === "(") parens += 1
			else if (char === ")") parens = Math.max(0, parens - 1)
			text += char
		}
	}
	flush()
	return tokens
}

// Groups tokens into rule openings, declarations, closings and standalone comments.
function cssStatements(src) {
	const statements = []
	let parts = []
	const joined = () => parts.map((p) => (p.type === "text" ? p.value.replace(/\s+/g, " ") : p.value)).join("").trim()
	const blank = () => parts.every((p) => p.type === "text" && !p.value.trim())
	for (const token of tokenizeCss(src)) {
		if (token.type === "comment" && blank()) {
			statements.push({ kind: "comment", text: token.value })
			parts = []
		} else if (token.type === "text" || token.type === "string" || token.type === "comment") parts.push(token)
		else {
			const text = joined()
			if (token.type === "{") statements.push({ kind: "open", text })
			else if (text) statements.push({ kind: "decl", text })
			if (token.type === "}") statements.push({ kind: "close" })
			parts = []
		}
	}
	if (joined()) statements.push({ kind: "tail", text: joined() })
	return statements
}

function formatDeclaration(text, compact) {
	if (text.startsWith("@")) return text
	const match = text.match(/^([^:"']+?)\s*:\s*([\s\S]*)$/)
	if (!match) return text
	const value = compact && !/["']/.test(match[2]) ? match[2].replace(/\s*,\s*/g, ",") : match[2]
	return compact ? `${match[1]}:${value}` : `${match[1]}: ${value}`
}

function formatSelector(text, compact) {
	if (/["']/.test(text)) return text
	if (!compact) return text.replace(/\s*,\s*/g, ", ")
	return text.startsWith("@") ? text.replace(/\s*,\s*/g, ",") : text.replace(/\s*([>~+,])\s*/g, "$1")
}

export function beautifyCss(src, unit = "  ") {
	const lines = []
	let depth = 0
	for (const st of cssStatements(src)) {
		const pad = unit.repeat(depth)
		if (st.kind === "open") {
			lines.push(`${pad}${formatSelector(st.text, false)} {`)
			depth += 1
		} else if (st.kind === "decl") lines.push(`${pad}${depth ? formatDeclaration(st.text, false) : st.text};`)
		else if (st.kind === "close") {
			depth = Math.max(0, depth - 1)
			lines.push(`${unit.repeat(depth)}}`)
			if (!depth) lines.push("")
		} else lines.push(`${pad}${st.text}`)
	}
	return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`
}

export function minifyCss(src) {
	let out = ""
	let depth = 0
	for (const st of cssStatements(src)) {
		if (st.kind === "open") {
			out += `${formatSelector(st.text, true)}{`
			depth += 1
		} else if (st.kind === "decl") out += `${depth ? formatDeclaration(st.text, true) : st.text};`
		else if (st.kind === "close") {
			out = `${out.replace(/;$/, "")}}`
			depth = Math.max(0, depth - 1)
		} else if (st.kind === "tail" || st.text.startsWith("/*!")) out += st.text
	}
	return out
}

const VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "))
const RAW_TAGS = new Set(["script", "style", "textarea", "pre"])
const INLINE_TAGS = new Set("a abbr b bdi bdo br button cite code data del dfn em i img input ins kbd label mark q s samp select small span strong sub sup time u var wbr".split(" "))
const AUTO_CLOSE = new Set(["li", "p", "dt", "dd", "tr", "td", "th", "option"])

function tagEnd(src, start) {
	let quote = null
	for (let j = start + 1; j < src.length; j += 1) {
		const char = src[j]
		if (quote) {
			if (char === quote) quote = null
		} else if ((char === "\"" || char === "'") && /=\s*$/.test(src.slice(Math.max(start, j - 8), j))) quote = char
		else if (char === ">") return j
	}
	return -1
}

function endOf(src, marker, from) {
	const index = src.indexOf(marker, from)
	return index < 0 ? src.length : index + marker.length
}

export function tokenizeMarkup(src, html = true) {
	const tokens = []
	const lower = html ? src.toLowerCase() : src
	let i = 0
	const pushText = (value) => {
		const last = tokens[tokens.length - 1]
		if (last?.type === "text") last.value += value
		else tokens.push({ type: "text", value })
	}
	while (i < src.length) {
		let stop
		if (src.startsWith("<!--", i)) {
			stop = endOf(src, "-->", i + 4)
			tokens.push({ type: "comment", value: src.slice(i, stop) })
		} else if (src.startsWith("<![CDATA[", i)) {
			stop = endOf(src, "]]>", i + 9)
			tokens.push({ type: "cdata", value: src.slice(i, stop) })
		} else if (src.startsWith("<!", i) || src.startsWith("<?", i)) {
			stop = endOf(src, ">", i + 2)
			tokens.push({ type: "decl", value: src.slice(i, stop) })
		} else if (src[i] === "<" && /[A-Za-z/]/.test(src[i + 1] ?? "")) {
			const end = tagEnd(src, i)
			if (end < 0) {
				pushText(src.slice(i))
				break
			}
			const raw = src.slice(i, end + 1)
			const closing = raw[1] === "/"
			const rawName = raw.match(/^<\/?\s*([^\s/>]+)/)?.[1] ?? ""
			const name = html ? rawName.toLowerCase() : rawName
			const selfClosing = /\/\s*>$/.test(raw) || (html && VOID_TAGS.has(name))
			tokens.push({ type: closing ? "close" : selfClosing ? "void" : "open", name, raw })
			stop = end + 1
			if (html && !closing && !selfClosing && RAW_TAGS.has(name)) {
				const closeAt = lower.indexOf(`</${name}`, stop)
				const rawEnd = closeAt < 0 ? src.length : closeAt
				tokens.push({ type: "raw", value: src.slice(stop, rawEnd) })
				stop = rawEnd
			}
		} else {
			const next = src.indexOf("<", i + 1)
			stop = next < 0 ? src.length : next
			pushText(src.slice(i, stop))
		}
		i = stop
	}
	return tokens
}

// Collapses whitespace between attributes but never inside quoted attribute values.
function normalizeTag(raw) {
	let out = ""
	let quote = null
	for (const char of raw) {
		if (quote) {
			out += char
			if (char === quote) quote = null
		} else if ((char === "\"" || char === "'") && out.trimEnd().endsWith("=")) {
			out = `${out.trimEnd().replace(/\s*=$/, "=")}${char}`
			quote = char
		} else if (/\s/.test(char)) {
			if (!out.endsWith(" ")) out += " "
		} else out += char
	}
	return out.replace(/\s+(\/?>)$/, "$1")
}

// Template literals may hold significant indentation, so code containing a backtick is kept verbatim.
function reindentBlock(text, pad) {
	const body = text.replace(/^\s*\n|\s+$/g, "")
	if (body.includes("`")) return body
	const lines = body.split("\n")
	const common = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length))
	return lines.map((l) => (l.trim() ? pad + l.slice(common) : "")).join("\n")
}

// Index of the matching close tag when everything in between is short inline content, otherwise minus one.
function inlineRunEnd(tokens, start, name) {
	let length = 0
	for (let k = start + 1; k < tokens.length && k < start + 40; k += 1) {
		const token = tokens[k]
		if (token.type === "close" && token.name === name) return length <= 100 ? k : -1
		if (token.type === "text") length += token.value.trim().length
		else if (isInlineToken(token, true) && token.name !== "br") length += token.raw.length
		else return -1
	}
	return -1
}

function isInlineToken(token, html) {
	return html && token && (token.type === "open" || token.type === "close" || token.type === "void") && INLINE_TAGS.has(token.name)
}

export function beautifyMarkup(src, unit = "  ", html = true) {
	const tokens = tokenizeMarkup(src, html)
	const lines = []
	const stack = []
	let current = ""
	const pad = () => unit.repeat(stack.length)
	const flush = () => {
		const text = current.trim()
		if (text) lines.push(pad() + text)
		current = ""
	}
	for (let k = 0; k < tokens.length; k += 1) {
		const token = tokens[k]
		if (token.type === "text") {
			const collapsed = token.value.replace(/\s+/g, " ")
			if (collapsed === " ") {
				if (current && !current.endsWith(" ")) current += " "
			} else current += current ? collapsed : collapsed.trimStart()
		} else if (isInlineToken(token, html)) {
			current += token.type === "close" ? token.raw : normalizeTag(token.raw)
			if (token.name === "br") flush()
		} else if (token.type === "open") {
			flush()
			if (html && AUTO_CLOSE.has(stack[stack.length - 1]) && (stack[stack.length - 1] === token.name || stack[stack.length - 1] === "p")) stack.pop()
			const tag = normalizeTag(token.raw)
			const next = tokens[k + 1]
			const after = tokens[k + 2]
			if (next?.type === "raw") {
				const closeTag = after?.type === "close" ? after.raw : ""
				if (token.name === "pre" || token.name === "textarea" || !next.value.trim()) lines.push(pad() + tag + next.value + closeTag)
				else lines.push(pad() + tag, reindentBlock(next.value, pad() + unit), pad() + closeTag)
				k += after?.type === "close" ? 2 : 1
			} else if (next?.type === "close" && next.name === token.name) {
				lines.push(pad() + tag + next.raw)
				k += 1
			} else if (next?.type === "text" && after?.type === "close" && after.name === token.name) {
				const text = html ? next.value.replace(/\s+/g, " ").trim() : next.value.trim() ? next.value : ""
				lines.push(pad() + tag + text + after.raw)
				k += 2
			} else if (html && inlineRunEnd(tokens, k, token.name) > 0) {
				const end = inlineRunEnd(tokens, k, token.name)
				const inner = tokens.slice(k + 1, end).map((t) => (t.type === "text" ? t.value.replace(/\s+/g, " ") : t.type === "close" ? t.raw : normalizeTag(t.raw))).join("")
				lines.push(pad() + tag + inner.trim() + tokens[end].raw)
				k = end
			} else {
				lines.push(pad() + tag)
				stack.push(token.name)
			}
		} else if (token.type === "close") {
			flush()
			const index = stack.lastIndexOf(token.name)
			if (index >= 0) stack.length = index
			lines.push(pad() + normalizeTag(token.raw))
		} else {
			flush()
			lines.push(pad() + (token.type === "void" ? normalizeTag(token.raw) : token.value))
		}
	}
	flush()
	return `${lines.join("\n")}\n`
}

function isBlockBoundary(token, html) {
	return !token || (token.type !== "text" && !isInlineToken(token, html))
}

export function minifyMarkup(src, html = true) {
	const tokens = tokenizeMarkup(src, html)
	let out = ""
	tokens.forEach((token, k) => {
		if (token.type === "comment") {
			if (/^<!--\[if|^<!--\s*!/.test(token.value)) out += token.value
		} else if (token.type === "text") {
			if (!html) {
				if (token.value.trim()) out += token.value
				return
			}
			const collapsed = token.value.replace(/\s+/g, " ")
			if (collapsed !== " ") out += collapsed
			else if (!isBlockBoundary(tokens[k - 1], html) && !isBlockBoundary(tokens[k + 1], html)) out += " "
		} else if (token.type === "raw") {
			const parent = tokens[k - 1]?.name
			out += parent === "pre" || parent === "textarea" ? token.value : token.value.trim()
		} else if (token.raw) out += token.type === "close" ? token.raw.replace(/\s+/g, "") : normalizeTag(token.raw)
		else out += token.value
	})
	return out
}

const SQL_KEYWORDS = new Set(
	"add all alter and any as asc begin between by case cast check coalesce column commit constraint count create cross current_date current_timestamp database default delete desc distinct drop else end except exists false fetch first foreign from full function grant group having if ilike in index inner insert intersect interval into is join key left like limit max min natural next not null nulls offset on only or order outer over partition primary procedure references replace returning revoke right rollback row rows select set sum table then to transaction trigger true truncate union unique update using values view when where window with avg".split(" "),
)
const SQL_CLAUSES = [
	"left outer join", "right outer join", "full outer join", "insert into", "delete from", "group by", "order by", "union all", "partition by", "on conflict",
	"left join", "right join", "full join", "inner join", "cross join", "natural join", "select", "from", "where", "having", "limit", "offset", "union", "intersect",
	"except", "values", "update", "set", "with", "returning", "window", "join",
].map((c) => c.split(" "))
const SQL_FUNCTIONS = new Set(["count", "sum", "avg", "min", "max", "coalesce", "cast", "replace", "left", "right", "if"])
const SQL_LIST_CLAUSES = new Set(["select", "set", "values"])
const SQL_CONDITION_CLAUSES = new Set(["where", "having", "on", "join", "left join", "right join", "inner join", "full join", "left outer join", "right outer join", "full outer join", "cross join", "natural join"])

export function tokenizeSql(src) {
	const tokens = []
	let i = 0
	const take = (type, length) => {
		tokens.push({ type, value: src.slice(i, i + length) })
		i += length
	}
	while (i < src.length) {
		const rest = src.slice(i, i + 200)
		const char = src[i]
		if (/\s/.test(char)) {
			i += 1
			continue
		}
		if (src.startsWith("--", i)) take("line-comment", (src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i)) - i)
		else if (src.startsWith("/*", i)) take("block-comment", endOf(src, "*/", i + 2) - i)
		else if (char === "'" || char === "\"" || char === "`" || char === "[") {
			const close = char === "[" ? "]" : char
			let j = i + 1
			while (j < src.length) {
				if (src[j] === close && src[j + 1] === close && close !== "]") j += 2
				else if (src[j] === close) break
				else j += 1
			}
			take(char === "'" ? "string" : "ident", j + 1 - i)
		} else if (/^\$[A-Za-z_]*\$/.test(rest)) {
			const tag = rest.match(/^\$[A-Za-z_]*\$/)[0]
			take("string", endOf(src, tag, i + tag.length) - i)
		} else if (/^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?|\.\d+)/.test(rest)) take("number", rest.match(/^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?|\.\d+)/)[0].length)
		else if (/^[:@#]?[\p{L}_][\p{L}\p{N}_$#]*/u.test(rest)) take("word", rest.match(/^[:@#]?[\p{L}_][\p{L}\p{N}_$#]*/u)[0].length)
		else if (/^(<>|<=|>=|!=|\|\||::|->>|->|:=)/.test(rest)) take("op", rest.match(/^(<>|<=|>=|!=|\|\||::|->>|->|:=)/)[0].length)
		else take("(),;.".includes(char) ? char : "op", 1)
	}
	return tokens
}

function matchClause(tokens, k) {
	for (const words of SQL_CLAUSES) {
		if (words.every((word, n) => tokens[k + n]?.type === "word" && tokens[k + n].value.toLowerCase() === word)) return words
	}
	return null
}

function sqlWord(token, upper) {
	return upper && token.type === "word" && SQL_KEYWORDS.has(token.value.toLowerCase()) ? token.value.toUpperCase() : token.value
}

function sqlNeedsSpace(prev, token, clause) {
	if (!prev) return false
	if (prev.type === "(" || prev.type === "." || prev.value === "::") return false
	if (token.type === ")" || token.type === "," || token.type === "." || token.type === ";" || token.value === "::") return false
	if (token.type === "(" && prev.type === "word" && clause !== "insert into") {
		const word = prev.value.toLowerCase()
		if (SQL_FUNCTIONS.has(word) || !SQL_KEYWORDS.has(word)) return false
	}
	return true
}

export function beautifySql(src, unit = "  ", upper = true) {
	const tokens = tokenizeSql(src)
	const out = []
	let line = ""
	let level = 0
	let clause = ""
	let prev = null
	const parens = []
	const newline = (indent) => {
		if (line.trim()) out.push(line.trimEnd())
		line = unit.repeat(Math.max(0, indent))
		prev = null
	}
	const write = (token, text) => {
		line += (sqlNeedsSpace(prev, token, clause) ? " " : "") + text
		prev = token
	}
	const atClauseLevel = () => !parens.length || parens[parens.length - 1].sub
	for (let k = 0; k < tokens.length; k += 1) {
		const token = tokens[k]
		const words = token.type === "word" && atClauseLevel() ? matchClause(tokens, k) : null
		const lowerValue = token.value.toLowerCase()
		if (words) {
			clause = words.join(" ")
			newline(level)
			write(token, words.map((_, n) => sqlWord(tokens[k + n], upper)).join(" "))
			k += words.length - 1
			if (SQL_LIST_CLAUSES.has(clause)) newline(level + 1)
		} else if (token.type === "word" && (lowerValue === "and" || lowerValue === "or") && atClauseLevel() && SQL_CONDITION_CLAUSES.has(clause)) {
			newline(level + 1)
			write(token, sqlWord(token, upper))
		} else if (token.type === ",") {
			write(token, ",")
			if (SQL_LIST_CLAUSES.has(clause) && atClauseLevel()) newline(level + 1)
		} else if (token.type === "(") {
			const nextWord = tokens[k + 1]?.value?.toLowerCase()
			const sub = nextWord === "select" || nextWord === "with"
			write(token, "(")
			const lineLevel = Math.floor(indentWidth(line.replace(/\t/g, "    ")) / Math.max(1, indentWidth(unit.replace(/\t/g, "    "))))
			parens.push({ sub, level, clause, lineLevel })
			if (sub) level = lineLevel + 1
		} else if (token.type === ")") {
			const open = parens.pop()
			if (open?.sub) {
				level = open.level
				clause = open.clause
				newline(open.lineLevel)
			}
			write(token, ")")
		} else if (token.type === ";") {
			write(token, ";")
			newline(0)
			out.push("")
			level = 0
			clause = ""
			parens.length = 0
		} else if (token.type === "line-comment") {
			write(token, token.value)
			newline(level + (clause ? 1 : 0))
		} else write(token, sqlWord(token, upper))
	}
	newline(0)
	while (out.length && out[out.length - 1] === "") out.pop()
	return `${out.join("\n")}\n`
}

export function minifySql(src) {
	let out = ""
	let prev = null
	for (const token of tokenizeSql(src)) {
		if (token.type === "line-comment" || (token.type === "block-comment" && !token.value.startsWith("/*+"))) continue
		out += (prev?.type !== "," && sqlNeedsSpace(prev, token, "") ? " " : "") + token.value
		prev = token
	}
	return out
}

export function detectCodeLanguage(text) {
	const t = text.trim()
	if (/^<\?xml|^<(svg|rss|feed|project|configuration|beans|manifest)\b/i.test(t)) return "xml"
	if (t.startsWith("<")) return /<(!doctype html|html|head|body|div|p|span|a|ul|section|main)\b/i.test(t) || !/xmlns|<\/?[A-Za-z]+:[A-Za-z]/.test(t) ? "html" : "xml"
	if (/^(select|insert|update|delete|with|create|alter|drop|merge|truncate)\b/i.test(t)) return "sql"
	return "css"
}

function compactText(text, lower) {
	const stripped = text.replace(/\s+/g, "").replace(/;/g, "")
	return lower ? stripped.toLowerCase() : stripped
}

export function formatCode(text, { language = "auto", mode = "beautify", indent = "2", uppercase = true } = {}) {
	const input = required(text, "Code").replace(/^﻿/, "")
	const lang = language === "auto" ? detectCodeLanguage(input) : language
	const unit = INDENT_UNITS[indent] ?? "  "
	const formatters = {
		css: { beautify: () => beautifyCss(input, unit), minify: () => minifyCss(input) },
		html: { beautify: () => beautifyMarkup(input, unit, true), minify: () => minifyMarkup(input, true) },
		xml: { beautify: () => beautifyMarkup(input, unit, false), minify: () => minifyMarkup(input, false) },
		sql: { beautify: () => beautifySql(input, unit, uppercase), minify: () => minifySql(input) },
	}
	const formatter = formatters[lang]
	if (!formatter) throw new ToolError(`Unsupported language: ${lang}`)
	const output = mode === "minify" ? formatter.minify() : formatter.beautify()
	// Beautifying may only change whitespace, semicolons and keyword case; anything else means a formatter bug.
	if (mode !== "minify" && compactText(output, lang === "sql") !== compactText(input, lang === "sql")) {
		throw new ToolError("This input could not be formatted without changing its content; it may be malformed")
	}
	const ext = { css: "css", html: "html", xml: "xml", sql: "sql" }[lang]
	return { type: "text", value: output, download: { filename: `formatted.${ext}`, mime: lang === "html" ? "text/html" : lang === "xml" ? "application/xml" : `text/${ext === "sql" ? "plain" : ext}`, text: output } }
}

function safeMarkdownUrl(raw, image) {
	const url = String(raw ?? "").trim()
	const compact = url.replace(/[\x00-\x20\x7f]/g, "").toLowerCase()
	if (image) return /^https?:\/\//.test(compact) || /^data:image\/(png|gif|jpe?g|webp|avif|bmp|svg\+xml)[;,]/.test(compact) ? url : null
	return /^(https?:\/\/|mailto:)/.test(compact) || url.startsWith("#") ? url : null
}

function linkHtml(url, inner, title) {
	const safe = safeMarkdownUrl(url, false)
	if (!safe) return inner
	const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
	return `<a href="${escapeHtml(safe)}"${titleAttr} rel="noopener noreferrer" target="_blank">${inner}</a>`
}

// Code spans, escapes and links become placeholders before escaping so their content is never reinterpreted.
export function renderMarkdownInline(source, holds = [], nested = false) {
	const hold = (html) => `\x00${holds.push(html) - 1}\x01`
	let s = nested ? String(source) : String(source).replace(/[\x00\x01]/g, "")
	s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => hold(`<code>${escapeHtml(code.replace(/^ ([\s\S]+) $/, "$1"))}</code>`))
	s = s.replace(/\\([!-/:-@[-`{-~])/g, (m, char) => hold(escapeHtml(char)))
	s = s.replace(/\\\n/g, () => hold("<br>\n"))
	s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/gi, (m, url) => hold(linkHtml(url, escapeHtml(url))))
	s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (m, alt, src, t1, t2) => {
		const url = safeMarkdownUrl(src, true)
		const title = t1 ?? t2
		return hold(url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""}>` : escapeHtml(alt))
	})
	s = s.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (m, label, href, t1, t2) =>
		hold(linkHtml(href, renderMarkdownInline(label, holds, true), t1 ?? t2)),
	)
	s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<\x00]*[^\s<\x00.,:;"')\]!?*_~])/g, (m, pre, url) =>
		pre + hold(linkHtml(url.startsWith("www.") ? `https://${url}` : url, escapeHtml(url))),
	)
	s = escapeHtml(s)
		.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
		.replace(/\*(?=\S)([\s\S]*?\S)\*/g, "<em>$1</em>")
		.replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1<em>$2</em>")
		.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
		.replace(/ {2,}\n/g, "<br>\n")
	if (nested) return s
	for (let guard = 0; guard < 50 && /\x00\d+\x01/.test(s); guard += 1) {
		s = s.replace(/\x00(\d+)\x01/g, (m, n) => holds[Number(n)])
	}
	return s
}

const MD_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const MD_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const MD_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const MD_QUOTE = /^ {0,3}>/
const MD_LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/
const MD_TABLE_DELIM = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function indentWidth(line) {
	let width = 0
	for (const char of line) {
		if (char === " ") width += 1
		else if (char === "\t") width += 4 - (width % 4)
		else break
	}
	return width
}

function startsMarkdownBlock(line) {
	return MD_FENCE.test(line) || MD_HEADING.test(line) || MD_HR.test(line) || MD_QUOTE.test(line) || /^ {0,3}([-*+]|1[.)])[ \t]+\S/.test(line)
}

function splitTableRow(line) {
	let s = line.trim()
	if (s.startsWith("|")) s = s.slice(1)
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1)
	const cells = []
	let cell = ""
	let code = false
	for (let i = 0; i < s.length; i += 1) {
		if (s[i] === "\\" && s[i + 1] === "|") {
			cell += "|"
			i += 1
			continue
		}
		if (s[i] === "`") code = !code
		if (s[i] === "|" && !code) {
			cells.push(cell.trim())
			cell = ""
		} else cell += s[i]
	}
	cells.push(cell.trim())
	return cells
}

function renderTable(lines, start) {
	const header = splitTableRow(lines[start])
	const aligns = splitTableRow(lines[start + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""))
	if (aligns.length !== header.length) return null
	const cell = (tag, text, index) => `<${tag}${aligns[index] ? ` style="text-align:${aligns[index]}"` : ""}>${renderMarkdownInline(text)}</${tag}>`
	let i = start + 2
	const rows = []
	while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
		const cells = splitTableRow(lines[i])
		rows.push(`<tr>${header.map((_, n) => cell("td", cells[n] ?? "", n)).join("")}</tr>`)
		i += 1
	}
	const head = `<thead><tr>${header.map((h, n) => cell("th", h, n)).join("")}</tr></thead>`
	return { html: `<table>${head}${rows.length ? `<tbody>${rows.join("")}</tbody>` : ""}</table>`, next: i }
}

function listKey(match) {
	return /\d/.test(match[2]) ? `ol${match[2].slice(-1)}` : `ul${match[2]}`
}

function parseMarkdownList(lines, start, state) {
	const first = lines[start].match(MD_LIST_ITEM)
	const key = listKey(first)
	const items = []
	let loose = false
	let i = start
	while (i < lines.length) {
		const match = lines[i].match(MD_LIST_ITEM)
		if (!match || listKey(match) !== key || MD_HR.test(lines[i])) break
		const gap = match[3].replace(/\t/g, "    ").length
		const contentIndent = match[1].length + match[2].length + (gap > 4 || !match[4] ? 1 : gap)
		const body = [gap > 4 ? " ".repeat(gap - 1) + match[4] : match[4]]
		i += 1
		let sawBlank = false
		while (i < lines.length) {
			const line = lines[i]
			if (!line.trim()) {
				let j = i + 1
				while (j < lines.length && !lines[j].trim()) j += 1
				if (j < lines.length && indentWidth(lines[j]) >= contentIndent) {
					body.push(...Array(j - i).fill(""))
					i = j
					sawBlank = true
					continue
				}
				break
			}
			if (indentWidth(line) >= contentIndent) body.push(line.replace(/^[ \t]+/, (ws) => " ".repeat(Math.max(0, indentWidth(ws) - contentIndent))))
			else if (sawBlank || MD_LIST_ITEM.test(line) || startsMarkdownBlock(line)) break
			else body.push(line.trim())
			i += 1
		}
		if (sawBlank) loose = true
		items.push(body)
		let j = i
		while (j < lines.length && !lines[j].trim()) j += 1
		const nextMatch = j < lines.length ? lines[j].match(MD_LIST_ITEM) : null
		if (j > i && nextMatch && listKey(nextMatch) === key) {
			loose = true
			i = j
		}
	}
	const ordered = key.startsWith("ol")
	const startNumber = ordered ? parseInt(first[2], 10) : 1
	const tag = ordered ? "ol" : "ul"
	const rendered = items.map((body) => {
		const task = body[0].match(/^\[([ xX])\][ \t]+/)
		let checkbox = ""
		if (task) {
			checkbox = `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> `
			body[0] = body[0].slice(task[0].length)
		}
		const inner = renderMarkdownBlocks(body, { ...state, tight: !loose })
		return `<li${task ? " class=\"task\"" : ""}>${checkbox}${inner}</li>`
	})
	const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : ""
	return { html: `<${tag}${startAttr}>\n${rendered.join("\n")}\n</${tag}>`, next: i }
}

function headingHtml(level, text, state) {
	const inner = renderMarkdownInline(text)
	const plain = text.replace(/[`*_~[\]()#!<>]/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section"
	const count = state.ids.get(plain) ?? 0
	state.ids.set(plain, count + 1)
	const id = count ? `${plain}-${count}` : plain
	return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`
}

function renderMarkdownBlocks(lines, state) {
	const out = []
	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		let match
		if (!line.trim()) {
			i += 1
		} else if ((match = line.match(MD_FENCE))) {
			const fence = match[1]
			const closing = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`)
			const body = []
			i += 1
			while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++])
			i += 1
			const lang = match[2] ? ` class="language-${escapeHtml(match[2].replace(/[^\w+-]/g, ""))}"` : ""
			out.push(`<pre><code${lang}>${escapeHtml(body.join("\n"))}</code></pre>`)
		} else if ((match = line.match(MD_HEADING))) {
			out.push(headingHtml(match[1].length, match[2] ?? "", state))
			i += 1
		} else if (MD_HR.test(line)) {
			out.push("<hr>")
			i += 1
		} else if (MD_QUOTE.test(line)) {
			const body = []
			while (i < lines.length && lines[i].trim() && (MD_QUOTE.test(lines[i]) || body.length)) body.push(lines[i++].replace(/^ {0,3}> ?/, ""))
			out.push(`<blockquote>\n${renderMarkdownBlocks(body, { ...state, tight: false })}\n</blockquote>`)
		} else if (MD_LIST_ITEM.test(line)) {
			const list = parseMarkdownList(lines, i, state)
			out.push(list.html)
			i = list.next
		} else if (line.includes("|") && MD_TABLE_DELIM.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-") && renderTable(lines, i)) {
			const table = renderTable(lines, i)
			out.push(table.html)
			i = table.next
		} else if (indentWidth(line) >= 4 && !state.tight) {
			const body = []
			while (i < lines.length && (!lines[i].trim() || indentWidth(lines[i]) >= 4)) body.push(lines[i++].replace(/^( {4}|\t| {0,3}\t)/, ""))
			while (body.length && !body[body.length - 1].trim()) body.pop()
			out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`)
		} else {
			const para = [line.trimStart()]
			i += 1
			let heading = 0
			while (i < lines.length && lines[i].trim()) {
				if (/^ {0,3}=+\s*$/.test(lines[i])) heading = 1
				else if (/^ {0,3}-+\s*$/.test(lines[i])) heading = 2
				if (heading) {
					i += 1
					break
				}
				if (startsMarkdownBlock(lines[i])) break
				para.push(lines[i++].trimStart())
			}
			const text = para.join("\n")
			if (heading) out.push(headingHtml(heading, text.trim(), state))
			else {
				const inner = renderMarkdownInline(text.replace(/\s+$/, ""))
				out.push(state.tight ? inner : `<p>${inner}</p>`)
			}
		}
	}
	return out.join("\n")
}

export function renderMarkdown(text) {
	const lines = String(text ?? "").replace(/^﻿/, "").split(/\r\n|\r|\n/)
	return renderMarkdownBlocks(lines, { ids: new Map(), tight: false })
}

const MARKDOWN_CSS = [
	":root{color-scheme:light dark}",
	"body{margin:0;padding:16px;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;background:#fff;word-wrap:break-word}",
	"@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}a{color:#4493f8}code,pre{background:#161b22!important}th,td{border-color:#30363d!important}blockquote{border-color:#30363d!important;color:#9198a1!important}}",
	"a{color:#0969da}img{max-width:100%}h1,h2{border-bottom:1px solid #8884;padding-bottom:.3em}",
	"code{font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f6f8fa;padding:.15em .35em;border-radius:4px}",
	"pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}pre code{padding:0;background:none}",
	"blockquote{margin:0;padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}",
	"table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #d1d9e0;padding:6px 13px}",
	"li.task{list-style:none}li.task input{margin:0 .4em 0 -1.4em}",
].join("\n")

export function markdownPreview(text) {
	const source = required(text, "Markdown")
	if (source.length > 1000000) throw new ToolError("Markdown input is larger than 1 MB; split it into smaller parts")
	const fragment = renderMarkdown(source)
	const title = escapeHtml(source.match(/^ {0,3}#{1,6}[ \t]+(.+)$/m)?.[1]?.replace(/[#*_`]/g, "").trim() || "Markdown preview")
	const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title><style>\n${MARKDOWN_CSS}\n</style></head>\n<body>\n${fragment}\n</body></html>\n`
	return { type: "html-preview", value: { html, source: fragment }, copy: fragment, download: { filename: "markdown.html", mime: "text/html", text: html } }
}

const QUERY_RESULT_LIMIT = 2000

function queryError(message) {
	return new ToolError(`Query error: ${message}`)
}

function readQuoted(text, pos) {
	const quote = text[pos]
	let i = pos + 1
	let value = ""
	while (i < text.length && text[i] !== quote) {
		if (text[i] === "\\" && i + 1 < text.length) i += 1
		value += text[i]
		i += 1
	}
	if (i >= text.length) throw queryError("unterminated string")
	return { value, end: i + 1 }
}

function findClosing(text, pos, open, close) {
	let depth = 0
	for (let i = pos; i < text.length; i += 1) {
		if (text[i] === "'" || text[i] === "\"") i = readQuoted(text, i).end - 1
		else if (text[i] === open) depth += 1
		else if (text[i] === close) {
			depth -= 1
			if (!depth) return i
		}
	}
	throw queryError(`missing "${close}"`)
}

function parseBracketSelector(part) {
	const text = part.trim()
	if (text === "*") return { type: "wildcard" }
	if (/^['"]/.test(text)) return { type: "name", name: readQuoted(text, 0).value }
	const slice = text.match(/^(-?\d*)\s*:\s*(-?\d*)(?:\s*:\s*(-?\d+))?$/)
	if (slice) return { type: "slice", start: slice[1] === "" ? null : Number(slice[1]), end: slice[2] === "" ? null : Number(slice[2]), step: slice[3] ? Number(slice[3]) : 1 }
	if (/^-?\d+$/.test(text)) return { type: "index", index: Number(text) }
	if (text) return { type: "name", name: text }
	throw queryError("empty brackets")
}

function splitTopLevel(text) {
	const parts = []
	let start = 0
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "'" || text[i] === "\"") i = readQuoted(text, i).end - 1
		else if (text[i] === ",") {
			parts.push(text.slice(start, i))
			start = i + 1
		}
	}
	parts.push(text.slice(start))
	return parts
}

export function parseJsonQuery(query) {
	let text = String(query ?? "").trim() || "$"
	if (!text.startsWith("$") && !text.startsWith("@")) text = text.startsWith(".") || text.startsWith("[") ? `$${text}` : `$.${text}`
	const segments = []
	let pos = 1
	while (pos < text.length) {
		const char = text[pos]
		if (/\s/.test(char)) {
			pos += 1
			continue
		}
		const descendant = text.startsWith("..", pos)
		if (char === "." || descendant) {
			pos += descendant ? 2 : 1
			if (text[pos] === "[") continue
			if (text[pos] === "*") {
				segments.push({ descendant, selectors: [{ type: "wildcard" }] })
				pos += 1
				continue
			}
			const name = text.slice(pos).match(/^[^.[\s]+/)?.[0]
			if (!name) throw queryError(`expected a name after "." at position ${pos + 1}`)
			segments.push({ descendant, selectors: [{ type: "name", name }] })
			pos += name.length
		} else if (char === "[") {
			const isDescendant = text.slice(pos - 2, pos) === ".."
			const close = findClosing(text, pos, "[", "]")
			const inner = text.slice(pos + 1, close).trim()
			const selectors = inner.startsWith("?") ? [{ type: "filter", expr: parseFilter(inner.slice(1).trim().replace(/^\(([\s\S]*)\)$/, "$1")) }] : splitTopLevel(inner).map(parseBracketSelector)
			segments.push({ descendant: isDescendant, selectors })
			pos = close + 1
		} else throw queryError(`unexpected "${char}" at position ${pos + 1}`)
	}
	return segments
}

function tokenizeFilter(text) {
	const tokens = []
	let pos = 0
	while (pos < text.length) {
		const rest = text.slice(pos)
		let match
		if (/^\s/.test(rest)) pos += 1
		else if (rest[0] === "'" || rest[0] === "\"") {
			const quoted = readQuoted(text, pos)
			tokens.push({ type: "literal", value: quoted.value })
			pos = quoted.end
		} else if ((match = rest.match(/^[@$](?:\.[\p{L}_$][\p{L}\p{N}_$-]*|\.\*|\[\s*(?:-?\d+|'[^']*'|"[^"]*"|\*)\s*\])*/u))) {
			tokens.push({ type: "path", root: match[0][0], segments: parseJsonQuery(`$${match[0].slice(1)}`) })
			pos += match[0].length
		} else if ((match = rest.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/))) {
			tokens.push({ type: "literal", value: Number(match[0]) })
			pos += match[0].length
		} else if ((match = rest.match(/^(true|false|null)\b/))) {
			tokens.push({ type: "literal", value: JSON.parse(match[0]) })
			pos += match[0].length
		} else if (tokens[tokens.length - 1]?.value === "=~" && (match = rest.match(/^\/((?:\\.|[^/\\])+)\/([a-z]*)/))) {
			let regex
			try {
				regex = new RegExp(match[1], match[2])
			} catch (error) {
				throw queryError(error.message)
			}
			tokens.push({ type: "literal", value: regex })
			pos += match[0].length
		} else if ((match = rest.match(/^(===|!==|==|!=|<=|>=|=~|&&|\|\||[<>!()])/))) {
			tokens.push({ type: "op", value: match[0] })
			pos += match[0].length
		} else throw queryError(`unexpected "${rest[0]}" in filter`)
	}
	return tokens
}

function parseFilter(text) {
	const tokens = tokenizeFilter(text)
	let pos = 0
	const peek = () => tokens[pos]
	const isOp = (value) => peek()?.type === "op" && peek().value === value
	const primary = () => {
		const token = tokens[pos++]
		if (!token) throw queryError("incomplete filter expression")
		if (token.type === "op" && token.value === "(") {
			const inner = or()
			if (!isOp(")")) throw queryError("missing ) in filter")
			pos += 1
			return inner
		}
		if (token.type === "op") throw queryError(`unexpected "${token.value}" in filter`)
		return token
	}
	const comparison = () => {
		const left = primary()
		const op = peek()
		if (op?.type === "op" && /^(===|!==|==|!=|<=|>=|=~|<|>)$/.test(op.value)) {
			pos += 1
			return { type: "compare", op: op.value, left, right: primary() }
		}
		return left
	}
	const unary = () => {
		if (isOp("!")) {
			pos += 1
			return { type: "not", operand: unary() }
		}
		return comparison()
	}
	const and = () => {
		let node = unary()
		while (isOp("&&")) {
			pos += 1
			node = { type: "and", left: node, right: unary() }
		}
		return node
	}
	const or = () => {
		let node = and()
		while (isOp("||")) {
			pos += 1
			node = { type: "or", left: node, right: and() }
		}
		return node
	}
	const expr = or()
	if (pos < tokens.length) throw queryError("unexpected trailing tokens in filter")
	return expr
}

function childEntries(value) {
	if (Array.isArray(value)) return value.map((v, i) => [i, v])
	if (value && typeof value === "object") return Object.entries(value)
	return []
}

function formatPathPart(key) {
	if (typeof key === "number") return `[${key}]`
	return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

function evaluateFilterValue(node, current, root) {
	if (node.type === "literal") return node.value
	if (node.type === "path") {
		const base = node.root === "@" ? current : root
		const found = evaluateSegments(node.segments, base, base)
		if (found.length) return found[0].value
		const last = node.segments[node.segments.length - 1]?.selectors[0]
		if (last?.type === "name" && last.name === "length") {
			const parent = evaluateSegments(node.segments.slice(0, -1), base, base)[0]?.value
			if (Array.isArray(parent) || typeof parent === "string") return parent.length
		}
		return undefined
	}
	return evaluateFilter(node, current, root)
}

function looseEqual(a, b) {
	if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b)
	return a === b
}

function evaluateFilter(node, current, root) {
	if (node.type === "and") return evaluateFilter(node.left, current, root) && evaluateFilter(node.right, current, root)
	if (node.type === "or") return evaluateFilter(node.left, current, root) || evaluateFilter(node.right, current, root)
	if (node.type === "not") return !evaluateFilter(node.operand, current, root)
	if (node.type !== "compare") {
		const value = evaluateFilterValue(node, current, root)
		return value !== undefined && value !== false && value !== null
	}
	const left = evaluateFilterValue(node.left, current, root)
	const right = evaluateFilterValue(node.right, current, root)
	const comparable = (typeof left === "number" && typeof right === "number") || (typeof left === "string" && typeof right === "string")
	switch (node.op) {
		case "==":
		case "===":
			return looseEqual(left, right)
		case "!=":
		case "!==":
			return !looseEqual(left, right)
		case "<":
			return comparable && left < right
		case "<=":
			return comparable && left <= right
		case ">":
			return comparable && left > right
		case ">=":
			return comparable && left >= right
		case "=~":
			return typeof left === "string" && right instanceof RegExp && right.test(left)
		default:
			return false
	}
}

function applySelector(selector, node, root, out) {
	const { value, path } = node
	if (selector.type === "name") {
		if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, selector.name)) out.push({ path: path + formatPathPart(selector.name), value: value[selector.name] })
	} else if (selector.type === "index") {
		if (Array.isArray(value)) {
			const index = selector.index < 0 ? value.length + selector.index : selector.index
			if (index >= 0 && index < value.length) out.push({ path: path + formatPathPart(index), value: value[index] })
		}
	} else if (selector.type === "wildcard") {
		for (const [key, child] of childEntries(value)) out.push({ path: path + formatPathPart(key), value: child })
	} else if (selector.type === "slice") {
		if (!Array.isArray(value) || !selector.step) return
		const len = value.length
		const norm = (n, fallback) => (n === null ? fallback : n < 0 ? Math.max(len + n, -1) : Math.min(n, len))
		if (selector.step > 0) {
			for (let i = Math.max(norm(selector.start, 0), 0); i < norm(selector.end, len); i += selector.step) out.push({ path: path + formatPathPart(i), value: value[i] })
		} else {
			for (let i = Math.min(norm(selector.start, len - 1), len - 1); i > norm(selector.end, -1); i += selector.step) out.push({ path: path + formatPathPart(i), value: value[i] })
		}
	} else if (selector.type === "filter") {
		for (const [key, child] of childEntries(value)) {
			if (evaluateFilter(selector.expr, child, root)) out.push({ path: path + formatPathPart(key), value: child })
		}
	}
}

function descendants(node, out, budget) {
	out.push(node)
	if (out.length > budget) throw queryError("the document is too large for a recursive (..) query")
	for (const [key, child] of childEntries(node.value)) descendants({ path: node.path + formatPathPart(key), value: child }, out, budget)
	return out
}

function evaluateSegments(segments, value, root) {
	let nodes = [{ path: "$", value }]
	for (const segment of segments) {
		const sources = segment.descendant ? nodes.flatMap((n) => descendants(n, [], 1000000)) : nodes
		const next = []
		for (const node of sources) {
			for (const selector of segment.selectors) applySelector(selector, node, root, next)
		}
		nodes = next
	}
	return nodes
}

export function queryJson(data, query) {
	return evaluateSegments(parseJsonQuery(query), data, data)
}

export const formatTools = [
	{
		id: "json-yaml",
		name: "JSON ⇄ YAML converter",
		category: "Formats",
		roles: ["dev", "it", "qa"],
		description: "Convert JSON to YAML and back, with anchors, merge keys, block scalars, comments and multi document files.",
		keywords: ["yaml", "yml", "json", "convert", "kubernetes", "docker compose", "openapi", "config", "ci"],
		live: true,
		inputs: [
			{ key: "text", label: "JSON or YAML", type: "textarea", upload: { accept: ".json,.yaml,.yml,application/json,text/*" } },
			{
				key: "mode",
				label: "Direction",
				type: "select",
				options: [
					{ value: "auto", label: "Auto detect" },
					{ value: "json-to-yaml", label: "JSON → YAML" },
					{ value: "yaml-to-json", label: "YAML → JSON" },
				],
				default: "auto",
			},
			{ key: "indent", label: "Indent", type: "select", options: [{ value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }], default: "2" },
		],
		run: ({ text, mode = "auto", indent = "2" }) => convertJsonYaml(text, mode, indent),
	},
	{
		id: "code-format",
		name: "Code beautifier / minifier",
		category: "Formats",
		roles: ["dev", "qa", "design"],
		description: "Beautify or minify CSS, HTML, XML and SQL locally; formatting never changes content beyond whitespace.",
		keywords: ["beautify", "prettify", "minify", "format", "css", "html", "xml", "svg", "sql", "pretty print", "indent", "compress"],
		live: true,
		inputs: [
			{ key: "text", label: "Code", type: "textarea", upload: { accept: ".css,.scss,.html,.htm,.xml,.svg,.xsd,.wsdl,.plist,.sql,text/*" } },
			{
				key: "language",
				label: "Language",
				type: "select",
				options: [
					{ value: "auto", label: "Auto detect" },
					{ value: "css", label: "CSS" },
					{ value: "html", label: "HTML" },
					{ value: "xml", label: "XML / SVG" },
					{ value: "sql", label: "SQL" },
				],
				default: "auto",
			},
			{ key: "mode", label: "Mode", type: "select", options: [{ value: "beautify", label: "Beautify" }, { value: "minify", label: "Minify" }], default: "beautify", help: "Minify drops comments (except /*! and conditional comments)." },
			{ key: "indent", label: "Indent", type: "select", options: [{ value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }, { value: "tab", label: "Tabs" }], default: "2", showIf: { key: "mode", in: ["beautify"] } },
			{ key: "uppercase", label: "Uppercase SQL keywords", type: "checkbox", default: true, showIf: { key: "language", in: ["sql", "auto"] } },
		],
		run: ({ text, language = "auto", mode = "beautify", indent = "2", uppercase = true }) => formatCode(text, { language, mode, indent, uppercase }),
	},
	{
		id: "markdown-preview",
		name: "Markdown preview",
		category: "Formats",
		roles: ["dev", "qa", "design", "it"],
		description: "Render Markdown (GFM tables, task lists, code) to safe HTML: raw HTML is escaped and only http, https, mailto and # links survive.",
		keywords: ["markdown", "md", "readme", "gfm", "preview", "render", "html", "changelog"],
		live: true,
		inputs: [{ key: "text", label: "Markdown", type: "textarea", placeholder: "# Title\n\nSome **bold** text", upload: { accept: ".md,.markdown,.mdown,.txt,text/*" } }],
		run: ({ text }) => markdownPreview(text),
	},
	{
		id: "json-query",
		name: "JSON query (JSONPath)",
		category: "Formats",
		roles: ["dev", "qa"],
		description: "Pull values out of large JSON with JSONPath: $.items[*].id, ..email, [0:5], [?(@.price < 10)].",
		keywords: ["jsonpath", "jq", "query", "filter", "extract", "select", "json explorer", "search json"],
		live: true,
		inputs: [
			{ key: "json", label: "JSON", type: "textarea", upload: { accept: ".json,.har,application/json,text/*" } },
			{ key: "query", label: "Query", type: "text", default: "$", placeholder: "$.store.book[?(@.price < 10)].title", help: "$ root · .key or ['key'] · [0], [-1], [1:3] · [*] · ..key (any depth) · [?(@.a == 'x' && @.n > 2)] · =~ /regex/i" },
			{ key: "output", label: "Output", type: "select", options: [{ value: "values", label: "Values" }, { value: "paths", label: "Paths" }, { value: "both", label: "Paths and values" }], default: "values" },
		],
		run: ({ json, query = "$", output = "values" }) => {
			const data = parseJsonWithDiagnostics(required(json, "JSON"))
			const matches = queryJson(data, query)
			const shown = matches.slice(0, QUERY_RESULT_LIMIT)
			const results = output === "paths" ? shown.map((m) => m.path) : output === "both" ? shown.map((m) => ({ path: m.path, value: m.value })) : shown.map((m) => m.value)
			const value = matches.length > QUERY_RESULT_LIMIT ? { count: matches.length, truncated: true, shown: QUERY_RESULT_LIMIT, results } : results
			return { type: "json", value, copy: JSON.stringify(results, null, 2) }
		},
	},
]

