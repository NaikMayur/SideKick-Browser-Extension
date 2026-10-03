import { ToolError, clamp, required, round } from "../lib/utils.js"

const NAMED_COLOR_DATA =
	"aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 " +
	"black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 " +
	"chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff " +
	"darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 " +
	"darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 " +
	"darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f " +
	"darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 " +
	"dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc " +
	"ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 " +
	"honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa " +
	"lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff " +
	"lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 " +
	"lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 " +
	"lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 " +
	"mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 " +
	"mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 " +
	"midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 " +
	"oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa " +
	"palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f " +
	"pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f " +
	"royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee " +
	"sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa " +
	"springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 " +
	"violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32"

export const NAMED_COLORS = Object.fromEntries(NAMED_COLOR_DATA.split(" ").map((pair) => pair.split(":")))

const HEX_TO_NAME = new Map()
for (const [name, hex] of Object.entries(NAMED_COLORS)) if (!HEX_TO_NAME.has(hex)) HEX_TO_NAME.set(hex, name)

function splitArgs(body) {
	const [main, alpha] = body.split("/")
	const parts = main.split(/[\s,]+/).filter(Boolean)
	if (alpha !== undefined) parts.push(alpha.trim())
	return parts
}

function parseAlpha(token) {
	if (token === undefined) return 1
	if (token === "none") return 0
	const n = parseFloat(token)
	if (Number.isNaN(n)) return NaN
	return clamp(token.endsWith("%") ? n / 100 : n, 0, 1)
}

function parseHue(token) {
	if (token === "none") return 0
	const n = parseFloat(token)
	if (token.endsWith("turn")) return n * 360
	if (token.endsWith("grad")) return n * 0.9
	if (token.endsWith("rad")) return (n * 180) / Math.PI
	return n
}

function parsePercent(token, scale = 1) {
	if (token === "none") return 0
	const n = parseFloat(token)
	return token.endsWith("%") ? (n / 100) * scale : n
}

function finish(rgb, a, kind) {
	const out = {
		r: Math.round(clamp(rgb.r, 0, 255)),
		g: Math.round(clamp(rgb.g, 0, 255)),
		b: Math.round(clamp(rgb.b, 0, 255)),
		a: round(a, 3),
	}
	if ([out.r, out.g, out.b, out.a].some(Number.isNaN)) throw new ToolError(`Invalid ${kind}() color`)
	return out
}

function parseHex(raw) {
	let hex = raw
	if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("")
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
	const a = hex.length === 8 ? round(parseInt(hex.slice(6, 8), 16) / 255, 3) : 1
	return { r, g, b, a }
}

function parseFunction(name, body) {
	const parts = splitArgs(body)
	if (parts.length < 3) throw new ToolError(`Invalid ${name}() color`)
	const alpha = parseAlpha(parts[3])
	if (name === "rgb" || name === "rgba") {
		const [r, g, b] = parts.slice(0, 3).map((p) => parsePercent(p, 255))
		return finish({ r, g, b }, alpha, "rgb")
	}
	if (name === "hsl" || name === "hsla") {
		const rgb = hslToRgb(parseHue(parts[0]), clamp(parseFloat(parts[1]) / 100, 0, 1), clamp(parseFloat(parts[2]) / 100, 0, 1))
		return finish(rgb, alpha, "hsl")
	}
	if (name === "hwb") {
		return finish(hwbToRgb(parseHue(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100), alpha, "hwb")
	}
	if (name === "oklab") {
		const rgb = oklabToRgb(parsePercent(parts[0]), parsePercent(parts[1], 0.4), parsePercent(parts[2], 0.4))
		return finish(rgb, alpha, "oklab")
	}
	if (name === "oklch") {
		const rgb = oklchToRgb(parsePercent(parts[0]), parsePercent(parts[1], 0.4), parseHue(parts[2]))
		return finish(rgb, alpha, "oklch")
	}
	throw new ToolError(`Unsupported color function: ${name}()`)
}

export function parseColor(input) {
	const value = String(input ?? "").trim().toLowerCase()
	if (!value) throw new ToolError("Color is required")
	if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
	if (NAMED_COLORS[value]) return parseHex(NAMED_COLORS[value])
	const hex = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
	if (hex) return parseHex(hex[1])
	const fn = value.match(/^([a-z]+)\(\s*([^)]*)\)$/)
	if (fn) return parseFunction(fn[1], fn[2])
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
	if (h === 360) h = 0
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
	return { h, s: round(s * 100, 1), l: round(l * 100, 1) }
}

