// 交易脉冲 · 涨停板块 / 板块情绪周期 / 市场情绪（真实数据版）
// 数据源：东方财富涨停池/炸板池、同花顺涨停聚焦板块、腾讯日K（后续溢价）。
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = d => `${d.slice(4, 6)}-${d.slice(6, 8)}`;
const fmtYi = v => (v / 1e8).toFixed(2);

const state = {
  view: "limit",
  dataset: null,
  endDate: null,
  sort: "count",
  minFive: false,
  strict: false,
  showBreak: false,
  premiumDays: 5,
  selected: null,
  drawerOrigin: null,
  marketData: null,
  forwardCache: {},
  sectorMomentum: null,
  flowCache: {},
  flowType: "industry",
  sentiment: null,
};

function showToast(message) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function heatOf(sector) {
  const m = sector.maxLbc;
  return m >= 5 ? 5 : m === 4 ? 4 : m === 3 ? 3 : m === 2 ? 2 : 1;
}
function heatClass(n) { return n >= 4 ? "hot" : n === 3 ? "warm" : "cool"; }
function tagClass(tag) { return tag === "首板" ? "tag-first" : /连板/.test(tag) ? "tag-ladder" : "tag-mixed"; }

// ---------- 数据 ----------
async function loadDataset(end, { silent } = {}) {
  const params = end ? `?end=${end}&days=15` : "?days=15";
  if (!silent) $("#board").innerHTML = `<p class="empty-lane board-loading">正在读取真实涨停池……</p>`;
  const response = await fetch(`/api/limitup-dataset${params}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.notice || "涨停池暂不可用");
  state.dataset = data;
  state.endDate = data.days[data.days.length - 1].date;
  const picker = $("#history-date");
  picker.max = new Date().toISOString().slice(0, 10);
  picker.value = `${state.endDate.slice(0, 4)}-${state.endDate.slice(4, 6)}-${state.endDate.slice(6, 8)}`;
  $("#history-today").disabled = data.days[data.days.length - 1].date === data.days[data.days.length - 1].date && !end ? true : false;
  renderLeaders();
  renderBoard();
  loadDailySummary(state.endDate);
}

async function loadDailySummary(date) {
  const panel = $("#daily-summary");
  try {
    const response = await fetch(`/api/daily-summary?date=${date}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) { panel.hidden = true; return; }
    $("#summary-date").textContent = `${data.date.slice(0, 4)}-${data.date.slice(4, 6)}-${data.date.slice(6, 8)} 复盘`;
    $("#summary-time").textContent = data.generatedAt ? `生成于 ${data.generatedAt}` : "";
    $("#summary-text").textContent = data.text || "";
    $("#summary-mainlines").innerHTML = (data.mainlines || []).map(m => `<span>${esc(m)}</span>`).join("");
    panel.hidden = false;
  } catch {
    panel.hidden = true;
  }
}

