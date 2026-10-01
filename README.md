# Sidekick

Browser companion for developers, QA testers and designers.
55+ offline tools, zero runtime dependencies, zero telemetry, zero remote code right in one command palette.

## Why Sidekick

Instead of installing multiple single purpose extensions with separate permission prompts and questionable privacy, Sidekick does everything locally in your browser.

Everything runs directly on your machine with pure JavaScript. No servers, no accounts, no telemetry and no data collection.

## Install

### Build from source
```bash
node scripts/lint.mjs
node scripts/build.mjs
```

| Browser | How to load |
| --- | --- |
| Chrome, Brave, Arc, Vivaldi | chrome://extensions > Developer mode > Load unpacked > select dist/chrome |
| Microsoft Edge | edge://extensions > Developer mode > Load unpacked > select dist/edge |
| Opera | opera://extensions > Developer mode > Load unpacked > select dist/opera |
| Firefox | about:debugging#/runtime/this-firefox > Load Temporary Add on > select dist/firefox/manifest.json |
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

| Category | Features |
| --- | --- |
| On Page | Deep Element Inspector, Box Model, Visual Move and Edit, Snipping Tool, 8px Baseline Grid, CSS Outlines, EyeDropper, Accessibility Audit, SEO Audit, Broken Link Check, Web Performance Metrics, Tech Stack Detector, Z Index Scan, Event Listener Map, Form Auto Filler |
| Encoding | Base64 Encode and Decode, URL Encode, HTML Entities, JWT Decoder, SHA Hashing, UUID Generator, Secret Generator |
| Text and Data | JSON Formatter and Validator, Case Converter, Slugify, Regex Tester, Text Diff, Text Statistics, Lorem Ipsum, CSV JSON Converter, URL Query Inspector |
| Design | Color Format Converter, WCAG Contrast Checker, Palette Swatches and Contrast Ramps, CSS Unit Converter, Type Scale, Shadow and Gradient Generator |
| Testing and QA | HTTP Status Lookup, Bug Report Builder with auto environment capture, Gherkin Scenario Writer, Cross Browser Test Matrix, Core Web Vitals Budget |
| API and Time | cURL and Fetch Builder, Mock Data Generator, Timestamp Converter, Timezone Comparer, Cron Explainer, Duration Calculator |
| Media | Image Converter and Resizer (PNG, JPEG, WebP, BMP, GIF, ICO, PDF) with quality control and aspect-ratio-aware resize |

## Privacy

Sidekick operates on a strict zero telemetry policy:
* Zero remote calls: Every tool runs in memory in your browser.
* No external servers: No analytics, no logging, no external fonts and no CDN dependencies.
* Local Storage only: User preferences like theme, default role and pinned tools stay in your local browser storage and never leave your device.

## License

MIT
