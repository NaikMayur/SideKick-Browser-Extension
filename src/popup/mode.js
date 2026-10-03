// Classic script loaded in the head so the first paint already has the right theme and
// layout: a fixed size toolbar popup, or a fluid side panel, sidebar or window.
;(function bootMode() {
	var root = document.documentElement
	var mode = "system"
	try {
		mode = localStorage.getItem("sk-theme") || "system"
	} catch (error) {
		mode = "system"
	}
	var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
	root.setAttribute("data-theme", mode === "dark" || (mode !== "light" && prefersDark) ? "dark" : "light")
	root.setAttribute("data-theme-mode", mode)

	var isWindow = /[?&]mode=window/.test(location.search)
	var isPopup = false
	if (!isWindow) {
		try {
			var ext = (typeof browser !== "undefined" && browser.extension) || (typeof chrome !== "undefined" && chrome.extension)
			var views = ext && ext.getViews ? ext.getViews({ type: "popup" }) : []
			isPopup = views.indexOf(window) !== -1
		} catch (error) {
			isPopup = false
		}
		// Toolbar popups start with a near zero viewport and grow to fit the content.
		if (!isPopup && window.innerWidth < 220) isPopup = true
	}
	root.setAttribute("data-layout", isWindow ? "window" : isPopup ? "popup" : "fluid")
})()
