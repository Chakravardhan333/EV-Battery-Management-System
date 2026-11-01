const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const config = require("./src/config");
const { createContext } = require("./src/app-context");
const { createRouter, errorHandler, authMiddleware } = require("./src/routes");

async function main() {
  const ctx = createContext();
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: true },
  });
  ctx.ioRef.io = io;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(authMiddleware(config.apiToken));
  app.use("/api", createRouter(ctx));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(errorHandler);

  io.use((socket, next) => {
    if (!config.apiToken) return next();
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token !== config.apiToken) return next(new Error("unauthorized"));
    next();
  });

  io.on("connection", (socket) => {
    socket.emit("hello", {
      mode: config.mode,
      dataClass: config.mode === "hardware" ? "measured" : "simulated",
      serial: ctx.serial.status,
    });
  });

  ctx.serial.on("telemetry", (sample) => ctx.ingest(sample));
  ctx.serial.on("status", (status) => io.emit("serial", status));
  await ctx.serial.start();

  if (config.mongo.uri) {
    try {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(config.mongo.uri);
      await client.connect();
      await ctx.store.attachMongo(client, config.mongo.db);
      console.log("MongoDB history enabled");
    } catch (err) {
      console.warn("MongoDB unavailable, using in-memory history:", err.message);
    }
  }

  if (config.mode === "simulation") {
    setInterval(() => {
      const sample = ctx.simulation.tick();
      if (sample) ctx.ingest(sample);
    }, 200);
  } else {
    setInterval(() => {
      const last = ctx.store.latest();
      const stale = !last || (Date.now() - last.hostTs) > 1000;
      if (stale) {
        ctx.ingest({
          origin: "hardware",
          dataClass: "measured",
          voltage: last?.voltage ?? null,
          current: last?.current ?? null,
          temperature: last?.temperature ?? null,
          soc: last?.soc ?? null,
          delayMs: null,
          delayClass: "measured",
          seq: last?.seq ?? null,
          canId: last?.canId ?? null,
          drops: last?.drops ?? 0,
          rxRateHz: 0,
          chargeState: "unknown",
          canConnected: false,
          missingFields: ["voltage", "current", "temperature", "soc"],
          deviceTs: null,
          hostTs: Date.now(),
          receivedAt: new Date().toISOString(),
        });
      }
    }, 1000);
  }

  server.listen(config.port, config.host, () => {
    console.log(`VoltScope listening on http://${config.host}:${config.port} (${config.mode} mode)`);
    console.log("Monitoring only — no contactor or charge-circuit control is implemented.");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
