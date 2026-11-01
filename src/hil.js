/**
 * HIL orchestration.
 * Default suite is SOFTWARE simulation of the diagnostic classifier.
 * PHYSICAL coverage is recorded only when hardware telemetry was received
 * during a case — never inferred from software passes.
 */

const { DiagnosisEngine } = require("./diagnosis");
const { SimulationEngine } = require("./simulation");

const CASES = [
  { id: "normal", title: "Normal operation", fault: "normal", expect: { health: ["healthy"] } },
  { id: "can_delay", title: "CAN delay simulation", fault: "canDelay", expect: { codes: ["can_delay"], notCodes: ["sensor_drift", "abnormal_voltage"] } },
  { id: "dropout", title: "Packet dropout", fault: "packetDropout", expect: { codes: ["packet_dropout"] } },
  { id: "drift", title: "Sensor drift", fault: "sensorDrift", expect: { codes: ["sensor_drift"] } },
  { id: "overtemp", title: "Abnormal temperature", fault: "highTemp", expect: { codes: ["overtemperature"] } },
  { id: "voltage", title: "Abnormal voltage", fault: "abnormalVoltage", expect: { codes: ["abnormal_voltage"] } },
  { id: "comm_fail", title: "Communication failure", fault: "commFailure", expect: { codes: ["comm_timeout"] } },
];

class HilService {
  constructor({ liveSimulation, liveDiagnosis, ingest, mode, serialStatus }) {
    this.liveSimulation = liveSimulation;
    this.liveDiagnosis = liveDiagnosis;
    this.ingest = ingest;
    this.mode = mode;
    this.serialStatus = serialStatus;
    this.running = false;
    this.last = null;
  }

  listCases() {
    return CASES.map(({ id, title }) => ({ id, title }));
  }

  async run({ suite = "software", onProgress }) {
    if (this.running) {
      const err = new Error("HIL suite already running");
      err.status = 409;
      throw err;
    }
    this.running = true;
    const started = new Date().toISOString();
    const results = [];
    const shadow = new DiagnosisEngine();
    shadow.setThresholds(this.liveDiagnosis.thresholds);
    const sim = new SimulationEngine();
    sim.deterministic = true;
    const useLiveStream = suite === "software" && this.mode === "simulation";
    const branchesBefore = new Set(this.liveDiagnosis.branchesHit);
    const runStart = Date.now();

    try {
      for (let i = 0; i < CASES.length; i += 1) {
        const testCase = CASES[i];
        onProgress?.({
          index: i,
          total: CASES.length,
          current: testCase.title,
          percent: Math.round((i / CASES.length) * 100),
        });
        const result = await this.executeCase({
          testCase,
          suite,
          shadow,
          sim,
          useLiveStream,
        });
        results.push(result);
      }
    } finally {
      this.liveSimulation.setFault("normal", true);
      this.running = false;
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const skipped = results.filter((r) => r.skippedPhysical).length;
    const branches = [...new Set([...this.liveDiagnosis.branchesHit, ...shadow.branchesHit])];
    const coveredFaults = results.filter((r) => r.passed).map((r) => r.id);
    const hwDuringRun = Boolean(this.serialStatus()?.lastRxAt && this.serialStatus().lastRxAt >= runStart);

    this.last = {
      suite,
      started,
      finished: new Date().toISOString(),
      results,
      stats: { passed, failed, skipped, total: results.length },
      coverage: {
        kind: suite === "physical" ? "physical" : "software",
        branchCoveragePct: Math.round((branches.length / 10) * 1000) / 10,
        branchesHit: branches,
        branchesDiscoveredThisRun: branches.filter((b) => !branchesBefore.has(b)),
        faultSpaceCoveragePct: Math.round((coveredFaults.length / CASES.length) * 1000) / 10,
        faultSpace: CASES.map((c) => c.id),
        coveredFaults,
        hardwareFramesDuringRun: hwDuringRun,
        note: suite === "physical"
          ? (hwDuringRun
            ? "Physical suite ran while hardware frames were arriving. Per-case pass still requires measured samples."
            : "No hardware frames arrived during this run. Results are not physical coverage.")
          : "Software HIL exercises the diagnostic classifier with simulated telemetry. This is not MCU instruction coverage and not physical HIL.",
      },
    };
    onProgress?.({ index: CASES.length, total: CASES.length, current: "Complete", percent: 100 });
    return this.last;
  }

  async executeCase({ testCase, suite, shadow, sim, useLiveStream }) {
    shadow.reset();
    sim.setFault("normal", true);
    sim.setFault(testCase.fault, testCase.fault !== "normal");
    if (useLiveStream) {
      this.liveDiagnosis.reset();
      this.liveSimulation.setFault("normal", true);
      this.liveSimulation.setFault(testCase.fault, testCase.fault !== "normal");
    }

    let lastDiag = null;
    for (let i = 0; i < 10; i += 1) {
      const sample = sim.tick();
      if (sample) lastDiag = shadow.evaluate(sample);
      if (useLiveStream && sample) this.ingest(sample, { fromHil: true, emit: true });
      await sleep(35);
    }

    const codes = (lastDiag?.faults || []).map((f) => f.code);
    const health = lastDiag?.health;
    let passed = true;
    let reason = "Classifier matched expected class";

    if (testCase.expect.health && !testCase.expect.health.includes(health)) {
      passed = false;
      reason = `Expected health ${testCase.expect.health.join("|")}, got ${health}`;
    }
    if (testCase.expect.codes) {
      const ok = testCase.expect.codes.every((c) => codes.includes(c));
      if (!ok) {
        passed = false;
        reason = `Expected codes ${testCase.expect.codes.join(", ")}; got ${codes.join(", ") || "none"}`;
      }
    }
    if (testCase.expect.notCodes) {
      const bad = testCase.expect.notCodes.filter((c) => codes.includes(c));
      if (bad.length) {
        passed = false;
        reason = `Communication case must not raise physical codes: ${bad.join(", ")}`;
      }
    }

    if (suite === "physical") {
      const hw = this.serialStatus();
      if (!hw?.lastRxAt) {
        return {
          id: testCase.id,
          title: testCase.title,
          passed: false,
          skippedPhysical: true,
          reason: "No hardware telemetry — not counted as physical HIL",
          codes,
          health,
          dataClass: "unmeasured",
        };
      }
    }

    return {
      id: testCase.id,
      title: testCase.title,
      passed,
      reason,
      codes,
      health,
      dataClass: suite === "physical" ? "measured" : "simulated",
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { HilService, CASES };
