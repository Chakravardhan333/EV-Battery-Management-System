const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

const mode = String(env("BMS_MODE", "simulation")).toLowerCase() === "hardware"
  ? "hardware"
  : "simulation";

module.exports = {
  host: env("HOST", "127.0.0.1"),
  port: Number(env("PORT", "3000")),
  mode,
  apiToken: env("BMS_API_TOKEN", ""),
  serial: {
    path: env("SERIAL_PORT", "COM3"),
    baudRate: Number(env("SERIAL_BAUD", "115200")),
    reconnectMs: Number(env("SERIAL_RECONNECT_MS", "3000")),
  },
  mongo: {
    uri: env("MONGO_URI", ""),
    db: env("MONGO_DB", "voltscope"),
  },
  /** Expected telemetry period used for dropout / delay residuals (ms). */
  expectedPeriodMs: 200,
};
