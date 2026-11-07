// Starts Endora Console: `node server/main.mjs`, configured by the environment (README).
import { configFrom, createConsole } from "./app.mjs";

const config = configFrom();
const server = createConsole(config);
await server.checkCore();
setInterval(() => server.checkCore(), 60000).unref();
server.listen(config.port, () => {
  const core = server.core;
  console.log(`endora-console on :${config.port} (${config.tls ? "https" : "http"}), Core at ${config.core}: ` +
    (core.reachable ? `reachable, API ${core.api ?? "unversioned"}` : "not reachable yet"));
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
