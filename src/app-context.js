const config = require("./config");
const { DiagnosisEngine } = require("./diagnosis");
const { SimulationEngine } = require("./simulation");
const { AlertService } = require("./alerts");
const { TelemetryStore } = require("./store");
const { SerialManager } = require("./serial");
const { HilService } = require("./hil");

function createContext() {
  const diagnosis = new DiagnosisEngine();
  const simulation = new SimulationEngine();
  const alerts = new AlertService();
  const store = new TelemetryStore();
  const serial = new SerialManager(config);
  const ioRef = { io: null };
  const startedAt = Date.now();

  let lastDiagnosis = null;

  function ingest(sample, meta = {}) {
    const diagnosisResult = diagnosis.evaluate(sample);
    lastDiagnosis = diagnosisResult;
    store.push(sample, diagnosisResult);
    alerts.syncFromDiagnosis(diagnosisResult);
    const payload = { sample, diagnosis: diagnosisResult, can: store.canSnapshot(), alerts: alerts.snapshot() };
    if (!meta.fromHil || meta.emit) {
      ioRef.io?.emit("telemetry", payload);
    }
    return diagnosisResult;
  }

  const hil = new HilService({
    liveSimulation: simulation,
    liveDiagnosis: diagnosis,
    ingest: (sample, meta) => ingest(sample, meta),
    mode: config.mode,
    serialStatus: () => serial.status,
  });

  return {
    config,
    diagnosis,
    simulation,
    alerts,
    store,
    serial,
    hil,
    ioRef,
    startedAt,
    ingest,
    getLastDiagnosis: () => lastDiagnosis,
  };
}

module.exports = { createContext };
