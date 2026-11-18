import fixtures from "../../../shared/geometry_fixtures.json";
import { colorMatrixRGB, cropRect, fitZoom, interpKeyframes } from "./geometry";
import type { CropKeyframe } from "@/lib/types";

// The same fixture file is asserted by backend/tests/test_unit_core.py, so the
// browser preview and the Python renderer compute identical geometry and colour.
describe("geometry parity with the Python renderer", () => {
  it("crop rectangles match", () => {
    for (const c of fixtures.crop) {
      const [cx, cy, z, w, h, a] = c.args as number[];
      const r = cropRect(cx, cy, z, w, h, a);
      r.forEach((v, i) => expect(v).toBeCloseTo(c.rect[i], 4));
    }
  });
  it("fit zoom matches", () => {
    const f = fixtures.fit_zoom[0];
    expect(fitZoom(f.args[0], f.args[1], f.args[2])).toBeCloseTo(f.value, 5);
  });
  it("keyframe interpolation and easing match", () => {
    for (const p of fixtures.interp) {
      const v = interpKeyframes(fixtures.keyframes as CropKeyframe[], p.t);
      v.forEach((x, i) => expect(x).toBeCloseTo(p.value[i], 5));
    }
  });
  it("colour matrices match (BGR vs RGB order)", () => {
    for (const c of fixtures.color) {
      const [e, k, s, t] = c.args;
      const rgb = colorMatrixRGB(e, k, s, t)!;
      const bgr = c.matrix_bgr;
      // Python stores rows/cols in BGR order; reverse both for RGB.
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) expect(rgb[i][j]).toBeCloseTo(bgr[2 - i][2 - j], 4);
        expect(rgb[i][3]).toBeCloseTo(bgr[2 - i][3], 3);
      }
    }
  });
});
