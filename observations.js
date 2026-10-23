// Reads the free-text "Observaciones" of a SIESA MPC into fields Clover can show.
// Planners type these by hand, so keywords come with typos (RECUEPRO, RESPOSO,
// PAQUEETS...): words are matched by edit distance, not exact spelling.

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

const clean = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
const words = (line) => line.split(/[^A-Z]+/).filter(Boolean);
const like = (line, word, max = 2) =>
  words(line).some((w) => w.length >= word.length - max && distance(w.slice(0, word.length + 1), word) <= max);
const number = (s) => Number(s.replace(",", "."));

const ORDER = /\bCP\s*([VE])\s*-?\s*(\d+)\s*(.*)$/;
const PACKAGES = /^([^A-Z0-9]*[A-Z0-9-]{1,6}\s*=\s*[\d\s+./-]*)+$/;
const PACKAGE = /([A-Z0-9-]{1,6})\s*=\s*([\d\s+.-]*)/g;
const DATE = /^(\d{1,2})\s*-?\s*([A-Z]{3,10})\.?$/;

function parseObservations(text) {
  const out = {
    raw: text || "",
    order: null,
    pattern_ok: false,
    shipping_ok: false,
    rest_hours: null,
    recovery_cm: null,
    marker: null,
    external_cut: false,
    from_leftover: false,
    point_of_sale: false,
    packages: {},
    note_date: null,
    other: [],
  };
  for (const original of out.raw.split(/\r?\n/)) {
    const line = clean(original).replace(/\s+/g, " ").trim();
    if (!line) continue;
    let m;
    if ((m = line.match(ORDER))) {
      out.order = { type: m[1] === "V" ? "CPV" : "CPE", number: m[2], date: m[3].replace(/^[-\s]+/, "") || null };
    } else if (PACKAGES.test(line)) {
      // "S=20-20-6", also "S=7/M=13" or one column per marker: "S=65-65   M=55-55"
      for (const [, size, list] of line.matchAll(PACKAGE)) {
        out.packages[size] = (out.packages[size] || []).concat(list.split(/\D+/).filter(Boolean).map(Number));
      }
    } else if (like(line, "PAQUETES")) {
      // header of the packages block, sizes follow on the next lines
    } else if (like(line, "RECUPERO")) {
      const n = line.split("(")[0].match(/(\d+(?:[.,]\d+)?)/);
      out.recovery_cm = /^NO\b/.test(line) || !n ? 0 : number(n[1]);
      const rest = line.match(/REPOSAD[AO] (\d+) HORAS?/);
      if (rest) out.rest_hours = Number(rest[1]);
    } else if (/^\D*\d+(\s*H|$)/.test(line) && (like(line, "REPOSO") || like(line, "REPOSADA"))) {
      out.rest_hours = Number(line.match(/(\d+)/)[1]);
    } else if (/^\d+(?:[.,]\d+)?\s*CM$/.test(line)) {
      out.recovery_cm = number(line);
    } else if (like(line, "SHIPPING")) {
      out.shipping_ok = true;
    } else if (like(line, "AJUSTE") || like(line, "PLANTILLA")) {
      out.pattern_ok = true;
    } else if ((m = line.match(/^T?R?A?ZO\s*#?\s*(\d+)$/)) || (like(line, "TRAZO", 1) && (m = line.match(/(\d+)/)))) {
      out.marker = Number(m[1]);
    } else if (like(line, "EXTERNO") && like(line, "CORTE")) {
      out.external_cut = true;
    } else if (like(line, "APROVECHAMIENTO")) {
      out.from_leftover = true;
    } else if (like(line, "PUNTO") && like(line, "VENTA")) {
      out.point_of_sale = true;
    } else if (DATE.test(line)) {
      out.note_date = original.trim();
    } else if (line !== "OK") {
      out.other.push(original.trim());
    }
  }
  return out;
}

// "05-L" -> "L", "08" -> "8". Package keys come typed the same way.
const sizeOf = (extension) => `${extension}`.split("-").pop().replace(/^0+(?=\d)/, "").toUpperCase();

// Sizes whose package split does not add up to the ordered quantity.
function packageMismatches(packages, items) {
  const ordered = {};
  for (const it of items) ordered[sizeOf(it.extension)] = (ordered[sizeOf(it.extension)] || 0) + it.ordered_quantity;
  return Object.entries(packages)
    .map(([size, list]) => ({ size, packages: list.reduce((a, b) => a + b, 0), ordered: ordered[size.replace(/^0+(?=\d)/, "")] }))
    .filter((r) => r.ordered !== undefined && r.packages !== r.ordered);
}

module.exports = { parseObservations, packageMismatches, sizeOf };
