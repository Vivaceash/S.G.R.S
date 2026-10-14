import React, { useEffect, useRef } from 'react';

// Decorative character field: no images, network requests or login state.
export function LoginWaves() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = -Infinity, width = 0, height = 0;
    let phase = 0, previous = null;
    let calendar = { x: 0, y: 0, radius: 0 };
    let intro = null;
    let columns = [];
    const rowStep = 16;
    const glyphs = '~=-.:·';
    // Rasterize each glyph once, rather than shape thousands of strings/frame.
    const atlas = document.createElement('canvas');
    atlas.width = glyphs.length * 16; atlas.height = 40;
    const ink = atlas.getContext('2d');
    if (!ink) return undefined;
    ink.font = '12px ui-monospace, Consolas, monospace';
    ink.textAlign = 'center';
    for (let color = 0; color < 2; color++) {
      ink.fillStyle = color ? '#a07335' : '#691834';
      for (let i = 0; i < glyphs.length; i++) ink.fillText(glyphs[i], i * 16 + 8, color * 20 + 14);
    }
    const paint = time => {
      frame = 0;
      if (document.hidden) { previous = null; return; }
      if (time - last >= 40 || motion.matches) {
        if (previous !== null && !motion.matches) phase += Math.min(time - previous, 100) * .00035;
        previous = time;
        last = time;
        context.clearRect(0, 0, width, height);
        for (const { x, u, mask } of columns) {
          for (let band = 0; band < 6; band++) {
            const crest = height * (.10 + band * .16)
              + Math.sin(u * 7.5 - phase + band * .9) * height * .055
              + Math.sin(u * 14 + phase * .7 + band) * height * .02;
            const shimmer = .65 + .35 * Math.sin(u * 9 + phase + band);
            for (let row = -2; row <= 2; row++) {
              const cell = Math.round(crest / rowStep) + row;
              const clearance = mask[cell] || 0;
              if (!clearance) continue;
              const y = cell * rowStep;
              const strength = clearance * (1 - Math.abs(row) / 3) * shimmer;
              const chars = row === 0 ? '~=~-' : row % 2 ? '.:-' : '.·:';
              const char = chars[Math.floor(x / 16 + phase * 3 + band + row + 20) % chars.length];
              context.globalAlpha = strength * (band % 2 ? .48 : .38);
              context.drawImage(atlas, glyphs.indexOf(char) * 16, (band % 2) * 20, 16, 20, x - 8, y - 14, 16, 20);
            }
          }
        }
        context.globalAlpha = 1;
      }
      if (!motion.matches) frame = requestAnimationFrame(paint);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      previous = null;
      last = -Infinity;
      frame = requestAnimationFrame(paint);
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width; height = box.height;
      const decoration = getComputedStyle(canvas.parentElement, '::before');
      const size = parseFloat(decoration.width) || 0;
      calendar = {
        x: (parseFloat(decoration.left) || 0) + size / 2,
        y: height - (parseFloat(decoration.bottom) || 0) - size / 2,
        radius: size / 2,
      };
      const text = canvas.parentElement.querySelector('.login-intro');
      const textBox = text?.getBoundingClientRect();
      intro = textBox?.width ? { left: textBox.left - box.left, right: textBox.right - box.left, top: textBox.top - box.top, bottom: textBox.bottom - box.top } : null;
      const panel = canvas.parentElement.querySelector('.login-panel')?.getBoundingClientRect();
      const cellCount = Math.ceil(height / rowStep) + 1;
      columns = [];
      for (let x = 0; x < width; x += width < 600 ? 20 : 16) {
        const mask = new Float32Array(cellCount);
        for (let cell = 0; cell < cellCount; cell++) {
          const y = cell * rowStep;
          if (intro && x > intro.left - 20 && x < intro.right + 20 && y > intro.top - 20 && y < intro.bottom + 20) continue;
          if (panel && x > panel.left - box.left - 20 && x < panel.right - box.left + 20 && y > panel.top - box.top - 20 && y < panel.bottom - box.top + 20) continue;
          mask[cell] = Math.max(0, Math.min(1, (Math.hypot(x - calendar.x, y - calendar.y) - calendar.radius - 25) / 55));
        }
        columns.push({ x, u: x / Math.max(width, 1), mask });
      }
      // Decorative pixels do not need the device's high-DPI backing buffer.
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      restart();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    motion.addEventListener('change', restart);
    document.addEventListener('visibilitychange', restart);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', restart);
      document.removeEventListener('visibilitychange', restart);
    };
  }, []);
  return <canvas ref={canvasRef} className="login-ascii-waves" aria-hidden="true" />;
}
