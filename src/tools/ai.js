import { ToolError } from "../lib/utils.js"
import { AI_NOTE } from "../lib/scrubber.js"
import { forgetScrubs, maskText, restoreText, savedCount, summarizeCounts } from "../lib/scrub-session.js"
import { vaultGet, vaultSet } from "../lib/vault.js"

const MASK_INPUT = { key: "mask", label: "Mask secrets and personal data", type: "checkbox", default: true, help: "Keys, tokens, passwords, emails, phone numbers and cards become placeholders like [EMAIL_1]. Put the originals back with Private data scrubber › Restore." }

async function maskOutput(data, values, { saveCapture = false } = {}) {
	if (!values?.mask || !data || typeof data !== "object" || data.type !== "text" || typeof data.value !== "string") return data
	const result = await maskText(data.value)
	if (!result.findings.length) return { ...data, note: [data.note, "Nothing sensitive found to mask"].filter(Boolean).join(" · ") }
	const text = result.text
	if (saveCapture) {
		const saved = await vaultGet("ai-context").catch(() => null)
		if (saved) await vaultSet("ai-context", { ...saved, text, masked: true }).catch(() => {})
	}
	const download = data.download?.text !== undefined ? { ...data.download, text } : data.download
	return { ...data, value: text, copy: text, download, note: [data.note, `${summarizeCounts(result.counts)}; restore them in the AI's reply with Private data scrubber`].filter(Boolean).join(" · ") }
}

