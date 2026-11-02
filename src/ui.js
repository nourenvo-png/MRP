// Shared bits for forms and pages
import { esc, nkey, fmt } from "./util.js";

export function materialInput(id, rows, value = "", attrs = "") {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return `<input list="${id}-list" id="${id}" ${attrs} placeholder="اكتب اسم الخامة أو الكود" value="${esc(value)}" autocomplete="off">
    <datalist id="${id}-list">${sorted.map((m) => `<option value="${esc(m.name)}">${esc(m.code || "")}${m.unit ? " · " + esc(m.unit) : ""}</option>`).join("")}</datalist>`;
}

export function resolveMaterial(text, rows) {
  const t = nkey(text);
  if (!t) return null;
  return rows.find((r) => nkey(r.name) === t) || rows.find((r) => r.code && nkey(r.code) === t) || null;
}

export function datalist(id, values) {
  return `<datalist id="${id}">${[...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
}

export function kpiStrip(items) {
  return `<section class="kpis kpis-${items.length}">${items.map(([label, value, cls = "", sub = ""]) =>
    `<div class="kpi ${cls}"><div><small>${label}</small><b>${value}${sub ? ` <em>${sub}</em>` : ""}</b></div></div>`).join("")}</section>`;
}

export function confirmButton(btn, onConfirm, text = "متأكد؟") {
  btn.dataset.label = btn.textContent;
  btn.addEventListener("click", () => {
    if (btn.dataset.armed) return onConfirm();
    btn.dataset.armed = "1"; btn.textContent = text; btn.classList.add("danger");
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.classList.remove("danger"); btn.textContent = btn.dataset.label || btn.textContent; } }, 4000);
  });
}

export const dayWord = (n) => (n === 1 ? "يوم واحد" : n === 2 ? "يومين" : fmt(n) + (n >= 3 && n <= 10 ? " أيام" : " يوم"));
