import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as TooltipP from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/components/ui";
import { JobRow } from "@/components/layout/JobsPanel";
import { Inspector } from "@/editor/Inspector";
import { useEditor } from "@/editor/store";
import HighlightsPage from "@/pages/HighlightsPage";
import NewProjectPage from "@/pages/NewProjectPage";
import ExportCentre from "@/pages/ExportCentre";
import { makeTimeline } from "./fixtures";
import type { Job } from "@/lib/types";

type Handler = (url: string, init?: RequestInit) => any;
let routes: Record<string, Handler> = {};
const calls: { url: string; method: string; body?: any }[] = [];

beforeEach(() => {
  routes = {};
  calls.length = 0;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return init.body; } })() : undefined });
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(" "); return m === method && url.split("?")[0] === p; });
    const data = key ? routes[key](url, init) : {};
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  });
});

function wrap(ui: React.ReactNode, path = "/", pattern = "*") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><TooltipP.Provider><ToastProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={ui} /></Routes></MemoryRouter>
    </ToastProvider></TooltipP.Provider></QueryClientProvider>,
  );
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "job_1", kind: "render", queue: "render", title: "Render clip", payload: {}, status: "running", stage: "compose", progress: 0.4,
  stages: [{ name: "compose", label: "Rendering video", weight: 1, status: "running", progress: 0.4 }], result: { log: [] }, attempts: 1,
  created_at: new Date().toISOString(), ...over,
});

describe("UI interactions", () => {
  it("cancels a running job", async () => {
    routes["POST /api/jobs/job_1/cancel"] = () => job({ status: "cancelled" });
    wrap(<JobRow job={job()} />);
    expect(screen.getAllByText("Rendering video").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs/job_1/cancel" && c.method === "POST")).toBe(true));
  });

  it("edits a caption word in the inspector", async () => {
    useEditor.getState().load(makeTimeline());
    useEditor.getState().select({ kind: "word", id: 2 });
    wrap(<Inspector onReframe={() => {}} />);
    const input = screen.getByTestId("word-input");
    await userEvent.clear(input);
    await userEvent.type(input, "world");
    expect(useEditor.getState().timeline!.captions.words[1].text).toBe("world");
    fireEvent.click(screen.getByText("Emphasise (accent colour)"));
    expect(useEditor.getState().timeline!.captions.words[1].emphasis).toBe(true);
  });

  it("edits a text overlay", async () => {
    useEditor.getState().load(makeTimeline());
    useEditor.getState().addText("title", "Hello");
    wrap(<Inspector onReframe={() => {}} />);
    const ta = screen.getByTestId("text-content");
    await userEvent.clear(ta);
    await userEvent.type(ta, "My title");
    expect(useEditor.getState().timeline!.texts[0].text).toBe("My title");
  });

  it("selects highlights and prepares edits", async () => {
    const hl = (id: string, rank: number, score: number) => ({
      id, project_id: "p1", source_id: "s1", rank, start: rank * 10, end: rank * 10 + 20, duration: 20, score, title: `Clip ${rank}`, topic: "money",
      hook: "Hook", reason: "Opens with a question", audience: "Everyone", issues: [], evidence: {}, transcript: "words", thumb_url: null, selected: false, edits: [],
      breakdown: { hook: { label: "Opening hook quality", points: 15, max: 20, raw: 0.75, evidence: ["Opens with a question"] } },
    });
    routes["GET /api/projects/p1"] = () => ({ id: "p1", name: "Proj", sources: [{ id: "s1", probe: { duration: 120 }, has_proxy: false }], summary: {} });
    routes["GET /api/projects/p1/highlights"] = () => [hl("h1", 1, 91), hl("h2", 2, 72)];
    routes["GET /api/projects/p1/analysis"] = () => ({ selection: { candidates: 50 }, summary: { topics: [] } });
    routes["PATCH /api/highlights/h2"] = () => ({});
    routes["POST /api/projects/p1/prepare-edits"] = () => job({ id: "job_p", kind: "prepare_edits" });
    wrap(<HighlightsPage />, "/projects/p1/highlights", "/projects/:pid/highlights");
    expect(await screen.findByText("Clip 1")).toBeInTheDocument();
    expect(screen.getAllByTestId("highlight-card")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Select Clip 2"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/highlights/h2" && c.body?.selected === true)).toBe(true));
    fireEvent.click(screen.getByTestId("prepare-edits"));
    fireEvent.click(await screen.findByRole("button", { name: "Prepare edits" }));
    await waitFor(() => {
      const c = calls.find((x) => x.url === "/api/projects/p1/prepare-edits");
      expect(c?.body.highlight_ids).toEqual(["h2"]);
    });
  });

  it("creates a project and uploads a dropped file", async () => {
    routes["POST /api/projects"] = () => ({ id: "p9", name: "episode" });
    const sent: any[] = [];
    class FakeXHR {
      upload: any = {};
      status = 200;
      responseText = JSON.stringify({ id: "s9" });
      headers: Record<string, string> = {};
      onload: any; onerror: any; onabort: any; url = "";
      open(_m: string, u: string) { this.url = u; }
      setRequestHeader(k: string, v: string) { this.headers[k] = v; }
      send(body: any) { sent.push({ url: this.url, body, headers: this.headers }); this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }); setTimeout(() => this.onload(), 0); }
      abort() {}
    }
    (globalThis as any).XMLHttpRequest = FakeXHR;
    wrap(<NewProjectPage />, "/new", "/new");
    const file = new File(["fake video bytes"], "episode_42.mp4", { type: "video/mp4" });
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.find((c) => c.url === "/api/projects")?.body).toEqual({ name: "episode 42" });
    expect(sent[0].url).toBe("/api/projects/p9/upload?filename=episode_42.mp4");
    expect(sent[0].headers["X-ClipForge-Client"]).toBe("1");
  });

  it("export settings estimate and render request", async () => {
    routes["GET /api/settings"] = () => ({ export_defaults: { preset: "social_hq", resolution: "1080p", codec: "h264", crf: 17, encoder_speed: "medium", hardware: "cpu", audio_bitrate_kbps: 192, burn_captions: true, export_srt: true }, defaults: { platform: "tiktok" }, storage: { exports_dir: "/x" } });
    routes["GET /api/export/presets"] = () => ({ presets: { social_hq: { label: "Social High Quality", codec: "h264" }, custom: { label: "Custom" } }, hardware: { encoders: {}, notes: [] } });
    routes["GET /api/library"] = () => ({ edits: [{ id: "e1", name: "Edit one", style: "dynamic", version: 1, project_id: "p1", aspect: "9:16", is_current: true, updated_at: new Date().toISOString() }] });
    routes["GET /api/renders"] = () => [];
    routes["GET /api/jobs"] = () => [];
    routes["POST /api/export/estimate"] = () => ({ width: 1080, height: 1920, fps: 30, duration: 20, estimated_bytes: 30e6, scale: { message: "1.78× upscale", is_upscaled: true }, blocked: false });
    routes["POST /api/renders"] = () => [{ render_id: "r1", job_id: "j1" }];
    wrap(<ExportCentre />, "/export?edits=e1", "/export");
    expect(await screen.findByTestId("estimate")).toHaveTextContent("1080×1920");
    fireEvent.click(screen.getByTestId("start-render"));
    await waitFor(() => {
      const c = calls.find((x) => x.url === "/api/renders" && x.method === "POST");
      expect(c?.body.edit_ids).toEqual(["e1"]);
      expect(c?.body.settings.preset).toBe("social_hq");
    });
  });
});
