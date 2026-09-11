import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");

function runNpm(args) {
  return new Promise((resolve) => {
    const child = spawn("npm", args, { cwd: APP_ROOT, stdio: "inherit", shell: true });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function installDeps() {
  if (fs.existsSync(path.join(APP_ROOT, "node_modules"))) {
    console.log("[2/5] ابزارهای برنامه از قبل نصب است.");
    return true;
  }
  console.log("[2/5] نصب ابزارهای برنامه (نیاز به اینترنت)...");
  const code = await runNpm(["ci"]);
  if (code !== 0) {
    console.log("خطا: نصب ابزارهای برنامه انجام نشد.");
    return false;
  }
  return true;
}

async function build() {
  console.log("[3/5] ساخت برنامه...");
  const code = await runNpm(["run", "build"]);
  if (code !== 0) {
    console.log("خطا: ساخت برنامه انجام نشد.");
    return false;
  }
  return true;
}

function startProxy() {
  console.log("[4/5] راه‌اندازی پروکسی داخلی ترب...");
  const child = spawn(process.execPath, ["scripts/torob-proxy.mjs"], { cwd: APP_ROOT, stdio: "inherit" });
  child.on("error", () => console.log("هشدار: پروکسی ترب بالا نیامد."));
  return child;
}

async function main() {
  console.log("==========================================================");
  console.log("  انبار | نصب و اجرای برنامه");
  console.log("  در اولین اجرا، اتصال به اینترنت لازم است.");
  console.log("==========================================================");
  console.log("");

  console.log("[1/5] بررسی Node.js...");
  const nodeMajor = Number.parseInt(process.versions.node, 10);
  if (nodeMajor < 18) {
    console.log("خطا: نسخهٔ Node.js روی این سیستم خیلی قدیمی است. نسخهٔ جدید را از nodejs.org نصب کنید.");
    process.exit(1);
  }

  if (!(await installDeps())) process.exit(1);
  if (!(await build())) process.exit(1);

  const proxy = startProxy();

  console.log("[5/5] اجرای برنامه...");
  console.log("مرورگر به‌صورت خودکار باز می‌شود.");
  console.log("برای بستن برنامه، فقط این پنجره را ببندید.");
  console.log("");

  const server = spawn(process.execPath, ["scripts/serve-app.mjs"], { cwd: APP_ROOT, stdio: "inherit" });
  server.on("error", () => {
    console.log("خطا در اجرای برنامه.");
    proxy.kill();
    process.exit(1);
  });
  server.on("exit", (code) => {
    proxy.kill();
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => process.exit(0));

main();