// Renders scenes.html frame by frame and pipes JPEG frames into ffmpeg (H.264).
// Usage: node render.cjs timeline.json out.mp4 [fps] [poster.jpg]
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, execSync } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"))); }

const [tlFile, outFile, fpsArg, posterFile] = process.argv.slice(2);
const FPS = Number(fpsArg || 30);
const tl = JSON.parse(fs.readFileSync(tlFile, "utf8"));
const ROOT = path.resolve(__dirname, "..");
const ffmpeg = execSync(`python3 -c "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())"`).toString().trim();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`http://localhost:${port}/video/scenes.html`);
  await page.waitForFunction(() => typeof window.seek === "function" && typeof window.ready === "function");
  await page.evaluate(async (t) => { window.setTimeline(t); await window.ready(); }, tl);
  const ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "scale=1920:1080", "-movflags", "+faststart", outFile], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.ceil(tl.total * FPS);
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now();
  const posterAt = tl.scenes.find((s) => s.id === "reading").start + 3.2;
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    await page.evaluate((x) => window.seek(x), t);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
    const buf = Buffer.from(data, "base64");
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (posterFile && Math.abs(t - posterAt) < 0.5 / FPS) fs.writeFileSync(posterFile, buf);
    if (i % (FPS * 10) === 0) process.stdout.write(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await browser.close();
  server.close();
  console.log("rendered", frames, "frames");
})().catch((e) => { console.error(e); process.exit(1); });
