import { useEditor } from "./store";
import { makeTimeline } from "@/test/fixtures";
import { segments, sourceToTimeline, timelineDuration } from "./geometry";

const st = () => useEditor.getState();

describe("editor store (timeline editing)", () => {
  beforeEach(() => st().load(makeTimeline()));

  it("lays out clips contiguously", () => {
    expect(timelineDuration(st().timeline!)).toBeCloseTo(9);
    expect(st().timeline!.clips[1].start).toBeCloseTo(4);
  });

  it("splits at the playhead preserving source mapping, and undo/redo restore it", () => {
    st().setPlayhead(6);
    expect(st().splitAtPlayhead()).toBe(true);
    const c = st().timeline!.clips;
    expect(c).toHaveLength(3);
    expect(c[1].src_out).toBeCloseTo(17);
    expect(c[2].src_in).toBeCloseTo(17);
    expect(c[2].effects[0].type).toBe("zoom"); // effects follow the material
    expect(timelineDuration(st().timeline!)).toBeCloseTo(9);
    st().undo();
    expect(st().timeline!.clips).toHaveLength(2);
    st().redo();
    expect(st().timeline!.clips).toHaveLength(3);
  });

  it("deletes the selected clip (ripple on the main track)", () => {
    st().select({ kind: "clip", id: "c1" });
    st().deleteSelection(true);
    expect(st().timeline!.clips.map((c) => c.id)).toEqual(["c2"]);
    expect(st().timeline!.clips[0].start).toBe(0);
  });

  it("ripple-deletes text layers and shifts later ones", () => {
    st().setPlayhead(1);
    st().addText("title", "A");
    st().setPlayhead(5);
    st().addText("title", "B");
    const [a, b] = st().timeline!.texts;
    st().select({ kind: "text", id: a.id });
    st().deleteSelection(true);
    const left = st().timeline!.texts;
    expect(left).toHaveLength(1);
    expect(left[0].start).toBeCloseTo(b.start - (a.end - a.start));
  });

  it("trims via commit and records a single history entry for a drag gesture", () => {
    const before = st().past.length;
    st().beginGesture();
    for (const v of [10.2, 10.4, 10.6]) st().commit((t) => { t.clips[0].src_in = v; }, { history: false });
    st().commit(() => {}, { history: true });
    expect(st().timeline!.clips[0].src_in).toBeCloseTo(10.6);
    expect(st().past.length).toBe(before + 1);
    st().undo();
    expect(st().timeline!.clips[0].src_in).toBeCloseTo(10);
  });

  it("adds effects, markers and graphics at the playhead", () => {
    st().setPlayhead(5);
    st().addEffect("blur");
    expect(st().timeline!.clips[1].effects.map((e) => e.type)).toContain("blur");
    st().addMarker();
    expect(st().timeline!.markers[0].t).toBeCloseTo(5);
    st().addGraphic("arrow");
    expect(st().timeline!.graphics[0].kind).toBe("arrow");
  });

  it("maps caption words through cuts", () => {
    const segs = segments(st().timeline!);
    expect(sourceToTimeline(segs, 15.2, 15.6)![0]).toBeCloseTo(4.2);
    expect(sourceToTimeline(segs, 14.2, 14.6)).toBeNull(); // removed by the cut
  });
});

describe("text placement", () => {
  it("does not place a new text layer on top of an existing one", () => {
    useEditor.getState().load(makeTimeline());
    useEditor.getState().setPlayhead(0);
    useEditor.getState().addText("hook", "Hook");
    useEditor.getState().addText("title", "Title");
    const [a, b] = useEditor.getState().timeline!.texts;
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(0.09);
  });
});

describe("keyframes, envelopes and track selection", () => {
  beforeEach(() => useEditor.getState().load(makeTimeline()));

  it("deletes a crop keyframe (never the last one) and switches to manual", () => {
    const st = useEditor.getState();
    st.commit((t) => { t.reframe.panels[0].keyframes.push({ t: 3, cx: 0.2, cy: 0.5, zoom: 1.2, ease: "linear" }); });
    st.select({ kind: "keyframe", panel: "main", index: 1 });
    st.deleteSelection(false);
    expect(useEditor.getState().timeline!.reframe.panels[0].keyframes).toHaveLength(1);
    expect(useEditor.getState().timeline!.reframe.mode).toBe("manual");
    st.select({ kind: "keyframe", panel: "main", index: 0 });
    st.deleteSelection(false);
    expect(useEditor.getState().timeline!.reframe.panels[0].keyframes).toHaveLength(1);
  });

  it("removes envelope points and ignores non-deletable selections", () => {
    const st = useEditor.getState();
    st.commit((t) => { t.clips[0].envelope = [{ t: 0.5, gain_db: -6 }, { t: 1.5, gain_db: 0 }]; });
    st.select({ kind: "envpoint", owner: "clip", id: "c1", index: 0 });
    st.deleteSelection(false);
    expect(useEditor.getState().timeline!.clips[0].envelope).toEqual([{ t: 1.5, gain_db: 0 }]);
    const before = useEditor.getState().past.length;
    st.select({ kind: "track", id: "a1" });
    st.deleteSelection(false);
    st.select({ kind: "captions" });
    st.deleteSelection(false);
    expect(useEditor.getState().past.length).toBe(before);
  });
});
