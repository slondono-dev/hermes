# Hermes

Messenger between SIESA and Clover. Runs inside the DISEX network next to APISIESA, reads every MPC (orden de producción confección) with the MCS (orden de compra paquete completo) that contract its operations, and pushes them to Clover. Clover never reaches SIESA. No dependencies, Node 22.

```
cp .env.example .env   # fill APISIESA_TOKEN and CLOVER_TOKEN
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

## What it sends (Clover)
`POST {CLOVER_URL}/api/hermes/production-orders` with `Authorization: Bearer {CLOVER_TOKEN}`:

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
  hash, sent_at
}
```

Clover must upsert by `production_order.document_number` and show each contract only to the supplier whose NIT it carries.

## Observations
Planners write the MPC notes by hand, with typos (`RECUEPRO`, `RESPOSO`, `PAQUEETS`). `observations.js` matches keywords by edit distance; on 612 real MPCs it places 98% of the 5,044 lines. Lines it does not recognize go to `other` untouched, and `raw` always carries the original text.
