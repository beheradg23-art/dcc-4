import React, { useEffect, useRef } from 'react';

// A lightweight, self-contained reimplementation of Magic UI's "Glyph
// Matrix" (https://magicui.design/docs/components/glyph-matrix): a canvas
// grid of monospace glyphs that quietly mutate over time, fading out toward
// the bottom. No external deps (no `motion`, no shadcn registry) — just
// canvas + rAF, matching this project's existing "no framer-motion" stack.
//
// Same public prop surface as the Magic UI original so it drops in the
// same way: glyphs / cellSize / mutationRate / interval / fadeBottom / color.
//
// Perf note: every tick only repaints the cells that actually mutated
// (mutationRate is ~4% by default) instead of clearing + redrawing the
// whole grid. A full-panel redraw means thousands of fillText() calls
// ~11x/sec, which is what was causing the visible jank — this cuts that
// down to a couple dozen calls per tick.

interface GlyphMatrixProps {
  /** Characters to randomly pick from. */
  glyphs?: string;
  /** Cell size in pixels and font size. */
  cellSize?: number;
  /** Probability a cell mutates each tick. */
  mutationRate?: number;
  /** Tick interval in milliseconds. */
  interval?: number;
  /** Classes applied to the canvas element. */
  className?: string;
  /** Fade strength toward the bottom of the grid (0–1). */
  fadeBottom?: number;
  /** Glyph color — any CSS color. */
  color?: string;
}

const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';
// Small margin cleared around each cell before repainting it, so glyphs
// with a bit of side-bearing overhang (e.g. "\", "<", ">") never leave a
// ghost sliver behind from the previous frame.
const CLEAR_PAD = 2;

export function GlyphMatrix({
  glyphs = '01·•+*/\\<>=',
  cellSize = 14,
  mutationRate = 0.04,
  interval = 90,
  className = '',
  fadeBottom = 0.6,
  color = '#6B7280',
}: GlyphMatrixProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chars = glyphs.length ? glyphs.split('') : ['·'];
    const pick = () => chars[(Math.random() * chars.length) | 0];

    let cols = 0;
    let rows = 0;
    let grid: string[] = [];
    let rowAlpha: number[] = [];
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    const alphaForRow = (r: number) => Math.max(0, Math.min(1, 1 - fadeBottom * (r / Math.max(1, rows - 1))));

    // Repaints a single cell in place: clear its small patch, then draw
    // its (possibly new) glyph at the row's fixed fade alpha.
    const paintCell = (idx: number) => {
      const r = (idx / cols) | 0;
      const c = idx % cols;
      const x = c * cellSize;
      const y = r * cellSize;
      ctx.clearRect(x - CLEAR_PAD, y - CLEAR_PAD, cellSize + CLEAR_PAD * 2, cellSize + CLEAR_PAD * 2);
      ctx.globalAlpha = rowAlpha[r];
      ctx.fillText(grid[idx], x, y);
    };

    const fullPaint = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < grid.length; i++) {
        const r = (i / cols) | 0;
        ctx.globalAlpha = rowAlpha[r];
        ctx.fillText(grid[i], (i % cols) * cellSize, r * cellSize);
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : canvas.clientWidth;
      const h = parent ? parent.clientHeight : canvas.clientHeight;
      if (w === 0 || h === 0) return;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      cols = Math.ceil(w / cellSize) + 1;
      rows = Math.ceil(h / cellSize) + 1;
      grid = Array.from({ length: cols * rows }, pick);
      rowAlpha = Array.from({ length: rows }, (_, r) => alphaForRow(r));

      // Resizing the backing buffer resets all canvas state, so the DPR
      // transform + font/baseline/fill need to be reapplied before the
      // one-time full paint. Every tick after this only touches whichever
      // cells mutate.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cellSize}px ${FONT_STACK}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      fullPaint();
    };

    resize();

    let raf = 0;
    let last = 0;
    let stopped = false;

    const tick = (t: number) => {
      if (stopped) return;
      if (t - last >= interval) {
        last = t;
        for (let i = 0; i < grid.length; i++) {
          if (Math.random() < mutationRate) {
            grid[i] = pick();
            paintCell(i);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [glyphs, cellSize, mutationRate, interval, fadeBottom, color]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}

export default GlyphMatrix;