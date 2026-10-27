// Hermes: lives inside the DISEX network next to APISIESA, reads each MPC with
// its MCS contracts and pushes them to Prisma Proveedores, which is on the internet.
// Prisma Proveedores never reaches SIESA; Hermes only reads SIESA and only talks out.
const crypto = require("node:crypto");
const fs = require("node:fs");
const { parseObservations, packageMismatches } = require("./observations");
const { photosFor } = require("./photos");

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
};
const SIESA = env("APISIESA_URL").replace(/\/$/, "");
const SIESA_TOKEN = env("APISIESA_TOKEN");
const CIA = env("APISIESA_CIA", "1");
// Prisma Proveedores (formerly Clover). CLOVER_* still works until the .env is updated.
const PROVEEDORES = env("PROVEEDORES_URL", process.env.CLOVER_URL).replace(/\/$/, "");
const PROVEEDORES_TOKEN = env("PROVEEDORES_TOKEN", process.env.CLOVER_TOKEN);
const SYNC_DAYS = Number(env("SYNC_DAYS", "45"));
const POLL_SECONDS = Number(env("POLL_SECONDS", "300"));
const STATE_FILE = env("STATE_FILE", `${__dirname}/state.json`);

async function siesa(path) {
  const res = await fetch(`${SIESA}${path}`, {
    headers: { Authorization: SIESA_TOKEN, "X-Cia": CIA },
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`APISIESA ${res.status} ${path}`);
  return res.json();
}

// One MPC plus every MCS that contracts one of its operations.
async function bundle(document, uploaded = new Set()) {
  const number = document.split("-")[1];
  const order = await siesa(`/get-production-order-print?document_type=MPC&document_number=${number}`);
  if (!order) return null;
  const found = await siesa(`/get-production-order-operations?op_document=${document}`);
  const operations = Array.isArray(found) ? found : [];

  const byContract = new Map();
  for (const op of operations) {
    if (!/^MCS-\d+$/.test(op.purchase_order_document)) continue;
    const ops = byContract.get(op.purchase_order_document) || new Map();
    ops.set(op.operation_number, `${op.operation_description}`.trim());
    byContract.set(op.purchase_order_document, ops);
  }
  const contracts = [];
  for (const [mcs, ops] of byContract) {
    const contract = await siesa(`/get-purchase-order-print?document_type=MCS&document_number=${mcs.split("-")[1]}`);
    if (!contract) continue;
    contract.operations = [...ops].map(([operation_number, description]) => ({ operation_number, description }));
    contracts.push(contract);
  }

  const observations = parseObservations(order.notes);
  observations.package_mismatches = packageMismatches(observations.packages, order.items);
  // Photos never block an order: if Ropero or B2 fail, it goes without them.
  const photos = await photosFor(order, uploaded).catch((err) => {
    console.error(new Date().toISOString(), document, `photos: ${err.message}`);
    return [];
  });
  return { production_order: order, observations, contracts, photos };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function syncOnce() {
  const since = new Date(Date.now() - SYNC_DAYS * 86_400_000).toISOString().slice(0, 10);
  const orders = (await siesa(`/get-production-orders?document_type=MPC&start_document_date=${since}`)) || [];
  const state = loadState();
  const uploaded = new Set(state._photos || []);
  let sent = 0;
  let failed = 0;

  for (const { document } of orders) {
    try {
      const payload = await bundle(document, uploaded);
      // ponytail: no MCS yet means no confeccionista to show it to; it goes out once one exists.
      if (!payload || payload.contracts.length === 0) continue;
      const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      if (state[document] === hash) continue;

      const res = await fetch(`${PROVEEDORES}/api/hermes/production-orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${PROVEEDORES_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, hash, sent_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Prisma Proveedores ${res.status} ${(await res.text()).slice(0, 200)}`);
      state[document] = hash;
      state._photos = [...uploaded];
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
      sent++;
    } catch (err) {
      failed++;
      console.error(new Date().toISOString(), document, err.message);
    }
  }
  console.log(new Date().toISOString(), `orders=${orders.length} sent=${sent} failed=${failed}`);
}

async function main() {
  if (process.argv.includes("--print")) {
    // Shows what would go to Prisma Proveedores for one MPC, without sending: node hermes.js --print MPC-12734
    const doc = process.argv[process.argv.indexOf("--print") + 1];
    console.log(JSON.stringify(await bundle(doc), null, 2));
    return;
  }
  do {
    await syncOnce().catch((err) => console.error(new Date().toISOString(), err.message));
    if (process.argv.includes("--once")) return;
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  } while (true);
}

main();
