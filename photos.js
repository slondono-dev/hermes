// Garment photos for an MPC: Ropero (ropero.dsx.com.co) knows the techpack images of
// each reference; Hermes copies them to B2 once and tells Prisma Proveedores their keys.
const b2 = require("./b2");

const ROPERO = (process.env.ROPERO_URL || "https://ropero.dsx.com.co").replace(/\/$/, "");
const PER_REFERENCE = Number(process.env.PHOTOS_PER_REFERENCE || 4);

// "uploads/27005271-E600893.png" -> "refs/27005271/27005271-E600893.png"
const keyFor = (reference, filename) => `refs/${reference}/${String(filename).split("/").pop()}`;

async function imagesOf(reference) {
  const res = await fetch(`${ROPERO}/techpack-images/${encodeURIComponent(reference)}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.found) return [];
  return (data.images || []).filter((i) => i.simulated_path && i.filename).slice(0, PER_REFERENCE);
}

// References of the MPC (usually one), their photos uploaded if new. `uploaded` is the
// set of keys already in B2, kept in Hermes' state so each photo travels only once.
async function photosFor(order, uploaded) {
  if (!b2.enabled()) return [];
  const refs = [...new Set((order.items || []).map((i) => String(i.reference || "").trim()).filter(Boolean))];
  const out = [];
  for (const reference of refs) {
    for (const img of await imagesOf(reference)) {
      const key = keyFor(reference, img.filename);
      if (!uploaded.has(key)) {
        const res = await fetch(img.simulated_path, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) continue;
        await b2.upload(key, Buffer.from(await res.arrayBuffer()), res.headers.get("content-type"));
        uploaded.add(key);
      }
      out.push({ reference, key: await b2.fileName(key), source: img.source_db || null });
    }
  }
  return out;
}

module.exports = { photosFor, keyFor };
