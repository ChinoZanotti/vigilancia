import React, { useState, useMemo, useRef } from "react";
import Papa from "papaparse";
import { Search, Upload, AlertTriangle, X, Download, FileText, Sparkles } from "lucide-react";

/* ============================================================
   MOTOR DE COMPARACIÓN  (cotejo marcario — fonético + ortográfico)
   Este módulo es independiente de la UI: es exactamente la lógica
   que luego se traslada al backend Node/Express.
   ============================================================ */

const stripDia = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function normalize(s) {
  return stripDia((s || "").toUpperCase())
    .replace(/&/g, " Y ")
    .replace(/[^A-ZÑ0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Clave fonética adaptada al español (yeísmo, seseo, b/v, h muda, etc.)
function phonetic(input) {
  let t = " " + normalize(input).replace(/Ñ/g, "N") + " ";
  t = t.replace(/CH/g, "X");
  t = t.replace(/QU/g, "K").replace(/Q/g, "K");
  t = t.replace(/GUE/g, "GE").replace(/GUI/g, "GI");
  t = t.replace(/G([EI])/g, "J$1");
  t = t.replace(/C([EIY])/g, "S$1");
  t = t.replace(/[CKQ]/g, "K");
  t = t.replace(/Z/g, "S");
  t = t.replace(/V/g, "B");
  t = t.replace(/LL/g, "Y").replace(/Y/g, "I");
  t = t.replace(/H/g, "");
  t = t.replace(/W/g, "B");
  t = t.replace(/X/g, "KS");
  t = t.replace(/(.)\1+/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = p[0];
    p[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = p[j];
      p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return p[n];
}
const levSim = (a, b) => {
  const M = Math.max(a.length, b.length);
  return M ? 1 - lev(a, b) / M : 1;
};
function jaro(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const d = Math.max(0, Math.floor(Math.max(m, n) / 2) - 1);
  const ma = Array(m).fill(false), mb = Array(n).fill(false);
  let mt = 0;
  for (let i = 0; i < m; i++)
    for (let j = Math.max(0, i - d); j < Math.min(n, i + d + 1); j++)
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; mt++; break; }
  if (!mt) return 0;
  let tr = 0, k = 0;
  for (let i = 0; i < m; i++)
    if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) tr++; k++; }
  tr /= 2;
  return (mt / m + mt / n + (mt - tr) / mt) / 3;
}
function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && a[p] && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}
const simRatio = (a, b) => Math.max(jaroWinkler(a, b), levSim(a, b));

function bestTokenSim(a, b) {
  const ta = a.split(" ").filter((x) => x.length > 2);
  const tb = b.split(" ").filter((x) => x.length > 2);
  if (!ta.length || !tb.length) return 0;
  let best = 0;
  for (const x of ta)
    for (const y of tb) {
      const s = Math.max(simRatio(x, y), simRatio(phonetic(x), phonetic(y)));
      if (s > best) best = s;
    }
  return best;
}
function containment(a, b) {
  if (!a || !b) return 0;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3) return 0;
  if (l === s || l.includes(" " + s + " ") || l.startsWith(s + " ") || l.endsWith(" " + s)) return 1;
  return 0;
}

function compare(aRaw, bRaw) {
  const a = normalize(aRaw), b = normalize(bRaw);
  if (!a || !b) return { score: 0, reasons: [], ortho: 0, phon: 0 };
  const pa = phonetic(a), pb = phonetic(b);
  const ortho = simRatio(a, b);
  const phon = simRatio(pa, pb);
  const tok = bestTokenSim(a, b);
  const cont = containment(a, b);
  const blend = 0.55 * ortho + 0.45 * phon;
  const raw = Math.max(blend, tok * 0.95, cont * 0.9);
  const reasons = [];
  if (phon >= 0.85) reasons.push("Fonética");
  if (ortho >= 0.85) reasons.push("Ortográfica");
  if (tok >= 0.88) reasons.push("Palabra clave");
  if (cont === 1) reasons.push("Contención");
  return { score: Math.round(raw * 100), reasons, ortho, phon };
}

/* ============================================================
   PARSEO DEL BOLETÍN DINAPI
   ============================================================ */
