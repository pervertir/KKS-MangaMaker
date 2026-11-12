import { $, h } from "../editor/core.js";
import { closeModal, modal } from "../editor/modal.js";
import { scriptWizard } from "../wizard/prompt.js";

/* ================================================================ guide */
/* docs/SCRIPT_WIZARD.md, shown in a dialog: a small Markdown subset (headings, lists, tables, code) */
export function mdToHtml(md) {
  const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const out = [], L = md.split("\n");
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.startsWith("```")) { const buf = []; while (++i < L.length && !L[i].startsWith("```")) buf.push(esc(L[i])); out.push(`<pre>${buf.join("\n")}</pre>`); continue; }
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n + 1}>${inline(l.slice(n + 1))}</h${n + 1}>`); continue; }
    if (l.startsWith("|")) {
      const rows = []; while (i < L.length && L[i].startsWith("|")) rows.push(L[i++]); i--;
      const cells = r => r.split("|").slice(1, -1).map(c => c.trim());
      out.push("<table>" + rows.filter((_, k) => k !== 1).map((r, k) => "<tr>" + cells(r).map(c => k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join("") + "</tr>").join("") + "</table>");
      continue;
    }
    if (/^(\d+\.|-) /.test(l)) {
      const ord = /^\d/.test(l), items = [];
      while (i < L.length && /^(\d+\.|-) |^   /.test(L[i])) { if (/^   /.test(L[i]) && items.length) items[items.length - 1] += " " + L[i].trim(); else items.push(L[i].replace(/^(\d+\.|-) /, "")); i++; }
      i--; out.push(`<${ord ? "ol" : "ul"}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${ord ? "ol" : "ul"}>`); continue;
    }
    if (l.trim()) { const buf = [l]; while (i + 1 < L.length && L[i + 1].trim() && !/^(#|\||```|- |\d+\. )/.test(L[i + 1])) buf.push(L[++i]); out.push(`<p>${inline(buf.join(" "))}</p>`); }
  }
  return out.join("");
}
export async function wizardGuide() {
  let md = ""; try { md = await (await fetch("/api/guide")).text(); } catch { md = "Guide not found (docs/SCRIPT_WIZARD.md)."; }
  const box = modal("Script Wizard guide", "mid"); const body = $(".mbody", box);
  const div = h("div", { class: "guide" }); div.innerHTML = mdToHtml(md); body.append(div);
  box.append(h("div", { class: "mfoot" }, h("div", { class: "spacer" }), h("button", { onclick: () => scriptWizard() }, "Open the Script Wizard"), h("button", { class: "primary", onclick: closeModal }, "Close")));
}