function hwbToRgb(h, w, bl) {
	let white = clamp(w, 0, 1)
	let black = clamp(bl, 0, 1)
	if (white + black >= 1) {
		const grey = (white / (white + black)) * 255
		return { r: grey, g: grey, b: grey }
	}
	const pure = hslToRgb(h, 1, 0.5)
	const scale = (v) => (v / 255) * (1 - white - black) * 255 + white * 255
	return { r: scale(pure.r), g: scale(pure.g), b: scale(pure.b) }
}

export function rgbToHwb({ r, g, b }) {
	const { h } = rgbToHsl({ r, g, b })
	return { h, w: round((Math.min(r, g, b) / 255) * 100, 1), b: round((1 - Math.max(r, g, b) / 255) * 100, 1) }
}

function toLinear(v) {
	const s = v / 255
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function fromLinear(v) {
	const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
	return s * 255
}

export function rgbToOklab({ r, g, b }) {
	const lr = toLinear(r)
	const lg = toLinear(g)
	const lb = toLinear(b)
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	}
}

function oklabToLinear(L, a, b) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
}

export function oklabToRgb(L, a, b) {
	const [r, g, bl] = oklabToLinear(L, a, b)
	return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(bl) }
}

export function rgbToOklch(rgb) {
	const { L, a, b } = rgbToOklab(rgb)
	const C = Math.sqrt(a * a + b * b)
	let h = C < 1e-4 ? 0 : (Math.atan2(b, a) * 180) / Math.PI
	if (h < 0) h += 360
	return { L, C, h }
}

export function oklchToRgb(L, C, h) {
	const rad = (h * Math.PI) / 180
	return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad))
}

function inGamut(L, C, h) {
	const rad = (h * Math.PI) / 180
	return oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad)).every((v) => v >= -1e-4 && v <= 1.0001)
}

export function oklchToRgbInGamut(L, C, h) {
	const light = clamp(L, 0, 1)
	if (inGamut(light, C, h)) return oklchToRgb(light, C, h)
	let lo = 0
	let hi = C
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2
		if (inGamut(light, mid, h)) lo = mid
		else hi = mid
	}
	return oklchToRgb(light, lo, h)
}

