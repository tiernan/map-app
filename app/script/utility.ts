"use strict";
//noinspection TsLint
function loadScript(url: string, callback?: (e: Event) => any): void {
	let script: HTMLScriptElement = document.createElement('script');
	script.type = 'text/javascript';
	script.src = url;
	script.onload = callback;
	document.getElementsByTagName('head')[0].appendChild(script);
}

// load JSON data from url or file and callback once loaded
//noinspection TsLint
function loadJSON(url: string): Promise<string> {
	return new Promise(function(resolve: (response: string) => void, reject: (reason?: string) => void): void {
		let XHR: XMLHttpRequest = new XMLHttpRequest();
		// override MIME in case server is misconfigured.
		XHR.overrideMimeType("application/json");
		XHR.open('GET', url, true);

		XHR.onerror = function(): void {
			reject();
		};

		// Note: add after open to save cycles
		XHR.onreadystatechange = function(): void {
			if (XHR.readyState === 4 && XHR.status === 200) {
				resolve(XHR.responseText);
			}
		};
		XHR.send();
	});
}

//noinspection TsLint
function isIE(): boolean {
	return /Trident/.test(navigator.userAgent);
}