export const aiTools = [
	{
		id: "ai-bug-capture",
		name: "AI bug report",
		category: "AI",
		roles: ["dev", "qa"],
		surface: "page",
		command: "ai-bug-capture",
		description: "Turn what just went wrong into a fix-ready prompt for Claude Code, Cursor, Copilot or any coding agent: console errors with stack traces mapped to source files, failed and slow network calls, your recent clicks and typing as repro steps, the broken element with its component and file, and the environment. Secrets are masked first. Runs offline.",
		keywords: ["bug", "ai", "agent", "claude code", "cursor", "copilot", "repro", "steps", "network", "console", "stack trace", "source map", "issue", "jam", "report"],
		inputs: [
			{
				key: "action",
				label: "Action",
				type: "select",
				options: [
					{ value: "capture", label: "Capture a bug report now" },
					{ value: "arm", label: "Record full network on this tab (then reproduce)" },
				],
				default: "capture",
				help: "Steps, console errors and request status codes are always recorded locally. Full network adds request methods, bodies and error responses from now until the tab reloads.",
			},
			{ key: "note", label: "What went wrong? (optional)", type: "textarea", placeholder: "Clicking Save shows a spinner forever. Expected: the form saves and closes.", showIf: { key: "action", in: ["capture"] } },
			{ key: "pick", label: "Point at the broken element (click it on the page)", type: "checkbox", default: false, showIf: { key: "action", in: ["capture"] } },
			{
				key: "format",
				label: "Format for",
				type: "select",
				options: [
					{ value: "agent", label: "AI coding agent (Claude Code, Cursor, Copilot)" },
					{ value: "issue", label: "GitHub or Jira issue" },
					{ value: "json", label: "JSON" },
				],
				default: "agent",
				showIf: { key: "action", in: ["capture"] },
			},
			{ key: "values", label: "Include what was typed into fields", type: "checkbox", default: false, showIf: { key: "action", in: ["capture"] }, help: "Off by default. Password, card and one-time-code fields are never included." },
			{ key: "screenshot", label: "Attach a screenshot (Save downloads it)", type: "checkbox", default: true, showIf: { key: "action", in: ["capture"] } },
			{ key: "sourcemaps", label: "Map stack traces to source files when source maps exist", type: "checkbox", default: true, showIf: { key: "action", in: ["capture"] } },
			{ ...MASK_INPUT, showIf: { key: "action", in: ["capture"] } },
		],
		finish: (data, values) => maskOutput(data, values),
	},
	{
		id: "page-to-ai",
		name: "Page to AI context",
		category: "AI",
		roles: ["dev", "design", "qa", "it"],
		surface: "page",
		command: "page-to-ai",
		description: "Give an AI exactly what it needs from a page: clean Markdown of the main content or your selection with a token count; a component's structure and measured styles as a ready prompt to rebuild it in React, Vue, Svelte or HTML with Tailwind or CSS; or the site's design system as DESIGN.md, a Tailwind v4 theme or design tokens.",
		keywords: ["ai", "llm", "markdown", "context", "readability", "reader", "clip", "component", "tailwind", "react", "copy as code", "design tokens", "design system", "design.md", "prompt", "tokens"],
		inputs: [
			{
				key: "mode",
				label: "Capture",
				type: "select",
				options: [
					{ value: "content", label: "Page content as Markdown" },
					{ value: "component", label: "Component to code prompt (click an element)" },
					{ value: "design", label: "Design system (colours, type, spacing)" },
				],
				default: "content",
			},
			{
				key: "scope",
				label: "Content",
				type: "select",
				options: [
					{ value: "main", label: "Main content only (drops menus, ads, footers)" },
					{ value: "page", label: "Whole page" },
					{ value: "selection", label: "Current text selection" },
				],
				default: "main",
				showIf: { key: "mode", in: ["content"] },
			},
			{
				key: "links",
				label: "Links",
				type: "select",
				options: [
					{ value: "inline", label: "Inline [text](url)" },
					{ value: "refs", label: "Numbered references (fewer tokens)" },
					{ value: "none", label: "Text only" },
				],
				default: "inline",
				showIf: { key: "mode", in: ["content"] },
			},
			{ key: "images", label: "Keep images as Markdown links", type: "checkbox", default: false, showIf: { key: "mode", in: ["content"] } },
			{
				key: "stack",
				label: "Rebuild with",
				type: "select",
				options: [
					{ value: "react-tailwind", label: "React + Tailwind" },
					{ value: "html-tailwind", label: "HTML + Tailwind" },
					{ value: "vue-tailwind", label: "Vue + Tailwind" },
					{ value: "svelte-tailwind", label: "Svelte + Tailwind" },
					{ value: "react-css", label: "React + CSS module" },
					{ value: "html-css", label: "HTML + CSS" },
				],
				default: "react-tailwind",
				showIf: { key: "mode", in: ["component"] },
			},
			{ key: "screenshot", label: "Attach a screenshot of the component", type: "checkbox", default: true, showIf: { key: "mode", in: ["component"] } },
			{
				key: "format",
				label: "Output",
				type: "select",
				options: [
					{ value: "design-md", label: "DESIGN.md (best for AI agents)" },
					{ value: "tailwind", label: "Tailwind v4 @theme" },
					{ value: "tokens", label: "Design tokens JSON (W3C format)" },
				],
				default: "design-md",
				showIf: { key: "mode", in: ["design"] },
			},
			{ ...MASK_INPUT, default: false, showIf: { key: "mode", in: ["content"] } },
		],
		finish: (data, values) => maskOutput(data, values),
	},
	{
		id: "privacy-scrubber",
		name: "Private data scrubber",
		category: "AI",
		roles: ["dev", "qa", "security", "it", "design"],
		description: "Mask API keys, tokens, passwords, private keys, emails, phone numbers, cards, IBANs, IPs and your own terms before pasting into ChatGPT, Claude or any AI, then put the originals back into the AI's reply. Uses gitleaks- and Presidio-grade patterns with checksums. Originals stay encrypted in memory and vanish when the browser closes.",
		keywords: ["privacy", "redact", "mask", "pii", "secrets", "anonymize", "pseudonymize", "dlp", "api key", "token", "ai", "chatgpt", "claude", "restore", "gdpr"],
		inputs: [
			{
				key: "mode",
				label: "Action",
				type: "select",
				options: [
					{ value: "mask", label: "Mask text before sending to AI" },
					{ value: "restore", label: "Restore originals in the AI's reply" },
					{ value: "forget", label: "Forget saved originals" },
				],
				default: "mask",
			},
			{ key: "text", label: "Text", type: "textarea", sensitive: true, placeholder: "Paste a prompt, log, config file or the AI's reply", upload: { accept: ".txt,.log,.md,.json,.env,.yaml,.yml,.csv,.xml,.ini,.conf,text/*" }, showIf: { key: "mode", in: ["mask", "restore"] } },
			{
				key: "detect",
				label: "Detect",
				type: "select",
				options: [
					{ value: "all", label: "Secrets and personal data" },
					{ value: "secrets", label: "Secrets only (keys, tokens, passwords)" },
					{ value: "pii", label: "Personal data only (emails, phones, cards, IDs)" },
				],
				default: "all",
				showIf: { key: "mode", in: ["mask"] },
			},
			{ key: "terms", label: "Always mask these terms", type: "textarea", placeholder: "Client names, project code names, internal hosts (one per line)", showIf: { key: "mode", in: ["mask"] } },
			{ key: "entropy", label: "Also mask unlabelled random-looking strings", type: "checkbox", default: true, showIf: { key: "mode", in: ["mask"] } },
			{ key: "note", label: "Add a line telling the AI to keep placeholders", type: "checkbox", default: true, showIf: { key: "mode", in: ["mask"] } },
		],
		run: async ({ mode = "mask", text = "", detect = "all", terms = "", entropy = true, note = true }) => {
			if (mode === "forget") {
				const forgotten = await forgetScrubs()
				const message = forgotten ? `Forgot ${forgotten} saved original${forgotten === 1 ? "" : "s"}. Placeholders in old replies can no longer be restored.` : "Nothing was saved."
				return { type: "text", value: message }
			}
			if (!String(text).trim()) throw new ToolError(mode === "restore" ? "Paste the AI's reply to restore." : "Paste the text to mask.")
			if (mode === "restore") {
				const result = await restoreText(text)
				const saved = await savedCount()
				const missing = result.missing.length ? ` ${result.missing.length} placeholder${result.missing.length === 1 ? "" : "s"} not found: ${result.missing.slice(0, 6).join(", ")}${result.missing.length > 6 ? "…" : ""}.` : ""
				return {
					type: "text",
					value: result.text,
					copy: result.text,
					meta: `${result.restored} restored`,
					note: saved ? `Restored ${result.restored} value${result.restored === 1 ? "" : "s"}.${missing}` : "No saved originals in this browser session. Mask the text here first; originals are kept only until the browser closes.",
				}
			}
			const result = await maskText(text, { secrets: detect !== "pii", pii: detect !== "secrets", entropy, terms })
			const output = note && result.findings.length ? `${AI_NOTE}\n\n${result.text}` : result.text
			return {
				type: "text",
				value: output,
				copy: output,
				meta: `${result.findings.length} masked`,
				note: result.findings.length ? `${summarizeCounts(result.counts)}. Originals are encrypted in memory until the browser closes.` : "Nothing sensitive found.",
			}
		},
	},
	{
		id: "ai-readiness",
		name: "AI search readiness",
		category: "AI",
		roles: ["dev", "it", "design"],
		surface: "page",
		command: "ai-readiness",
		description: "Score how well ChatGPT search, Claude, Perplexity, Gemini, Copilot and Google AI Overviews can crawl, read and cite this page: AI crawler access per robots.txt (RFC 9309), noindex and snippet controls, content visible without JavaScript, structure, citability, structured data, sitemap and llms.txt. Lists the fixes worth the most points and drafts an llms.txt.",
		keywords: ["ai", "geo", "aeo", "seo", "llms.txt", "robots.txt", "gptbot", "claudebot", "perplexity", "ai overviews", "crawler", "citation", "schema", "visibility"],
		inputs: [
			{
				key: "output",
				label: "Show",
				type: "select",
				options: [
					{ value: "report", label: "Readiness report with fixes" },
					{ value: "llms", label: "Draft an llms.txt for this site" },
				],
				default: "report",
			},
		],
	},
	{
		id: "ai-chat-handoff",
		name: "AI chat handoff",
		category: "AI",
		roles: ["dev", "qa", "design", "it"],
		surface: "page",
		command: "ai-context",
		description: "Move a conversation between ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, Mistral and others without losing context. Captures the chat as lean Markdown (code, tables and math kept, UI clutter dropped), saves it encrypted, then types it into the next AI. Runs offline.",
		keywords: ["ai", "chatgpt", "claude", "gemini", "copilot", "perplexity", "deepseek", "grok", "mistral", "context", "handoff", "transfer", "export chat", "llm", "prompt"],
		inputs: [
			{
				key: "action",
				label: "Action",
				type: "select",
				options: [
					{ value: "capture", label: "Capture this chat" },
					{ value: "insert", label: "Insert last capture into this chat" },
				],
				default: "capture",
				help: "Capture on the AI you are leaving, then open the other AI and run Insert. Select part of a page first to capture only that.",
			},
			{
				key: "detail",
				label: "Detail",
				type: "select",
				options: [
					{ value: "full", label: "Full: every message, word for word" },
					{ value: "balanced", label: "Balanced: recent turns in full, older replies shortened" },
					{ value: "compact", label: "Compact: fewest tokens" },
				],
				default: "full",
				showIf: { key: "action", in: ["capture"] },
			},
			{
				key: "format",
				label: "Output",
				type: "select",
				options: [
					{ value: "handoff", label: "Handoff prompt (paste into another AI)" },
					{ value: "transcript", label: "Markdown transcript" },
					{ value: "json", label: "JSON messages (API format)" },
				],
				default: "handoff",
				showIf: { key: "action", in: ["capture"] },
			},
			{ key: "lastN", label: "Only the last N messages (0 = all)", type: "number", default: 0, min: 0, max: 1000, showIf: { key: "action", in: ["capture"] } },
			{ key: "loadAll", label: "Scroll to load the full history first", type: "checkbox", default: true, showIf: { key: "action", in: ["capture"] } },
			{ key: "thinking", label: "Include reasoning / thinking blocks", type: "checkbox", default: false, showIf: { key: "action", in: ["capture"] } },
			{ ...MASK_INPUT, default: false, showIf: { key: "action", in: ["capture"] } },
		],
		finish: (data, values) => (values?.action === "insert" ? data : maskOutput(data, values, { saveCapture: true })),
	},
]
