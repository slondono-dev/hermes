# Hermes

Messenger between SIESA and Prisma Proveedores. Runs inside the DISEX network next to APISIESA, reads every MPC (orden de producción confección) with the MCS (orden de compra paquete completo) that contract its operations, and pushes them to Prisma Proveedores. Prisma Proveedores never reaches SIESA. No dependencies, Node 22.

```
cp .env.example .env   # fill APISIESA_TOKEN and PROVEEDORES_TOKEN
npm test
npm run once           # one pass
npm start              # every POLL_SECONDS
node --env-file=.env hermes.js --print MPC-12734   # show one bundle, send nothing
```

## What it reads (APISIESA)
- `GET /get-production-orders?document_type=MPC&start_document_date=` MPCs of the last `SYNC_DAYS`.
- `GET /get-production-order-print?document_type=MPC&document_number=` header, items, components, operations, notes.
- `GET /get-production-order-operations?op_document=MPC-n` which MCS contracts each operation.
- `GET /get-purchase-order-print?document_type=MCS&document_number=` each MCS as printed for the supplier.

An MPC with no MCS yet is skipped (no confeccionista to show it to). Unchanged bundles are not resent (`state.json` keeps a hash per MPC).

## Photos (Ropero → B2)
For each reference of the MPC, Hermes asks Ropero `GET {ROPERO_URL}/techpack-images/{reference}`, downloads up to `PHOTOS_PER_REFERENCE` images and uploads them once to the private B2 bucket as `refs/{reference}/{file}` (inside the key's name prefix when the B2 key has one, e.g. `DISEXCLOVER/refs/...`; `b2.js`, native API, no dependencies). The bundle carries `photos: [{ reference, key, source }]`; Prisma Proveedores signs short-lived links to show them. Without `B2_*` the bundle goes without photos.

## What it sends (Prisma Proveedores)
`POST {PROVEEDORES_URL}/api/hermes/production-orders` with `Authorization: Bearer {PROVEEDORES_TOKEN}`:

```
{
  production_order: { document_number, document_code, document_date, document_status, planner,
    reference_1 (item), reference_2 (client), reference_3 (CPV/CPE), notes,
    items: [{ reference, extension, description, barcode, ordered_quantity, start_date, end_date, ... }],
    components: [{ reference, extension, description, warehouse, meassure_unit, required_quantity }],
    operations: [{ operation_number, description, work_center, is_external, ... }] },
  observations: { raw, order, pattern_ok, shipping_ok, rest_hours, recovery_cm, marker,
    external_cut, from_leftover, point_of_sale, packages: { S: [20, 20, 6] }, note_date, other: [],
    package_mismatches: [{ size, packages, ordered }] },
  contracts: [ MCS print (supplier, items, totals, notes) + operations: [{ operation_number, description }] ],
  photos: [{ reference, key, source }],
  hash, sent_at
}
```

Prisma Proveedores must upsert by `production_order.document_number` and show each contract only to the supplier whose NIT it carries.

## Observations
Planners write the MPC notes by hand, with typos (`RECUEPRO`, `RESPOSO`, `PAQUEETS`). `observations.js` matches keywords by edit distance; on 612 real MPCs it places 98% of the 5,044 lines. Lines it does not recognize go to `other` untouched, and `raw` always carries the original text.
