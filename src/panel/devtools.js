;(() => {
	const runtime = typeof browser !== "undefined" && browser.devtools ? browser : chrome
	try {
		runtime.devtools.panels.create("Sidekick", "../assets/icon-48.png", "../panel/panel.html")
	} catch (error) {
		console.warn("[Sidekick] DevTools panel unavailable:", error)
	}
})()
