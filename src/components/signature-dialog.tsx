"use client";
import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Adopted = { image: string; method: "drawn" | "typed" };

/** Crops a canvas to its ink and returns a compact transparent PNG data URL (or null if blank). */
function exportTrimmed(source: HTMLCanvasElement, maxWidth = 800): string | null {
  const ctx = source.getContext("2d");
  if (!ctx) return null;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return null;
  const pad = 6;
  left = Math.max(left - pad, 0); top = Math.max(top - pad, 0);
  right = Math.min(right + pad, width - 1); bottom = Math.min(bottom + pad, height - 1);
  const w = right - left + 1, h = bottom - top + 1;
  const scale = Math.min(1, maxWidth / w);
  const out = document.createElement("canvas");
  out.width = Math.max(Math.round(w * scale), 1);
  out.height = Math.max(Math.round(h * scale), 1);
  out.getContext("2d")!.drawImage(source, left, top, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

async function renderTyped(text: string): Promise<string | null> {
  const font = '600 96px "Dancing Script", "Brush Script MT", cursive';
  try { await document.fonts.load(font, text); } catch { /* fall back to whatever cursive font exists */ }
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d")!;
  measure.font = font;
  canvas.width = Math.ceil(measure.measureText(text).width) + 80;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.fillStyle = "#0f1738";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 40, 110);
  return exportTrimmed(canvas);
}

export function SignatureDialog({
  open, kind, suggestedText, onClose, onAdopt,
}: {
  open: boolean; kind: "signature" | "initials"; suggestedText: string; onClose: () => void; onAdopt: (a: Adopted) => void;
}) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(suggestedText);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => { if (open) { setTyped(suggestedText); setError(null); } }, [open, suggestedText]);

  // The canvas only exists while the dialog is open and the Draw tab is showing.
  const attach = (canvas: HTMLCanvasElement | null) => {
    if (canvas === canvasRef.current) return;
    padRef.current?.off();
    padRef.current = null;
    canvasRef.current = canvas;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(rect.width, 200) * ratio;
    canvas.height = Math.max(rect.height, 120) * ratio;
    canvas.getContext("2d")!.scale(ratio, ratio);
    padRef.current = new SignaturePad(canvas, { penColor: "#0f1738", minWidth: 0.8, maxWidth: 2.6 });
  };

  const adopt = async () => {
    setError(null);
    if (tab === "draw") {
      const pad = padRef.current;
      const canvas = canvasRef.current;
      if (!pad || !canvas || pad.isEmpty()) { setError(`Please draw your ${kind} in the box first.`); return; }
      const image = exportTrimmed(canvas);
      if (!image) { setError(`Please draw your ${kind} in the box first.`); return; }
      onAdopt({ image, method: "drawn" });
    } else {
      const text = typed.trim();
      if (!text) { setError(`Please type your ${kind === "signature" ? "name" : "initials"}.`); return; }
      const image = await renderTyped(text);
      if (!image) { setError("That could not be turned into a signature. Try drawing instead."); return; }
      onAdopt({ image, method: "typed" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="signature-dialog">
        <DialogHeader>
          <DialogTitle>{kind === "signature" ? "Add your signature" : "Add your initials"}</DialogTitle>
          <DialogDescription>Draw with your finger or mouse, or type and we will style it for you.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 rounded-lg bg-secondary p-1 text-sm font-medium">
          {(["draw", "type"] as const).map((t) => (
            <button key={t} type="button" data-testid={`sig-tab-${t}`} onClick={() => { setTab(t); setError(null); }} className={cn("rounded-md py-1.5", tab === t ? "bg-card shadow-sm" : "text-muted-foreground")}>
              {t === "draw" ? "Draw" : "Type"}
            </button>
          ))}
        </div>
        {tab === "draw" ? (
          <div>
            <canvas ref={attach} data-testid="signature-canvas" className="h-44 w-full touch-none rounded-lg border-2 border-dashed bg-white" aria-label="Signature drawing area" />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Sign inside the box</span>
              <button type="button" data-testid="sig-clear" className="inline-flex items-center gap-1 font-medium text-primary" onClick={() => { padRef.current?.clear(); setError(null); }}><Eraser className="size-3.5" /> Clear</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <Input value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} placeholder={kind === "signature" ? "Type your full name" : "Type your initials"} data-testid="sig-typed-input" aria-label="Typed signature" />
            <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-white px-4">
              <span className="whitespace-nowrap font-signature text-5xl text-[#0f1738]">{typed || " "}</span>
            </div>
          </div>
        )}
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={adopt} data-testid="sig-adopt">Use this {kind}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
