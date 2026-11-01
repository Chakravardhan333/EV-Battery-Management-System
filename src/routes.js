const express = require("express");
const { parseThresholds, parseFaultRequest } = require("./validate");

function createRouter(ctx) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: ctx.config.mode,
      uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
    });
  });

  router.get("/status", (_req, res) => {
    const latest = ctx.store.latest();
    res.json({
      mode: ctx.config.mode,
      dataClass: ctx.config.mode === "hardware" ? "measured" : "simulated",
      bind: `${ctx.config.host}:${ctx.config.port}`,
      uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
      serial: ctx.serial.status,
      paused: ctx.simulation.paused,
      latest: latest ? {
        receivedAt: latest.receivedAt,
        canConnected: latest.canConnected,
        missingFields: latest.missingFields,
      } : null,
      safety: {
        contactorControl: false,
        chargeCircuitControl: false,
        emergencyDisconnectControl: false,
        note: "This prototype is monitoring-only. It cannot command contactors or charge hardware.",
      },
    });
  });

  router.get("/telemetry/latest", (_req, res) => {
    res.json({ sample: ctx.store.latest(), diagnosis: ctx.getLastDiagnosis() });
  });

  router.get("/telemetry/history", (req, res) => {
    const count = Math.min(2000, Math.max(10, Number(req.query.count) || 300));
    res.json({ samples: ctx.store.history(count) });
  });

  router.get("/can", (_req, res) => {
    res.json(ctx.store.canSnapshot());
  });

  router.get("/alerts", (_req, res) => {
    res.json(ctx.alerts.snapshot());
  });

  router.get("/diagnosis", (_req, res) => {
    res.json(ctx.getLastDiagnosis() || { health: "unknown", faults: [] });
  });

  router.get("/config/thresholds", (_req, res) => {
    res.json({
      thresholds: ctx.diagnosis.thresholds,
      assumptions: [
        "Default voltage window is for the 400 V simulated pack. Recalibrate for hardware.",
        "Delayed frames do not update the physical residual observer.",
        "Hardware delayMs from the Arduino is inter-frame interval on the receiver clock, not synchronized one-way CAN delay.",
      ],
    });
  });

  router.put("/config/thresholds", (req, res) => {
    ctx.diagnosis.setThresholds(parseThresholds(req.body, ctx.diagnosis.thresholds));
    res.json({ thresholds: ctx.diagnosis.thresholds });
  });

  router.post("/stream/pause", (req, res) => {
    ctx.simulation.paused = Boolean(req.body?.paused);
    res.json({ paused: ctx.simulation.paused });
  });

  router.post("/faults", (req, res, next) => {
    try {
      if (ctx.config.mode === "hardware") {
        return res.status(403).json({
          error: "Fault injection is simulation-only unless a validated hardware injector is connected.",
        });
      }
      const { type, enable, magnitude } = parseFaultRequest(req.body);
      const faults = ctx.simulation.setFault(type, enable, magnitude);
      res.json({ faults, type, enable });
    } catch (err) {
      next(err);
    }
  });

  router.get("/hil/cases", (_req, res) => {
    res.json({ cases: ctx.hil.listCases() });
  });

  router.get("/hil/last", (_req, res) => {
    res.json({ result: ctx.hil.last, running: ctx.hil.running });
  });

  router.post("/hil/run", async (req, res, next) => {
    try {
      const suite = req.body?.suite === "physical" ? "physical" : "software";
      const result = await ctx.hil.run({
        suite,
        onProgress: (progress) => ctx.ioRef.io?.emit("hil:progress", progress),
      });
      ctx.ioRef.io?.emit("hil:complete", result);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/serial/reconnect", async (_req, res) => {
    if (ctx.config.mode !== "hardware") {
      return res.status(400).json({ error: "SERIAL reconnect is only valid in hardware mode" });
    }
    await ctx.serial.stop();
    await ctx.serial.start();
    res.json({ serial: ctx.serial.status });
  });

  return router;
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal error" });
}

function authMiddleware(token) {
  return (req, res, next) => {
    if (!token) return next();
    const header = req.get("authorization") || "";
    const query = req.query.token;
    const provided = header.startsWith("Bearer ") ? header.slice(7) : query;
    if (provided !== token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}

module.exports = { createRouter, errorHandler, authMiddleware };
