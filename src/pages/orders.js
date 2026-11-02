import { store } from "../store.js";
import { addDays, daysBetween, STATUS } from "../calc.js";
import { esc, fmt, fmtMoney, dKey, uid, nkey } from "../util.js";
import { materialInput, resolveMaterial, datalist, kpiStrip, confirmButton, dayWord } from "../ui.js";
import { toast } from "./movements.js";

let ui = { tab: "open", prefill: "", receiving: null };
export function setOrderPrefill(key) { if (key) { ui.prefill = key; } }

export function orderState(o, today) {
  if (o.status === "received") return "received";
  if (o.status === "cancelled") return "cancelled";
  return o.expected < today ? "late" : "open";
}
export const ORDER_STATE = {
  open: ["في الطريق", "plain"], late: ["متأخر", "order"], received: ["اتسجل في المخزن", "ok"], cancelled: ["ملغي", "nodata"],
};

export function renderOrders() {
  const d = store.derived;
  const today = d.meta.today;
  const orders = store.state.orders.map((o) => ({ ...o, st: orderState(o, today) }));
  const open = orders.filter((o) => o.st === "open" || o.st === "late");
  const late = orders.filter((o) => o.st === "late");
  const week = open.filter((o) => daysBetween(today, o.expected) >= 0 && daysBetween(today, o.expected) <= 7);
  const openVal = open.reduce((a, o) => a + (o.price ? o.price * o.qty : 0), 0);

  const pre = ui.prefill ? d.byKey.get(ui.prefill) : null;
  const suggest = d.rows.filter((r) => (r.status === "order" || r.status === "warn") && !open.some((o) => o.key === r.key))
    .sort((a, b) => (a.status === "order" ? 0 : 1) - (b.status === "order" ? 0 : 1));
  const suppliers = [...store.state.orders.map((o) => o.supplier), ...store.state.defects.map((x) => x.supplier)];

  const list = orders.filter((o) => ui.tab === "all" || (ui.tab === "open" ? (o.st === "open" || o.st === "late") : o.st === ui.tab))
    .sort((a, b) => (ui.tab === "received" ? b.receivedDate.localeCompare(a.receivedDate) : a.expected.localeCompare(b.expected)));
  const tabs = [["open", "مفتوحة", open.length], ["late", "متأخرة", late.length], ["received", "اتسجلت", orders.filter((o) => o.st === "received").length], ["cancelled", "ملغية", orders.filter((o) => o.st === "cancelled").length], ["all", "الكل", orders.length]];

  return `
  <div class="page-head"><div><h2>طلبات الشراء</h2><p class="muted">سجّل تاريخ الطلب والليد تايم، وهتعرف الخامة هتتسجل في المخازن إمتى.</p></div></div>
  ${kpiStrip([
    ["طلبات مفتوحة", fmt(open.length)],
    ["متأخرة عن ميعادها", fmt(late.length), late.length ? "crit" : ""],
    ["هتوصل خلال 7 أيام", fmt(week.length), "warn"],
    ["قيمة الطلبات المفتوحة", openVal ? fmtMoney(openVal) : "—"],
  ])}
  <section class="grid g-mov">
    <div class="side">
      <form class="card form" id="po-form" autocomplete="off">
        <h3>طلب جديد</h3>
        <label>الخامة ${materialInput("po-mat", d.rows, pre ? pre.name : "", "required")}</label>
        <div class="po-hint" id="po-hint">${pre ? hint(pre) : ""}</div>
        <div class="row2">
          <label>تاريخ الطلب<input type="date" id="po-date" required value="${today}"></label>
          <label>الليد تايم (يوم)<input type="number" id="po-lead" min="0" required value="${pre ? pre.lt : store.state.settings.leadDefault}"></label>
        </div>
        <div class="arrive" id="po-arrive"></div>
        <div class="row2">
          <label>الكمية<input type="number" id="po-qty" min="0" step="any" required value="${pre && pre.orderQty ? pre.orderQty : ""}"></label>
          <label>سعر الوحدة<input type="number" id="po-price" min="0" step="any" value="${pre && pre.price != null ? pre.price : ""}"></label>
        </div>
        <label>المورد<input id="po-sup" list="po-sup-list" placeholder="اسم المورد">${datalist("po-sup-list", suppliers)}</label>
        <label>رقم أمر الشراء<input id="po-no" placeholder="PO-0001"></label>
        <label>ملاحظة<input id="po-note"></label>
        <p class="err" id="po-err" hidden></p>
        <button class="btn primary" type="submit">سجّل الطلب</button>
      </form>
      ${suggest.length ? `<div class="card">
        <h3>خامات محتاجة طلب ومفيش ليها طلب مفتوح</h3>
        <div class="sugg">${suggest.slice(0, 12).map((r) => `<button class="sugg-item" data-pre="${esc(r.key)}"><span class="chip ${r.status}">${STATUS[r.status].short}</span> <b>${esc(r.name)}</b><small>${fmt(r.orderQty)} ${esc(r.unit)}</small></button>`).join("")}</div>
      </div>` : ""}
    </div>
    <div class="card">
      <div class="tabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${ui.tab === k ? "on" : ""}">${l} <span>${n}</span></button>`).join("")}</div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>رقم الطلب</th><th>الخامة / المورد</th><th>الكمية</th><th>اتطلب · الليد تايم</th><th>هتتسجل في المخازن</th><th>فاضل</th><th>الحالة</th><th></th></tr></thead>
          <tbody>${list.map((o) => row(o, today)).join("") || `<tr><td colspan="8" class="empty">مافيش طلبات هنا.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

function hint(r) {
  return `الرصيد ${fmt(r.qty)} ${esc(r.unit)} · نقطة الطلب ${fmt(r.rop)}${r.onOrder ? ` · تحت الطلب ${fmt(r.onOrder)}` : ""}${r.stockoutDate ? ` · الرصيد يخلص حوالي <b>${r.stockoutDate}</b>` : ""}`;
}

function row(o, today) {
  const [lbl, cls] = ORDER_STATE[o.st];
  const left = daysBetween(today, o.expected);
  let leftTxt = "—";
  if (o.st === "open") leftTxt = left === 0 ? "النهارده" : dayWord(left);
  if (o.st === "late") leftTxt = `<span class="neg">متأخر ${dayWord(-left)}</span>`;
  if (o.st === "received") {
    const diff = daysBetween(o.expected, o.receivedDate);
    leftTxt = diff > 0 ? `<span class="neg">وصل متأخر ${dayWord(diff)}</span>` : diff < 0 ? `وصل بدري ${dayWord(-diff)}` : "في ميعاده";
  }
  const recv = ui.receiving === o.id;
  return `<tr>
    <td class="mono">${esc(o.poNo || "—")}</td>
    <td class="wrap"><a href="#/materials/${encodeURIComponent(o.key)}"><b>${esc(o.name)}</b></a><span class="sub">${esc(o.supplier || "")}</span></td>
    <td class="n">${fmt(o.qty, 2)}${o.st === "received" && +o.receivedQty !== +o.qty ? ` <small>(وصل ${fmt(o.receivedQty, 2)})</small>` : ""}</td>
    <td class="mono">${o.orderDate}<span class="sub">${dayWord(+o.lead)}</span></td>
    <td class="mono strong">${o.st === "received" ? o.receivedDate : o.expected}</td>
    <td>${leftTxt}</td>
    <td><span class="chip ${cls}">${lbl}</span></td>
    <td class="actions-cell">${recv ? `
      <div class="recv"><input type="date" id="rc-date" value="${today}"><input type="number" id="rc-qty" step="any" value="${o.qty}"><button class="btn primary sm" data-rc-ok="${o.id}">تأكيد الاستلام</button><button class="btn ghost sm" data-rc-x>رجوع</button></div>`
      : o.st === "open" || o.st === "late" ? `<button class="btn sm" data-recv="${o.id}">استلام</button> <button class="btn ghost sm" data-cancel="${o.id}">إلغاء</button>`
      : `<button class="btn ghost sm" data-del="${o.id}">حذف</button>`}</td>
  </tr>`;
}

export function bindOrders(root, rerender) {
  const d = store.derived;
  const mat = root.querySelector("#po-mat"), lead = root.querySelector("#po-lead"), date = root.querySelector("#po-date");
  const arrive = root.querySelector("#po-arrive");
  const upd = () => {
    const days = +lead.value || 0;
    if (!date.value) { arrive.innerHTML = ""; return; }
    const e = addDays(date.value, days);
    const m = resolveMaterial(mat.value, d.rows);
    let warn = "";
    if (m && m.stockoutDate && m.stockoutDate < e) warn = `<span class="neg">الرصيد هيخلص ${m.stockoutDate} قبل وصول الطلب</span>`;
    arrive.innerHTML = `هتتسجل في المخازن يوم <b>${e}</b> ${warn}`;
  };
  mat?.addEventListener("change", () => {
    const m = resolveMaterial(mat.value, d.rows);
    root.querySelector("#po-hint").innerHTML = m ? hint(m) : "";
    if (m) {
      lead.value = m.lt;
      if (m.orderQty && !root.querySelector("#po-qty").value) root.querySelector("#po-qty").value = m.orderQty;
      if (m.price != null && !root.querySelector("#po-price").value) root.querySelector("#po-price").value = m.price;
    }
    upd();
  });
  lead?.addEventListener("input", upd); date?.addEventListener("input", upd); upd();

  root.querySelector("#po-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = root.querySelector("#po-err");
    const m = resolveMaterial(mat.value, d.rows);
    const qty = +root.querySelector("#po-qty").value;
    if (!m) { err.textContent = "اختار الخامة من الاقتراحات."; err.hidden = false; return; }
    if (!(qty > 0)) { err.textContent = "اكتب كمية أكبر من صفر."; err.hidden = false; return; }
    const lt = +lead.value || 0;
    store.update((s) => s.orders.push({
      id: uid(), key: m.key, code: m.code, name: m.name, unit: m.unit, qty, lead: lt,
      orderDate: date.value, expected: addDays(date.value, lt),
      price: +root.querySelector("#po-price").value || null,
      supplier: root.querySelector("#po-sup").value.trim(), poNo: root.querySelector("#po-no").value.trim(),
      note: root.querySelector("#po-note").value.trim(), status: "open",
    }));
    ui.prefill = ""; ui.tab = "open";
    toast("اتسجل الطلب، هيوصل " + addDays(date.value, lt));
  });
  root.querySelectorAll("[data-pre]").forEach((b) => b.addEventListener("click", () => { ui.prefill = b.dataset.pre; rerender(); root.querySelector("#po-qty")?.focus(); }));
  root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { ui.tab = b.dataset.tab; rerender(); }));
  root.querySelectorAll("[data-recv]").forEach((b) => b.addEventListener("click", () => { ui.receiving = b.dataset.recv; rerender(); }));
  root.querySelector("[data-rc-x]")?.addEventListener("click", () => { ui.receiving = null; rerender(); });
  root.querySelector("[data-rc-ok]")?.addEventListener("click", (e) => {
    const id = e.target.dataset.rcOk;
    const rd = root.querySelector("#rc-date").value, rq = +root.querySelector("#rc-qty").value;
    if (!rd || !(rq > 0)) return;
    ui.receiving = null;
    store.update((s) => { const o = s.orders.find((x) => x.id === id); o.status = "received"; o.receivedDate = rd; o.receivedQty = rq; });
    toast("اتسجل الاستلام واتضاف للرصيد");
  });
  root.querySelectorAll("[data-cancel]").forEach((b) => confirmButton(b, () => store.update((s) => { s.orders.find((x) => x.id === b.dataset.cancel).status = "cancelled"; })));
  root.querySelectorAll("[data-del]").forEach((b) => confirmButton(b, () => store.update((s) => { s.orders = s.orders.filter((x) => x.id !== b.dataset.del); })));
}
