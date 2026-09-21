
import { ToolError } from "../lib/utils.js"

export const CSS_DEFAULTS = {
	"align-content": new Set(["normal"]),
	"align-items": new Set(["normal"]),
	"align-self": new Set(["auto"]),
	"animation": new Set(["none"]),
	"animation-name": new Set(["none"]),
	"appearance": new Set(["none", "auto"]),
	"backface-visibility": new Set(["visible"]),
	"background-attachment": new Set(["scroll"]),
	"background-blend-mode": new Set(["normal"]),
	"background-clip": new Set(["border-box"]),
	"background-color": new Set(["rgba(0, 0, 0, 0)", "transparent"]),
	"background-image": new Set(["none"]),
	"background-origin": new Set(["padding-box"]),
	"background-position": new Set(["0% 0%", "0px 0px"]),
	"background-repeat": new Set(["repeat"]),
	"background-size": new Set(["auto", "auto auto"]),
	"border-collapse": new Set(["separate"]),
	"border-color": new Set(["rgb(0, 0, 0)"]),
	"border-image": new Set(["none"]),
	"border-radius": new Set(["0px"]),
	"border-style": new Set(["none"]),
	"border-width": new Set(["0px"]),
	"bottom": new Set(["auto"]),
	"box-shadow": new Set(["none"]),
	"box-sizing": new Set(["content-box"]),
	"caption-side": new Set(["top"]),
	"clear": new Set(["none"]),
	"clip": new Set(["auto"]),
	"clip-path": new Set(["none"]),
	"color-scheme": new Set(["normal"]),
	"column-count": new Set(["auto"]),
	"column-gap": new Set(["normal"]),
	"contain": new Set(["none"]),
	"content": new Set(["normal", "none"]),
	"cursor": new Set(["auto"]),
	"direction": new Set(["ltr"]),
	"empty-cells": new Set(["show"]),
	"filter": new Set(["none"]),
	"flex-basis": new Set(["auto"]),
	"flex-direction": new Set(["row"]),
	"flex-grow": new Set(["0"]),
	"flex-shrink": new Set(["1"]),
	"flex-wrap": new Set(["nowrap"]),
	"float": new Set(["none"]),
	"font-feature-settings": new Set(["normal"]),
	"font-kerning": new Set(["auto"]),
	"font-size-adjust": new Set(["none"]),
	"font-stretch": new Set(["100%", "normal"]),
	"font-style": new Set(["normal"]),
	"font-variant": new Set(["normal"]),
	"font-variant-caps": new Set(["normal"]),
	"font-variant-ligatures": new Set(["normal"]),
	"font-variant-numeric": new Set(["normal"]),
	"gap": new Set(["normal"]),
	"grid-auto-columns": new Set(["auto"]),
	"grid-auto-flow": new Set(["row"]),
	"grid-auto-rows": new Set(["auto"]),
	"grid-column-end": new Set(["auto"]),
	"grid-column-start": new Set(["auto"]),
	"grid-row-end": new Set(["auto"]),
	"grid-row-start": new Set(["auto"]),
	"grid-template-areas": new Set(["none"]),
	"grid-template-columns": new Set(["none"]),
	"grid-template-rows": new Set(["none"]),
	"height": new Set(["auto"]),
	"hyphens": new Set(["manual"]),
	"image-rendering": new Set(["auto"]),
	"ime-mode": new Set(["auto"]),
	"isolation": new Set(["auto"]),
	"justify-content": new Set(["normal"]),
	"justify-items": new Set(["normal", "legacy"]),
	"justify-self": new Set(["auto"]),
	"left": new Set(["auto"]),
	"letter-spacing": new Set(["normal"]),
	"line-break": new Set(["auto"]),
	"list-style": new Set(["outside none disc"]),
	"list-style-image": new Set(["none"]),
	"list-style-position": new Set(["outside"]),
	"list-style-type": new Set(["disc"]),
	"margin": new Set(["0px"]),
	"mask": new Set(["none"]),
	"max-height": new Set(["none"]),
	"max-width": new Set(["none"]),
	"min-height": new Set(["auto", "0px"]),
	"min-width": new Set(["auto", "0px"]),
	"mix-blend-mode": new Set(["normal"]),
	"object-fit": new Set(["fill"]),
	"object-position": new Set(["50% 50%"]),
	"offset": new Set(["none"]),
	"opacity": new Set(["1"]),
	"order": new Set(["0"]),
	"orphans": new Set(["2"]),
	"outline": new Set(["none"]),
	"outline-offset": new Set(["0px"]),
	"overflow": new Set(["visible"]),
	"overflow-anchor": new Set(["auto"]),
	"overflow-wrap": new Set(["normal"]),
	"overflow-x": new Set(["visible"]),
	"overflow-y": new Set(["visible"]),
	"overscroll-behavior": new Set(["auto"]),
	"padding": new Set(["0px"]),
	"page-break-after": new Set(["auto"]),
	"page-break-before": new Set(["auto"]),
	"page-break-inside": new Set(["auto"]),
	"perspective": new Set(["none"]),
	"place-content": new Set(["normal"]),
	"place-items": new Set(["normal"]),
	"place-self": new Set(["auto"]),
	"pointer-events": new Set(["auto"]),
	"position": new Set(["static"]),
	"resize": new Set(["none"]),
	"right": new Set(["auto"]),
	"row-gap": new Set(["normal"]),
	"scroll-behavior": new Set(["auto"]),
	"scroll-snap-type": new Set(["none"]),
	"shape-outside": new Set(["none"]),
	"tab-size": new Set(["8"]),
	"table-layout": new Set(["auto"]),
	"text-align": new Set(["start"]),
	"text-align-last": new Set(["auto"]),
	"text-decoration": new Set(["none", "none solid rgb(0, 0, 0)"]),
	"text-decoration-color": new Set(["currentcolor"]),
	"text-decoration-line": new Set(["none"]),
	"text-decoration-style": new Set(["solid"]),
	"text-indent": new Set(["0px"]),
	"text-overflow": new Set(["clip"]),
	"text-rendering": new Set(["auto"]),
	"text-shadow": new Set(["none"]),
	"text-transform": new Set(["none"]),
	"top": new Set(["auto"]),
	"touch-action": new Set(["auto"]),
	"transform": new Set(["none"]),
	"transform-origin": new Set(["50% 50%", "50% 50% 0px"]),
	"transform-style": new Set(["flat"]),
	"transition": new Set(["none", "all 0s ease 0s"]),
	"unicode-bidi": new Set(["normal"]),
	"user-select": new Set(["auto"]),
	"vertical-align": new Set(["baseline"]),
	"visibility": new Set(["visible"]),
	"white-space": new Set(["normal"]),
	"widows": new Set(["2"]),
	"width": new Set(["auto"]),
	"will-change": new Set(["auto"]),
	"word-break": new Set(["normal"]),
	"word-spacing": new Set(["0px", "normal"]),
	"word-wrap": new Set(["normal"]),
	"writing-mode": new Set(["horizontal-tb"]),
	"z-index": new Set(["auto"]),
	"zoom": new Set(["1", "normal"]),
}

