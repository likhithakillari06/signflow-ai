/**
 * Coordinate conversion between "what the administrator sees" and PDF user space.
 *
 * Fields are stored as fractions (0..1) of the page *as displayed*: origin top-left, x to the
 * right, y downwards. That is independent of zoom, device pixel ratio and screen size.
 *
 * A PDF page, however, has its origin bottom-left, may be cropped (CropBox with a non-zero
 * origin) and may carry a /Rotate of 90/180/270 that the viewer applies clockwise. This module
 * maps one onto the other so a signature lands exactly where the field was drawn.
 */

export type Rotation = 0 | 90 | 180 | 270;

/** The visible box of a page in unrotated PDF user space, plus its display rotation. */
export type PageGeometry = {
  x0: number;
  y0: number;
  width: number;
  height: number;
  rotation: Rotation;
};

/** A rectangle in display fractions (0..1), origin top-left. */
export type NormRect = { x: number; y: number; width: number; height: number };

/** A rectangle in display points (1/72 inch), origin top-left of the displayed page. */
export type DisplayRect = { u: number; v: number; w: number; h: number };

/** Where and how to draw with pdf-lib so content appears upright inside a display rectangle. */
export type Placement = { x: number; y: number; width: number; height: number; rotateDegrees: Rotation };

export function normalizeRotation(angle: number): Rotation {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return a as Rotation;
}

/** Size of the page as a viewer shows it (width/height swap for 90° and 270°). */
export function displaySize(g: PageGeometry): { width: number; height: number } {
  return g.rotation === 90 || g.rotation === 270
    ? { width: g.height, height: g.width }
    : { width: g.width, height: g.height };
}

/** Display point (points from the top-left of the displayed page) -> PDF user space. */
export function displayToPdfPoint(g: PageGeometry, u: number, v: number): { x: number; y: number } {
  switch (g.rotation) {
    case 0:
      return { x: g.x0 + u, y: g.y0 + g.height - v };
    case 90:
      return { x: g.x0 + v, y: g.y0 + u };
    case 180:
      return { x: g.x0 + g.width - u, y: g.y0 + v };
    case 270:
      return { x: g.x0 + g.width - v, y: g.y0 + g.height - u };
  }
}

/** PDF user space -> display point. Inverse of displayToPdfPoint. */
export function pdfToDisplayPoint(g: PageGeometry, x: number, y: number): { u: number; v: number } {
  switch (g.rotation) {
    case 0:
      return { u: x - g.x0, v: g.y0 + g.height - y };
    case 90:
      return { u: y - g.y0, v: x - g.x0 };
    case 180:
      return { u: g.x0 + g.width - x, v: y - g.y0 };
    case 270:
      return { u: g.y0 + g.height - y, v: g.x0 + g.width - x };
  }
}

export function normToDisplayRect(g: PageGeometry, r: NormRect): DisplayRect {
  const d = displaySize(g);
  return { u: r.x * d.width, v: r.y * d.height, w: r.width * d.width, h: r.height * d.height };
}

/**
 * pdf-lib draws images/text from their bottom-left corner and rotates counter-clockwise around
 * that point. To look upright on a page the viewer rotates clockwise by R, the content is drawn
 * rotated counter-clockwise by R, anchored at the display rectangle's bottom-left corner.
 */
export function placementForDisplayRect(g: PageGeometry, d: DisplayRect): Placement {
  const anchor = displayToPdfPoint(g, d.u, d.v + d.h);
  return { x: anchor.x, y: anchor.y, width: d.w, height: d.h, rotateDegrees: g.rotation };
}

/** Largest rectangle with the given aspect ratio that fits inside `box`, centred. */
export function containRect(box: DisplayRect, contentWidth: number, contentHeight: number, padding = 0): DisplayRect {
  const availW = Math.max(box.w - padding * 2, 1);
  const availH = Math.max(box.h - padding * 2, 1);
  const scale = Math.min(availW / contentWidth, availH / contentHeight);
  const w = contentWidth * scale;
  const h = contentHeight * scale;
  return { u: box.u + (box.w - w) / 2, v: box.v + (box.h - h) / 2, w, h };
}

/** Keep a rectangle inside the page and above a minimum size. Used by the editor. */
export function clampNormRect(r: NormRect, min = 0.01): NormRect {
  const width = Math.min(Math.max(r.width, min), 1);
  const height = Math.min(Math.max(r.height, min), 1);
  const x = Math.min(Math.max(r.x, 0), 1 - width);
  const y = Math.min(Math.max(r.y, 0), 1 - height);
  return { x, y, width, height };
}

/** Browser pixels (relative to the rendered page element) -> stored fractions. */
export function pixelsToNorm(px: { left: number; top: number; width: number; height: number }, rendered: { width: number; height: number }): NormRect {
  return {
    x: px.left / rendered.width,
    y: px.top / rendered.height,
    width: px.width / rendered.width,
    height: px.height / rendered.height,
  };
}

export function normToPixels(r: NormRect, rendered: { width: number; height: number }) {
  return {
    left: r.x * rendered.width,
    top: r.y * rendered.height,
    width: r.width * rendered.width,
    height: r.height * rendered.height,
  };
}
