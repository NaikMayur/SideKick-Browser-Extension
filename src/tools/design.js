import { ToolError, clamp, required, round } from "../lib/utils.js"

export function parseColor(input) {
	const value = String(input).trim().toLowerCase()
	const hex = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
	if (hex) {
		let raw = hex[1]
		if (raw.length === 3 || raw.length === 4) raw = [...raw].map((c) => c + c).join("")
		const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16))
		const a = raw.length === 8 ? round(parseInt(raw.slice(6, 8), 16) / 255, 3) : 1
		return { r, g, b, a }
	}
	const rgb = value.match(/^rgba?\(([^)]+)\)$/)
	if (rgb) {
		const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number)
		if (parts.length < 3 || parts.some(Number.isNaN)) throw new ToolError("Invalid rgb() color")
		return { r: clamp(parts[0], 0, 255), g: clamp(parts[1], 0, 255), b: clamp(parts[2], 0, 255), a: clamp(parts[3] ?? 1, 0, 1) }
	}
	const hsl = value.match(/^hsla?\(([^)]+)\)$/)
	if (hsl) {
		const parts = hsl[1].split(/[,\s/]+/).filter(Boolean)
		if (parts.length < 3) throw new ToolError("Invalid hsl() color")
		const h = parseFloat(parts[0])
		const s = clamp(parseFloat(parts[1]) / 100, 0, 1)
		const l = clamp(parseFloat(parts[2]) / 100, 0, 1)
		let a = 1
		if (parts[3] !== undefined) {
			a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
		}
		if ([h, s, l, a].some(Number.isNaN)) throw new ToolError("Invalid hsl() color")
		return { ...hslToRgb(h, s, l), a: clamp(a, 0, 1) }
	}
	throw new ToolError(`Unrecognised color: ${input}`)
}

export function hslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const hp = (((h % 360) + 360) % 360) / 60
	const x = c * (1 - Math.abs((hp % 2) - 1))
	const [r1, g1, b1] =
		hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
	const m = l - c / 2
	return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
}

export function rgbToHsl({ r, g, b }) {
	const rn = r / 255
	const gn = g / 255
	const bn = b / 255
	const max = Math.max(rn, gn, bn)
	const min = Math.min(rn, gn, bn)
	const delta = max - min
	const l = (max + min) / 2
	let h = 0
	if (delta !== 0) {
		if (max === rn) h = ((gn - bn) / delta) % 6
		else if (max === gn) h = (bn - rn) / delta + 2
		else h = (rn - gn) / delta + 4
	}
	h = Math.round(h * 60)
	if (h < 0) h += 360
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
	return { h, s: round(s * 100, 1), l: round(l * 100, 1) }
}