async function loadForward(date, horizon) {
  const key = `${date}:${horizon}`;
  if (!state.forwardCache[key]) {
    const response = await fetch(`/api/forward-premium?date=${date}&days=${horizon}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.notice || "后续溢价暂不可用");
    state.forwardCache[key] = data;
  }
  return state.forwardCache[key];
}

// ---------- 涨停板块泳道 ----------
function boardDays() { return state.dataset ? state.dataset.days.slice(-7) : []; }

function sectorCard(sector, dayIndex) {
  const heat = heatOf(sector), hc = heatClass(heat);
  const quote = sector.pct != null ? `<span class="metric-pill ${sector.pct >= 0 ? "up" : "down"}">板块 ${sector.pct > 0 ? "+" : ""}${sector.pct}%</span>` : "";
  return `<button class="sector-card" data-day="${dayIndex}" data-name="${esc(sector.name)}" aria-label="查看 ${esc(sector.name)} 详情"><span class="sector-top"><span class="sector-name">${esc(sector.name)}<em class="sector-count">${sector.count}</em></span><span class="heat-dots" aria-label="热度 ${heat} 级">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= heat ? `on ${hc}` : ""}"></i>`).join("")}</span></span><span class="sector-desc">龙头 ${esc(sector.stocks[0] ? sector.stocks[0].name : "--")} · ${esc(sector.stocks[0] ? sector.stocks[0].tag : "")}</span><span class="sector-metrics">${quote}<span class="amount">${fmtYi(sector.amount)} 亿</span><span class="premium neutral">最高 ${sector.maxLbc} 板</span></span></button>`;
}

function renderBoard() {
  if (!state.dataset) return;
  const days = boardDays();
  const totals15 = cumulativeCounts();
  const strictSet = new Set([...Object.entries(totals15)].filter(([, v]) => v >= 10).map(([k]) => k));
  $("#board-title").textContent = `${days[0] ? fmtDate(days[0].date) : "--"} 至 ${days.length ? fmtDate(days[days.length - 1].date) : "--"} · 涨停板块演进`;
  $("#board-eyebrow").textContent = "LIMIT-UP SECTOR FLOW · 真实涨停池";
  $("#board").innerHTML = days.map((day, di) => {
    let sectors = day.sectors.filter(s => (!state.minFive || s.count >= 5) && (!state.strict || strictSet.has(s.name)));
    sectors.sort((a, b) => state.sort === "count" ? b.count - a.count || b.amount - a.amount : b.maxLbc - a.maxLbc || b.count - a.count);
    return `<article class="lane"><header class="lane-head"><div class="lane-head-top"><button class="lane-date lane-action" data-action="date" data-day="${di}">${fmtDate(day.date)}</button><button class="lane-weekday lane-action" data-action="ladder" data-day="${di}">${day.weekday}</button></div><div class="lane-stat"><button class="lane-total lane-action" data-action="all" data-day="${di}">${day.total} 只涨停</button><span class="market-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></header><div class="lane-list">${sectors.length ? sectors.map(s => sectorCard(s, di)).join("") : `<p class="empty-lane">当前筛选下暂无板块</p>`}</div></article>`;
  }).join("");
  $$(".sector-card").forEach(card => card.addEventListener("click", () => openDrawer(Number(card.dataset.day), card.dataset.name)));
  $$(".lane-action").forEach(button => button.addEventListener("click", () => openDayAnalysis(button.dataset.action, Number(button.dataset.day))));
  $("#strict-filter").closest("label").title = state.strict ? `严格筛选命中 ${strictSet.size} 个板块` : "15日内累计涨停 ≥10 家";
}

function cumulativeCounts() {
  const totals = {};
  if (!state.dataset) return totals;
  state.dataset.days.forEach(day => day.sectors.forEach(s => { totals[s.name] = (totals[s.name] || 0) + s.count; }));
  return totals;
}

// ---------- 板块详情弹窗（居中） ----------
function openDrawer(dayIndex, sectorName) {
  const day = boardDays()[dayIndex];
  const sector = day && day.sectors.find(s => s.name === sectorName);
  if (!sector) return;
  const themeSet = new Set(sector.themes && sector.themes.length ? sector.themes : [sector.name]);
  // 跨日匹配同一条主线：先按板块名精确匹配（保证所选日数字与板块卡完全一致），
  // 名称漂移时再退回题材集合交集匹配
  const matchSector = d => d.sectors.find(s => s.name === sector.name) || d.sectors.find(s => {
    const names = s.themes && s.themes.length ? s.themes : [s.name];
    return names.some(t => themeSet.has(t));
  });
  state.selected = { dayIndex, sectorName };
  $$(".sector-card").forEach(c => c.classList.toggle("is-selected", Number(c.dataset.day) === dayIndex && c.dataset.name === sectorName));
  const aliases = (sector.themes || []).filter(t => t !== sector.name);
  $("#drawer-date").textContent = `${fmtDate(day.date)} / ${day.weekday}${aliases.length ? ` · 含 ${aliases.slice(0, 4).join("/")}` : ""}`;
  $("#drawer-title").textContent = sector.name;

  // 板块内股票：当日全部涨停股，按龙头强度排序
  $("#drawer-stock-count").textContent = `${sector.count} 家涨停 · 按连板与封单排序`;
  let stocksHtml = sector.stocks.map((s, i) => stockRow(s, i, sector.name)).join("");
  if (state.showBreak) {
    const broken = (day.broken || []).filter(b => (b.concepts && b.concepts.length ? b.concepts.some(t => themeSet.has(t)) : b.sector === sector.name));
    stocksHtml += broken.map(b => `<div class="stock-row real is-broken is-clickable" data-code="${esc(b.code)}" data-name="${esc(b.name)}" title="点击查看日K与分时"><span><strong>${esc(b.name)}</strong><small>${esc(b.code)} · 炸板 ${b.zbc} 次未回封</small></span><span class="stock-amounts">${fmtYi(b.amount)} 亿</span></div>`).join("");
  }
  $("#drawer-stocks").innerHTML = stocksHtml || `<p class="stair-empty">当日无涨停个股</p>`;
  $$("#drawer-stocks .stock-row.is-clickable").forEach(row => row.addEventListener("click", () => openStockChart(row.dataset.code, row.dataset.name)));
  $$("#drawer-stocks .stock-move").forEach(button => button.addEventListener("click", e => { e.stopPropagation(); moveStock(button); }));

  // 最近三天涨停的隔天溢价率（所选日及其前两个交易日）
  const allDays = state.dataset.days;
  const upto = allDays.filter(d => d.date <= day.date).slice(-3);
  $("#premium-3d").innerHTML = upto.map(d => {
    const sec = matchSector(d);
    const rows = sec ? sec.stocks.map(s => `<div class="premium-row" data-code="${esc(s.code)}" data-date="${d.date}"><span><b>${esc(s.name)}</b><small>${esc(s.tag)}</small></span><em class="premium-value">…</em></div>`).join("") : `<p class="stair-empty">当日无涨停</p>`;
    return `<div class="premium-day"><header>${fmtDate(d.date)} ${d.weekday}<span>${sec ? sec.count + " 家" : ""}</span></header>${rows}</div>`;
  }).join("");
  upto.forEach(d => {
    loadForward(d.date, 1).then(fwd => {
      if (!state.selected || state.selected.sectorName !== sector.name) return;
      const map = new Map(fwd.rows.map(r => [r.code, r.forward]));
      $$(`#premium-3d .premium-row[data-date="${d.date}"]`).forEach(row => {
        const forward = map.get(row.dataset.code);
        const v = forward && forward[0];
        const cell = row.querySelector(".premium-value");
        cell.textContent = v == null ? "--" : `${v > 0 ? "+" : ""}${v}%`;
        cell.className = `premium-value ${v == null ? "" : v >= 0 ? "up" : "down"}`;
        if (v == null) cell.title = "次日尚未收盘";
        else if (fwd.intraday) cell.title = "盘中实时涨幅，收盘后落定";
      });
    }).catch(() => {});
  });

  // 近7日涨停数量趋势
  const trend = boardDays().map(d => {
    const hit = matchSector(d);
    return { date: fmtDate(d.date), count: hit ? hit.count : 0 };
  });
  const maxCount = Math.max(...trend.map(t => t.count), 1);
  $("#trend-chart").innerHTML = trend.map((t, i) => `<div class="trend-col ${i === trend.length - 1 ? "latest" : ""}"><b>${t.count}</b><i style="height:${Math.max(6, Math.round(t.count / maxCount * 100))}%"></i><span>${t.date}</span></div>`).join("");

  $("#detail-drawer").classList.add("is-open");
  $("#detail-drawer").setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").hidden = false;
  state.drawerOrigin = document.querySelector(`.sector-card[data-day="${dayIndex}"][data-name="${CSS.escape(sector.name)}"]`);
  $("#drawer-close").focus();
}

function stockRow(s, i, bucketName) {
  const reason = s.reason ? esc(s.reason) : (s.concepts || []).slice(0, 3).map(esc).join("/");
  const tip = s.reasonInfo ? esc(s.reasonInfo.slice(0, 160)) : "点击查看日K与分时";
  return `<div class="stock-row real is-clickable" data-code="${esc(s.code)}" data-name="${esc(s.name)}" title="${tip}"><span><strong>${i + 1}. ${esc(s.name)}</strong><small>${esc(s.code)} · ${esc(s.tag)}${s.zbc ? ` · 炸板${s.zbc}次` : ""}${s.theme ? ` · <em class="stock-theme">${esc(s.theme)}</em>` : ""}${reason ? ` · ${reason}` : ""}${s.manual ? ` · <em class="stock-manual">手动</em>` : ""}</small></span><span class="stock-amounts">${fmtYi(s.amount)}亿 · 封单${fmtYi(s.fund)}亿<button class="stock-move" data-code="${esc(s.code)}" data-name="${esc(s.name)}" data-bucket="${esc(bucketName || "")}" title="手动调整板块">调</button></span></div>`;
}

async function moveStock(button) {
  const code = button.dataset.code, name = button.dataset.name;
  const current = button.dataset.bucket || "";
  const input = prompt(`把「${name}」归入哪个板块？\n（输入新板块名；输入"恢复"清除手动设置，回到自动判定）`, current);
  if (input === null) return;
  const sector = input.trim() === "恢复" ? "" : input.trim();
  if (!sector && input.trim() !== "恢复") return;
  try {
    const response = await fetch("/api/sector-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, sector }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.notice || "保存失败");
    showToast(sector ? `${name} → ${sector}，重新计算中…` : `${name} 已恢复自动判定，重新计算中…`);
    await loadDataset(state.endDate, { silent: true });
    // 重新打开该股票当前所在的板块弹窗
    const dayIndex = state.selected != null ? state.selected.dayIndex : null;
    if (dayIndex != null) {
      const day = boardDays()[dayIndex];
      const target = day && day.sectors.find(s => s.stocks.some(st => st.code === code));
      if (target) openDrawer(dayIndex, target.name);
    }
  } catch (err) {
    showToast(err.message || "保存失败");
  }
}

async function renameSector() {
  if (!state.selected) return;
  const oldName = state.selected.sectorName;
  const dayIndex = state.selected.dayIndex;
  const input = prompt(`把板块「${oldName}」改名为：\n（所有历史与未来交易日统一生效；输入"恢复"清除改名映射）`, oldName);
  if (input === null) return;
  const trimmed = input.trim();
  const newName = trimmed === "恢复" ? "" : trimmed;
  if (!newName && trimmed !== "恢复") return;
  if (newName === oldName) return;
  try {
    const response = await fetch("/api/sector-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old: oldName, new: newName }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.notice || "改名失败");
    showToast(newName ? `${oldName} → ${newName}，重新计算中…` : `${oldName} 已恢复原名，重新计算中…`);
    closeDrawer();
    await loadDataset(state.endDate, { silent: true });
    const day = boardDays()[dayIndex];
    const targetName = newName || oldName;
    if (day && day.sectors.some(s => s.name === targetName)) openDrawer(dayIndex, targetName);
  } catch (err) {
    showToast(err.message || "改名失败");
  }
}

function closeDrawer() {
  $("#detail-drawer").classList.remove("is-open");
  $("#detail-drawer").setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").hidden = true;
  $$(".sector-card").forEach(c => c.classList.remove("is-selected"));
  state.selected = null;
  const origin = state.drawerOrigin;
  state.drawerOrigin = null;
  if (origin && document.contains(origin)) origin.focus();
}

// ---------- 分析弹窗 ----------
function dialogFrame(kicker, title, subtitle, html) {
  $("#analysis-kicker").textContent = kicker;
  $("#analysis-title").textContent = title;
  $("#analysis-subtitle").textContent = subtitle;
  $("#analysis-body").style.setProperty("--premium-cols", state.premiumDays);
  $("#analysis-body").innerHTML = html;
  $("#analysis-dialog").showModal();
}

async function openDayAnalysis(action, index) {
  const day = boardDays()[index];
  if (!day) return;
  if (action === "ladder") return openLadder(day, index);
  if (action === "all") return openAllStocks(day, index);
  dialogFrame("DATE RELAY", `${fmtDate(day.date)} · 板块接力质量`, `${day.weekday} · 正在计算真实后续溢价……`, `<p class="empty-lane board-loading">按涨停日收盘对收盘计算 D+1 至 D+${state.premiumDays}……</p>`);
  try {
    const fwd = await loadForward(day.date, state.premiumDays);
    const byCode = new Map(fwd.rows.map(r => [r.code, r]));
    const rows = day.sectors.slice(0, 8).map(sector => {
      const members = sector.stocks.map(s => byCode.get(s.code)).filter(Boolean);
      const avg = Array.from({ length: state.premiumDays }, (_, i) => {
        const vals = members.map(m => m.forward[i]).filter(v => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      const cum = avg.reduce((a, b) => a + (b || 0), 0);
      return { sector, avg, cum };
    }).sort((a, b) => b.cum - a.cum);
    const html = `<div class="analysis-summary"><div><span>当日涨停</span><strong>${day.total}</strong></div><div><span>领先板块</span><strong>${esc(day.sectors[0]?.name || "--")}</strong></div><div><span>观察周期</span><strong>${state.premiumDays} 日</strong></div></div><div class="data-table"><div class="data-row head"><span>板块（平均溢价）</span>${Array.from({ length: state.premiumDays }, (_, i) => `<span>D+${i + 1}</span>`).join("")}</div>${rows.map((r, ri) => `<button class="data-row drill-sector" data-name="${esc(r.sector.name)}" data-day="${index}"><strong>${esc(r.sector.name)} · ${r.sector.count}家 · 最高${r.sector.maxLbc}板</strong>${r.avg.map(v => `<span class="${v == null ? "" : v >= 0 ? "up" : "down"}">${v == null ? "--" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"}</span>`).join("")}</button>`).join("")}</div><p class="analysis-foot-note">板块平均溢价 = 板块内涨停股收盘对收盘真实涨幅均值；-- 表示该交易日尚未到来。</p>`;
    dialogFrame("DATE RELAY", `${fmtDate(day.date)} · 板块接力质量`, `${day.weekday} · 真实后续溢价 · 点击行下钻板块`, html);
    $$(".drill-sector").forEach(b => b.addEventListener("click", () => { $("#analysis-dialog").close(); openDrawer(Number(b.dataset.day), b.dataset.name); }));
  } catch (error) {
    dialogFrame("DATE RELAY", `${fmtDate(day.date)} · 板块接力质量`, day.weekday, `<p class="empty-lane board-loading">${esc(error.message)}</p>`);
  }
}

function openLadder(day, index) {
  const rows = day.stocks.filter(x => x.lbc >= 2);
  const maxBoard = rows.length ? Math.max(...rows.map(x => x.lbc)) : 1;
  const levels = Array.from({ length: maxBoard - 1 }, (_, i) => maxBoard - i);
  const html = `<div class="ladder-stack">${levels.map(level => { const hits = rows.filter(x => x.lbc === level); return `<section><header><strong>${level}板</strong><span>${hits.length} 家</span></header><div>${hits.length ? hits.map(x => `<button class="stock-chip" data-name="${esc(x.name)}"><b>${esc(x.name)}</b><small>${esc(x.sector)} · ${esc(x.tag)} · 封单${fmtYi(x.fund)}亿</small></button>`).join("") : `<p>梯队空缺</p>`}</div></section>`; }).join("")}</div>${rows.length ? "" : `<p class="empty-lane board-loading">当日无连板个股</p>`}`;
  dialogFrame("LIMIT-UP LADDER", `${fmtDate(day.date)} · 连板个股梯队`, `${day.weekday} · 真实涨停池`, html);
}

function openAllStocks(day, index) {
  const html = `<div class="grouped-stocks">${day.sectors.map(sector => `<section><header><div><strong>${esc(sector.name)}</strong><span>${sector.count} 家 · ${fmtYi(sector.amount)} 亿 · 最高${sector.maxLbc}板</span></div><button class="group-drill" data-name="${esc(sector.name)}" data-day="${index}">板块详情</button></header>${sector.stocks.map(x => `<div class="group-stock"><span><b>${esc(x.name)}</b><small>${esc(x.code)}</small></span><span>${esc(x.tag)}</span><span>${fmtYi(x.amount)}亿</span><span class="up">封单${fmtYi(x.fund)}亿</span></div>`).join("")}</section>`).join("")}</div>`;
  dialogFrame("DAILY LIMIT-UP POOL", `${fmtDate(day.date)} · 全部涨停个股`, `${day.weekday} · 按板块分组 · 真实涨停池`, html);
  $$(".group-drill").forEach(b => b.addEventListener("click", () => { $("#analysis-dialog").close(); openDrawer(Number(b.dataset.day), b.dataset.name); }));
}

// ---------- 15日阶梯 / 高度 / 排行 ----------
function openStaircase(name) {
  const days = state.dataset.days;
  const html = `<div class="staircase">${days.map(d => { const sector = d.sectors.find(s => s.name === name); const stocks = sector ? sector.stocks : []; return `<section><header><strong>${fmtDate(d.date)}</strong><span>${stocks.length} 家 · ${d.weekday}</span></header><div>${stocks.length ? stocks.map(x => `<button class="stair-chip ${tagClass(x.tag)}" data-code="${esc(x.code)}"><b>${esc(x.name)}</b><small>${esc(x.tag)}${x.zbc ? ` · 炸${x.zbc}` : ""} · 封单${fmtYi(x.fund)}亿</small></button>`).join("") : `<p class="stair-empty">当日无涨停</p>`}</div></section>`; }).join("")}</div>`;
  dialogFrame("SECTOR STAIRCASE", `${esc(name)} · 15日涨停个股阶梯`, "按龙头强度排序（连板数 → 封单金额） · 红色连板 · 蓝色多天板 · 灰色首板", html);
}


// ---------- 板块领先度 ----------
function renderLeaders() {
  const totals = cumulativeCounts();
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#leader-chips").innerHTML = top.map(([name, count], i) => `<button class="leader-chip" data-name="${esc(name)}"><b>${String(i + 1).padStart(2, "0")}</b>${esc(name)}<i>${count}</i></button>`).join("");
  $$(".leader-chip").forEach(b => b.addEventListener("click", () => openStaircase(b.dataset.name)));
}

// ---------- TOP 板块情绪周期 ----------
function sparklineSVG(trend, color) {
  const W = 120, H = 34, pad = 3;
  const max = Math.max(...trend, 1);
  const n = trend.length;
  const x = i => pad + i * (W - pad * 2) / Math.max(1, n - 1);
  const y = v => H - pad - (v / max) * (H - pad * 2);
  const pts = trend.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const bars = trend.map((v, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" fill="${i === n - 1 ? color : "#c7c7cc"}"><title>${v} 家</title></circle>`
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="momentum-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.7"/>${bars}</svg>`;
}

async function loadSectorMomentum(force) {
  if (state.sectorMomentum && !force) return state.sectorMomentum;
  const response = await fetch("/api/sector-momentum?days=5", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.notice || "板块情绪暂不可用");
  state.sectorMomentum = data;
  return data;
}

function momentumCardsHTML(data) {
  return (data.sectors || []).map((s, i) => {
    const color = s.phaseColor || "#868e96";
    return `<button class="momentum-card" data-name="${esc(s.name)}" style="--phase:${color}">
      <span class="momentum-rank">${String(i + 1).padStart(2, "0")}</span>
      <span class="momentum-phase" style="background:${color}1a;color:${color};border-color:${color}55">${esc(s.phase)}</span>
      <strong class="momentum-name">${esc(s.name)}</strong>
      <span class="momentum-score">强度 ${s.score}</span>
      ${sparklineSVG(s.dailyTrend || [], color)}
      <span class="momentum-metrics"><span>5日 <b>${s.totalLimitup}</b> 家</span><span>最高 <b>${s.maxLbc}</b> 板</span><span>晋级 <b>${s.avgPromotion == null ? "--" : s.avgPromotion + "%"}</b></span><span>炸板 <b>${s.breakRate == null ? "--" : s.breakRate + "%"}</b></span></span>
    </button>`;
  }).join("");
}

async function renderMomentumInto(panel) {
  const sec = document.createElement("div");
  sec.className = "sentiment-section momentum-section";
  sec.innerHTML = `<h3>TOP 板块情绪周期 · 近 5 日最强主线</h3><p class="empty-lane board-loading">正在计算板块强度与梯队……</p>`;
  panel.appendChild(sec);
  try {
    const data = await loadSectorMomentum();
    if (state.view !== "sentiment") return;
    const mc = data.marketContext || {};
    sec.innerHTML = `<h3>TOP 板块情绪周期 · 近 5 日最强主线</h3>
      <p class="momentum-context">近 5 日日均涨停 ${mc.avgLimitup ?? "--"} 家 · 全场最高 ${mc.maxLadder ?? "--"} 板${mc.maxLadderName ? `（${esc(mc.maxLadderName)}）` : ""}${data.isIntraday ? " · 盘中数据，收盘后复核" : ""}</p>
      <div class="momentum-cards">${momentumCardsHTML(data)}</div>
      <p class="analysis-foot-note">强度分 = 家数规模 30 + 高度 25 + 持续性 15 + 晋级率 15 + 隔日溢价 15（板块间 0-100 归一加权）；点开卡片看梯队与周期判定依据 · 生成于 ${esc(data.generatedAt || "")}</p>`;
    sec.querySelectorAll(".momentum-card").forEach(card => card.addEventListener("click", () => openSectorDetail(card.dataset.name)));
  } catch (error) {
    if (state.view !== "sentiment") return;
    sec.innerHTML = `<h3>TOP 板块情绪周期 · 近 5 日最强主线</h3><p class="empty-lane board-loading">${esc(error.message)}</p>`;
  }
}

function ladderGroup(title, stocks, note) {
  const seal = v => { const s = String(v || "").padStart(6, "0"); return /^\d{6}$/.test(s) && s !== "000000" ? `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}` : ""; };
  const rows = stocks.length ? stocks.map(s => {
    const fbt = seal(s.firstSeal);
    return `<button class="ladder-stock" data-code="${esc(s.code)}" data-name="${esc(s.name)}" title="点击查看日K与分时"><b>${esc(s.name)}</b><small>${s.lbc} 板${s.promoted ? " · 晋级" : " · 新面孔"}${s.zbc ? ` · 炸${s.zbc}` : ""}${fbt ? ` · 首封 ${fbt}` : ""}</small></button>`;
  }).join("") : `<p class="stair-empty">空位</p>`;
  return `<section class="ladder-group"><header><strong>${title}</strong><span>${stocks.length} 家${note ? ` · ${note}` : ""}</span></header><div class="ladder-list">${rows}</div></section>`;
}

async function openSectorDetail(name) {
  dialogFrame("SECTOR CYCLE", `${esc(name)} · 情绪周期`, "读取梯队与判定依据……", `<p class="empty-lane board-loading">正在装配板块梯队……</p>`);
  try {
    const response = await fetch(`/api/sector-detail?name=${encodeURIComponent(name)}&days=5`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.notice || "板块详情暂不可用");
    const color = data.phaseColor || "#868e96";
    const ladder = data.ladder || { leader: [], core: [], rookie: [] };
    const detailRows = (data.dailyDetail || []).map(d =>
      `<div class="data-row"><strong>${fmtDate(d.date)}</strong><span>${d.count} 家</span><span>${d.maxLbc} 板</span><span>${d.rookie} 首板</span><span>${d.promotion == null ? "--" : d.promotion + "%"}</span><span>${d.breakRate == null ? "--" : d.breakRate + "%"}</span><span class="${d.premium == null ? "" : d.premium >= 0 ? "up" : "down"}">${d.premium == null ? "--" : (d.premium > 0 ? "+" : "") + d.premium + "%"}</span></div>`
    ).join("");
    const rules = (data.rules || []).map(r =>
      `<li class="${r.hit ? "hit" : "miss"}"><i>${r.hit ? "✓" : "✕"}</i><span>${esc(r.rule_id)} ${esc(r.desc)}</span><em>${typeof r.value === "object" ? "" : esc(String(r.value))}</em></li>`
    ).join("");
    const html = `
      <div class="cycle-hero"><span class="momentum-phase big" style="background:${color}1a;color:${color};border-color:${color}55">${esc(data.phase)}</span><div><strong>${esc(name)}</strong><small>强度分 ${data.score ?? "--"} · ${data.isIntraday ? "盘中数据，收盘后复核" : "收盘数据"}</small></div></div>
      <div class="ladder-3col">
        ${ladderGroup("龙头（最高连板）", ladder.leader || [])}
        ${ladderGroup("中军（中间梯队）", ladder.core || [])}
        ${ladderGroup("新兵（今日首板）", ladder.rookie || [], "源源不断为佳")}
      </div>
      <div class="data-table cycle-table"><div class="data-row head"><span>日期</span><span>家数</span><span>高度</span><span>首板</span><span>晋级率</span><span>炸板率</span><span>隔日溢价</span></div>${detailRows}</div>
      <div class="cycle-rules"><h3>周期判定依据（命中即停，按主升→发酵→启动→分歧→退潮顺序）</h3><ul>${rules}</ul></div>
      <p class="analysis-foot-note">梯队与判定全部来自涨停池/炸板池真实数据；点个股可看日K与分时 · 不构成投资建议</p>`;
    dialogFrame("SECTOR CYCLE", `${esc(name)} · 情绪周期`, `近 5 日窗口 · ${esc(data.generatedAt || "")}`, html);
    $$("#analysis-body .ladder-stock").forEach(b => b.addEventListener("click", () => openStockChart(b.dataset.code, b.dataset.name)));
  } catch (error) {
    dialogFrame("SECTOR CYCLE", `${esc(name)} · 情绪周期`, "", `<p class="empty-lane board-loading">${esc(error.message)}</p>`);
  }
}

// ---------- 板块资金流向 ----------
async function loadCapitalFlow(type, force) {
  const key = type || "industry";
  if (state.flowCache[key] && !force) return state.flowCache[key];
  const response = await fetch(`/api/capital-flow?type=${key}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.notice || "资金流向暂不可用");
  state.flowCache[key] = data;
  return data;
}

function flowRow(item, i, maxAbs, dir) {
  const w = Math.max(6, Math.round(Math.abs(item.netInflow) / maxAbs * 100));
  const net = `${item.netInflow > 0 ? "+" : ""}${item.netInflow} 亿`;
  return `<div class="flow-row"><span class="flow-rank">${String(i + 1).padStart(2, "0")}</span><span class="flow-name">${esc(item.name)}</span><span class="flow-bar"><i class="${dir}" style="width:${w}%"></i></span><span class="flow-net ${dir === "in" ? "up" : "down"}">${net}</span><span class="flow-pct ${item.pct >= 0 ? "up" : "down"}">${item.pct > 0 ? "+" : ""}${item.pct}%</span></div>`;
}

async function renderCapitalFlow() {
  const board = $("#board");
  $("#board-title").textContent = "板块资金流向";
  $("#board-eyebrow").textContent = "CAPITAL FLOW · 主力净流入排行";
  const key = state.flowType;
  if (!state.flowCache[key]) board.innerHTML = `<p class="empty-lane board-loading">正在读取板块资金流向……</p>`;
  let data;
  try {
    data = await loadCapitalFlow(key);
  } catch (error) {
    if (state.view !== "flow") return;
    board.innerHTML = `<p class="empty-lane board-loading">${esc(error.message)}<br>点击「刷新行情」重试。</p>`;
    return;
  }
  if (state.view !== "flow") return;
  const all = [...(data.inflows || []), ...(data.outflows || [])];
  const maxAbs = Math.max(...all.map(x => Math.abs(x.netInflow)), 1);
  board.innerHTML = `<div class="flow-panel">
    <div class="flow-toolbar">
      <div class="flow-toggle">${[["industry", "行业板块"], ["concept", "概念板块"]].map(([v, label]) => `<button class="${key === v ? "is-active" : ""}" data-flow-type="${v}">${label}</button>`).join("")}</div>
      <span class="flow-note">${esc(data.boardLabel)} · 主力净流入 = 超大单 + 大单净额${data.isIntraday ? " · 盘中延时数据" : " · 收盘数据"}</span>
    </div>
    <div class="flow-columns">
      <section class="flow-col"><header><strong>资金流入 Top 10</strong><span>主力净流入</span></header>${(data.inflows || []).map((x, i) => flowRow(x, i, maxAbs, "in")).join("")}</section>
      <section class="flow-col"><header><strong>资金流出 Top 10</strong><span>主力净流出</span></header>${(data.outflows || []).map((x, i) => flowRow(x, i, maxAbs, "out")).join("")}</section>
    </div>
    <p class="analysis-foot-note">${esc(data.source)} · 更新于 ${esc(data.fetchedAt)} · 不构成投资建议</p>
  </div>`;
  $$("[data-flow-type]").forEach(b => b.addEventListener("click", () => {
    state.flowType = b.dataset.flowType;
    renderCapitalFlow();
  }));
}

// ---------- 指数行情条 ----------
function renderTicker(indices = []) {
  const map = { "000001": ["#ticker-sh", "上证"], "399001": ["#ticker-sz", "深证"], "399006": ["#ticker-cy", "创业板"] };
  indices.forEach(x => {
    const target = map[x.code];
    if (!target) return;
    const cls = x.pct >= 0 ? "up" : "down";
    $(target[0]).innerHTML = `<b>${target[1]}</b> ${Number(x.price).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <em class="${cls}">${x.pct >= 0 ? "+" : ""}${Number(x.pct).toFixed(2)}%</em>`;
  });
}

async function loadMarket(manual = false) {
  const dot = $("#connection-dot");
  dot.className = "connection-dot is-loading";
  $("#connection-text").textContent = "更新免费行情";
  try {
    const r = await fetch("/api/market", { cache: "no-store" }), data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.notice || "行情不可用");
    renderTicker(data.indices || []);
    state.marketData = data;
    $("#freshness").textContent = (data.fetchedAt || "").split(" ")[1] || "--:--:--";
    $("#connection-text").textContent = "免费行情已连接";
    $("#source-notice").textContent = `${data.notice}；涨停板块、板块情绪与市场情绪已接入真实数据源。`;
    dot.className = "connection-dot";
    if (manual) showToast("免费指数行情已更新");
  } catch (e) {
    dot.className = "connection-dot is-error";
    $("#connection-text").textContent = "指数行情暂不可用";
    $("#source-notice").textContent = `${e.message}；涨停池与板块情绪数据不受影响。`;
    if (manual) showToast("指数行情暂不可用");
  }
}

// ---------- 个股图表弹窗（日K + 分时） ----------
async function openStockChart(code, name) {
  const dlg = $("#stock-dialog");
  $("#stock-chart-title").textContent = `${name} · ${code}`;
  $("#stock-chart-sub").textContent = "读取行情中……";
  $("#stock-chart-note").textContent = "";
  if (!dlg.open) dlg.showModal();
  try {
    const r = await fetch(`/api/stock-chart?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.notice || "图表数据不可用");
    drawKline($("#kline-chart"), data.daily || []);
    drawMinute($("#minute-chart"), data.minute || [], data.prevClose);
    $("#stock-chart-sub").textContent = `${data.minuteDate ? `分时 ${data.minuteDate} · ` : ""}${data.fetchedAt}`;
    $("#stock-chart-note").textContent = data.source || "";
  } catch (error) {
    $("#stock-chart-sub").textContent = error.message;
  }
}

function fitCanvas(canvas, cssH) {
  const cssW = Math.max(320, canvas.parentElement.clientWidth - 4);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return [ctx, cssW, cssH];
}

const CHART_UP = "#e5453c", CHART_DOWN = "#12a05c", CHART_GRID = "#ececf0", CHART_TEXT = "#8e8e93";

function drawKline(canvas, rows) {
  const [ctx, W, H] = fitCanvas(canvas, 320);
  ctx.font = "10px -apple-system, sans-serif";
  if (!rows.length) { ctx.fillStyle = CHART_TEXT; ctx.fillText("暂无日K数据", 12, 20); return; }
  const data = rows.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] || 0 }));
  const padL = 8, padR = 52, padT = 10, priceH = H * 0.68, volTop = priceH + 14, volH = H - volTop - 18;
  const hi = Math.max(...data.map(x => x.h)), lo = Math.min(...data.map(x => x.l));
  const vmax = Math.max(...data.map(x => x.v), 1);
  const py = v => padT + (hi - v) / (hi - lo || 1) * (priceH - padT - 6);
  const n = data.length, slot = (W - padL - padR) / n, body = Math.max(1.5, slot * 0.62);
  const x = i => padL + slot * i + slot / 2;
  ctx.strokeStyle = CHART_GRID; ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => { const y = padT + f * (priceH - padT); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); });
  const ma = (arr, p, i) => i >= p - 1 ? arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b.c, 0) / p : null;
  data.forEach((k, i) => {
    const up = k.c >= k.o, color = up ? CHART_UP : CHART_DOWN;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x(i), py(k.h)); ctx.lineTo(x(i), py(k.l)); ctx.stroke();
    const t = py(Math.max(k.o, k.c)), b = py(Math.min(k.o, k.c));
    if (up) { ctx.lineWidth = 1; ctx.strokeRect(x(i) - body / 2, t, body, Math.max(1, b - t)); }
    else ctx.fillRect(x(i) - body / 2, t, body, Math.max(1, b - t));
    const vh = k.v / vmax * volH;
    ctx.globalAlpha = 0.75; ctx.fillRect(x(i) - body / 2, volTop + volH - vh, body, vh); ctx.globalAlpha = 1;
  });
  [[5, "#ff9f0a"], [10, "#0a84ff"]].forEach(([p, color]) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
    let started = false;
    data.forEach((k, i) => { const m = ma(data, p, i); if (m == null) return; const X = x(i), Y = py(m); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; });
    ctx.stroke();
    ctx.fillStyle = color; ctx.fillText(`MA${p}`, W - padR + 6, padT + 10 + (p === 5 ? 0 : 12));
  });
  ctx.fillStyle = CHART_TEXT;
  ctx.fillText(hi.toFixed(2), W - padR + 6, py(hi) + 8);
  ctx.fillText(lo.toFixed(2), W - padR + 6, py(lo));
  ctx.fillText(data[0].d.slice(5), padL, H - 4);
  ctx.textAlign = "right"; ctx.fillText(data[n - 1].d.slice(5), W - padR, H - 4); ctx.textAlign = "left";
}

function drawMinute(canvas, minute, prevClose) {
  const [ctx, W, H] = fitCanvas(canvas, 220);
  ctx.font = "10px -apple-system, sans-serif";
  if (!minute.length || prevClose == null) { ctx.fillStyle = CHART_TEXT; ctx.fillText("暂无分时数据（非交易时段或数据源未覆盖）", 12, 20); return; }
  const padL = 8, padR = 56, padT = 10, padB = 18;
  const prices = minute.map(m => m[1]);
  let hi = Math.max(...prices, prevClose), lo = Math.min(...prices, prevClose);
  const span = Math.max(hi - prevClose, prevClose - lo, prevClose * 0.005);
  hi = prevClose + span; lo = prevClose - span;
  const n = minute.length;
  const x = i => padL + (W - padL - padR) * i / (n - 1 || 1);
  const y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const base = y(prevClose);
  const upColor = prices[n - 1] >= prevClose ? CHART_UP : CHART_DOWN;
  ctx.strokeStyle = CHART_GRID;
  [0.25, 0.75].forEach(f => { const gy = padT + f * (H - padT - padB); ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke(); });
  ctx.setLineDash([4, 4]); ctx.strokeStyle = "#c7c7cc";
  ctx.beginPath(); ctx.moveTo(padL, base); ctx.lineTo(W - padR, base); ctx.stroke(); ctx.setLineDash([]);
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, upColor + "33"); grad.addColorStop(1, upColor + "05");
  ctx.beginPath(); ctx.moveTo(x(0), y(prices[0]));
  prices.forEach((p, i) => ctx.lineTo(x(i), y(p)));
  ctx.lineTo(x(n - 1), base); ctx.lineTo(x(0), base); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x(0), y(prices[0]));
  prices.forEach((p, i) => ctx.lineTo(x(i), y(p)));
  ctx.strokeStyle = upColor; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = CHART_TEXT;
  const pct = v => `${v.toFixed(2)} (${((v / prevClose - 1) * 100).toFixed(1)}%)`;
  ctx.fillText(pct(hi), W - padR + 6, y(hi) + 8);
  ctx.fillText(prevClose.toFixed(2), W - padR + 6, base + 3);
  ctx.fillText(pct(lo), W - padR + 6, y(lo) + 4);
  ctx.fillText("09:30", padL, H - 4);
  ctx.textAlign = "center"; ctx.fillText("11:30/13:00", (W - padR + padL) / 2, H - 4);
  ctx.textAlign = "right"; ctx.fillText("15:00", W - padR, H - 4); ctx.textAlign = "left";
}

// ---------- 市场情绪温度计 ----------
function stageColorMap(data) {
  const map = {};
  (data.stages || []).forEach(s => { map[s.name] = s.color; });
  return map;
}

function gaugeSVG(temp, color) {
  const r = 80, c = Math.PI * r;
  const filled = Math.max(0, Math.min(100, temp)) / 100 * c;
  return `<svg viewBox="0 0 200 116" class="sentiment-gauge-svg" role="img" aria-label="情绪温度 ${temp} 分">
    <path d="M 20 105 A 80 80 0 0 1 180 105" fill="none" stroke="#e8e8ed" stroke-width="14" stroke-linecap="round"/>
    <path d="M 20 105 A 80 80 0 0 1 180 105" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}"/>
    <text x="100" y="86" text-anchor="middle" class="gauge-num" fill="${color}">${temp}</text>
    <text x="100" y="108" text-anchor="middle" class="gauge-label">情绪温度 / 100</text>
  </svg>`;
}

function sentimentTrendSVG(days, colors) {
  const W = 760, H = 220, padL = 36, padR = 16, padT = 16, padB = 32;
  const xi = i => padL + i * (W - padL - padR) / Math.max(1, days.length - 1);
  const yt = t => padT + (100 - t) / 100 * (H - padT - padB);
  const grids = [0, 25, 45, 70, 100].map(g =>
    `<line x1="${padL}" x2="${W - padR}" y1="${yt(g)}" y2="${yt(g)}" class="trend-grid"/><text x="${padL - 6}" y="${yt(g) + 4}" text-anchor="end" class="trend-grid-label">${g}</text>`
  ).join("");
  const pts = days.map((d, i) => `${xi(i).toFixed(1)},${yt(d.temp).toFixed(1)}`).join(" ");
  const dots = days.map((d, i) =>
    `<circle cx="${xi(i).toFixed(1)}" cy="${yt(d.temp).toFixed(1)}" r="5" fill="${colors[d.stage] || "#86868b"}"><title>${fmtDate(d.date)} ${d.weekday} · ${d.temp} 分 · ${d.stage}</title></circle>`
  ).join("");
  const step = Math.max(1, Math.ceil(days.length / 8));
  const labels = days.map((d, i) => i % step === 0 || i === days.length - 1
    ? `<text x="${xi(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="trend-x-label">${fmtDate(d.date)}</text>` : ""
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="sentiment-trend-svg">${grids}<polyline points="${pts}" fill="none" stroke="#1d1d1f" stroke-width="2" stroke-linejoin="round" opacity="0.55"/>${dots}${labels}</svg>`;
}

async function renderSentiment() {
  const board = $("#board");
  $("#board-title").textContent = "市场情绪温度计";
  $("#board-eyebrow").textContent = "MARKET SENTIMENT · 六指标量化打分";
  if (!state.sentiment) board.innerHTML = `<p class="empty-lane board-loading">正在计算情绪温度（首次约需 1 分钟，抓取真实 K 线）……</p>`;
  let data;
  try {
    data = await loadSentiment();
  } catch (error) {
    if (state.view !== "sentiment") return;
    board.innerHTML = `<p class="empty-lane board-loading">${esc(error.message)}<br>点击「刷新行情」重试。</p>`;
    return;
  }
  if (state.view !== "sentiment") return;
  const latest = data.latest;
  if (!latest) { board.innerHTML = `<p class="empty-lane">暂无情绪数据</p>`; return; }
  const colors = stageColorMap(data);
  const color = colors[latest.stage] || "#86868b";
  const sc = latest.scores || {};
  const premiumText = latest.premiumAvg == null ? "--" : (latest.premiumAvg > 0 ? "+" : "") + latest.premiumAvg + "%";
  const cards = [
    { label: "涨停家数", value: `${latest.zt} 家`, sub: `已剔除 ST/新股`, score: `+${sc.zt ?? 0} / 30` },
    { label: "最高连板", value: `${latest.maxLbc} 板`, sub: "情绪天花板", score: `+${sc.height ?? 0} / 20` },
    { label: "昨涨停今日溢价", value: premiumText, sub: `红盘率 ${latest.redRatio == null ? "--" : latest.redRatio + "%"}`, score: sc.premium == null ? "-- / 25" : `+${sc.premium} / 25` },
    { label: "炸板率", value: `${latest.brokenRate}%`, sub: `炸板 ${latest.broken} 家`, score: `+${sc.broken ?? 0} / 15` },
    { label: "跌停家数", value: `${latest.downLimit} 家`, sub: `大面（跌超5%）${latest.damain == null ? "--" : latest.damain} 家`, score: `${sc.downLimit ?? 0} / 0` },
    { label: "连板晋级率", value: latest.promotion == null ? "--" : `${latest.promotion}%`, sub: "昨日2板+今日继续涨停", score: "结构信号" },
  ];
  const stageList = (data.stages || []).map(s =>
    `<div class="stage-item ${s.name === latest.stage ? "is-active" : ""}"><i style="background:${s.color}"></i><div><strong>${esc(s.name)}</strong><small>${esc(s.range)}</small><p>${esc(s.desc)}</p></div></div>`
  ).join("");
  board.innerHTML = `
    <div class="sentiment-panel">
      <div class="sentiment-hero">
        <div class="sentiment-gauge">${gaugeSVG(latest.temp, color)}</div>
        <div class="sentiment-stage">
          <div class="stage-badge" style="background:${color}1a;color:${color};border-color:${color}55">${esc(latest.stage)}</div>
          <h3>${fmtDate(latest.date)} ${esc(latest.weekday)} · ${latest.temp} 分</h3>
          <p>${esc(latest.stageNote || "")}</p>
          <small>生成于 ${esc(data.fetchedAt)}</small>
        </div>
      </div>
      <div class="sentiment-cards">${cards.map(c =>
        `<div class="sentiment-card"><span>${c.label}</span><strong>${c.value}</strong><small>${c.sub}</small><em>${c.score}</em></div>`
      ).join("")}</div>
      <div class="sentiment-section"><h3>近 ${data.days.length} 日温度走势</h3>${sentimentTrendSVG(data.days, colors)}</div>
      <div class="sentiment-section"><h3>五阶段判定标准</h3><div class="stage-list">${stageList}</div></div>
      <p class="analysis-foot-note">${esc(data.rules.formula)}<br>涨停 ${esc(data.rules.zt)}；高度 ${esc(data.rules.height)}；溢价 ${esc(data.rules.premium)}；炸板率 ${esc(data.rules.broken)}；跌停 ${esc(data.rules.downLimit)}。<br>${esc(data.source)} · 不构成投资建议</p>
    </div>`;
  const panel = board.querySelector(".sentiment-panel");
  if (panel) renderMomentumInto(panel);
}

async function loadSentiment(force) {
  if (state.sentiment && !force) return state.sentiment;
  const response = await fetch("/api/sentiment?days=40", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.notice || "情绪温度暂不可用");
  state.sentiment = data;
  return data;
}

// ---------- 控件 ----------
$$(".view-tab").forEach(b => b.addEventListener("click", () => {
  state.view = b.dataset.view;
  $$(".view-tab").forEach(x => x.classList.toggle("is-active", x === b));
  closeDrawer();
  document.body.classList.toggle("view-sentiment", state.view === "sentiment");
  document.body.classList.toggle("view-flow", state.view === "flow");
  history.replaceState(null, "", state.view === "limit" ? location.pathname + location.search : `#${state.view}`);
  if (state.view === "flow") renderCapitalFlow();
  else if (state.view === "sentiment") renderSentiment();
  else renderBoard();
}));
$("#count-filter").addEventListener("change", e => { state.minFive = e.target.checked; renderBoard(); });
$("#strict-filter").addEventListener("change", e => { state.strict = e.target.checked; renderBoard(); showToast(state.strict ? `严格筛选已开启 · 命中 ${[...Object.entries(cumulativeCounts())].filter(([, v]) => v >= 10).length} 个板块` : "严格筛选已关闭"); });
$("#heat-filter").addEventListener("change", e => { state.showBreak = e.target.checked; if (state.selected) openDrawer(state.selected.dayIndex, state.selected.sectorName); showToast(state.showBreak ? "板块详情将显示真实炸板记录" : "人气炸板已隐藏"); });
$("#sort-button").addEventListener("click", e => { state.sort = state.sort === "count" ? "ladder" : "count"; e.currentTarget.textContent = state.sort === "count" ? "家数优先" : "高度优先"; renderBoard(); });
$("#refresh-button").addEventListener("click", async () => {
  if (state.view === "flow") {
    try { await loadCapitalFlow(state.flowType, true); renderCapitalFlow(); showToast("资金流向已刷新"); } catch (e2) { showToast(e2.message); }
    return;
  }
  if (state.view === "sentiment") {
    try {
      await loadSentiment(true);
      renderSentiment();
      loadSectorMomentum(true).then(() => { if (state.view === "sentiment") renderSentiment(); });
      showToast("情绪温度已刷新");
    } catch (e2) { showToast(e2.message); }
    return;
  }
  try { await loadDataset(state.endDate, { silent: true }); showToast("涨停池已刷新"); } catch (e2) { showToast(e2.message); } loadMarket(true);
});
$("#history-prev").addEventListener("click", () => {
  const first = state.dataset.days[0].date;
  const d = new Date(`${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const end = d.toISOString().slice(0, 10).replace(/-/g, "");
  loadDataset(end).then(() => { $("#history-today").disabled = false; }).catch(e2 => showToast(e2.message));
});
$("#history-today").addEventListener("click", () => { loadDataset(null).then(() => { $("#history-today").disabled = true; }).catch(e2 => showToast(e2.message)); });
$("#history-date").addEventListener("change", e => {
  if (!e.target.value) return;
  loadDataset(e.target.value.replace(/-/g, "")).then(() => { $("#history-today").disabled = false; }).catch(e2 => showToast(e2.message));
});
$("#premium-days").addEventListener("change", e => { state.premiumDays = Number(e.target.value); showToast(`溢价周期已切换为 ${state.premiumDays} 日`); });
$("#drawer-close").addEventListener("click", closeDrawer);
$("#drawer-rename").addEventListener("click", renameSector);
$("#drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
$("#analysis-close").addEventListener("click", () => $("#analysis-dialog").close());
$("#analysis-done").addEventListener("click", () => $("#analysis-dialog").close());
$("#stock-chart-close").addEventListener("click", () => $("#stock-dialog").close());
$("#method-button").addEventListener("click", () => $("#method-dialog").showModal());
$("#model-card-button").addEventListener("click", () => $("#method-dialog").showModal());
$("#sort-button").textContent = "家数优先";

// ---------- 启动 ----------
(async function boot() {
  try {
    await loadDataset(null);
  } catch (error) {
    $("#board").innerHTML = `<p class="empty-lane board-loading">${esc(error.message)}<br>点击「刷新行情」重试；不会用演示数据冒充真实涨停。</p>`;
  }
  loadMarket();
  setInterval(loadMarket, 15000);
  // 支持 #sentiment / #flow / #sector:板块名 直达（#sector 并入市场情绪页，可分享）
  const target = location.hash.replace("#", "");
  const [viewName, viewArg] = target.split(":");
  const aliased = viewName === "sector" ? "sentiment" : viewName;
  if (["sentiment", "flow"].includes(aliased)) {
    const tab = document.querySelector(`[data-view="${aliased}"]`);
    if (tab) tab.click();
    if (viewName === "sector" && viewArg) openSectorDetail(decodeURIComponent(viewArg));
  }
})();