export function toHex({ r, g, b, a = 1 }) {
	const part = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")
	return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a * 255) : ""}`
}

export function colorName(rgb) {
	if (rgb.a !== undefined && rgb.a < 1) return rgb.a === 0 ? "transparent" : null
	return HEX_TO_NAME.get(toHex({ ...rgb, a: 1 }).slice(1)) ?? null
}

function formatOklch(rgb) {
	const { L, C, h } = rgbToOklch(rgb)
	const alpha = rgb.a < 1 ? ` / ${rgb.a}` : ""
	return `oklch(${round(L * 100, 2)}% ${round(C, 4)} ${round(h, 2)}${alpha})`
}

function formatOklab(rgb) {
	const { L, a, b } = rgbToOklab(rgb)
	const alpha = rgb.a < 1 ? ` / ${rgb.a}` : ""
	return `oklab(${round(L * 100, 2)}% ${round(a, 4)} ${round(b, 4)}${alpha})`
}

export function relativeLuminance({ r, g, b }) {
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

// Browsers composite in gamma encoded sRGB, so blending there matches what is actually on screen.
export function blend(top, backdrop) {
	const a = top.a ?? 1
	if (a >= 1) return { r: top.r, g: top.g, b: top.b, a: 1 }
	const mix = (fg, bg) => Math.round(fg * a + bg * (1 - a))
	return { r: mix(top.r, backdrop.r), g: mix(top.g, backdrop.g), b: mix(top.b, backdrop.b), a: 1 }
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 }

// A translucent background has to sit on something; white is the common page default.
export function resolvePair(foreground, background) {
	const bg = blend(typeof background === "string" ? parseColor(background) : background, WHITE)
	const fg = blend(typeof foreground === "string" ? parseColor(foreground) : foreground, bg)
	return { fg, bg }
}

export function contrastRatioExact(colorA, colorB) {
	const { fg, bg } = resolvePair(colorA, colorB)
	const l1 = relativeLuminance(fg)
	const l2 = relativeLuminance(bg)
	const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1]
	return (light + 0.05) / (dark + 0.05)
}

// Truncated rather than rounded so a ratio of 4.499 is never displayed as a passing 4.5.
export function contrastRatio(colorA, colorB) {
	return Math.floor(contrastRatioExact(colorA, colorB) * 100 + 1e-9) / 100
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

function apcaY({ r, g, b }) {
	const lin = (v) => (v / 255) ** 2.4
	const y = 0.2126729 * lin(r) + 0.7151522 * lin(g) + 0.072175 * lin(b)
	return y < 0.022 ? y + (0.022 - y) ** 1.414 : y
}

// APCA 0.0.98G 4g constants. Positive Lc means dark text on light, negative means light text on dark.
export function apcaContrast(textColor, backgroundColor) {
	const { fg, bg } = resolvePair(textColor, backgroundColor)
	const yText = apcaY(fg)
	const yBg = apcaY(bg)
	if (Math.abs(yBg - yText) < 0.0005) return 0
	if (yBg > yText) {
		const sapc = (yBg ** 0.56 - yText ** 0.57) * 1.14
		return sapc < 0.1 ? 0 : round((sapc - 0.027) * 100, 1)
	}
	const sapc = (yBg ** 0.65 - yText ** 0.62) * 1.14
	return sapc > -0.1 ? 0 : round((sapc + 0.027) * 100, 1)
}

export function apcaGuidance(lc) {
	const abs = Math.abs(lc)
	if (abs >= 90) return "Preferred for body text (Lc 90+)"
	if (abs >= 75) return "Minimum for body text (Lc 75+)"
	if (abs >= 60) return "OK for content text that is not body copy (Lc 60+)"
	if (abs >= 45) return "Large/heavy text and headlines only (Lc 45+)"
	if (abs >= 30) return "Placeholder, disabled text and non-text UI only (Lc 30+)"
	if (abs >= 15) return "Non-text decoration only (Lc 15+)"
	return "Not readable (below Lc 15)"
}

// Walks OKLCH lightness outward in both directions so the suggestion keeps the hue and stays as close as possible.
export function suggestAccessibleColor(foreground, background, targetRatio = 4.5) {
	const { fg, bg } = resolvePair(foreground, background)
	if (contrastRatioExact(fg, bg) >= targetRatio) return toHex(fg)
	const { L, C, h } = rgbToOklch(fg)
	for (let step = 1; step <= 200; step++) {
		const delta = step * 0.005
		for (const candidateL of [L - delta, L + delta]) {
			if (candidateL < 0 || candidateL > 1) continue
			const hex = toHex(oklchToRgbInGamut(candidateL, C, h))
			if (contrastRatioExact(parseColor(hex), bg) >= targetRatio) return hex
		}
	}
	for (const hex of ["#000000", "#ffffff"]) if (contrastRatioExact(parseColor(hex), bg) >= targetRatio) return hex
	return null
}

function bestTextColor(rgb) {
	const dark = { r: 0x2c, g: 0x2c, b: 0x2b, a: 1 }
	const opaque = blend(rgb, WHITE)
	return contrastRatioExact(dark, opaque) >= contrastRatioExact(WHITE, opaque) ? "#2C2C2B" : "#FFFFFF"
}

function stepNames(count, scale) {
	if (scale === "tailwind") return [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
	return Array.from({ length: count }, (_, i) => (i + 1) * 100)
}

const RAMP_LIGHTEST = 0.975
const RAMP_DARKEST = 0.24

// Lightness is piecewise linear through the base colour so the brand hex appears unchanged in the ramp.
export function shades(color, steps = 9, scale = "numeric") {
	const base = parseColor(color)
	const opaque = { ...base, a: 1 }
	const names = stepNames(clamp(Math.round(Number(steps)) || 9, 3, 15), scale)
	const count = names.length
	const { L: baseL, C: baseC, h } = rgbToOklch(opaque)
	const defaultL = (i) => RAMP_LIGHTEST - ((RAMP_LIGHTEST - RAMP_DARKEST) * i) / (count - 1)
	let anchor = 0
	for (let i = 1; i < count; i++) if (Math.abs(defaultL(i) - baseL) < Math.abs(defaultL(anchor) - baseL)) anchor = i
	const top = Math.max(RAMP_LIGHTEST, baseL)
	const bottom = Math.min(RAMP_DARKEST, baseL)
	const lightnessAt = (i) => {
		if (i === anchor) return baseL
		if (i < anchor) return top - ((top - baseL) * i) / anchor
		return baseL - ((baseL - bottom) * (i - anchor)) / (count - 1 - anchor)
	}
	return names.map((step, i) => {
		const isBase = i === anchor
		const L = lightnessAt(i)
		const distance = Math.abs(L - baseL) / Math.max(top - bottom, 0.01)
		const rgb = isBase ? opaque : oklchToRgbInGamut(L, baseC * (1 - 0.55 * distance ** 1.5), h)
		const hex = toHex(rgb)
		const parsed = parseColor(hex)
		const hsl = rgbToHsl(parsed)
		return {
			step,
			hex,
			hsl: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`,
			oklch: formatOklch(parsed),
			base: isBase,
			contrastOnWhite: contrastRatio(hex, "#ffffff"),
			contrastOnBlack: contrastRatio(hex, "#000000"),
			textColor: bestTextColor(parsed),
		}
	})
}