export function toHex({ r, g, b, a = 1 }) {
	const part = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")
	return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a * 255) : ""}`
}

export function relativeLuminance({ r, g, b }) {
	const channel = (v) => {
		const s = v / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(colorA, colorB) {
	const l1 = relativeLuminance(parseColor(colorA))
	const l2 = relativeLuminance(parseColor(colorB))
	const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1]
	return round((light + 0.05) / (dark + 0.05), 2)
}

export function wcagVerdict(ratio) {
	return {
		ratio,
		normalTextAA: ratio >= 4.5,
		normalTextAAA: ratio >= 7,
		largeTextAA: ratio >= 3,
		largeTextAAA: ratio >= 4.5,
		uiComponentsAA: ratio >= 3,
	}
}

export function shades(color, steps = 9) {
	const base = parseColor(color)
	const { h, s } = rgbToHsl(base)
	const count = clamp(Number(steps) || 9, 3, 15)
	return Array.from({ length: count }, (_, i) => {
		const l = 95 - (90 / (count - 1)) * i
		const rgb = hslToRgb(h, s / 100, l / 100)
		return { step: (i + 1) * 100, hex: toHex(rgb), hsl: `hsl(${h} ${round(s, 1)}% ${round(l, 1)}%)` }
	})
}

export const designTools = [
	{
		id: "color-convert",
		name: "Color converter",
		category: "Design",
		roles: ["design", "dev"],
		description: "HEX ↔ RGB ↔ HSL with alpha support, plus a CSS-ready value.",
		inputs: [{ key: "color", label: "Color", type: "text", default: "#2783DE" }],
		run: ({ color }) => {
			const rgb = parseColor(required(color, "Color"))
			const hsl = rgbToHsl(rgb)
			return {
				type: "json",
				value: {
					hex: toHex(rgb),
					rgb: `rgb(${rgb.r} ${rgb.g} ${rgb.b}${rgb.a < 1 ? ` / ${rgb.a}` : ""})`,
					hsl: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`,
					luminance: round(relativeLuminance(rgb), 4),
					suggestedTextColor: relativeLuminance(rgb) > 0.35 ? "#2C2C2B" : "#FFFFFF",
				},
				swatch: toHex(rgb),
			}
		},
	},
	{
		id: "contrast-checker",
		name: "WCAG contrast checker",
		category: "Design",
		roles: ["design", "qa", "a11y"],
		description: "Contrast ratio with AA/AAA verdicts for normal text, large text and UI parts.",
		inputs: [
			{ key: "foreground", label: "Foreground", type: "text", default: "#7D7A75" },
			{ key: "background", label: "Background", type: "text", default: "#FFFFFF" },
		],
		run: ({ foreground, background }) => {
			const fg = required(foreground, "Foreground")
			const bg = required(background, "Background")
			const ratio = contrastRatio(fg, bg)
			return { type: "json", value: { ...wcagVerdict(ratio), foreground: fg, background: bg } }
		},
	},
	{
		id: "palette",
		name: "Tint & shade scale",
		category: "Design",
		roles: ["design"],
		description: "Generate a 100–900 design-token ramp from one brand color.",
		inputs: [
			{ key: "color", label: "Base color", type: "text", default: "#2783DE" },
			{ key: "steps", label: "Steps", type: "number", default: 9 },
		],
		run: ({ color, steps = 9 }) => ({ type: "json", value: shades(required(color, "Base color"), steps) }),
	},
	{
		id: "unit-convert",
		name: "CSS unit converter",
		category: "Design",
		roles: ["design", "dev"],
		description: "px ↔ rem ↔ em ↔ pt ↔ % against a configurable root size.",
		inputs: [
			{ key: "value", label: "Value", type: "number", default: 24 },
			{ key: "unit", label: "From unit", type: "select", options: ["px", "rem", "em", "pt"], default: "px" },
			{ key: "root", label: "Root font size (px)", type: "number", default: 16 },
		],
		run: ({ value = 0, unit = "px", root = 16 }) => {
			const base = Math.max(Number(root) || 16, 1)
			const n = Number(value) || 0
			const px = unit === "px" ? n : unit === "pt" ? (n * 96) / 72 : n * base
			return {
				type: "json",
				value: { px: round(px, 3), rem: round(px / base, 4), em: round(px / base, 4), pt: round((px * 72) / 96, 3) },
			}
		},
	},
	{
		id: "type-scale",
		name: "Typographic scale",
		category: "Design",
		roles: ["design"],
		description: "Modular type ramp with matching line heights for a design system.",
		inputs: [
			{ key: "base", label: "Base size (px)", type: "number", default: 16 },
			{ key: "ratio", label: "Ratio", type: "number", default: 1.25 },
			{ key: "steps", label: "Steps up", type: "number", default: 6 },
		],
		run: ({ base = 16, ratio = 1.25, steps = 6 }) => {
			const b = Math.max(Number(base) || 16, 1)
			const r = Math.max(Number(ratio) || 1.25, 0.01)
			const count = clamp(Number(steps) || 6, 1, 12)
			const scale = Array.from({ length: count + 1 }, (_, i) => {
				const size = round(b * r ** i, 2)
				return { step: i, px: size, rem: round(size / 16, 3), lineHeight: round(size < 24 ? 1.5 : 1.25, 2) }
			})
			return { type: "json", value: scale }
		},
	},
	{
		id: "shadow-generator",
		name: "Box-shadow & gradient generator",
		category: "Design",
		roles: ["design", "dev"],
		description: "Copy-ready elevation and gradient CSS with sensible, subtle defaults.",
		inputs: [
			{ key: "elevation", label: "Elevation (1-5)", type: "number", default: 2 },
			{ key: "from", label: "Gradient from", type: "text", default: "#2783DE" },
			{ key: "to", label: "Gradient to", type: "text", default: "#E5F2FC" },
			{ key: "angle", label: "Angle (deg)", type: "number", default: 135 },
		],
		run: ({ elevation = 2, from = "#2783DE", to = "#E5F2FC", angle = 135 }) => {
			const level = clamp(Number(elevation) || 1, 1, 5)
			const y = level * 2
			const blur = level * 6
			const shadow = `0 1px 2px rgba(0,0,0,.05), 0 ${y}px ${blur}px rgba(0,0,0,${round(0.04 + level * 0.01, 3)})`
			parseColor(from)
			parseColor(to)
			return {
				type: "json",
				value: { boxShadow: shadow, gradient: `linear-gradient(${Number(angle) || 0}deg, ${from}, ${to})` },
			}
		},
	},
]