function parseBoletin(text) {
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  const rows = parsed.data;
  let dateRange = "";
  const meta = rows.find((r) => (r[0] || "").includes("BOLETIN DE INFORMACIONES"));
  if (meta) {
    const desde = meta.find((c, i) => meta[i - 1] && meta[i - 1].includes("Desde"));
    const hasta = meta.find((c, i) => meta[i - 1] && meta[i - 1].includes("Hasta"));
    if (desde && hasta) dateRange = `${desde} – ${hasta}`;
  }
  const hi = rows.findIndex((r) => (r[0] || "").trim() === "Fecha Solicitud");
  if (hi === -1) return { marks: [], skipped: 0, dateRange, error: "No se encontró el encabezado del boletín." };
  const body = rows.slice(hi + 1);
  const marks = [];
  let skipped = 0;
  for (const r of body) {
    const exp = (r[1] || "").trim();
    if (!/^\d+$/.test(exp)) continue;
    const denom = (r[3] || "").trim();
    if (!denom) { skipped++; continue; } // figurativa pura: sin texto comparable
    marks.push({
      fecha: (r[0] || "").trim(),
      expediente: exp,
      clase: (r[2] || "").trim(),
      denominacion: denom,
      signo: (r[4] || "").trim(),
      titular: (r[5] || "").trim(),
      pais: (r[6] || "").trim(),
      agente: (r[7] || "").trim(),
      tramite: (r[9] || "").trim(),
    });
  }
  return { marks, skipped, dateRange, error: null };
}

/* ============================================================
   DATOS DE EJEMPLO  (variantes que un agente debería vigilar)
   ============================================================ */
const EJEMPLO = `ALBIRROJA | 25
BIOTERM | 3
RIVAN | 5
TIMEKS | 14
PAN TV | 38
MASTERPYN | 14
ELYFARMA | 5`;

function parseMisMarcas(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [d, c] = l.split("|").map((x) => (x || "").trim());
      const clase = (c || "").replace(/[^0-9]/g, "");
      return { denominacion: d, clase };
    })
    .filter((m) => m.denominacion);
}

/* ============================================================
   UI
   ============================================================ */
const riskOf = (s) => (s >= 85 ? "alta" : s >= 70 ? "media" : "baja");
const riskStyle = {
  alta: "bg-red-100 text-red-800 border-red-200",
  media: "bg-amber-100 text-amber-800 border-amber-200",
  baja: "bg-slate-100 text-slate-600 border-slate-200",
};
const riskLabel = { alta: "Alta", media: "Media", baja: "Baja" };