const ABSOLUTE_UNITS_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 }

export function convertUnits({ value = 0, unit = "px", root = 16, parent = 16, viewportWidth = 1440, viewportHeight = 900 } = {}) {
	const rootPx = Math.max(Number(root) || 16, 1)
	const parentPx = Math.max(Number(parent) || rootPx, 1)
	const vw = Math.max(Number(viewportWidth) || 1440, 1)
	const vh = Math.max(Number(viewportHeight) || 900, 1)
	const n = Number(value) || 0
	const toPx = {
		rem: rootPx,
		em: parentPx,
		"%": parentPx / 100,
		vw: vw / 100,
		vh: vh / 100,
		vmin: Math.min(vw, vh) / 100,
		vmax: Math.max(vw, vh) / 100,
		...ABSOLUTE_UNITS_PX,
	}
	const factor = toPx[String(unit).toLowerCase()]
	if (!factor) throw new ToolError(`Unsupported unit: ${unit}`)
	const px = n * factor
	return {
		px: round(px, 3),
		rem: round(px / rootPx, 4),
		em: round(px / parentPx, 4),
		pt: round(px / ABSOLUTE_UNITS_PX.pt, 3),
		percent: round((px / parentPx) * 100, 3),
		vw: round(px / toPx.vw, 4),
		vh: round(px / toPx.vh, 4),
		pc: round(px / ABSOLUTE_UNITS_PX.pc, 4),
		in: round(px / ABSOLUTE_UNITS_PX.in, 4),
		cm: round(px / ABSOLUTE_UNITS_PX.cm, 4),
		mm: round(px / ABSOLUTE_UNITS_PX.mm, 3),
		basis: { rootPx, parentPx, viewport: `${vw}x${vh}` },
	}
}

export const TYPE_RATIOS = [
	{ value: "1.067", label: "Minor second (1.067)" },
	{ value: "1.125", label: "Major second (1.125)" },
	{ value: "1.2", label: "Minor third (1.2)" },
	{ value: "1.25", label: "Major third (1.25)" },
	{ value: "1.333", label: "Perfect fourth (1.333)" },
	{ value: "1.414", label: "Augmented fourth (1.414)" },
	{ value: "1.5", label: "Perfect fifth (1.5)" },
	{ value: "1.618", label: "Golden ratio (1.618)" },
	{ value: "custom", label: "Custom…" },
]

