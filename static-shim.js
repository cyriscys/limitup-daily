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
    if (/^\/api\/sector-momentum/.test(u)) return realFetch("data/sector-momentum.json", opt);
    if ((m = u.match(/^\/api\/capital-flow-history\?.*?\bcode=([A-Za-z0-9]+)/))) {
      return realFetch("data/capital-flow-history.json", opt).then(function (r) {
        return r.json();
      }).then(function (payload) {
        var h = payload && payload.history && payload.history[m[1].toUpperCase()];
        if (h) return respond(h, 200);
        return respond({ ok: false, notice: "静态版暂无该板块资金流历史" }, 404);
      });
    }
    if ((m = u.match(/^\/api\/capital-flow(?:\?type=(\w+))?/))) {
      return realFetch("data/capital-flow-" + (m[1] === "concept" ? "concept" : "industry") + ".json", opt);
    }
    if ((m = u.match(/^\/api\/sector-detail\?name=([^&]+)/))) {
      return realFetch("data/sector-details.json", opt).then(function (r) {
        return r.json();
      }).then(function (payload) {
        var detail = payload && payload.details && payload.details[decodeURIComponent(m[1])];
        if (detail) return respond(detail, 200);
        return respond({ ok: false, notice: "该板块不在静态版 Top5 详情中" }, 404);
      });
    }
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
