"use strict";
//noinspection TsLint
function loadScript(url, callback) {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = url;
    script.onload = callback;
    document.getElementsByTagName('head')[0].appendChild(script);
}
// load JSON data from url or file and callback once loaded
//noinspection TsLint
function loadJSON(url) {
    return new Promise(function (resolve, reject) {
        var XHR = new XMLHttpRequest();
        // override MIME in case server is misconfigured.
        XHR.overrideMimeType("application/json");
        XHR.open('GET', url, true);
        XHR.onerror = function () {
            reject();
        };
        // Note: add after open to save cycles
        XHR.onreadystatechange = function () {
            if (XHR.readyState === 4 && XHR.status === 200) {
                resolve(XHR.responseText);
            }
        };
        XHR.send();
    });
}
//noinspection TsLint
function isIE() {
    return /Trident/.test(navigator.userAgent);
}
//# sourceMappingURL=utility.js.map