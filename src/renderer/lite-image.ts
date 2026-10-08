/** Image preparation shared by the light settings preview and the pet window. */
interface LitePreparedImage {
  canvas: HTMLCanvasElement;
  bounds: { x: number; y: number; width: number; height: number };
  visiblePixels: number;
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

/**
 * Draw a picture at its natural size and measure what is actually visible.
 *
 * No background keying happens here: the automatic cutout lives in one place
 * (custom.rs) and imported photos already arrive transparent, so this only has to
 * reject the pictures that would render as an empty canvas.
 */
function litePrepareImage(image: HTMLImageElement): LitePreparedImage {
  const width = image.naturalWidth, height = image.naturalHeight;
  if (width * height > 16_000_000) throw new Error(liteT('lite.image.tooManyPixels'));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(liteT('lite.image.noPreview'));
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const visible = liteVisibleBounds(pixels.data, width, height);
  if (visible.count === 0) throw new Error(liteT('lite.image.allTransparent'));
  return { canvas, bounds: visible.bounds, visiblePixels: visible.count };
}
