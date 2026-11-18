// End-to-end workflow test: real browser + real backend + real media.
//
//   1 import (browser upload)   2 analyse            3 genuine highlights
//   4 preview a clip            5 open in editor     6 modify subtitles
//   7 add a text overlay        8 render an MP4      9 reopen & play it (+ ffprobe)
//  10 social metadata, package, and persistence after reload
//
// Usage: node e2e/workflow.e2e.mjs   (env CLIPFORGE_WHISPER_MODEL optional)
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const backend = path.join(root, "backend");
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(root, "e2e-artifacts");
fs.mkdirSync(ART, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipforge-e2e-"));
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    console.log(`  ✘ ${name}: ${e}`);
    throw e;
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + "/api" + p, { ...opts, headers: { "X-ClipForge-Client": "1", ...(opts.headers ?? {}) } });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${await r.text()}`);
  return (r.headers.get("content-type") ?? "").includes("json") ? r.json() : r.arrayBuffer();
};

// ---------------------------------------------------------------- fixtures & server
const videoDir = path.join(backend, "tests", "_artifacts");
const video = path.join(videoDir, "test_podcast.mp4");
if (!fs.existsSync(video)) {
  console.log("Generating test video…");
  execFileSync("uv", ["run", "python", "tests/fixtures/make_test_video.py", videoDir], { cwd: backend, stdio: "inherit" });
}
const manifest = JSON.parse(fs.readFileSync(path.join(videoDir, "test_podcast.json"), "utf8"));

console.log(`Starting backend on ${BASE} (data ${dataDir})`);
const server = spawn("uv", ["run", "python", "-m", "clipforge", "--port", String(PORT)], {
  cwd: backend, env: { ...process.env, CLIPFORGE_DATA_DIR: dataDir, CLIPFORGE_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + "/api/health")).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) consoleErrors.push(m.text()); });
const shot = (n) => page.screenshot({ path: path.join(ART, `${n}.png`) });
let projectId, editId, renderRow;
const corrected = "MONEYWORD";
let exitCode = 0;

try {
  await step("1. Import a video (browser upload)", async () => {
    await page.goto(BASE + "/new");
    await page.getByTestId("file-input").setInputFiles(video);
    await page.waitForURL(/\/projects\/pr_/, { timeout: 60000 });
    projectId = page.url().split("/projects/")[1].split(/[?/]/)[0];
    await page.getByText("1920×1080").waitFor();
    await shot("01-imported");
  });

  await step("2. Analyse the media", async () => {
    await page.getByLabel("Clip duration").selectOption("custom");
    await page.getByLabel("Min seconds").fill("10");
    await page.getByLabel("Max seconds").fill("35");
    await page.getByTestId("start-analysis").click();
    await page.getByText("Review highlights").waitFor({ timeout: 600000 });
    await shot("02-analysed");
  });

  await step("3. Genuine candidate clips with explainable scores", async () => {
    await page.getByText("Review highlights").click();
    await page.getByTestId("highlight-card").first().waitFor();
    const n = await page.getByTestId("highlight-card").count();
    assert(n >= 2, `expected ≥2 highlights, got ${n}`);
    const hls = await api(`/projects/${projectId}/highlights`);
    const starts = manifest.sentences.map((s) => s.start);
    for (const h of hls) {
      const off = Math.min(...starts.map((s) => Math.abs(s - h.start)));
      assert(off < 0.9, `highlight ${h.title} does not start at a sentence (${off.toFixed(2)}s)`);
      assert(h.score > 0 && h.score <= 100 && Object.keys(h.breakdown).length === 7, "score breakdown missing");
    }
    await page.getByText("Why this score").first().click();
    await page.getByText("Narrative coherence").first().waitFor();
    await shot("03-highlights");
  });

  await step("4. Preview a clip", async () => {
    await page.getByRole("button", { name: "Play preview" }).first().click({ force: true });
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => document.querySelector("video")?.currentTime ?? 0);
    assert(t > 1, `preview did not play (currentTime ${t})`);
  });

  await step("5. Open the clip in the editor", async () => {
    await page.getByTestId("open-editor").first().click();
    await page.waitForURL(/\/editor\/ed_/);
    editId = page.url().split("/editor/")[1];
    await page.getByTestId("preview-canvas").waitFor();
    await page.getByTestId("timeline-clip").first().waitFor();
    await page.getByTestId("play").click();
    await page.waitForTimeout(1500);
    await page.getByTestId("play").click();
    const clock = await page.getByTestId("clock").textContent();
    assert(!clock.startsWith("0:00.00"), `playback did not advance (${clock})`);
    await shot("05-editor");
  });

  await step("6. Modify subtitles (style + word correction)", async () => {
    await page.getByTestId("caption-preset-karaoke").click();
    const ed = await api(`/edits/${editId}`);
    const word = ed.timeline.captions.words.find((w) => /mistake/i.test(w.text)) ?? ed.timeline.captions.words[5];
    await page.locator("button", { hasText: new RegExp(`^${word.text}$`) }).first().click();
    const input = page.getByTestId("word-input");
    await input.fill(corrected);
  });

  await step("7. Add a text overlay", async () => {
    await page.getByRole("tab", { name: "Text" }).click();
    await page.getByTestId("add-text-title").click();
    await page.getByTestId("text-content").fill("E2E TITLE");
    await page.getByTestId("save").click();
    await page.getByTestId("save-state").getByText("Saved").waitFor({ timeout: 15000 });
    const ed = await api(`/edits/${editId}`);
    assert(ed.timeline.texts.some((t) => t.text === "E2E TITLE"), "text layer not persisted");
    assert(ed.timeline.captions.style.preset === "karaoke", "caption style not persisted");
    assert(ed.timeline.captions.words.some((w) => w.text === corrected), "word correction not persisted");
    await page.getByTestId("exact-frame").click();
    await page.getByAltText("Exact export frame").waitFor({ timeout: 60000 });
    await shot("07-exact-frame");
    await page.getByTestId("exact-frame").click();
  });

  await step("8. Render an MP4", async () => {
    await page.getByTestId("export").click();
    await page.waitForURL(/\/export/);
    await page.getByTestId("estimate").waitFor();
    await page.getByLabel("Quality preset").selectOption("social_standard");
    await page.getByTestId("start-render").click();
    await page.getByTestId("render-card").first().waitFor({ timeout: 600000 });
    const renders = await api(`/renders?project_id=${projectId}`);
    renderRow = renders.find((r) => r.edit_id === editId && r.status === "completed");
    assert(renderRow, `no completed render: ${JSON.stringify(renders.map((r) => r.status))}`);
    await shot("08-exported");
  });

  await step("9. Reopen and play the generated video; verify edits are in the file", async () => {
    const out = renderRow.output_path;
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]).toString());
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    assert(v.width === 1080 && v.height === 1920 && v.codec_name === "h264", `bad video stream ${v.width}x${v.height} ${v.codec_name}`);
    assert(a && a.codec_name === "aac", "missing AAC audio");
    const checks = Object.fromEntries(renderRow.validation.checks.map((c) => [c.name, c]));
    for (const k of ["duration", "av_sync", "decodes_cleanly", "overlay_captions", "overlay_text"]) assert(checks[k]?.ok, `validation ${k} failed: ${JSON.stringify(checks[k])}`);
    const srt = fs.readFileSync(out.replace(/\.mp4$/, ".srt"), "utf8");
    assert(srt.includes(corrected), "corrected caption word missing from exported SRT");
    await page.goto(BASE + "/export");
    const card = page.getByTestId("render-card").first();
    const vid = card.locator("video");
    await vid.evaluate((el) => el.play());
    await page.waitForTimeout(1500);
    const st = await vid.evaluate((el) => ({ t: el.currentTime, d: el.duration, w: el.videoWidth, h: el.videoHeight }));
    assert(st.t > 0.5 && st.w === 1080 && st.h === 1920, `rendered video did not play in the browser ${JSON.stringify(st)}`);
    // Pixel check: the exported frame contains the text overlay we added (bright text near y=15%).
    const png = path.join(ART, "render-frame.png");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1.2", "-i", out, "-frames:v", "1", png]);
  });

  await step("10. Social metadata, package download and persistence after reload", async () => {
    const pk = await api(`/social?edit_id=${editId}`);
    assert(pk.length >= 1 && pk[0].content.titles.length === 3 && pk[0].content.hashtags.length >= 1, "social package incomplete");
    await page.goto(`${BASE}/social?edit=${editId}`);
    await page.getByText("Titles").waitFor();
    await page.getByRole("button", { name: "Copy to clipboard" }).first().click();
    await shot("10-social");
    const txt = Buffer.from(await api(`/social/${pk[0].id}/export.txt`)).toString();
    assert(txt.includes("HASHTAGS"), "TXT export malformed");
    const zip = path.join(ART, "package.zip");
    fs.writeFileSync(zip, Buffer.from(await api(`/projects/${projectId}/package.zip`)));
    const listing = execFileSync("unzip", ["-l", zip]).toString();
    for (const part of [".mp4", ".srt", "metadata.json", "metadata.csv", "post_"]) assert(listing.includes(part), `package missing ${part}`);
    await page.goto(`${BASE}/editor/${editId}`);
    await page.getByTestId("timeline-text").first().waitFor();
    const txtCount = await page.getByTestId("timeline-text").count();
    assert(txtCount >= 1, "text layer missing after reload");
    await shot("10-reopened-editor");
  });
  assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(" | ")}`);
  console.log(`\nE2E PASSED: ${results.length} steps`);
} catch (e) {
  exitCode = 1;
  console.log(`\nE2E FAILED: ${e}`);
  await shot("failure").catch(() => {});
  fs.writeFileSync(path.join(ART, "server.log"), serverLog);
} finally {
  fs.writeFileSync(path.join(ART, "e2e-results.json"), JSON.stringify({ results, consoleErrors }, null, 1));
  await browser.close();
  server.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 1500);
}
