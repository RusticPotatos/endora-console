// The container's own health check: Console answers on its port (http, or https with its own
// certificate). It does not need Core to be up: Console says so itself, on the page.
import { request as http } from "node:http";
import { request as https } from "node:https";

const secure = !!(process.env.CONSOLE_TLS_CERT && process.env.CONSOLE_TLS_KEY);
const req = (secure ? https : http)(
  { host: "127.0.0.1", port: Number(process.env.PORT || 8080), path: "/console/health", rejectUnauthorized: false, timeout: 3000 },
  (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); },
);
req.on("timeout", () => req.destroy());
req.on("error", () => process.exit(1));
req.end();
