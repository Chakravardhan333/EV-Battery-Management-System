const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HilService } = require("../src/hil");
const { DiagnosisEngine } = require("../src/diagnosis");
const { SimulationEngine } = require("../src/simulation");

test("software HIL suite passes expected diagnostic classes", async () => {
  const liveDiagnosis = new DiagnosisEngine();
  const liveSimulation = new SimulationEngine();
  const hil = new HilService({
    liveSimulation,
    liveDiagnosis,
    ingest: () => liveDiagnosis,
    mode: "simulation",
    serialStatus: () => ({ lastRxAt: null }),
  });
  const result = await hil.run({ suite: "software" });
  assert.equal(result.stats.failed, 0, JSON.stringify(result.results, null, 2));
  assert.equal(result.coverage.kind, "software");
  assert.ok(result.coverage.faultSpaceCoveragePct >= 99);
});

test("physical suite without hardware is unmeasured", async () => {
  const hil = new HilService({
    liveSimulation: new SimulationEngine(),
    liveDiagnosis: new DiagnosisEngine(),
    ingest: () => null,
    mode: "hardware",
    serialStatus: () => ({ lastRxAt: null }),
  });
  const result = await hil.run({ suite: "physical" });
  assert.ok(result.results.every((r) => r.skippedPhysical));
  assert.equal(result.coverage.kind, "physical");
});
