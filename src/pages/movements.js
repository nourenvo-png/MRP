import { store } from "../store.js";
import { esc, fmt, dKey, uid, mLabel, nkey } from "../util.js";

let ui = { m: "", type: "", month: "", src: "", page: 0 };
const PAGE = 100;

export function setMovementFilter(key) { if (key != null) { ui.m = key; ui.page = 0; } }

export function renderMovements() {
  const d = store.derived;
  const mats = [...d.rows].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const months = [...new Set(d.txns.map((t) => t.date.slice(0, 7)))].sort().reverse();
  let tx = d.txns.filter((t) =>
    (!ui.m || t.key === ui.m) && (!ui.type || t.type === ui.type) &&
    (!ui.month || t.date.startsWith(ui.month)) &&
    (!ui.src || (ui.src === "manual" ? t.manual : !t.manual)));
  tx = [...tx].sort((a, b) => b.date.localeCompare(a.date) || (b.manual ? 1 : 0) - (a.manual ? 1 : 0));
  const total = tx.length;
  const outSum = tx.filter((t) => t.type === "out").reduce((a, t) => a + t.qty, 0);
  const inSum = tx.filter((t) => t.type === "in").reduce((a, t) => a + t.qty, 0);
  const shown = tx.slice(0, (ui.page + 1) * PAGE);
  const name = (k) => d.byKey.get(k)?.name || k;
  const unit = (k) => d.byKey.get(k)?.unit || "";

  return `
  <div class="page-head"><h2>تسجيل الحركات</h2></div>
  <section class="grid g-mov">
    <form class="card form" id="mv-form" autocomplete="off">
      <h3>حركة جديدة</h3>
      <label>الخامة
        <input list="mv-list" id="mv-mat" required placeholder="اكتب اسم الخامة أو الكود" value="${ui.m ? esc(name(ui.m)) : ""}">
        <datalist id="mv-list">${mats.map((m) => `<option value="${esc(m.name)}">${esc(m.code || "")}</option>`).join("")}</datalist>
      </label>
      <div class="row2">
        <label>النوع
          <select id="mv-type"><option value="out">صرف</option><option value="in">وارد</option></select></label>
        <label>التاريخ<input type="date" id="mv-date" required value="${dKey(new Date())}"></label>
      </div>
      <label>الكمية<input type="number" id="mv-qty" min="0" step="any" required placeholder="0"></label>
      <label>ملاحظة<input id="mv-note" placeholder="رقم إذن الصرف، المورد، ..."></label>
      <p class="err" id="mv-err" hidden></p>
      <button class="btn primary" type="submit">سجّل الحركة</button>
      <p class="cap">الحركات اليدوية اللي تاريخها بعد آخر رفع لشيت الرصيد بتتطرح/تتضاف على الرصيد تلقائي. الصرف كمان بيدخل في حساب التوقع.</p>
    </form>
    <div class="card">
      <div class="card-head">
        <h3>كل الحركات <span class="count">${fmt(total)}</span></h3>
        <div class="filters">
          <select id="f-m"><option value="">كل الخامات</option>${mats.map((m) => `<option value="${esc(m.key)}" ${m.key === ui.m ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
          <select id="f-type"><option value="">كل الأنواع</option><option value="out" ${ui.type === "out" ? "selected" : ""}>صرف</option><option value="in" ${ui.type === "in" ? "selected" : ""}>وارد</option><option value="scrap" ${ui.type === "scrap" ? "selected" : ""}>معيب / هالك</option></select>
          <select id="f-month"><option value="">كل الشهور</option>${months.map((k) => `<option value="${k}" ${k === ui.month ? "selected" : ""}>${mLabel(k)}</option>`).join("")}</select>
          <select id="f-src"><option value="">كل المصادر</option><option value="sheet" ${ui.src === "sheet" ? "selected" : ""}>من الشيتات</option><option value="manual" ${ui.src === "manual" ? "selected" : ""}>من البرنامج (يدوي، طلبات، عيوب)</option></select>
        </div>
      </div>
      <div class="mini-sum"><span>إجمالي الصرف: <b>${fmt(outSum)}</b></span><span>إجمالي الوارد: <b>${fmt(inSum)}</b></span>${ui.m ? `<span>الوحدة: ${esc(unit(ui.m)) || "—"}</span>` : ""}</div>
      <div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th>التاريخ</th><th>الخامة</th><th>النوع</th><th>الكمية</th><th>المصدر</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>${shown.map((t) => `<tr>
            <td class="mono">${t.date}</td><td><a href="#/materials/${encodeURIComponent(t.key)}">${esc(name(t.key))}</a></td>
            <td>${typeChip(t.type)}</td>
            <td class="n">${fmt(t.qty, 2)}</td><td>${t.manual ? `<span class="chip manual">${esc(t.source)}</span>` : esc(t.source) + (t.sheet ? " / " + esc(t.sheet) : "")}</td>
            <td>${esc(t.note || "")}</td>
            <td>${t.manual && !t.ref ? `<button class="btn ghost sm" data-del="${esc(t.id)}">حذف</button>` : ""}</td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty">مافيش حركات بالفلتر ده.</td></tr>`}</tbody>
        </table>
      </div>
      ${shown.length < total ? `<button class="btn" id="mv-more">اعرض ${fmt(Math.min(PAGE, total - shown.length))} كمان</button>` : ""}
    </div>
  </section>`;
}

export function bindMovements(root, rerender) {
  const d = store.derived;
  const f = root.querySelector("#mv-form");
  f?.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = root.querySelector("#mv-err");
    const txt = nkey(root.querySelector("#mv-mat").value);
    const m = d.rows.find((r) => nkey(r.name) === txt || (r.code && nkey(r.code) === txt));
    const qty = +root.querySelector("#mv-qty").value;
    const date = root.querySelector("#mv-date").value;
    if (!m) { err.textContent = "الخامة دي مش في القائمة. اختارها من الاقتراحات."; err.hidden = false; return; }
    if (!(qty > 0)) { err.textContent = "اكتب كمية أكبر من صفر."; err.hidden = false; return; }
    if (!date) { err.textContent = "حدد التاريخ."; err.hidden = false; return; }
    store.update((s) => s.manual.push({
      id: uid(), key: m.key, code: m.code, name: m.name, date,
      type: root.querySelector("#mv-type").value, qty, note: root.querySelector("#mv-note").value.trim(),
    }));
    toast("اتسجلت الحركة");
  });
  const on = (id, k) => root.querySelector(id)?.addEventListener("change", (e) => { ui[k] = e.target.value; ui.page = 0; rerender(); });
  on("#f-m", "m"); on("#f-type", "type"); on("#f-month", "month"); on("#f-src", "src");
  root.querySelector("#mv-more")?.addEventListener("click", () => { ui.page++; rerender(); });
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.confirm) { store.update((s) => { s.manual = s.manual.filter((t) => t.id !== b.dataset.del); }); toast("اتحذفت الحركة"); }
    else { b.dataset.confirm = "1"; b.textContent = "متأكد؟"; b.classList.add("danger"); }
  }));
}

export function typeChip(t) {
  return t === "in" ? `<span class="chip ok">وارد</span>` : t === "scrap" ? `<span class="chip order">معيب</span>` : `<span class="chip plain">صرف</span>`;
}

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2200);
}