export function lineHeightFor(sizePx, basePx = 16) {
	const t = clamp((sizePx - basePx) / (64 - basePx || 1), 0, 1)
	const multiplier = 1.5 - 0.4 * t
	const linePx = Math.max(Math.round((sizePx * multiplier) / 4) * 4, Math.ceil((sizePx * 1.05) / 4) * 4, 4)
	return { lineHeight: round(linePx / sizePx, 3), lineHeightPx: linePx }
}

export function typeScale({ base = 16, ratio = 1.25, steps = 6, stepsDown = 2, root = 16 } = {}) {
	const b = Math.max(Number(base) || 16, 1)
	const r = Math.max(Number(ratio) || 1.25, 1.001)
	const up = clamp(Math.round(Number(steps)) || 0, 0, 12)
	const down = clamp(Math.round(Number(stepsDown)) || 0, 0, 6)
	const rootPx = Math.max(Number(root) || 16, 1)
	const rows = []
	for (let i = -down; i <= up; i++) {
		const size = round(b * r ** i, 2)
		rows.push({ step: i, px: size, rem: round(size / rootPx, 3), ...lineHeightFor(size, b), token: `--font-size-${i < 0 ? `n${-i}` : i}` })
	}
	return rows
}

function rgbaString({ r, g, b }, alpha) {
	return `rgb(${r} ${g} ${b} / ${round(alpha, 3)})`
}

export function elevationShadow(level, color = "#000000") {
	const lvl = clamp(Math.round(Number(level)) || 0, 0, 5)
	if (lvl === 0) return "none"
	const c = parseColor(color)
	return [
		`0 1px 2px ${rgbaString(c, 0.06)}`,
		`0 ${lvl * 2}px ${lvl * 4}px ${rgbaString(c, 0.05 + lvl * 0.01)}`,
		`0 ${lvl * 4}px ${lvl * 8 + 4}px ${rgbaString(c, 0.03 + lvl * 0.01)}`,
	].join(", ")
}

function cssColor(input) {
	const rgb = parseColor(input)
	return toHex(rgb)
}

export function buildGradient({ type = "linear", from = "#2783DE", to = "#E5F2FC", angle = 135, smooth = false } = {}) {
	const a = cssColor(from)
	const b = cssColor(to)
	const deg = ((Number(angle) || 0) % 360 + 360) % 360
	const space = smooth ? "in oklab " : ""
	if (type === "radial") return `radial-gradient(${smooth ? "in oklab, " : ""}${a}, ${b})`
	if (type === "conic") return `conic-gradient(${space}from ${deg}deg, ${a}, ${b}, ${a})`
	return `linear-gradient(${space}${deg}deg, ${a}, ${b})`
}

const COLOR_HELP = "Any CSS colour: #hex (3/4/6/8 digits), rgb(), hsl(), hwb(), oklch(), oklab() or a name like rebeccapurple."

function colorConvert({ color }) {
	const rgb = parseColor(required(color, "Color"))
	const hsl = rgbToHsl(rgb)
	const hwb = rgbToHwb(rgb)
	const alpha = rgb.a < 1 ? ` / ${rgb.a}` : ""
	const hex = toHex(rgb)
	return {
		type: "json",
		value: {
			hex,
			rgb: `rgb(${rgb.r} ${rgb.g} ${rgb.b}${alpha})`,
			hsl: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%${alpha})`,
			hwb: `hwb(${hwb.h} ${hwb.w}% ${hwb.b}%${alpha})`,
			oklch: formatOklch(rgb),
			oklab: formatOklab(rgb),
			rgbLegacy: rgb.a < 1 ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})` : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
			name: colorName(rgb),
			alpha: rgb.a,
			luminance: round(relativeLuminance(blend(rgb, WHITE)), 4),
			suggestedTextColor: bestTextColor(rgb),
		},
		swatch: hex,
		copy: hex,
	}
}