export const STYLE_PROPERTIES = [
	"display", "position", "top", "right", "bottom", "left",
	"width", "height", "min-width", "min-height", "max-width", "max-height",
	"margin-top", "margin-right", "margin-bottom", "margin-left",
	"padding-top", "padding-right", "padding-bottom", "padding-left",
	"border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
	"border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
	"border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
	"border-radius",
	"border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
	"background-color", "background-image", "background-size", "background-position", "background-repeat",
	"color", "font-family", "font-size", "font-weight", "font-style",
	"line-height", "letter-spacing", "text-align", "text-decoration", "text-transform",
	"white-space", "word-break", "overflow", "overflow-x", "overflow-y",
	"flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
	"justify-content", "align-items", "align-self", "align-content",
	"gap", "row-gap", "column-gap",
	"grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
	"opacity", "visibility", "z-index", "cursor",
	"box-shadow", "text-shadow", "filter", "backdrop-filter",
	"transform", "transition", "animation",
	"outline", "outline-offset",
	"box-sizing", "object-fit", "object-position",
	"overflow-wrap", "text-overflow",
	"list-style", "list-style-type",
]

export function isDefaultValue(prop, value) {
	const defaults = CSS_DEFAULTS[prop]
	if (!defaults) return false
	return defaults.has(value)
}

