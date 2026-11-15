/* Cooper · exports of a saved or current analysis: PDF report (logo in the corner),
 * Excel workbook (own minimal .xlsx writer), CSV tables and full JSON. */
(function () {
  "use strict";
  const C = window.Cooper;
  const { fmt } = C;
  const T = (s) => C.t(String(s ?? ""));

  const JSPDF = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  const AUTOTABLE = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";

  const slug = (s) => String(s || "field").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40);
  const stamp = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const fileName = (rec, ext) => `cooper-${slug(rec.context?.field)}-${stamp(rec.fecha)}.${ext}`;

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ------------------------------------------------------------ tables
   * One table model feeds Excel, CSV and the PDF. */
  function tables(rec) {
    const r = rec.result, i = rec.input;
    const ranking = r.ranking || r.rotaciones;
    const keys = Object.keys(C.SCORES);
    const scoreHead = keys.map((k) => T(C.SCORES[k].label));
    const rotName = window.CooperCatalog?.rotaciones.find((x) => x.id === i.rotacion_actual)?.nombre || i.rotacion_actual;
    const summary = [
      [T("Field"), rec.context?.field || ""],
      [T("Date"), C.dateLabel(rec.fecha, { dateStyle: "full", timeStyle: "short" })],
      [T("Latitude"), i.lat], [T("Longitude"), i.lon], [T("Field size") + " (ha)", i.area_ha],
      [T("Current rotation"), T(rotName)], [T("Soil water storage") + " (mm)", i.capacidad_suelo_mm],
      [T("Livestock"), T(i.tiene_ganado ? "Livestock available" : "No livestock")],
      [T("Scenario"), r.escenario?.activo ? `${T("Rainfall")} ${i.escenario.lluvia_pct}%, ${T("temperature")} +${i.escenario.temp_delta} °C (${T("What-if simulation, not a forecast")})` : T("Historical climate comparison, 1996–2025. This is not a weather forecast.")],
      ...keys.map((k) => [T("Importance") + " · " + T(C.SCORES[k].label), i.prioridades[k]]),
      [T("Data source"), `${r.meta.fuente} · ${r.meta.periodo} · ${r.meta.resolucion}`],
    ];
    const rank = [["#", T("Rotation"), ...scoreHead, T("Total"), T("Water used by the crops per year") + " (mm)", T("Water deficit in a dry year") + " (mm)",
      T("Estimated erosion per year") + " (t/ha)", T("Months without a crop per year")],
      ...ranking.map((x, n) => [n + 1, T(x.nombre) + (x.id === r.rotaciones[0].id ? ` (${T("Current")})` : ""), ...keys.map((k) => x.puntajes[k]), x.total,
        x.indicadores.uso_agua_mm, x.indicadores.deficit_seco_mm, x.indicadores.erosion_t_ha ?? "", x.indicadores.meses_descubiertos])];
    const bestPer = [[T("Topic"), T("Best option"), T("Score"), T("2nd option"), T("Score"), T("3rd option"), T("Score"), T("Why")],
      ...keys.map((k) => {
        const s = C.home.bestBy(ranking, k);
        const why = s[0].perfil?.[k]?.por_que || "";
        return [T(C.SCORES[k].label), T(s[0].nombre), s[0].puntajes[k], s[1] ? T(s[1].nombre) : "", s[1]?.puntajes[k] ?? "", s[2] ? T(s[2].nombre) : "", s[2]?.puntajes[k] ?? "", T(why)];
      })];
    const monthly = [[T("Month"), T("Rain (mm)"), T("Rain, dry year (mm)"), T("ET0 (mm)"), T("Balance (mm)"), T("Tmax (°C)"), T("Tmin (°C)"), T("Root-zone moisture"),
      T("Hot days"), T("Frost-risk days"), T("Heavy-rain days")],
      ...r.clima.mensual.map((d) => [T(d.nombre), d.lluvia_mm, d.lluvia_seca_mm, d.et0_mm, d.balance_mm, d.tmax, d.tmin, d.humedad_raiz ?? "", d.dias_calor, d.dias_helada, d.dias_lluvia_fuerte])];
    const trends = [[T("Indicator"), T("Period 1"), T("Value"), T("Period 2"), T("Value"), T("Change (%)"), T("Unit")],
      ...r.clima.tendencias.indicadores.map((t) => [T(t.nombre), t.periodo_1, t.valor_1, t.periodo_2, t.valor_2, t.cambio_pct, T(t.unidad)])];
    const cal = [[T("Rotation"), T("Year"), ...C.AG_MONTHS.map(T)],
      ...r.rotaciones.flatMap((x) => x.calendario.map((y, n) => [T(x.nombre), n + 1, ...y.map((c) => (c ? T(c.nombre) + (c.critico ? " (!)" : "") : "–"))]))];
    const zones = r.zonas ? [[T("Cell"), T("Elevation") + " (m)", T("Slope") + " (%)", T("Relative wetness") + " (0-2)", T("Low spots"),
      ...ranking.map((x) => T("Erosion") + " · " + T(x.nombre) + " (t/ha)")],
      ...r.zonas.celdas.map((c, n) => [n + 1, c.elev, c.pend, c.hum, c.bajo ? 1 : 0, ...ranking.map((x) => C.results.erosionOf(r.zonas, c, n, x.id) ?? "")])] : null;
    const diag = [[T("Rotation"), T("Topic"), T("Level"), T("Why"), T("Ideas to improve")],
      ...r.rotaciones.flatMap((x) => (x.diagnostico?.items || []).map((d) => [T(x.nombre), T(d.etiqueta), T({ fuerte: "Good", medio: "Fair", flojo: "Weak" }[d.nivel]), T(d.por_que), d.recomendaciones.map(T).join(" · ")]))];
    return { summary, rank, bestPer, monthly, trends, cal, zones, diag };
  }

  /* -------------------------------------------------------------- JSON/CSV */
  function json(rec) {
    const out = { app: "Cooper", version: 1, exported: new Date().toISOString(), field: rec.context?.field, date: rec.fecha, input: rec.input, result: rec.result };
    download(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), fileName(rec, "json"));
    C.toast(T("JSON file downloaded."));
  }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(rec) {
    const t = tables(rec);
    const blocks = [[T("Summary"), t.summary], [T("All options for your field"), t.rank], [T("Your best options"), t.bestPer],
      [T("Climate by month"), t.monthly], [T("How is your area changing?"), t.trends], [T("Crop calendars"), t.cal], [T("Strengths and weaknesses"), t.diag]];
    if (t.zones) blocks.push([T("Zones of your field"), t.zones]);
    const text = blocks.map(([title, rows]) => [csvCell(title), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n")).join("\r\n\r\n");
    download(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), fileName(rec, "csv"));
    C.toast(T("CSV file downloaded."));
  }

  /* ---------------------------------------------------------------- XLSX
   * Minimal Office Open XML writer: inline strings, bold header row, stored ZIP. */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const data = enc.encode(content), nm = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXML(rows) {
    const widths = [];
    rows.forEach((r) => r.forEach((v, j) => { widths[j] = Math.min(60, Math.max(widths[j] || 8, String(v ?? "").length + 2)); }));
    const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
      const ref = colName(j) + (i + 1), st = i === 0 ? ' s="1"' : "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v ?? "")}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
  }
  function xlsx(rec) {
    const t = tables(rec);
    const sheets = [["Summary", [[T("Item"), T("Value")], ...t.summary]], ["Ranking", t.rank], ["Best options", t.bestPer],
      ["Climate by month", t.monthly], ["Trends", t.trends], ["Crop calendars", t.cal], ["Diagnosis", t.diag]];
    if (t.zones) sheets.push(["Zones", t.zones]);
    const safe = (n) => T(n).replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${xmlEsc(safe(n))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5A3E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXML(rows)]),
    ];
    download(zip(files), fileName(rec, "xlsx"));
    C.toast(T("Excel file downloaded."));
  }

  /* ----------------------------------------------------------------- PDF */
  // Standard PDF fonts only cover Windows-1252: replace the few symbols outside it.
  const pdfText = (s) => T(s).replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/→/g, "->").replace(/−/g, "-").replace(/₀/g, "0")
    .replace(/[  ]/g, " ").replace(/[^\x00-\xffŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g, "");

  function imgData(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); resolve({ data: c.toDataURL("image/png"), w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = reject; im.src = src;
    });
  }

  function chartImage(result) {
    if (typeof Chart === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1400; canvas.height = 560;
    canvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1400px;height:560px";
    document.body.appendChild(canvas);
    const months = result.clima.mensual;
    const chart = new Chart(canvas, {
      data: { labels: months.map((d) => pdfText(d.nombre)), datasets: [
        { type: "bar", label: pdfText("Average rainfall (mm)"), data: months.map((d) => d.lluvia_mm), backgroundColor: "#2a78d6", borderRadius: 6, order: 2 },
        { type: "line", label: pdfText("Reference evapotranspiration (mm)"), data: months.map((d) => d.et0_mm), borderColor: "#eb6834", backgroundColor: "#eb6834", borderWidth: 4, pointRadius: 6, tension: 0.3, order: 1 },
        ...(result.escenario?.activo ? [{ type: "line", label: pdfText("Historical rainfall (no scenario)"), data: result.clima.mensual_base.map((d) => d.lluvia_mm), borderColor: "#888", borderDash: [8, 6], borderWidth: 3, pointRadius: 0, order: 0 }] : []),
      ] },
      options: { responsive: false, animation: false, devicePixelRatio: 1,
        plugins: { legend: { labels: { font: { size: 22 }, color: "#333" } } },
        scales: { x: { ticks: { font: { size: 20 }, color: "#333" }, grid: { display: false } }, y: { ticks: { font: { size: 20 }, color: "#555" }, grid: { color: "#e3e3dc" }, title: { display: true, text: "mm", font: { size: 20 } } } } },
    });
    const url = chart.toBase64Image("image/png", 1);
    chart.destroy(); canvas.remove();
    return url;
  }

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  async function pdf(rec) {
    C.toast(T("Preparing the PDF report…"), "info", 2400);
    try {
      await C.loadScript(JSPDF);
      await C.loadScript(AUTOTABLE);
    } catch (_) {
      C.toast(T("The PDF library could not load. Check your connection and try again."), "error", 6000);
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const W = 210, M = 14, BRAND = [31, 90, 62], INK = [26, 33, 29], SOFT = [102, 112, 106];
    const r = rec.result, t = tables(rec);
    const ranking = r.ranking || r.rotaciones;
    const current = r.rotaciones[0];
    let logo = null;
    try { logo = await imgData("assets/brand/logo-print.png"); } catch (_) { /* text-only header */ }

    const header = () => {
      if (logo) { const h = 13, w = (logo.w / logo.h) * h; doc.addImage(logo.data, "PNG", M, 8, w, h); }
      else { doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...BRAND); doc.text("Cooper", M, 16); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...SOFT);
      doc.text(pdfText(rec.context?.field || ""), W - M, 12, { align: "right" });
      doc.text(pdfText(C.dateLabel(rec.fecha)), W - M, 16.5, { align: "right" });
      doc.setDrawColor(...BRAND); doc.setLineWidth(0.5); doc.line(M, 24, W - M, 24);
    };
    let y = 32;
    const ensure = (h) => { if (y + h > 280) { doc.addPage(); header(); y = 32; } };
    const h2 = (s) => { ensure(14); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BRAND); doc.text(pdfText(s), M, y); y += 2.5; doc.setDrawColor(220, 226, 220); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6; };
    const para = (s, size = 9.5, color = INK) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(pdfText(s), W - 2 * M);
      for (const ln of lines) { ensure(5); doc.text(ln, M, y); y += size * 0.45; }
      y += 1.5;
    };
    const bullets = (title, items) => {
      if (!items?.length) return;
      ensure(10); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(pdfText(title), M, y); y += 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      for (const it of items) {
        const lines = doc.splitTextToSize(pdfText(it), W - 2 * M - 5);
        lines.forEach((ln, k) => { ensure(4.6); if (k === 0) doc.text("•", M + 1, y); doc.text(ln, M + 5, y); y += 4.2; });
      }
      y += 2;
    };
    const table = (head, body, opts = {}) => {
      doc.autoTable({ startY: y, head: [head.map(pdfText)], body: body.map((row) => row.map((v) => (typeof v === "number" ? fmt(v, Number.isInteger(v) ? 0 : 1) : pdfText(v)))),
        margin: { left: M, right: M, top: 30 }, theme: "grid",
        styles: { font: "helvetica", fontSize: opts.size || 8, cellPadding: 1.6, textColor: INK, lineColor: [225, 228, 222], lineWidth: 0.2, overflow: "linebreak" },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 248, 244] },
        didDrawPage: () => header(), ...opts.extra });
      y = doc.lastAutoTable.finalY + 7;
    };

    header();
    /* cover block */
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...INK);
    doc.text(pdfText("Field analysis report"), M, y + 4); y += 11;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...SOFT);
    doc.text(pdfText(`${rec.context?.field || ""} · ${C.dateLabel(rec.fecha, { dateStyle: "full", timeStyle: "short" })}`), M, y); y += 5.5;
    doc.text(pdfText(r.escenario?.activo ? `What-if simulation: rainfall ${rec.input.escenario.lluvia_pct}%, temperature +${rec.input.escenario.temp_delta} °C. This is not a forecast.` : "Historical climate comparison, 1996–2025. This is not a weather forecast."), M, y); y += 8;
    doc.setFillColor(238, 244, 238); doc.roundedRect(M, y, W - 2 * M, 12, 2, 2, "F");
    doc.setFontSize(9); doc.setTextColor(...BRAND);
    doc.text(doc.splitTextToSize(pdfText("Cooper helps you think, it doesn't decide. Every result comes from written rules and published formulas; review it with your agronomist."), W - 2 * M - 8), M + 4, y + 5); y += 18;

    h2("Your field");
    table([T("Item"), T("Value")], t.summary, { size: 8.5, extra: { columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } } } });

    /* overall */
    h2("Overall analysis");
    const best = ranking[0];
    para(best.id === current.id ? `Your current rotation, ${T(current.nombre)}, is the best fit for your priorities (${fmt(best.total)} / 100).`
      : `Best overall option for your priorities: ${T(best.nombre)} (${fmt(best.total)} / 100). Your current rotation, ${T(current.nombre)}, scores ${fmt(current.total)}.`, 10);
    ensure(48);
    Object.entries(C.SCORES).forEach(([k, s], n) => {
      const yy = y + n * 8.6, v = best.puntajes[k], c = current.puntajes[k];
      const col = hex({ agua: "#2b7bb9", suelo: "#8b6a3e", ingreso: "#c88a12", forraje: "#5c8f2f", clima: "#2a8a83" }[k]);
      doc.setFontSize(9); doc.setTextColor(...INK); doc.text(pdfText(s.label), M, yy + 3.5);
      doc.setFillColor(234, 236, 230); doc.roundedRect(M + 52, yy, 100, 4.5, 1.5, 1.5, "F");
      doc.setFillColor(...col); doc.roundedRect(M + 52, yy, Math.max(1, v), 4.5, 1.5, 1.5, "F");
      if (best.id !== current.id) { doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.5); doc.line(M + 52 + c, yy - 1, M + 52 + c, yy + 5.5); }
      doc.setFont("helvetica", "bold"); doc.text(String(v), M + 156, yy + 3.5);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...SOFT); if (best.id !== current.id) doc.text(pdfText(`(${T("today")} ${c})`), M + 164, yy + 3.5);
    });
    y += 5 * 8.6 + 3;
    para("Bars: best overall option. Black mark: your current rotation.", 8, SOFT);

    h2("Your best options");
    table(t.bestPer[0], t.bestPer.slice(1), { size: 7.6, extra: { columnStyles: { 7: { cellWidth: 48 } } } });

    /* climate */
    h2("Your area in numbers");
    para(`${r.meta.fuente} · ${r.meta.periodo} · ${r.meta.resolucion}`, 8.5, SOFT);
    const chart = chartImage(r);
    if (chart) { ensure(76); doc.addImage(chart, "PNG", M, y, W - 2 * M, (W - 2 * M) * 0.4); y += (W - 2 * M) * 0.4 + 5; }
    table(t.monthly[0], t.monthly.slice(1), { size: 7.4 });
    const steps = ["#f3f7fd", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
    const riskRows = [["Hot days", "dias_calor"], ["Frost-risk days", "dias_helada"], ["Heavy-rain days", "dias_lluvia_fuerte"], ["Atmospheric water deficit (mm)", "deficit"]];
    const val = (d, k) => (k === "deficit" ? Math.max(0, -d.balance_mm) : d[k]);
    const riskBody = riskRows.map(([l, k]) => [T(l), ...r.clima.mensual.map((d) => val(d, k))]);
    para("Risk calendar", 10, INK);
    table(["", ...r.clima.mensual.map((d) => T(d.nombre))], riskBody, { size: 7.2, extra: {
      didParseCell: (h) => {
        if (h.section !== "body" || h.column.index === 0) return;
        const k = riskRows[h.row.index][1];
        const vals = r.clima.mensual.map((d) => val(d, k)), max = Math.max(...vals) || 1, v = vals[h.column.index - 1];
        const lvl = v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
        h.cell.styles.fillColor = hex(steps[lvl]); h.cell.styles.textColor = lvl >= 3 ? 255 : 30; h.cell.styles.halign = "center";
      } } });
    table(t.trends[0], t.trends.slice(1), { size: 8 });

    /* zones */
    if (r.zonas) {
      h2("Zones of your field");
      const z = r.zonas;
      para(`${fmt(z.area_ha)} ha · ${fmt(z.celda_m)} m grid · NASA SRTM 30 m · R = ${fmt(z.r_factor)} · K = ${z.k_factor} (typical value, not measured). Estimated erosion with RUSLE; reference tolerance ${z.tolerancia_t_ha} t/ha a year.`, 8.5, SOFT);
      const pair = [current, ...(best.id !== current.id ? [best] : [])];
      const size = pair.length === 2 ? 84 : 110;
      ensure(size + 18);
      pair.forEach((rot, n) => {
        const x = M + n * (size + 8);
        doc.addImage(C.results.zoneRaster(z, "erosion", rot.id, 420, true).toDataURL("image/png"), "PNG", x, y, size, size);
        doc.setFontSize(8.5); doc.setTextColor(...INK);
        doc.text(doc.splitTextToSize(pdfText(`${n === 0 ? T("Current") + ": " : T("Best overall option") + ": "}${T(rot.nombre)} · ${fmt(rot.indicadores.erosion_t_ha, 1)} t/ha`), size), x, y + size + 4.5);
      });
      y += size + 13;
      const cls = C.results.ZONE_LAYERS.erosion.classes(z);
      cls.forEach((k, n) => { const x = M + n * 46; doc.setFillColor(...hex(k.color)); doc.rect(x, y - 3, 4, 4, "F"); doc.setFontSize(7.5); doc.setTextColor(...INK); doc.text(pdfText(k.label), x + 5.5, y, { maxWidth: 40 }); });
      y += 9;
      const s = z.resumen;
      table([T("Height difference within the field"), T("Slope"), T("Low spots")], [[`${fmt(s.desnivel_m)} m (${fmt(s.elev_min)}–${fmt(s.elev_max)} m)`, `${fmt(s.pendiente_media_pct, 1)}% (max ${fmt(s.pendiente_max_pct, 1)}%)`, `${fmt(s.area_baja_pct)}%`]], { size: 8.5 });
    }

    /* rotations */
    r.rotaciones.forEach((rot) => {
      doc.addPage(); header(); y = 32;
      const role = rot.rol === "actual" ? "Your current rotation" : rot.rol === "alternativa_1" ? "Alternative 1" : "Alternative 2";
      h2(`${T(role)}: ${T(rot.nombre)}`);
      para(rot.descripcion, 9.5, SOFT);
      para(`${T("Total")}: ${fmt(rot.total)} / 100 ${T("for your priorities")}`, 11, BRAND);
      table(Object.values(C.SCORES).map((s) => T(s.label)), [Object.keys(C.SCORES).map((k) => rot.puntajes[k])], { size: 9, extra: { bodyStyles: { halign: "center", fontStyle: "bold" } } });
      const ind = rot.indicadores;
      table([T("Months without a crop per year"), T("Water used by the crops per year"), T("Water deficit in a dry year"), T("Estimated erosion per year")],
        [[fmt(ind.meses_descubiertos, 1), `${fmt(ind.uso_agua_mm)} mm`, `${fmt(ind.deficit_seco_mm)} mm`, ind.erosion_t_ha != null ? `${fmt(ind.erosion_t_ha, 1)} t/ha (${fmt(ind.erosion_area_alta_pct)}%)` : "–"]], { size: 8.5 });
      const head = [T("Year"), ...C.AG_MONTHS.map(T)];
      table(head, rot.calendario.map((yr, n) => [String(n + 1), ...yr.map((c) => (c ? c.abrev + (c.critico ? "!" : "") : "–"))]), { size: 7.5, extra: {
        didParseCell: (h) => {
          if (h.section !== "body" || h.column.index === 0) return;
          const c = rot.calendario[h.row.index][h.column.index - 1];
          h.cell.styles.halign = "center";
          if (c) { h.cell.styles.fillColor = hex(c.color); h.cell.styles.textColor = C.needsDarkText(c.color) ? 20 : 255; h.cell.styles.fontStyle = "bold"; }
        } } });
      if (rot.diagnostico?.items?.length) {
        bullets("Strengths and weaknesses", rot.diagnostico.items.map((d) => `${T({ fuerte: "Good", medio: "Fair", flojo: "Weak" }[d.nivel])} · ${T(d.etiqueta)}: ${T(d.por_que)}.${d.recomendaciones.length ? " " + T("Ideas to improve") + ": " + d.recomendaciones.map(T).join("; ") + "." : ""}`));
      }
      const ex = rot.explicacion;
      bullets("Why we suggest it", ex.por_que); bullets("Supporting data", ex.evidencia); bullets("Possible benefits", ex.beneficios);
      bullets("What we don't know yet", ex.vacios); bullets("Risks to review with an agronomist", ex.riesgos);
    });

    doc.addPage(); header(); y = 32;
    h2("All options for your field");
    table(t.rank[0], t.rank.slice(1), { size: 7 });
    h2("How it works and where the data comes from");
    bullets("Method", [
      "Climate: NASA POWER daily data, 1996–2025 (temperature, rainfall corrected with GPM-IMERG, MERRA-2 soil moisture).",
      "Evapotranspiration: Hargreaves method (FAO-56), using daily maximum and minimum temperatures.",
      "Water balance: month by month, over every real year in the record, with the soil acting as a bucket of the size you chose.",
      "Terrain and erosion: NASA SRTM 30 m elevation on a 15 × 15 grid; RUSLE with a month-by-month cover factor, assuming no-till.",
      "Scores: written, reviewable agronomic rules and thresholds, with no black boxes. No AI makes the decisions.",
    ]);
    bullets("Limits to keep in mind", [
      "The climate describes the area (about 50 km), not the field.",
      "The soil isn't measured: erodibility (K) is a typical value and the water capacity is the one you chose.",
      "Income is relative: there are no prices, costs or yields.",
      "The crop table comes from general literature and needs review by a local agronomist.",
    ]);

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...SOFT);
      doc.text(pdfText("Cooper · NASA Space Apps 2026 · Data: NASA POWER, NASA SRTM. It does not replace the judgment of farmers or agronomists."), M, 290);
      doc.text(`${p} / ${pages}`, W - M, 290, { align: "right" });
    }
    doc.save(fileName(rec, "pdf"));
    C.toast(T("PDF report downloaded."));
  }

  C.exporter = { pdf, xlsx, csv, json, tables, zip, _pdfText: pdfText };
})();