function contrastCheck({ foreground, background }) {
	const fgInput = parseColor(required(foreground, "Foreground"))
	const bgInput = parseColor(required(background, "Background"))
	const { fg, bg } = resolvePair(fgInput, bgInput)
	const exact = contrastRatioExact(fg, bg)
	const ratio = Math.floor(exact * 100 + 1e-9) / 100
	const verdict = { ...wcagVerdict(exact), ratio }
	const suggestions = {}
	if (!verdict.normalTextAA) suggestions.aa = suggestAccessibleColor(fg, bg, 4.5)
	if (!verdict.normalTextAAA) suggestions.aaa = suggestAccessibleColor(fg, bg, 7)
	const lc = apcaContrast(fg, bg)
	const notes = []
	if (fgInput.a < 1) notes.push(`Foreground alpha ${fgInput.a} blended over the background → ${toHex(fg)}`)
	if (bgInput.a < 1) notes.push(`Background alpha ${bgInput.a} assumed to sit on white → ${toHex(bg)}`)
	return {
		type: "json",
		value: {
			...verdict,
			foreground: toHex(fgInput),
			background: toHex(bgInput),
			suggestions,
			ratioExact: round(exact, 4),
			effectiveForeground: toHex(fg),
			effectiveBackground: toHex(bg),
			apca: { lc, guidance: apcaGuidance(lc) },
			notes,
		},
		copy: `${ratio}:1`,
	}
}

function paletteRun({ color, steps = 9, scale = "numeric" }) {
	const ramp = shades(required(color, "Base color"), steps, scale)
	const css = `:root {\n${ramp.map((s) => `  --color-${s.step}: ${s.hex};`).join("\n")}\n}`
	return { type: "json", value: ramp, copy: css }
}

