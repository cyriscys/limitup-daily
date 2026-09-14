(function () {
  // 静态托管版（GitHub Pages 等）没有后端 API，把 /api/* 映射到导出的 JSON 文件。
  // 本地实时版（127.0.0.1:8765）直连 API，本脚本不生效。
  if (location.port === "8765") return;
  var realFetch = window.fetch.bind(window);
  function respond(payload, status) {
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: status, headers: { "Content-Type": "application/json; charset=utf-8" }
    }));
  }
  window.fetch = function (url, opt) {
    var u = String(url);
    var m;
    if (/^\/api\/limitup-dataset/.test(u)) return realFetch("data/limitup-dataset.json", opt);
    if (/^\/api\/hundred-high/.test(u)) return realFetch("data/hundred-high.json", opt);
    if (/^\/api\/daily-summary/.test(u)) return realFetch("data/daily-summary.json", opt);
    if ((m = u.match(/^\/api\/forward-premium\?date=(\d{8})&days=(\d+)/))) {
      return realFetch("data/fwd-" + m[1] + "-" + m[2] + ".json", opt);
    }
    if (/^\/api\/sector-override/.test(u)) {
      return respond({ ok: false, notice: "静态分享版不支持手动调整板块" }, 503);
    }
    if (/^\/api\//.test(u)) return respond({ ok: false, notice: "静态分享版不支持此交互功能" }, 503);
    return realFetch(u, opt);
  };
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("static-mode");
  });
})();
