import { store } from "../store.js";
import { METHODS, METHOD_KEYS, forecast, backtest, bestMethod } from "../forecast.js";
import { vbars } from "../charts.js";
import { esc, fmt, fmtMoney, mLabel, mLabelShort, addM, nkey } from "../util.js";

let ui = { m: "", method: "", H: 3, group: "", q: "" };

export function forecastTable(H, method, group = "", q = "") {
  const d = store.derived;
  const nextMonths = [...Array(H)].map((_, i) => addM(d.meta.lastFull, i + 1));
  const rows = d.rows.filter((r) => r.status !== "nodata" && (!group || (r.group || "بدون مجموعة") === group) &&
    (!q || nkey(r.name).includes(nkey(q)) || nkey(r.code).includes(nkey(q))))
    .map((r) => {
      const m = method === "auto" || !method ? (method === "auto" ? bestMethod(r.full) : r.method) : method;
      const f = forecast(r.full, m, H);
      const bt = backtest(r.full, m);
      const total = f.reduce((a, b) => a + b, 0);
      const need = Math.max(0, total + r.ss - r.qty - r.onOrder);
      return { r, m, f, total, mape: bt.mape, need, needVal: r.price != null ? need * r.price : null, totalVal: r.price != null ? total * r.price : null };
    }).sort((a, b) => a.r.name.localeCompare(b.r.name, "ar"));
  return { nextMonths, rows };
}

