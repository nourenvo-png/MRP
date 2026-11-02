import { store } from "./store.js";
import { STATUS, STATUS_ORDER } from "./calc.js";
import { esc, dKey, mLabel } from "./util.js";
import { renderDashboard, bindDashboard } from "./pages/dashboard.js";
import { renderMaterials, bindMaterials, renderMaterial } from "./pages/materials.js";
import { renderMovements, bindMovements, setMovementFilter } from "./pages/movements.js";
import { renderSheets, bindSheets } from "./pages/sheets.js";
import { renderForecast, bindForecast } from "./pages/forecastPage.js";
import { renderOrders, bindOrders, setOrderPrefill, orderState } from "./pages/orders.js";
import { renderDefects, bindDefects } from "./pages/defects.js";
import { renderReports, bindReports } from "./pages/reports.js";
import { startAutoSync, onSyncInfo, syncSummary, timeAgo, syncInfo, submitCode } from "./autosync.js";

const main = document.getElementById("main");
const topbar = document.getElementById("topbar");

function route() {
  const h = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, qs] = h.split("?");
  const parts = path.split("/").map(decodeURIComponent);
  const params = new URLSearchParams(qs || "");
  return { name: parts[0] || "dashboard", arg: parts[1], params };
}

function renderTop(r) {
  const d = store.derived, v = store.state.view;
  const groups = [...new Set(d.rows.map((x) => x.group || "بدون مجموعة"))].sort();
  const titles = { dashboard: "لوحة الخامات", materials: "الخامات", movements: "تسجيل الحركات", sheets: "مصادر البيانات", forecast: "الفوركاست", orders: "طلبات الشراء", defects: "عيوب الخامات", reports: "التقارير" };
  const isDash = r.name === "dashboard";
  topbar.innerHTML = `
    <h1>${titles[r.name] || "لوحة الخامات"}</h1>
    ${isDash ? `
    <div class="tb-filters">
      <div class="tb-f"><small>عرض بـ</small>
        <div class="seg" role="group">
          <button data-mode="units" class="${v.mode === "units" ? "on" : ""}">الكمية</button>
          <button data-mode="value" class="${v.mode === "value" ? "on" : ""}">القيمة (ج)</button>
        </div></div>
      <label class="tb-f"><small>المجموعة</small>
        <select id="tb-group"><option value="">الكل</option>${groups.map((g) => `<option ${g === v.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
      <label class="tb-f"><small>الحالة</small>
        <select id="tb-status"><option value="">الكل</option>${STATUS_ORDER.map((s) => `<option value="${s}" ${s === v.status ? "selected" : ""}>${STATUS[s].label}</option>`).join("")}</select></label>
    </div>` : ""}
    ${syncBadge()}
    <div class="tb-asof"><small>البيانات حتى</small><b>${dKey(new Date())}</b><small>${d.isSample ? "بيانات مثال" : "آخر شهر كامل: " + mLabel(d.meta.lastFull)}</small></div>`;
  topbar.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => store.update((s) => { s.view.mode = b.dataset.mode; })));
  topbar.querySelector("#tb-group")?.addEventListener("change", (e) => store.update((s) => { s.view.group = e.target.value; }));
  topbar.querySelector("#tb-status")?.addEventListener("change", (e) => store.update((s) => { s.view.status = e.target.value; }));
}

function syncBadge() {
  const sm = syncSummary(), ex = store.state.excel;
  const when = ex ? timeAgo(ex.source?.modified) : "";
  return `<a href="#/sheets" class="tb-sync ${sm.cls}" title="${esc(sm.text)}">
    <i></i><span><small>${sm.cls === "good" ? "شيت المخازن · " + esc(ex.source?.period || "") : "المزامنة"}</small>
    <b>${sm.cls === "good" ? "آخر تعديل " + when : sm.cls === "off" ? "مش متوصلة" : "فيه مشكلة"}</b></span></a>`;
}

// قايمة "المزيد" في شريط الموبايل
const nav = document.getElementById("nav");
const moreBtn = document.getElementById("nav-more");
const setMore = (open) => { nav.classList.toggle("open", open); moreBtn.setAttribute("aria-expanded", open); };
moreBtn.addEventListener("click", (e) => { e.stopPropagation(); setMore(!nav.classList.contains("open")); });
document.addEventListener("click", (e) => { if (!e.target.closest("#nav")) setMore(false); });
nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMore(false); });

function render() {
  const r = route();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === r.name));
  moreBtn.classList.toggle("active", [...document.querySelectorAll("#nav .more-item")].some((a) => a.dataset.r === r.name));
  const d = store.derived;
  const crit = d.rows.filter((x) => x.status === "order").length;
  const late = store.state.orders.filter((o) => orderState(o, d.meta.today) === "late").length;
  document.getElementById("nav-foot").innerHTML = (crit ? `<a href="#/orders" class="alert-pill">${crit} خامة لازم تتطلب</a>` : "") +
    (late ? `<a href="#/orders" class="alert-pill late">${late} طلب متأخر</a>` : "");
  renderTop(r);
  const y = window.scrollY;
  const rerender = () => render();
  if (r.name === "materials" && r.arg) { main.innerHTML = renderMaterial(r.arg); }
  else if (r.name === "materials") { main.innerHTML = renderMaterials(); bindMaterials(main, rerender); }
  else if (r.name === "movements") { main.innerHTML = renderMovements(); bindMovements(main, rerender); }
  else if (r.name === "sheets") { main.innerHTML = renderSheets(); bindSheets(main); }
  else if (r.name === "forecast") { main.innerHTML = renderForecast(); bindForecast(main, rerender); }
  else if (r.name === "orders") { main.innerHTML = renderOrders(); bindOrders(main, rerender); }
  else if (r.name === "defects") { main.innerHTML = renderDefects(); bindDefects(main, rerender); }
  else if (r.name === "reports") { main.innerHTML = renderReports(); bindReports(main, rerender); }
  else { main.innerHTML = renderDashboard(); bindDashboard(main); }
  main.querySelectorAll("[data-href]").forEach((el) => {
    el.addEventListener("click", (e) => { if (e.target.closest("a,button,select,input")) return; location.hash = el.dataset.href; });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = el.dataset.href; });
  });
  window.scrollTo(0, y);
}

window.addEventListener("hashchange", () => {
  const r = route();
  if (r.name === "movements") setMovementFilter(r.params.get("m") ?? "");
  if (r.name === "orders") setOrderPrefill(r.params.get("m"));
  window.scrollTo(0, 0);
  render();
});

// شاشة كود الدخول (لما البيانات مشفرة)
const lock = document.getElementById("lock");
const lockErr = document.getElementById("lock-err");
function renderLock() {
  lock.hidden = !syncInfo.needCode;
  lockErr.hidden = !syncInfo.codeError;
  lockErr.textContent = syncInfo.codeError;
  if (!lock.hidden) setTimeout(() => document.getElementById("lock-code")?.focus(), 50);
}
document.getElementById("lock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("lock-btn"), inp = document.getElementById("lock-code");
  btn.disabled = true; btn.textContent = "بيفتح...";
  await submitCode(inp.value);
  btn.disabled = false; btn.textContent = "ادخل";
  if (syncInfo.needCode) { inp.select(); renderLock(); }
});
onSyncInfo(renderLock);

store.subscribe(render);
let lastSyncKey = "";
onSyncInfo(() => {
  // حدّث شريط المزامنة فوق، وصفحة الشيتات لو مفتوحة
  const k = JSON.stringify([syncSummary(), store.state.excel?.syncedAt, route().name === "sheets" && String(Math.floor(Date.now() / 30000))]);
  if (k !== lastSyncKey) { lastSyncKey = k; render(); }
});
store.load().then(() => {
  const r = route();
  if (r.name === "movements") setMovementFilter(r.params.get("m") ?? "");
  render();
  startAutoSync();
});
