const test = require("node:test");
const assert = require("node:assert");
const { keyFor } = require("./photos");

test("photo keys live under the reference, without Ropero's folders", () => {
  assert.strictEqual(keyFor("27005271", "uploads/27005271-E600893.png"), "refs/27005271/27005271-E600893.png");
  assert.strictEqual(keyFor("13001719", "13001718-1778676776281-v05g2x.jpeg"), "refs/13001719/13001718-1778676776281-v05g2x.jpeg");
});
