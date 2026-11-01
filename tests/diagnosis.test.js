const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DiagnosisEngine } = require("../src/diagnosis");
const { parseTelemetry } = require("../src/validate");

function sample(overrides) {
  return parseTelemetry({
    voltage: 398,
    current: 10,
    temperature: 32,
    soc: 78,
    delayMs: 12,
    delayClass: "simulated",
    seq: 1,
    drops: 0,
    canConnected: true,
    ...overrides,
  }, "simulation");
}

test("nominal pack is healthy", () => {
  const d = new DiagnosisEngine();
  const r = d.evaluate(sample({}));
  assert.equal(r.health, "healthy");
  assert.equal(r.faults.length, 0);
});

test("delayed frame is communication, not sensor drift", () => {
  const d = new DiagnosisEngine();
  d.evaluate(sample({ voltage: 398, seq: 1 }));
  const r = d.evaluate(sample({ voltage: 430, delayMs: 120, seq: 2 }));
  const codes = r.faults.map((f) => f.code);
  assert.ok(codes.includes("can_delay"));
  assert.ok(!codes.includes("sensor_drift"));
  assert.ok(!codes.includes("abnormal_voltage"));
  assert.equal(r.observer.heldForDelay, true);
});

test("sensor drift is physical when frame is fresh", () => {
  const d = new DiagnosisEngine();
  const r = d.evaluate(sample({ voltage: 414, soc: 78 }));
  assert.ok(r.faults.some((f) => f.code === "sensor_drift"));
  assert.equal(r.isolation.domain, "physical");
});

test("overtemperature is classified", () => {
  const d = new DiagnosisEngine();
  const r = d.evaluate(sample({ temperature: 58 }));
  assert.ok(r.faults.some((f) => f.code === "overtemperature"));
});
