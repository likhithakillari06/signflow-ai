"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { AlertTriangle, Loader2 } from "lucide-react";

/** Size of a page as displayed (PDF points, rotation already applied). */
export type PageInfo = { pageNumber: number; width: number; height: number };

type Props = {
  /** Returns the PDF bytes. Called once. */
  load: () => Promise<ArrayBuffer>;
  maxWidth?: number;
  renderOverlay?: (page: PageInfo) => ReactNode;
  onLoaded?: (pages: PageInfo[]) => void;
};

/**
 * Renders every page of a PDF with PDF.js, stacked vertically and scaled to the container.
 * Each page gets an absolutely-positioned overlay the same size as the page, so anything
 * placed in it with percentages lines up with the document at any zoom or screen size.
 */
export function PdfPages({ load, maxWidth = 880, renderOverlay, onLoaded }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const [pdfjs, data] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), loadRef.current()]);
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({
          data: new Uint8Array(data), isEvalSupported: false,
          cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        loaded = pdf;
        const infos: PageInfo[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          infos.push({ pageNumber: n, width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setDoc(pdf);
        setPages(infos);
        onLoadedRef.current?.(infos);
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setError(
          name === "PasswordException"
            ? "This PDF is password-protected and cannot be displayed."
            : "The document could not be displayed. Reload the page to try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth, maxWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  return (
    <div ref={wrapper} className="w-full" data-testid="pdf-pages" data-loaded={doc ? "true" : "false"}>
      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center text-sm text-red-900" role="alert">
          <AlertTriangle className="size-5" /> {error}
        </div>
      ) : !doc || width === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Loading document…
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5">
          {pages.map((p) => {
            const h = (width * p.height) / p.width;
            return (
              <div key={p.pageNumber} className="w-full" style={{ maxWidth: width }}>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Page {p.pageNumber} of {pages.length}</div>
                <div
                  className="relative overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-slate-200"
                  style={{ width, height: h }}
                  data-testid={`pdf-page-${p.pageNumber}`}
                  data-page-width={p.width}
                  data-page-height={p.height}
                >
                  <PageCanvas doc={doc} info={p} cssWidth={width} />
                  <div className="absolute inset-0">{renderOverlay?.(p)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PageCanvas({ doc, info, cssWidth }: { doc: PDFDocumentProxy; info: PageInfo; cssWidth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // Only paint pages near the viewport: long agreements stay fast and light on memory.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(info.pageNumber);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / info.width) * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport });
      try {
        await task.promise;
        canvas.dataset.rendered = "true";
      } catch {
        // cancelled by a re-render
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, info.pageNumber, info.width, cssWidth, visible]);

  return <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Page ${info.pageNumber}`} />;
}

/** Fetches a private document: asks our API for a short-lived URL, then downloads the bytes. */
export async function fetchDocumentBytes(getUrl: () => Promise<string>): Promise<ArrayBuffer> {
  const url = await getUrl();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Document download failed (${res.status})`);
  return res.arrayBuffer();
}