export function renderForecast() {
  const d = store.derived;
  const s = store.state.settings;
  const mats = [...d.rows].filter((r) => r.status !== "nodata").sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const groups = [...new Set(d.rows.map((r) => r.group || "بدون مجموعة"))].sort();
  const H = ui.H;
  const methodSel = ui.method || s.method;

  let detail = "";
  const r = ui.m ? d.byKey.get(ui.m) : null;
  if (r) {
    const axis = d.meta.axis.slice(-12), series = r.full.slice(-12);
    const comps = METHOD_KEYS.map((k) => ({ k, f: forecast(r.full, k, H), bt: backtest(r.full, k) }));
    const best = bestMethod(r.full);
    const use = methodSel === "auto" ? best : methodSel;
    const f = forecast(r.full, use, H);
    const items = axis.map((k, i) => ({ label: mLabelShort(k), value: series[i], color: "#1f5fd6" }))
      .concat(f.map((v, i) => ({ label: mLabelShort(addM(d.meta.lastFull, i + 1)), value: v, color: "#f29900", dashed: true })));
    const total = f.reduce((a, b) => a + b, 0);
    const need = Math.max(0, total + r.ss - r.qty - r.onOrder);
    detail = `
    <section class="grid g-detail">
      <div class="card">
        <div class="card-head"><h3>${esc(r.name)} <span class="unit">${esc(r.unit || "")}</span></h3><a class="link" href="#/materials/${encodeURIComponent(r.key)}">صفحة الخامة ←</a></div>
        <div class="chart-ltr">${vbars(items, { width: 560, height: 250, fmtV: (n) => fmtShortSafe(n) })}</div>
        <p class="cap">الأزرق = الصرف الفعلي، البرتقالي = التوقع بطريقة "${METHODS[use].label}"</p>
      </div>
      <div class="card">
        <h3>احتياج الـ ${H} شهور الجاية</h3>
        <div class="kvs">
          <div class="kv"><small>إجمالي التوقع</small><b>${fmt(total)}</b><em>${esc(r.unit)}</em></div>
          <div class="kv"><small>الرصيد + تحت الطلب</small><b>${fmt(r.qty + r.onOrder)}</b><em>${esc(r.unit)}</em></div>
          <div class="kv"><small>مخزون الأمان</small><b>${fmt(r.ss)}</b><em>${esc(r.unit)}</em></div>
          <div class="kv"><small>محتاج تشتري</small><b class="${need > 0 ? "neg" : ""}">${fmt(need)}</b><em>${r.price != null ? fmtMoney(need * r.price) : esc(r.unit)}</em></div>
        </div>
        <p class="cap">محتاج تشتري = إجمالي التوقع + مخزون الأمان − (الرصيد + تحت الطلب)</p>
        <h3 style="margin-top:14px">مقارنة الطرق</h3>
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>الطريقة</th>${f.map((_, i) => `<th>${mLabelShort(addM(d.meta.lastFull, i + 1))}</th>`).join("")}<th>نسبة الخطأ</th></tr></thead>
          <tbody>${comps.map((c) => `<tr class="${c.k === use ? "row-on" : ""}"><td>${METHODS[c.k].label}${c.k === best ? ` <span class="chip ok">الأدق</span>` : ""}</td>
            ${c.f.map((v) => `<td class="n">${fmt(v)}</td>`).join("")}<td class="n">${c.bt.mape == null ? "—" : c.bt.mape.toFixed(0) + "%"}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="cap">نسبة الخطأ = متوسط الفرق بين التوقع والفعلي في آخر ${Math.min(4, Math.max(0, r.full.length - 3))} شهور لو كنا استخدمنا الطريقة دي. الأقل أحسن.</p>
      </div>
    </section>`;
  }

  const t = forecastTable(H, methodSel, ui.group, ui.q);
  const hasPrice = t.rows.some((x) => x.needVal != null);
  return `
  <div class="page-head"><div><h2>الفوركاست</h2><p class="muted">توقع الصرف للشهور الجاية من بيانات الصرف اللي عندنا (آخر شهر كامل: ${mLabel(d.meta.lastFull)}).</p></div></div>
  <section class="card controls">
    <label>الخامة<select id="fc-m"><option value="">— كل الخامات (جدول) —</option>${mats.map((m) => `<option value="${esc(m.key)}" ${m.key === ui.m ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
    <label>عدد الشهور<select id="fc-h">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === H ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label>الطريقة للعرض<select id="fc-method"><option value="auto" ${methodSel === "auto" ? "selected" : ""}>الأدق لكل خامة (تلقائي)</option>${METHOD_KEYS.map((k) => `<option value="${k}" ${methodSel === k ? "selected" : ""}>${METHODS[k].label}</option>`).join("")}</select></label>
    <label>الطريقة المعتمدة في الحسابات
      <select id="fc-global"><option value="auto" ${s.method === "auto" ? "selected" : ""}>الأدق لكل خامة (تلقائي)</option>${METHOD_KEYS.map((k) => `<option value="${k}" ${s.method === k ? "selected" : ""}>${METHODS[k].label}</option>`).join("")}</select></label>
    <p class="cap">"الطريقة المعتمدة" هي اللي بتتحسب بيها نقطة الطلب والكميات المقترحة في كل الصفحات.</p>
  </section>
  ${detail}
  <section class="card">
    <div class="card-head"><h3>توقع كل الخامات <span class="count">${fmt(t.rows.length)}</span></h3>
      <div class="filters"><input type="search" id="fc-q" placeholder="دور على خامة" value="${esc(ui.q)}">
      <select id="fc-g"><option value="">كل المجموعات</option>${groups.map((g) => `<option ${g === ui.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>الكود</th><th>الخامة</th><th>الطريقة</th>${t.nextMonths.map((k) => `<th class="hl">${mLabel(k)}</th>`).join("")}<th>الإجمالي</th><th>الرصيد + تحت الطلب</th><th>محتاج تشتري</th>${hasPrice ? "<th>قيمة الشراء</th>" : ""}<th>نسبة الخطأ</th></tr></thead>
      <tbody>${t.rows.map((x) => `<tr data-fc="${esc(x.r.key)}" class="${x.r.key === ui.m ? "row-on" : ""}">
        <td class="mono">${esc(x.r.code || "—")}</td><td><b>${esc(x.r.name)}</b> <small>${esc(x.r.unit)}</small></td><td><small>${METHODS[x.m].label}</small></td>
        ${x.f.map((v) => `<td class="n">${fmt(v)}</td>`).join("")}<td class="n strong">${fmt(x.total)}</td><td class="n">${fmt(x.r.qty + x.r.onOrder)}</td>
        <td class="n ${x.need > 0 ? "neg" : ""}">${x.need > 0 ? fmt(x.need) : "—"}</td>${hasPrice ? `<td class="n">${x.needVal ? fmtMoney(x.needVal) : "—"}</td>` : ""}
        <td class="n">${x.mape == null ? "—" : x.mape.toFixed(0) + "%"}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">مافيش خامات ليها صرف.</td></tr>`}</tbody>
      ${hasPrice ? `<tfoot><tr><td colspan="${6 + H}">إجمالي قيمة الشراء المتوقع</td><td class="n strong">${fmtMoney(t.rows.reduce((a, x) => a + (x.needVal || 0), 0))}</td><td></td></tr></tfoot>` : ""}
    </table></div>
  </section>`;
}

function fmtShortSafe(n) { return n >= 10000 ? (n / 1000).toFixed(0) + "K" : fmt(n); }

export function bindForecast(root, rerender) {
  const on = (id, fn) => root.querySelector(id)?.addEventListener("change", (e) => { fn(e.target.value); rerender(); });
  on("#fc-m", (v) => { ui.m = v; });
  on("#fc-h", (v) => { ui.H = +v; });
  on("#fc-method", (v) => { ui.method = v; });
  on("#fc-g", (v) => { ui.group = v; });
  root.querySelector("#fc-global")?.addEventListener("change", (e) => { ui.method = e.target.value; store.update((s) => { s.settings.method = e.target.value; }); });
  root.querySelector("#fc-q")?.addEventListener("input", (e) => { ui.q = e.target.value; rerender(); const n = document.getElementById("fc-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  root.querySelectorAll("[data-fc]").forEach((tr) => tr.addEventListener("click", () => { ui.m = tr.dataset.fc; rerender(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
}

export function forecastUI() { return ui; }
