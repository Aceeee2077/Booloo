/** Image preparation shared by the light settings preview and the pet window. */
interface LitePreparedImage {
  canvas: HTMLCanvasElement;
  bounds: { x: number; y: number; width: number; height: number };
  visiblePixels: number;
  cutoutApplied: boolean;
  cutoutRejected: boolean;
}

function liteLoadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error(liteT('lite.image.invalidSize')));
    image.onerror = () => reject(new Error(liteT('lite.image.unreadable')));
    image.src = url;
  });
}

function liteVisibleBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= 24) continue;
    count++;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { count, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } };
}

function litePrepareImage(image: HTMLImageElement, removeBackground: boolean): LitePreparedImage {
  const width = image.naturalWidth, height = image.naturalHeight;
  if (width * height > 16_000_000) throw new Error(liteT('lite.image.tooManyPixels'));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(liteT('lite.image.noPreview'));
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const original = liteVisibleBounds(pixels.data, width, height);
  if (original.count === 0) throw new Error(liteT('lite.image.allTransparent'));
  let cutoutApplied = false;
  let cutoutRejected = false;

  // Existing transparent art needs no keying. For opaque photos, use one border
  // reference colour: neighbour-to-neighbour flood fill can walk through a pet
  // with a soft gradient and erase the entire subject.
  if (removeBackground && original.count > width * height * 0.95) {
    const data = pixels.data;
    const corners = [0, width - 1, (height - 1) * width, width * height - 1];
    const channels = [0, 1, 2].map((channel) =>
      Math.round(corners.reduce((sum, index) => sum + data[index * 4 + channel], 0) / 4));
    const nearBackground = (index: number) => {
      const offset = index * 4;
      const dr = data[offset] - channels[0];
      const dg = data[offset + 1] - channels[1];
      const db = data[offset + 2] - channels[2];
      return dr * dr + dg * dg + db * db < 48 * 48;
    };
    const marked = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0, tail = 0;
    const seed = (index: number) => {
      if (marked[index] || !nearBackground(index)) return;
      marked[index] = 1; queue[tail++] = index;
    };
    for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { seed(y * width); seed(y * width + width - 1); }
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      if (x > 0) seed(index - 1);
      if (x + 1 < width) seed(index + 1);
      if (y > 0) seed(index - width);
      if (y + 1 < height) seed(index + width);
    }
    const candidate = new Uint8ClampedArray(data);
    for (let i = 0; i < marked.length; i++) if (marked[i]) candidate[i * 4 + 3] = 0;
    const result = liteVisibleBounds(candidate, width, height);
    // A failed cutout must never replace a visible photo with an empty canvas.
    if (result.count >= Math.max(64, width * height * 0.005) && tail > width * height * 0.01) {
      pixels.data.set(candidate);
      ctx.putImageData(pixels, 0, 0);
      cutoutApplied = true;
    } else if (tail > 0) {
      cutoutRejected = true;
    }
  }

  const visible = liteVisibleBounds(pixels.data, width, height);
  return { canvas, bounds: visible.bounds, visiblePixels: visible.count, cutoutApplied, cutoutRejected };
}
