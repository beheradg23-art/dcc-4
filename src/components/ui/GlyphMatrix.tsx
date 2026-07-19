import React, { useEffect, useRef } from 'react';

// A lightweight, self-contained reimplementation of Magic UI's "Glyph
// Matrix" (https://magicui.design/docs/components/glyph-matrix): a canvas
// grid of monospace glyphs that quietly mutate over time, fading out toward
// the bottom. No external deps (no `motion`, no shadcn registry) — just
// canvas + rAF, matching this project's existing "no framer-motion" stack.
//
// Same public prop surface as the Magic UI original so it drops in the
// same way: glyphs / cellSize / mutationRate / interval / fadeBottom / color.

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
    let dpr = Math.max(1, window.devicePixelRatio || 1);

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
    };

    resize();

    const draw = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${cellSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      for (let r = 0; r < rows; r++) {
        const fade = 1 - fadeBottom * (r / Math.max(1, rows - 1));
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        for (let c = 0; c < cols; c++) {
          ctx.fillText(grid[r * cols + c], c * cellSize, r * cellSize);
        }
      }
      ctx.restore();
    };

    let raf = 0;
    let last = 0;
    let stopped = false;

    const tick = (t: number) => {
      if (stopped) return;
      if (t - last >= interval) {
        last = t;
        for (let i = 0; i < grid.length; i++) {
          if (Math.random() < mutationRate) grid[i] = pick();
        }
        draw();
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
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
