(function () {
  // 静态托管版（GitHub Pages 等）没有后端 API，把 /api/* 映射到导出的 JSON 文件。
  // 有后端的环境（本地 8765、云服务器 80 端口等）直连 API，本脚本不生效。
  // 判定方式：同步探测 /api/daily-summary，返回 JSON 说明有后端。
  if (location.port === "8765") return;
  var hasBackend = false;
  try {
    var probe = new XMLHttpRequest();
    probe.open("GET", "/api/daily-summary", false);
    probe.send(null);
    hasBackend = probe.status >= 200 && probe.status < 300 &&
      (probe.responseText || "").trim().charAt(0) === "{";
  } catch (e) {
    hasBackend = false;
  }
  if (hasBackend) return;
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
    if (/^\/api\/sentiment/.test(u)) return realFetch("data/sentiment.json", opt);
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
