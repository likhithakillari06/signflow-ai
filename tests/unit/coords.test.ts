import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  clampNormRect, containRect, displaySize, displayToPdfPoint, normToDisplayRect, normToPixels, normalizeRotation, pdfToDisplayPoint,
  pixelsToNorm, placementForDisplayRect, type PageGeometry, type Rotation,
} from "@/lib/pdf/coords";
import { pageGeometry } from "@/lib/pdf/inspect";

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe("displayToPdfPoint", () => {
  const letter: PageGeometry = { x0: 0, y0: 0, width: 612, height: 792, rotation: 0 };

  it("flips the y axis on an unrotated page", () => {
    expect(displayToPdfPoint(letter, 0, 0)).toEqual({ x: 0, y: 792 });
    expect(displayToPdfPoint(letter, 612, 792)).toEqual({ x: 612, y: 0 });
    expect(displayToPdfPoint(letter, 100, 200)).toEqual({ x: 100, y: 592 });
  });

  it("maps the displayed top-left corner to the right PDF corner for every rotation", () => {
    const g = (rotation: Rotation): PageGeometry => ({ ...letter, rotation });
    expect(displayToPdfPoint(g(0), 0, 0)).toEqual({ x: 0, y: 792 }); // top-left of the sheet
    expect(displayToPdfPoint(g(90), 0, 0)).toEqual({ x: 0, y: 0 }); // bottom-left of the sheet
    expect(displayToPdfPoint(g(180), 0, 0)).toEqual({ x: 612, y: 0 }); // bottom-right
    expect(displayToPdfPoint(g(270), 0, 0)).toEqual({ x: 612, y: 792 }); // top-right
  });

  it("respects a crop box that does not start at the origin", () => {
    const cropped: PageGeometry = { x0: 50, y0: 80, width: 400, height: 500, rotation: 0 };
    expect(displayToPdfPoint(cropped, 0, 0)).toEqual({ x: 50, y: 580 });
    expect(displayToPdfPoint(cropped, 400, 500)).toEqual({ x: 450, y: 80 });
  });

  it("round-trips through pdfToDisplayPoint for every rotation and a shifted crop box", () => {
    for (const rotation of ROTATIONS) {
      const g: PageGeometry = { x0: 30, y0: 45, width: 500, height: 700, rotation };
      const d = displaySize(g);
      for (const [u, v] of [[0, 0], [d.width, d.height], [123.4, 56.7], [d.width / 3, d.height * 0.9]]) {
        const p = displayToPdfPoint(g, u, v);
        const back = pdfToDisplayPoint(g, p.x, p.y);
        expect(back.u).toBeCloseTo(u, 9);
        expect(back.v).toBeCloseTo(v, 9);
      }
    }
  });

  it("agrees with PDF.js, the library that draws the preview", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const rotation of ROTATIONS) {
      for (const crop of [undefined, [40, 60, 300, 420] as [number, number, number, number]]) {
        const doc = await PDFDocument.create();
        const page = doc.addPage([595, 842]);
        page.setRotation(degrees(rotation));
        if (crop) page.setCropBox(...crop);
        const bytes = await doc.save();

        const reloaded = await PDFDocument.load(bytes);
        const g = pageGeometry(reloaded.getPage(0));
        const js = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
        const viewport = (await js.getPage(1)).getViewport({ scale: 1 });

        const d = displaySize(g);
        expect(d.width).toBeCloseTo(viewport.width, 6);
        expect(d.height).toBeCloseTo(viewport.height, 6);
        for (const [u, v] of [[0, 0], [10, 20], [d.width, d.height], [d.width * 0.37, d.height * 0.81]]) {
          const mine = displayToPdfPoint(g, u, v);
          const [x, y] = viewport.convertToPdfPoint(u, v);
          expect(mine.x).toBeCloseTo(x, 6);
          expect(mine.y).toBeCloseTo(y, 6);
        }
        await js.destroy();
      }
    }
  });
});

