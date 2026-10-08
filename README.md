# Sidekick

Browser companion for developers, QA testers and designers.
60+ offline tools in one command palette, ordered by how often you will reach for them. Zero runtime dependencies, zero telemetry, zero remote code.

## Why Sidekick

Instead of installing multiple single purpose extensions with separate permission prompts and questionable privacy, Sidekick does everything locally in your browser.

Everything runs directly on your machine with pure JavaScript. No servers, no accounts, no telemetry and no data collection.

## Install

### Build from source
```bash
node scripts/lint.mjs
node test/run.mjs
node scripts/build.mjs
```

The build writes one folder per browser to `dist/` plus a zip of each, using only Node 18 or later.

| Browser | How to load |
| --- | --- |
| Chrome, Brave, Arc, Vivaldi | chrome://extensions > Developer mode > Load unpacked > select dist/chrome |
| Microsoft Edge | edge://extensions > Developer mode > Load unpacked > select dist/edge |
| Opera | opera://extensions > Developer mode > Load unpacked > select dist/opera |
| Firefox | about:debugging#/runtime/this-firefox > Load Temporary Add on > select dist/firefox/manifest.json (Firefox 128 or later) |
| Safari | Run xcrun safari-web-extension-converter dist/safari-resources then build via Xcode |

## Surfaces

* Popup and Side Panel: Fast command palette to search and launch any tool.
* In Page Drawer: Full inspection drawer for live DOM nodes with box model, Tailwind classes, Vue and React skeletons, and CSS tokens.
* DevTools Panel: Built in panel inside browser DevTools with full sweep page audits.
* Context Menu: Right click shortcuts for element inspection, layout grid, accessibility audit, and bug capture.
* Keyboard Shortcuts:
  * Alt+Shift+D: Open Sidekick
  * Alt+Shift+I: Toggle Element Inspector
  * Alt+Shift+G: Toggle 8px Layout Grid Overlay

## Tool Catalogue

Tools that take documents accept a file upload or drag and drop: JSON, CSV, YAML, Markdown, code, SVG, images and any file for Base64 and checksums.

| Category | Tools |
| --- | --- |
| AI | AI bug report (fix-ready prompt for Claude Code, Cursor or Copilot: errors with source-mapped stack traces, failed requests, recorded repro steps, the element with its component and file), Page to AI context (main content as Markdown with token count, component to code prompt for React, Vue, Svelte or HTML with Tailwind or CSS, design system as DESIGN.md, Tailwind v4 theme or design tokens), Private data scrubber (masks keys, tokens, passwords and personal data before you paste into an AI, then restores them in the reply), AI chat handoff (moves a conversation between ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok and Mistral), AI search readiness (scores how well AI assistants can crawl, read and cite a page, and drafts an llms.txt) |
| On page | Element inspector, Snipping tool (visible, full page, region), Console and error capture, Accessibility audit, Performance snapshot (LCP, CLS, INP), Color eyedropper, Responsive viewport tester, Broken link and image scan, Security headers and cookies, SEO and meta audit with heading outline, Image audit, Measure distances, Storage inspector, Tech stack detector, Form auto filler, Design edit mode, Page color palette, Font and typography report, Outline all elements, Layout grid, Z index and stacking scan, Animation scanner |
| Text and data | JSON formatter and validator, Text diff, Regex tester, CSV and JSON converter with table preview, URL and query inspector, JSON to TypeScript, Case converter (including slugs), Line tools, Text statistics, Lorem ipsum |
| Formats | JSON and YAML converter, JSON query (JSONPath), Code beautifier and minifier (CSS, HTML, XML, SQL), Markdown preview |
| Encoding | JWT decoder with signature verification, Base64 for text and files, URL, HTML and JS escape, Hash, HMAC and file checksums, UUID and ULID generator, Password and API key generator, Number base converter |
| Media | Image converter, compressor and resizer, QR code generator, SVG optimizer, Image colour palette |
| Design | WCAG and APCA contrast checker, Color converter, Tint and shade scale, CSS unit converter, Box shadow and gradient generator, Typographic scale |
| Time | Timestamp converter, Cron explainer with next runs, Timezone comparer, Duration and SLA calculator |
| API and testing | cURL, fetch, Python and PowerShell request builder, Bug report and test case writer, User agent parser, Mock data generator (presets or custom schema; JSON, NDJSON, CSV, SQL), HTTP status reference, Performance budget check |

### Image compression

The image converter picks the encoding from the image itself. Images with 256 colours or fewer become exact palette PNGs, other flat graphics stay lossless, and photos are encoded as WebP or JPEG (whichever is smaller) at the lowest quality that still scores 0.985 SSIM against the original, so they look identical. Resizing uses Lanczos3 in linear light, EXIF orientation is applied, and a result is never larger than the original unless you asked for a resize or a different format.

## Privacy

Sidekick operates on a strict zero telemetry policy:
* No remote calls of its own: every tool runs in memory in your browser. The only network requests are ones you start while auditing a page: the security check reads that page's response headers, the optional HTTP status check in the link scan requests the links found on it, AI search readiness reads the current site's page, robots.txt, llms.txt and sitemap, and AI bug report reads the page's scripts and source maps to map stack traces to source files.
* No external servers: No analytics, no logging, no external fonts and no CDN dependencies.
* Local Storage only: User preferences like theme, default role and pinned tools stay in your local browser storage and never leave your device.
* Encrypted at rest: form drafts, AI chat captures and the scrubber's originals are encrypted with AES-256-GCM (a fresh random IV per write, each record bound to its name so records cannot be swapped). The key is generated on your device, cannot be exported and lives in the extension's own IndexedDB. The scrubber's originals are also kept only in memory-only session storage and disappear when the browser closes; it recognises repeated values by an HMAC-SHA-256 fingerprint, so its lookup table holds no plain text. "Reset everything" in the options destroys the key, which makes anything encrypted unreadable. Fields marked sensitive (tokens, keys, passwords) and files are never saved.
* Bug capture stays local: a small recorder keeps your last clicks, typing (values hidden unless you choose to include them; passwords and card fields never) and request status codes in memory on each page, so a report can include the steps that led to a bug. Nothing is stored or sent anywhere unless you run AI bug report.

## License

MIT
