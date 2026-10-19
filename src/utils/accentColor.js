function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

// Pure, so it can be tested without a canvas. `data` is RGBA pixel data.
export function accentFromPixels(data) {
  if (!data || data.length < 4) return null;
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.25 || l < 0.15 || l > 0.9) continue;      // skip greys, near-black and near-white
    const w = s * (1 - Math.abs(2 * l - 1));
    const bucket = buckets[Math.min(23, Math.floor(h / 15))];
    bucket.w += w;
    bucket.r += data[i] * w; bucket.g += data[i + 1] * w; bucket.b += data[i + 2] * w;
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < (data.length / 4) * 0.01) return null;    // art has no real colour
  const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
  const sat = Math.min(0.9, Math.max(0.6, s));
  return `hsl(${Math.round(h)} ${Math.round(sat * 100)}% 68%)`;
}

// Consume a blob URL leased from the existing artwork pool, so authorization,
// request deduplication and artwork lifetime stay with the normal image loader.
const colors = new Map();
const MAX_COLORS = 64;
export function accentFromImage(url, { signal } = {}) {
  if (!url || signal?.aborted) return Promise.resolve(null);
  if (colors.has(url)) return Promise.resolve(colors.get(url));
  return new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';
    let finished = false;
    const finish = (color, cache = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      if (cache && !signal?.aborted) {
        colors.set(url, color);
        if (colors.size > MAX_COLORS) colors.delete(colors.keys().next().value);
      }
      resolve(color);
    };
    const abort = () => finish(null);
    const timer = setTimeout(abort, 5000);
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, 32, 32);
        finish(accentFromPixels(context.getImageData(0, 0, 32, 32).data), true);
      } catch (_) { finish(null); }
    };
    image.onerror = abort;
    image.src = url;
  });
}

