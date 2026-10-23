const test = require("node:test");
const assert = require("node:assert");
const { parseObservations, packageMismatches } = require("./observations");

// Real notes from MPC prints, typos included.
test("reads a typical MPC note", () => {
  const o = parseObservations(
    "CPV-4998\t27-abr-2026\r\nOK AJSUTE PRODU PORCE+PLANTILLA\r\nRECUEPRO 0.50CM\r\nRESPOSO 18 HORAS\r\nPAQUEETS\r\nXS=51-51\r\nS=7/M=13\r\n13 marz\r\nCHOCOLATE",
  );
  assert.deepStrictEqual(o.order, { type: "CPV", number: "4998", date: "27-ABR-2026" });
  assert.strictEqual(o.pattern_ok, true);
  assert.strictEqual(o.recovery_cm, 0.5);
  assert.strictEqual(o.rest_hours, 18);
  assert.deepStrictEqual(o.packages, { XS: [51, 51], S: [7], M: [13] });
  assert.strictEqual(o.note_date, "13 marz");
  assert.deepStrictEqual(o.other, ["CHOCOLATE"]);
});

test("no recovery, rest inside recovery line, flags", () => {
  assert.strictEqual(parseObservations("NO ECUPERO").recovery_cm, 0);
  const o = parseObservations("RECUERO 0.02CM (TELA REPOSADA 15 HORAS + 3 HORAS EN MESA\nCORTE EXTERNO\nSALE DE APROVECHAMIENTO\nPUNTO VENTA\ntazo # 2\nOK SHIPING");
  assert.strictEqual(o.recovery_cm, 0.02);
  assert.strictEqual(o.rest_hours, 15);
  assert.strictEqual(o.external_cut && o.from_leftover && o.point_of_sale && o.shipping_ok, true);
  assert.strictEqual(o.marker, 2);
});

test("one package column per marker", () => {
  const o = parseObservations("S=65-65                        M=55-55\nM=65-65-65                   L=55-55");
  assert.deepStrictEqual(o.packages, { S: [65, 65], M: [55, 55, 65, 65, 65], L: [55, 55] });
});

test("flags package splits that do not add up", () => {
  const items = [
    { extension: "03-S", ordered_quantity: 20 },
    { extension: "04-M", ordered_quantity: 46 },
  ];
  assert.deepStrictEqual(packageMismatches({ S: [20], M: [20, 20] }, items), [{ size: "M", packages: 40, ordered: 46 }]);
});