export function collapseLonghands(styles) {
	const result = { ...styles }

	const groups = [
		{ shorthand: "margin", sides: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
		{ shorthand: "padding", sides: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
		{
			shorthand: "border-width",
			sides: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
		},
		{
			shorthand: "border-style",
			sides: ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
		},
		{
			shorthand: "border-color",
			sides: ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
		},
		{
			shorthand: "border-radius",
			sides: [
				"border-top-left-radius", "border-top-right-radius",
				"border-bottom-right-radius", "border-bottom-left-radius",
			],
		},
	]

	for (const { shorthand, sides } of groups) {
		const values = sides.map((s) => result[s]).filter(Boolean)
		if (values.length !== sides.length) continue

		const allSame = values.every((v) => v === values[0])
		if (allSame) {
			result[shorthand] = values[0]
			for (const side of sides) delete result[side]
		} else {

			const [top, right, bottom, left] = values
			if (top === bottom && right === left) {
				result[shorthand] = top === right ? top : `${top} ${right}`
			} else if (right === left) {
				result[shorthand] = `${top} ${right} ${bottom}`
			} else {
				result[shorthand] = `${top} ${right} ${bottom} ${left}`
			}
			for (const side of sides) delete result[side]
		}
	}

	if (result["border-width"] && result["border-style"] && result["border-color"]
		&& result["border-style"] !== "none") {
		result["border"] = `${result["border-width"]} ${result["border-style"]} ${result["border-color"]}`
		delete result["border-width"]
		delete result["border-style"]
		delete result["border-color"]
	}

	return result
}

export function cssToTailwind(styles) {
	const classes = []

	const pxMap = {
		"0px": "0", "1px": "px", "2px": "0.5", "4px": "1", "6px": "1.5",
		"8px": "2", "10px": "2.5", "12px": "3", "14px": "3.5", "16px": "4",
		"20px": "5", "24px": "6", "28px": "7", "32px": "8", "36px": "9",
		"40px": "10", "44px": "11", "48px": "12", "56px": "14", "64px": "16",
		"80px": "20", "96px": "24", "112px": "28", "128px": "32",
		"144px": "36", "160px": "40", "176px": "44", "192px": "48",
		"208px": "52", "224px": "56", "240px": "60", "256px": "64",
		"288px": "72", "320px": "80", "384px": "96",
	}

	const fontSizeMap = {
		"12px": "text-xs", "14px": "text-sm", "16px": "text-base",
		"18px": "text-lg", "20px": "text-xl", "24px": "text-2xl",
		"30px": "text-3xl", "36px": "text-4xl", "48px": "text-5xl",
		"60px": "text-6xl", "72px": "text-7xl", "96px": "text-8xl",
		"128px": "text-9xl",
	}

	const fontWeightMap = {
		"100": "font-thin", "200": "font-extralight", "300": "font-light",
		"400": "font-normal", "500": "font-medium", "600": "font-semibold",
		"700": "font-bold", "800": "font-extrabold", "900": "font-black",
	}

	const lineHeightMap = {
		"1": "leading-none", "1.25": "leading-tight", "1.375": "leading-snug",
		"1.5": "leading-normal", "1.625": "leading-relaxed", "2": "leading-loose",
	}

	const displayMap = {
		"block": "block", "inline-block": "inline-block", "inline": "inline",
		"flex": "flex", "inline-flex": "inline-flex", "grid": "grid",
		"inline-grid": "inline-grid", "none": "hidden", "table": "table",
	}

	const positionMap = {
		"static": "static", "relative": "relative", "absolute": "absolute",
		"fixed": "fixed", "sticky": "sticky",
	}

	if (styles.display && displayMap[styles.display]) {
		classes.push(displayMap[styles.display])
	}

	if (styles.position && positionMap[styles.position]) {
		classes.push(positionMap[styles.position])
	}

	const flexDirMap = { "row": "flex-row", "column": "flex-col", "row-reverse": "flex-row-reverse", "column-reverse": "flex-col-reverse" }
	if (styles["flex-direction"] && flexDirMap[styles["flex-direction"]]) {
		classes.push(flexDirMap[styles["flex-direction"]])
	}

	const justifyMap = {
		"flex-start": "justify-start", "flex-end": "justify-end", "center": "justify-center",
		"space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly",
	}
	if (styles["justify-content"] && justifyMap[styles["justify-content"]]) {
		classes.push(justifyMap[styles["justify-content"]])
	}

	const alignMap = {
		"flex-start": "items-start", "flex-end": "items-end", "center": "items-center",
		"baseline": "items-baseline", "stretch": "items-stretch",
	}
	if (styles["align-items"] && alignMap[styles["align-items"]]) {
		classes.push(alignMap[styles["align-items"]])
	}

	if (styles.gap && pxMap[styles.gap]) classes.push(`gap-${pxMap[styles.gap]}`)

	for (const [prop, prefix] of [["margin", "m"], ["padding", "p"]]) {
		if (styles[prop] && pxMap[styles[prop]]) {
			classes.push(`${prefix}-${pxMap[styles[prop]]}`)
		}
	}
	for (const [prop, prefix] of [
		["margin-top", "mt"], ["margin-right", "mr"], ["margin-bottom", "mb"], ["margin-left", "ml"],
		["padding-top", "pt"], ["padding-right", "pr"], ["padding-bottom", "pb"], ["padding-left", "pl"],
	]) {
		if (styles[prop] && pxMap[styles[prop]]) {
			classes.push(`${prefix}-${pxMap[styles[prop]]}`)
		}
	}

	if (styles.width && pxMap[styles.width]) classes.push(`w-${pxMap[styles.width]}`)
	if (styles.width === "100%") classes.push("w-full")
	if (styles.height && pxMap[styles.height]) classes.push(`h-${pxMap[styles.height]}`)
	if (styles.height === "100%") classes.push("h-full")

	if (styles["font-size"] && fontSizeMap[styles["font-size"]]) {
		classes.push(fontSizeMap[styles["font-size"]])
	}
	if (styles["font-weight"] && fontWeightMap[styles["font-weight"]]) {
		classes.push(fontWeightMap[styles["font-weight"]])
	}
	if (styles["line-height"]) {
		const lhNorm = String(parseFloat(styles["line-height"]) || styles["line-height"])
		if (lineHeightMap[lhNorm]) classes.push(lineHeightMap[lhNorm])
	}
	if (styles["text-align"] === "center") classes.push("text-center")
	if (styles["text-align"] === "right") classes.push("text-right")
	if (styles["text-align"] === "left") classes.push("text-left")
	if (styles["text-transform"] === "uppercase") classes.push("uppercase")
	if (styles["text-transform"] === "lowercase") classes.push("lowercase")
	if (styles["text-transform"] === "capitalize") classes.push("capitalize")

	const radiusMap = {
		"0px": "rounded-none", "2px": "rounded-sm", "4px": "rounded",
		"6px": "rounded-md", "8px": "rounded-lg", "12px": "rounded-xl",
		"16px": "rounded-2xl", "24px": "rounded-3xl", "9999px": "rounded-full",
	}
	if (styles["border-radius"] && radiusMap[styles["border-radius"]]) {
		classes.push(radiusMap[styles["border-radius"]])
	}

	if (styles.overflow === "hidden") classes.push("overflow-hidden")
	if (styles.overflow === "auto") classes.push("overflow-auto")
	if (styles.overflow === "scroll") classes.push("overflow-scroll")

	if (styles.opacity && styles.opacity !== "1") {
		const pct = Math.round(parseFloat(styles.opacity) * 100)
		classes.push(`opacity-${pct}`)
	}

	if (styles.cursor === "pointer") classes.push("cursor-pointer")
	if (styles.cursor === "not-allowed") classes.push("cursor-not-allowed")

	return classes
}

export function htmlToJsx(html) {
	let jsx = html

	jsx = jsx.replace(/\bclass="/g, 'className="')

	jsx = jsx.replace(/\bfor="/g, 'htmlFor="')

	jsx = jsx.replace(/<(img|input|br|hr|meta|link|source|track|wbr|col|embed|area|base|param)([^>]*?)(?<!\/)>/gi, "<$1$2 />")

	jsx = jsx.replace(/\bstyle="([^"]*)"/g, (_match, value) => {
		const props = value.split(";").filter(Boolean).map((p) => {
			const [key, ...val] = p.split(":")
			if (!key || !val.length) return null
			const camelKey = key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())
			const cleanVal = val.join(":").trim()
			const numMatch = cleanVal.match(/^(-?\d+(?:\.\d+)?)px$/)
			return numMatch ? `${camelKey}: ${numMatch[1]}` : `${camelKey}: "${cleanVal}"`
		}).filter(Boolean)
		return `style={{ ${props.join(", ")} }}`
	})

	jsx = jsx.replace(/\btabindex="/g, 'tabIndex="')

	jsx = jsx.replace(/\breadonly\b/g, "readOnly")

	jsx = jsx.replace(/\bautocomplete="/g, 'autoComplete="')
	return jsx
}

export function htmlToVueSfc(html, css) {
	return `<template>\n${indent(html, 1)}\n</template>\n\n<script setup>\n</script>\n\n<style scoped>\n${css}\n</style>`
}

export function generateAiPrompt(html, css, meta = {}) {
	const lines = [
		"Recreate this component exactly as shown. Here is the extracted markup and styles:",
		"",
		"## Component Info",
	]
	if (meta.tag) lines.push(`- Element: <${meta.tag}>`)
	if (meta.dimensions) lines.push(`- Dimensions: ${meta.dimensions}`)
	if (meta.fonts) lines.push(`- Typography: ${meta.fonts}`)
	if (meta.colors) lines.push(`- Colors: ${meta.colors}`)
	lines.push("")
	lines.push("## HTML")
	lines.push("```html")
	lines.push(html)
	lines.push("```")
	lines.push("")
	lines.push("## CSS")
	lines.push("```css")
	lines.push(css)
	lines.push("```")
	lines.push("")
	lines.push("Please recreate this component using [React/Vue/Svelte/HTML]. Preserve the exact visual appearance, spacing, typography, and colors. Use modern CSS and semantic HTML.")
	return lines.join("\n")
}

export function cleanHtmlString(html) {

	let cleaned = html.replace(/\s+data-(?!testid)[a-z0-9-]+="[^"]*"/gi, "")

	cleaned = cleaned.replace(/\s+(?:__react\w+|_ng[\w-]+|ng-[\w-]+|_v-[\w-]+)="[^"]*"/gi, "")

	cleaned = cleaned.replace(/\s+class=""/g, "")

	cleaned = cleaned.replace(/\s+style="[^"]*"/g, "")

	cleaned = cleaned.replace(/(<[^>]+)\s{2,}/g, "$1 ")
	return cleaned
}

export function stylesToCssBlock(selector, styles) {
	const entries = Object.entries(styles).filter(([, v]) => v)
	if (!entries.length) return ""
	const body = entries.map(([prop, val]) => `\t${prop}: ${val};`).join("\n")
	return `${selector} {\n${body}\n}`
}

function indent(str, level = 1) {
	const tab = "\t".repeat(level)
	return str.split("\n").map((line) => `${tab}${line}`).join("\n")
}

export function componentScore(info) {
	let score = 0
	const semanticTags = new Set([
		"nav", "header", "footer", "main", "aside", "article", "section",
		"form", "dialog", "details", "figure", "figcaption",
		"a", "button", "table",
	])
	const componentTags = new Set(["nav", "header", "footer", "aside", "article", "section", "form", "dialog"])
	if (semanticTags.has(info.tag)) score += 20
	if (componentTags.has(info.tag)) score += 15
	if (info.hasOwnBg) score += 15
	if (info.hasOwnBorder) score += 10
	if (info.hasOwnShadow) score += 10
	if (info.hasPadding) score += 8
	if (info.isFrameworkRoot) score += 20
	if (info.hasRole) score += 10
	if (info.childCount >= 2) score += 5
	if (info.childCount >= 5) score += 5

	if (info.tag === "body" || info.tag === "html") score = 0
	return Math.min(100, score)
}
