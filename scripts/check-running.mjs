import http from "node:http";

const PORT = Number(process.env.PORT || 5173);

const req = http.get(
  { host: "localhost", port: PORT, path: "/", timeout: 2500 },
  () => {},
);
req.on("response", (res) => {
  res.resume();
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on("error", () => process.exit(1));
req.setTimeout(2500, () => {
  req.destroy();
});