export default function VigilanciaMarcas() {
  const [marcasText, setMarcasText] = useState("");
  const [boletin, setBoletin] = useState(null);
  const [fileName, setFileName] = useState("");
  const [umbral, setUmbral] = useState(70);
  const [mismaClase, setMismaClase] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef();

  const misMarcas = useMemo(() => parseMisMarcas(marcasText), [marcasText]);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = (ev) => setBoletin(parseBoletin(String(ev.target.result)));
    reader.readAsText(f, "utf-8");
  }

  function comparar() {
    if (!misMarcas.length || !boletin?.marks?.length) return;
    const rows = [];
    for (const mine of misMarcas) {
      for (const b of boletin.marks) {
        if (mismaClase && mine.clase && b.clase !== mine.clase) continue;
        const r = compare(mine.denominacion, b.denominacion);
        if (r.score >= umbral) {
          rows.push({ mine, b, ...r, sameClass: mine.clase && b.clase === mine.clase });
        }
      }
    }
    rows.sort((a, b) => b.score - a.score || (b.sameClass ? 1 : 0) - (a.sameClass ? 1 : 0));
    setResults(rows);
  }

  function descargarCSV() {
    if (!results?.length) return;
    const head = ["Mi marca", "Mi clase", "Riesgo", "Puntaje", "Marca boletin", "Clase", "Expediente", "Titular", "Pais", "Tramite", "Motivos"];
    const lines = results.map((r) =>
      [r.mine.denominacion, r.mine.clase, riskLabel[riskOf(r.score)], r.score, r.b.denominacion, r.b.clase, r.b.expediente, r.b.titular, r.b.pais, r.b.tramite, r.reasons.join(" / ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coincidencias.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = useMemo(() => {
    if (!results) return null;
    return {
      total: results.length,
      alta: results.filter((r) => riskOf(r.score) === "alta").length,
      media: results.filter((r) => riskOf(r.score) === "media").length,
    };
  }, [results]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-6" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="max-w-6xl mx-auto">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles size={22} className="text-indigo-600" /> Vigilancia de Marcas — DINAPI
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Compara tu cartera de marcas contra un boletín de marcas recibidas y detecta posibles similitudes (fonéticas y ortográficas). Prototipo para validar la lógica de cotejo.
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* Mis marcas */}
          <section className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-slate-900">1. Mis marcas</h2>
              <button onClick={() => setMarcasText(EJEMPLO)} className="text-xs text-indigo-600 hover:underline">
                Cargar ejemplo
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Una por línea. Formato: <code className="bg-slate-100 px-1 rounded">DENOMINACIÓN | CLASE</code> (la clase Niza es opcional).
            </p>
            <textarea
              value={marcasText}
              onChange={(e) => setMarcasText(e.target.value)}
              rows={7}
              placeholder={"MI MARCA | 35\nOTRA MARCA | 5"}
              className="w-full text-sm font-mono border border-slate-300 rounded p-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <div className="text-xs text-slate-500 mt-2">{misMarcas.length} marca(s) cargada(s)</div>
          </section>

          {/* Boletín */}
          <section className="bg-white rounded-lg border border-slate-200 p-4">
            <h2 className="font-semibold text-slate-900 mb-2">2. Boletín DINAPI (CSV)</h2>
            <p className="text-xs text-slate-500 mb-2">Subí el archivo CSV de “Marcas Recibidas” tal como lo descargás de la DINAPI.</p>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 rounded p-5 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 flex flex-col items-center gap-1"
            >
              <Upload size={20} />
              {fileName || "Seleccionar archivo .csv"}
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            {boletin && (
              <div className="mt-3 text-xs text-slate-600 bg-slate-50 rounded p-2 border border-slate-100">
                {boletin.error ? (
                  <span className="text-red-600">{boletin.error}</span>
                ) : (
                  <>
                    <FileText size={12} className="inline mr-1" />
                    <b>{boletin.marks.length}</b> marcas comparables
                    {boletin.skipped > 0 && <> · {boletin.skipped} figurativas omitidas (sin texto)</>}
                    {boletin.dateRange && <> · {boletin.dateRange}</>}
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Controles */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-700">
              Umbral de alerta: <span className="text-indigo-600 font-bold">{umbral}</span>
            </label>
            <input type="range" min={50} max={95} value={umbral} onChange={(e) => setUmbral(+e.target.value)} className="w-full accent-indigo-600" />
            <p className="text-xs text-slate-400">Más bajo = más sensible (más alertas). Recomendado: 70.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
            <input type="checkbox" checked={mismaClase} onChange={(e) => setMismaClase(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
            Solo misma clase Niza
          </label>
          <button
            onClick={comparar}
            disabled={!misMarcas.length || !boletin?.marks?.length}
            className="bg-indigo-600 text-white font-medium px-5 py-2 rounded hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Search size={16} /> Comparar
          </button>
        </section>

        {/* Resultados */}
        {results && (
          <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" /> Coincidencias
              </h2>
              {counts && (
                <span className="text-sm text-slate-500">
                  {counts.total} resultado(s) · <span className="text-red-700 font-medium">{counts.alta} alta</span> · <span className="text-amber-700 font-medium">{counts.media} media</span>
                </span>
              )}
              {results.length > 0 && (
                <button onClick={descargarCSV} className="ml-auto text-sm text-indigo-600 hover:underline flex items-center gap-1">
                  <Download size={14} /> Descargar CSV
                </button>
              )}
            </div>

            {results.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No se encontraron coincidencias por encima del umbral {umbral}. Probá bajándolo.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                      <th className="px-3 py-2">Riesgo</th>
                      <th className="px-3 py-2">Mi marca</th>
                      <th className="px-3 py-2">Marca en boletín</th>
                      <th className="px-3 py-2">Clase</th>
                      <th className="px-3 py-2">Exp.</th>
                      <th className="px-3 py-2">Titular</th>
                      <th className="px-3 py-2">Trámite</th>
                      <th className="px-3 py-2">Motivos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const rk = riskOf(r.score);
                      return (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${riskStyle[rk]}`}>
                              {riskLabel[rk]} · {r.score}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {r.mine.denominacion}
                            {r.mine.clase && <span className="text-slate-400 text-xs"> (cl. {r.mine.clase})</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{r.b.denominacion}</td>
                          <td className="px-3 py-2">
                            <span className={r.sameClass ? "font-semibold text-indigo-700" : "text-slate-500"}>{r.b.clase}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{r.b.expediente}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px] truncate" title={r.b.titular}>
                            {r.b.titular} <span className="text-slate-300">({r.b.pais})</span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{r.b.tramite}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.reasons.map((rs) => (
                                <span key={rs} className="bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5 rounded">{rs}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <footer className="mt-6 text-xs text-slate-400 leading-relaxed">
          <p>
            <b>Cómo funciona el cotejo:</b> cada denominación se normaliza (mayúsculas, sin acentos ni puntuación) y se compara por
            similitud ortográfica (Jaro-Winkler + Levenshtein), por clave fonética en español (b/v, c/s/z, g/j, ll/y, h muda,
            qu/k, letras dobles) y por coincidencia de palabra clave / contención. El puntaje (0–100) toma la señal más fuerte.
            Las marcas puramente figurativas (sin texto) no se comparan.
          </p>
          <p className="mt-1">
            Este motor de comparación es el mismo que se trasladará al backend Node/Express; acá corre en el navegador para
            que puedas probar y ajustar la lógica sin instalar nada.
          </p>
        </footer>
      </div>
    </div>
  );
}
