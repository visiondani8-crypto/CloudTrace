// End-to-end workflow test: real browser + real backend + real media.
//
//   1 import (browser upload)   2 analyse            3 genuine highlights
//   4 preview a clip            5 open in editor     6 modify subtitles
//   7 add a text overlay        8 render an MP4      9 reopen & play it (+ ffprobe)
//  10 social metadata, package, and persistence after reload
//  11 live preview vs exporter: crossfade, B-roll and music playback
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
  await step("11. Live preview matches the exporter (crossfade, B-roll, music)", async () => {
    const broll = path.join(ART, "broll.mp4");
    const music = path.join(ART, "music.wav");
    execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", broll]);
    execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=330:d=12", "-ac", "2", music]);
    const upload = (kind, file) => api(`/assets?kind=${kind}&filename=${path.basename(file)}`, { method: "PUT", body: fs.readFileSync(file) });
    const br = await upload("broll", broll);
    const mu = await upload("music", music);
    const tl = (await api(`/edits/${editId}`)).timeline;
    const c0 = tl.clips[0];
    const base = { ...c0, speed: 1, effects: [], envelope: [], volume_db: 0, muted: false };
    // Two clips from differently coloured topics, joined by a 1 s crossfade at T = 3.0 s.
    tl.clips = [
      { ...base, id: "e2e_a", src_in: 12, src_out: 15, start: 0, transition_in: { type: "cut", duration: 0 } },
      { ...base, id: "e2e_b", src_in: 42, src_out: 47, start: 3, transition_in: { type: "crossfade", duration: 1 } },
    ];
    tl.overlays = [{ ...base, id: "e2e_ov", source_id: br.id, src_in: 0, src_out: 1.5, start: 4.2, transform: [0.1, 0.1, 0.5, 0.3], opacity: 1, muted: true, label: "B-roll", transition_in: { type: "cut", duration: 0 } }];
    tl.audio_clips = [{ id: "e2e_mu", asset_id: mu.id, start: 0, src_in: 0, src_out: null, gain_db: -6, fade_in: 0, fade_out: 0, duck: false, loop: false, envelope: [], label: "music" }];
    tl.texts = [];
    tl.graphics = [];
    tl.reframe.panels = tl.reframe.panels.map((p) => ({ ...p, keyframes: [{ ...p.keyframes[0], t: 0 }] }));
    await api(`/edits/${editId}/timeline`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tl) });
    await page.goto(`${BASE}/editor/${editId}`);
    await page.getByTestId("preview-canvas").waitFor();
    await page.waitForFunction(() => window.__clipforgePreview?.media().videos.every((v) => v && v.ready >= 2) && window.__clipforgePreview.media().broll.every((b) => b.ready >= 2), null, { timeout: 30000 });
    // Mean absolute RGB difference between the live canvas and exporter stills, inside a region.
    const compare = (t, refs, region = [0, 0, 1, 1]) => page.evaluate(async ({ t, refs, region, eid }) => {
      const P = window.__clipforgePreview;
      P.editor.getState().setPlayhead(t);
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const m = P.media();
        if (i > 6 && m.videos.every((v) => !v.seeking) && m.broll.every((b) => !b.seeking)) break;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cv = document.querySelector("[data-testid=preview-canvas]");
      const w = 90;
      const h = Math.round((w * cv.height) / cv.width);
      const grab = (src) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d");
        x.drawImage(src, 0, 0, w, h);
        return x.getImageData(0, 0, w, h).data;
      };
      const live = grab(cv);
      const out = {};
      for (const rt of refs) {
        const img = new Image();
        img.src = `/api/edits/${eid}/frame?t=${rt}&width=540`;
        await img.decode();
        const ref = grab(img);
        let s = 0;
        let n = 0;
        for (let y = Math.floor(region[1] * h); y < Math.ceil(region[3] * h); y++) {
          for (let x = Math.floor(region[0] * w); x < Math.ceil(region[2] * w); x++) {
            const i = (y * w + x) * 4;
            s += Math.abs(live[i] - ref[i]) + Math.abs(live[i + 1] - ref[i + 1]) + Math.abs(live[i + 2] - ref[i + 2]);
            n += 3;
          }
        }
        out[rt] = s / n;
      }
      return out;
    }, { t, refs, region, eid: editId });
    // Mid-crossfade (u = 0.5): live must match the exported blend, not either side alone.
    const xf = await compare(3.0, [3.0, 2.3, 3.7]);
    console.log(`     crossfade diff: exact ${xf["3"].toFixed(2)}, vs outgoing-only ${xf["2.3"].toFixed(2)}, vs incoming-only ${xf["3.7"].toFixed(2)}`);
    assert(xf["3"] < 8 && xf["3"] < 0.6 * Math.min(xf["2.3"], xf["3.7"]), `live crossfade does not match export: ${JSON.stringify(xf)}`);
    await shot("11-crossfade");
    // B-roll region (picture-in-picture): live footage, not a placeholder.
    const ov = await compare(4.9, [4.9, 4.0], [0.1, 0.1, 0.6, 0.4]);
    console.log(`     B-roll region diff: exact ${ov["4.9"].toFixed(2)}, vs no-overlay ${ov["4"].toFixed(2)}`);
    assert(ov["4.9"] < 14 && ov["4.9"] < 0.5 * ov["4"], `live B-roll does not match export: ${JSON.stringify(ov)}`);
    await shot("11-broll");
    // Playback across the cut: second decoder takes over, music plays at its gain.
    await page.evaluate(() => window.__clipforgePreview.editor.getState().setPlayhead(1.8));
    await page.waitForTimeout(400);
    await page.getByTestId("play").click();
    const samples = [];
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(100);
      samples.push(await page.evaluate(() => ({ ...window.__clipforgePreview.media(), t: window.__clipforgePreview.editor.getState().playhead })));
    }
    await page.getByTestId("play").click();
    const both = samples.filter((m) => m.t > 2.55 && m.t < 3.45 && m.videos.every((v) => !v.paused));
    const last = samples[samples.length - 1];
    const music0 = last.audio[0];
    console.log(`     playback: t ${last.t.toFixed(2)}, dual-decoder samples ${both.length}, cuts ${JSON.stringify(last.cuts.map((c) => ({ swap: c.swap, drift: +c.drift.toFixed(3) })))}, music t ${music0.t.toFixed(2)} vol ${music0.volume.toFixed(3)}`);
    assert(last.t > 4, `playback did not reach the B clip (t=${last.t})`);
    assert(both.length >= 2, "second decoder never played during the crossfade");
    assert(last.cuts.length === 1 && last.cuts[0].handle && last.cuts[0].swap, `expected exactly one decoder swap at the cut: ${JSON.stringify(last.cuts)}`);
    assert(samples.every((m, i) => i === 0 || m.t >= samples[i - 1].t - 1e-3), "playhead moved backwards during playback");
    assert(!music0.error && music0.t > 2 && Math.abs(music0.t - last.t) < 0.5, `music not following the playhead: ${JSON.stringify(music0)}`);
    assert(Math.abs(music0.volume - 10 ** (-6 / 20)) < 0.02, `music volume ${music0.volume} != -6 dB`);
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
