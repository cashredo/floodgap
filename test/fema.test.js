const test = require("node:test");
const assert = require("node:assert/strict");
const Fema = require("../js/fema.js");

test("aggregateByYear counts claims per year, sorted ascending", () => {
  const rows = [
    { yearOfLoss: 2017 }, { yearOfLoss: 2017 }, { yearOfLoss: 2001 }, { yearOfLoss: 2017 }, { yearOfLoss: 2019 },
  ];
  const out = Fema._aggregateByYear(rows);
  assert.deepEqual(out, [
    { year: 2001, count: 1 },
    { year: 2017, count: 3 },
    { year: 2019, count: 1 },
  ]);
});

test("aggregateByYear ignores rows with no year", () => {
  const out = Fema._aggregateByYear([{ yearOfLoss: null }, { yearOfLoss: 2010 }]);
  assert.deepEqual(out, [{ year: 2010, count: 1 }]);
});