describe("displaySize and rotation", () => {
  it("swaps width and height for quarter turns", () => {
    expect(displaySize({ x0: 0, y0: 0, width: 612, height: 792, rotation: 90 })).toEqual({ width: 792, height: 612 });
    expect(displaySize({ x0: 0, y0: 0, width: 612, height: 792, rotation: 180 })).toEqual({ width: 612, height: 792 });
  });
  it("normalises odd rotation values", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(0)).toBe(0);
  });
});

describe("placementForDisplayRect", () => {
  it("anchors at the bottom-left of the box on an unrotated page", () => {
    const g: PageGeometry = { x0: 0, y0: 0, width: 612, height: 792, rotation: 0 };
    const p = placementForDisplayRect(g, { u: 100, v: 600, w: 200, h: 50 });
    expect(p).toEqual({ x: 100, y: 142, width: 200, height: 50, rotateDegrees: 0 });
  });

  it("covers exactly the intended display rectangle for every rotation", () => {
    for (const rotation of ROTATIONS) {
      const g: PageGeometry = { x0: 20, y0: 10, width: 600, height: 800, rotation };
      const box = { u: 120, v: 300, w: 180, h: 40 };
      const p = placementForDisplayRect(g, box);
      // Corners of what pdf-lib will draw: anchor + rotated width/height vectors.
      const rad = (p.rotateDegrees * Math.PI) / 180;
      const wx = Math.cos(rad) * p.width, wy = Math.sin(rad) * p.width;
      const hx = -Math.sin(rad) * p.height, hy = Math.cos(rad) * p.height;
      const corners = [[p.x, p.y], [p.x + wx, p.y + wy], [p.x + hx, p.y + hy], [p.x + wx + hx, p.y + wy + hy]].map(([x, y]) => pdfToDisplayPoint(g, x, y));
      const us = corners.map((c) => c.u), vs = corners.map((c) => c.v);
      expect(Math.min(...us)).toBeCloseTo(box.u, 6);
      expect(Math.max(...us)).toBeCloseTo(box.u + box.w, 6);
      expect(Math.min(...vs)).toBeCloseTo(box.v, 6);
      expect(Math.max(...vs)).toBeCloseTo(box.v + box.h, 6);
      // Upright: the bottom-left corner of the content is the bottom-left of the box on screen.
      expect(corners[0].u).toBeCloseTo(box.u, 6);
      expect(corners[0].v).toBeCloseTo(box.v + box.h, 6);
    }
  });
});

describe("normalised rectangles", () => {
  it("are independent of zoom: pixels -> fractions -> pixels at another size", () => {
    const stored = pixelsToNorm({ left: 150, top: 400, width: 200, height: 50 }, { width: 800, height: 1035 });
    const zoomed = normToPixels(stored, { width: 1600, height: 2070 });
    expect(zoomed.left).toBeCloseTo(300, 9);
    expect(zoomed.top).toBeCloseTo(800, 9);
    expect(zoomed.width).toBeCloseTo(400, 9);
    expect(zoomed.height).toBeCloseTo(100, 9);
  });
  it("convert to points using the displayed (rotated) page size", () => {
    const landscapeByRotation: PageGeometry = { x0: 0, y0: 0, width: 612, height: 792, rotation: 90 };
    expect(normToDisplayRect(landscapeByRotation, { x: 0.5, y: 0.5, width: 0.25, height: 0.1 })).toEqual({ u: 396, v: 306, w: 198, h: 61.2 });
  });
  it("clamp keeps a field on the page", () => {
    expect(clampNormRect({ x: 0.95, y: -0.2, width: 0.2, height: 0.1 })).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.1 });
    const tiny = clampNormRect({ x: 0.5, y: 0.5, width: 0, height: 0 });
    expect(tiny.width).toBeGreaterThan(0);
  });
  it("containRect keeps aspect ratio and centres", () => {
    const r = containRect({ u: 0, v: 0, w: 200, h: 50 }, 100, 100);
    expect(r).toEqual({ u: 75, v: 0, w: 50, h: 50 });
  });
});