export const designTools = [
	{
		id: "color-convert",
		name: "Color converter",
		category: "Design",
		roles: ["design", "dev"],
		description: "Convert any CSS colour between HEX, RGB, HSL, HWB, OKLCH and OKLab, with alpha and a readable text colour.",
		keywords: ["hex", "rgb", "hsl", "hwb", "oklch", "oklab", "rgba", "colour", "color picker", "named color", "css color"],
		inputs: [{ key: "color", label: "Color", type: "color", default: "#2783DE", help: COLOR_HELP }],
		run: colorConvert,
	},
	{
		id: "contrast-checker",
		name: "WCAG contrast checker",
		category: "Design",
		roles: ["design", "qa", "a11y"],
		description: "WCAG 2.x contrast ratio with AA/AAA verdicts, APCA Lc, alpha blending and nearest passing colour suggestions.",
		keywords: ["a11y", "accessibility", "wcag", "apca", "contrast ratio", "aa", "aaa", "readability", "colour contrast"],
		inputs: [
			{ key: "foreground", label: "Text / foreground", type: "color", default: "#7D7A75", help: "Translucent colours (rgba, #rrggbbaa) are blended over the background." },
			{ key: "background", label: "Background", type: "color", default: "#FFFFFF", help: "A translucent background is assumed to sit on white." },
		],
		run: contrastCheck,
	},
	{
		id: "palette",
		name: "Tint & shade scale",
		category: "Design",
		roles: ["design"],
		description: "Perceptual (OKLCH) design-token ramp from one brand colour; the base colour is kept exactly.",
		keywords: ["tints", "shades", "ramp", "scale", "design tokens", "tailwind", "oklch", "swatches", "css variables"],
		inputs: [
			{ key: "color", label: "Base color", type: "color", default: "#2783DE", help: COLOR_HELP },
			{
				key: "scale",
				label: "Step names",
				type: "select",
				options: [
					{ value: "numeric", label: "100, 200, 300… (choose the count)" },
					{ value: "tailwind", label: "Tailwind 50–950 (11 steps)" },
				],
				default: "numeric",
			},
			{ key: "steps", label: "Steps", type: "number", default: 9, min: 3, max: 15, showIf: { key: "scale", in: ["numeric"] } },
		],
		run: paletteRun,
	},
	{
		id: "unit-convert",
		name: "CSS unit converter",
		category: "Design",
		roles: ["design", "dev"],
		description: "Convert between px, rem, em, %, pt, vw/vh and print units against your root size, parent size and viewport.",
		keywords: ["px to rem", "rem to px", "em", "pt", "vw", "vh", "percent", "inches", "cm", "mm", "css units"],
		inputs: [
			{ key: "value", label: "Value", type: "number", default: 24 },
			{
				key: "unit",
				label: "From unit",
				type: "select",
				options: ["px", "rem", "em", "%", "pt", "pc", "vw", "vh", "vmin", "vmax", "in", "cm", "mm"],
				default: "px",
			},
			{ key: "root", label: "Root font size (px)", type: "number", default: 16, min: 1, help: "Used for rem (browser default is 16px)." },
			{ key: "parent", label: "Parent font size (px)", type: "number", default: 16, min: 1, help: "Used for em and %." },
			{ key: "viewportWidth", label: "Viewport width (px)", type: "number", default: 1440, min: 1 },
			{ key: "viewportHeight", label: "Viewport height (px)", type: "number", default: 900, min: 1 },
		],
		run: (values) => ({ type: "json", value: convertUnits(values) }),
	},
	{
		id: "type-scale",
		name: "Typographic scale",
		category: "Design",
		roles: ["design"],
		description: "Modular type ramp with 4px-grid line heights, rem values and CSS custom properties.",
		keywords: ["font size", "modular scale", "typography", "line height", "rem", "headings", "golden ratio", "major third"],
		inputs: [
			{ key: "base", label: "Base size (px)", type: "number", default: 16, min: 1 },
			{ key: "ratio", label: "Ratio", type: "select", options: TYPE_RATIOS, default: "1.25" },
			{ key: "customRatio", label: "Custom ratio", type: "number", default: 1.25, min: 1.001, max: 4, step: 0.001, showIf: { key: "ratio", in: ["custom"] } },
			{ key: "steps", label: "Steps up", type: "number", default: 6, min: 0, max: 12 },
			{ key: "stepsDown", label: "Steps down", type: "number", default: 2, min: 0, max: 6, help: "Smaller sizes for captions and labels." },
			{ key: "root", label: "Root font size for rem (px)", type: "number", default: 16, min: 1 },
		],
		run: (values) => {
			const ratio = values.ratio === "custom" ? values.customRatio : values.ratio
			const scale = typeScale({ ...values, ratio })
			const css = `:root {\n${scale.map((s) => `  ${s.token}: ${s.rem}rem; /* ${s.px}px, line-height ${s.lineHeight} */`).join("\n")}\n}`
			return { type: "json", value: scale, copy: css }
		},
	},
	{
		id: "shadow-generator",
		name: "Box-shadow & gradient generator",
		category: "Design",
		roles: ["design", "dev"],
		description: "Copy-ready layered elevation shadows and linear, radial or conic gradients.",
		keywords: ["box-shadow", "elevation", "drop shadow", "gradient", "linear-gradient", "radial", "conic", "css"],
		inputs: [
			{ key: "elevation", label: "Elevation (0-5)", type: "number", default: 2, min: 0, max: 5 },
			{ key: "shadowColor", label: "Shadow color", type: "color", default: "#000000" },
			{ key: "gradientType", label: "Gradient type", type: "select", options: ["linear", "radial", "conic"], default: "linear" },
			{ key: "from", label: "Gradient from", type: "color", default: "#2783DE" },
			{ key: "to", label: "Gradient to", type: "color", default: "#E5F2FC" },
			{ key: "angle", label: "Angle (deg)", type: "number", default: 135, showIf: { key: "gradientType", in: ["linear", "conic"] } },
			{ key: "smooth", label: "Smoother blend (interpolate in OKLab)", type: "checkbox", default: false },
		],
		run: ({ elevation = 2, shadowColor = "#000000", gradientType = "linear", from = "#2783DE", to = "#E5F2FC", angle = 135, smooth = false }) => {
			const boxShadow = elevationShadow(elevation, shadowColor || "#000000")
			const gradient = buildGradient({ type: gradientType, from: from || "#2783DE", to: to || "#E5F2FC", angle, smooth })
			const css = `box-shadow: ${boxShadow};\nbackground: ${gradient};`
			return { type: "json", value: { boxShadow, gradient, css }, copy: css }
		},
	},
]
