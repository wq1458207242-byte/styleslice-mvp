import type { AssetImage, SliceAsset, StylePack } from '../types/workflow';

const DEFAULT_PALETTE = ['#242136', '#5d426b', '#d5a95f', '#f0dfb2', '#7b2f43'];

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图像，可能是图片地址跨域或格式不受支持'));
    image.src = dataUrl;
  });
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`;
}

export async function extractPalette(images: AssetImage[]): Promise<string[]> {
  if (images.length === 0) return DEFAULT_PALETTE;
  const samples: Array<[number, number, number]> = [];

  for (const asset of images.slice(0, 5)) {
    const image = await loadImage(asset.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(image, 0, 0, 48, 48);
    const pixels = context.getImageData(0, 0, 48, 48).data;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index + 3] > 180) samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
  }

  if (samples.length < 5) return DEFAULT_PALETTE;
  let centroids = [0.08, 0.28, 0.48, 0.68, 0.88].map((ratio) => samples[Math.floor((samples.length - 1) * ratio)]);
  for (let pass = 0; pass < 6; pass += 1) {
    const groups = centroids.map(() => [] as Array<[number, number, number]>);
    for (const sample of samples) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = sample.reduce((sum, value, channel) => sum + (value - centroid[channel]) ** 2, 0);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      groups[best].push(sample);
    }
    centroids = groups.map((group, index) => (
      group.length === 0
        ? centroids[index]
        : [0, 1, 2].map((channel) => Math.round(group.reduce((sum, value) => sum + value[channel], 0) / group.length)) as [number, number, number]
    ));
  }

  return centroids
    .sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
    .map(([red, green, blue]) => rgbToHex(red, green, blue));
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawComponent(context: CanvasRenderingContext2D, type: string, index: number, style: StylePack) {
  const baseType = type.replace(/\d+$/, '');
  const column = index % 2;
  const row = Math.floor(index / 2);
  const x = 48 + column * 352;
  const y = 48 + row * 212;
  const width = 304;
  const height = 164;
  const [dark, mid, accent, light, danger] = style.palette;

  context.save();
  context.shadowColor = `${dark}aa`;
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  const gradient = context.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, mid);
  gradient.addColorStop(1, dark);
  context.fillStyle = gradient;
  context.strokeStyle = accent;
  context.lineWidth = 5;
  roundedRect(context, x, y, width, height, type === '徽章' ? 56 : 22);
  context.fill();
  context.stroke();

  context.shadowColor = 'transparent';
  context.strokeStyle = `${light}88`;
  context.lineWidth = 2;
  roundedRect(context, x + 10, y + 10, width - 20, height - 20, type === '徽章' ? 48 : 15);
  context.stroke();

  context.fillStyle = accent;
  if (type === '进度条') {
    roundedRect(context, x + 32, y + 68, width - 64, 28, 14);
    context.fillStyle = `${light}35`;
    context.fill();
    roundedRect(context, x + 36, y + 72, (width - 72) * 0.68, 20, 10);
    context.fillStyle = accent;
    context.fill();
  } else if (type === '徽章') {
    context.beginPath();
    context.arc(x + width / 2, y + height / 2, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = danger;
    context.beginPath();
    context.arc(x + width / 2, y + height / 2, 15, 0, Math.PI * 2);
    context.fill();
  } else {
    context.fillStyle = `${accent}dd`;
    context.fillRect(x + 30, y + height - 29, width - 60, 3);
  }

  context.fillStyle = light;
  context.font = '600 19px system-ui';
  context.textAlign = 'center';
  context.fillText(type, x + width / 2, y + 38);
  context.font = '12px ui-monospace, monospace';
  context.fillStyle = `${light}aa`;
  context.fillText(`ASSET ${String(index + 1).padStart(2, '0')}`, x + width / 2, y + height - 18);
  context.restore();
}

export function generateComponentSheet(style: StylePack, componentTypes: string[]): AssetImage {
  const canvas = document.createElement('canvas');
  canvas.width = 752;
  canvas.height = Math.ceil(componentTypes.length / 2) * 212 + 48;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');
  context.clearRect(0, 0, canvas.width, canvas.height);
  componentTypes.forEach((type, index) => drawComponent(context, type, index, style));
  return {
    id: crypto.randomUUID(),
    name: 'component-sheet.png',
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

export function generateScreenMockup(style: StylePack, promptText: string): AssetImage {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');

  const [dark, mid, accent, light, extra] = style.palette.length >= 5 ? style.palette : DEFAULT_PALETTE;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.55, `${mid}55`);
  gradient.addColorStop(1, `${accent}44`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = `${extra}18`;
  for (let i = 0; i < 12; i += 1) {
    context.beginPath();
    context.arc(120 + i * 96, 90 + (i % 3) * 130, 36 + (i % 4) * 10, 0, Math.PI * 2);
    context.fill();
  }

  const drawPanel = (x: number, y: number, w: number, h: number, r = 28) => {
    context.save();
    context.shadowColor = `${dark}35`;
    context.shadowBlur = 24;
    context.shadowOffsetY = 12;
    context.fillStyle = 'rgba(255,255,255,.78)';
    context.strokeStyle = `${accent}aa`;
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(x, y, w, h, r);
    context.fill();
    context.stroke();
    context.restore();
  };

  drawPanel(66, 42, 1148, 72, 34);
  drawPanel(86, 164, 420, 420, 36);
  drawPanel(548, 164, 580, 150, 28);
  drawPanel(548, 342, 580, 180, 28);
  drawPanel(548, 552, 250, 78, 30);
  drawPanel(830, 552, 250, 78, 30);

  context.fillStyle = accent;
  context.font = '800 34px system-ui, sans-serif';
  context.fillText('SCREEN MOCKUP', 108, 90);
  context.font = '600 22px system-ui, sans-serif';
  ['NAV', 'PROFILE', 'STATS', 'ACTIONS'].forEach((text, index) => {
    context.fillStyle = index === 0 ? accent : dark;
    context.fillText(text, 330 + index * 160, 89);
  });

  context.fillStyle = `${mid}cc`;
  context.beginPath();
  context.arc(296, 352, 116, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = `${light}ee`;
  context.beginPath();
  context.arc(296, 315, 52, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.roundRect(220, 366, 152, 126, 52);
  context.fill();

  context.strokeStyle = `${accent}dd`;
  context.lineWidth = 14;
  [592, 650, 708].forEach((y, index) => {
    context.beginPath();
    context.roundRect(598, y - 390, 460 - index * 54, 24, 12);
    context.stroke();
  });
  context.fillStyle = `${extra}dd`;
  context.font = '700 24px system-ui, sans-serif';
  context.fillText(promptText.slice(0, 34) || 'Generated full game interface', 590, 220);

  return {
    id: crypto.randomUUID(),
    name: 'screen-mockup.png',
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function composeGeneratedComponentSheet(assets: AssetImage[], componentTypes: string[]): Promise<AssetImage> {
  const columns = 2;
  const cellWidth = 352;
  const cellHeight = 212;
  const rows = Math.max(1, Math.ceil(componentTypes.length / columns));
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth;
  canvas.height = rows * cellHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');

  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < componentTypes.length; index += 1) {
    const asset = assets[index];
    if (!asset) continue;
    const image = await loadImage(asset.dataUrl);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = column * cellWidth;
    const cellY = row * cellHeight;
    const maxWidth = cellWidth - 34;
    const maxHeight = cellHeight - 34;
    const sourceWidth = image.naturalWidth || asset.width || maxWidth;
    const sourceHeight = image.naturalHeight || asset.height || maxHeight;
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    const drawX = cellX + Math.round((cellWidth - drawWidth) / 2);
    const drawY = cellY + Math.round((cellHeight - drawHeight) / 2);
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  }

  return {
    id: crypto.randomUUID(),
    name: 'component-sheet-exact.png',
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function normalizeImageToDataUrl(asset: AssetImage): Promise<AssetImage> {
  if (asset.dataUrl.startsWith('data:')) return asset;
  const image = await loadImage(asset.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || asset.width || 1024;
  canvas.height = image.naturalHeight || asset.height || 1024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { ...asset, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

export function generateAnalysisCard(title: string, lines: string[], palette: string[] = DEFAULT_PALETTE): AssetImage {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 560;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');

  const [, mid, accent, light, extra] = palette.length >= 5 ? palette : DEFAULT_PALETTE;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#10131a');
  gradient.addColorStop(0.55, '#171b24');
  gradient.addColorStop(1, '#0b0d12');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(255,255,255,0.06)';
  context.roundRect(42, 42, canvas.width - 84, canvas.height - 84, 34);
  context.fill();
  context.strokeStyle = `${accent}cc`;
  context.lineWidth = 4;
  context.stroke();

  context.fillStyle = '#f6f7fb';
  context.font = '800 42px system-ui, sans-serif';
  context.fillText(title, 78, 112);

  palette.slice(0, 5).forEach((color, index) => {
    context.fillStyle = color;
    context.roundRect(78 + index * 92, 142, 74, 46, 12);
    context.fill();
    context.fillStyle = '#f6f7fb';
    context.font = '13px ui-monospace, monospace';
    context.fillText(color.toUpperCase(), 78 + index * 92, 208);
  });

  context.font = '24px system-ui, sans-serif';
  context.fillStyle = '#e7ebf3';
  lines.slice(0, 7).forEach((line, index) => {
    context.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.035)';
    context.roundRect(78, 240 + index * 42, canvas.width - 156, 32, 11);
    context.fill();
    context.fillStyle = '#eef2f8';
    context.fillText(`• ${line}`, 96, 263 + index * 42);
  });

  context.fillStyle = `${extra}aa`;
  context.font = '16px ui-monospace, monospace';
  context.fillText('StyleSlice local decomposition', 78, canvas.height - 70);

  return {
    id: crypto.randomUUID(),
    name: `${title.toLowerCase().replace(/\s+/g, '-')}-analysis.png`,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

type DecompositionKind = 'componentLibrary' | 'background' | 'ip' | 'icon' | 'typography';
type RegionCategory = DecompositionKind | 'unknown';

interface DetectedRegion {
  name: string;
  category: RegionCategory;
  box: [number, number, number, number];
  confidence: number;
}

const REGION_PRESETS: Record<DecompositionKind, Array<{ name: string; box: [number, number, number, number] }>> = {
  componentLibrary: [
    { name: 'top-navigation.png', box: [0.06, 0.03, 0.66, 0.14] },
    { name: 'profile-card.png', box: [0.08, 0.24, 0.44, 0.24] },
    { name: 'season-stats.png', box: [0.09, 0.50, 0.34, 0.22] },
    { name: 'coupon-buttons.png', box: [0.10, 0.77, 0.30, 0.10] },
    { name: 'rank-medal.png', box: [0.42, 0.25, 0.10, 0.20] },
  ],
  background: [
    { name: 'full-background-reference.png', box: [0, 0, 1, 1] },
    { name: 'right-pattern-background.png', box: [0.58, 0.04, 0.40, 0.86] },
    { name: 'soft-pink-gradient-sample.png', box: [0.02, 0.02, 0.36, 0.20] },
  ],
  ip: [
    { name: 'main-ip-character.png', box: [0.52, 0.08, 0.28, 0.84] },
    { name: 'ip-head-detail.png', box: [0.57, 0.10, 0.18, 0.30] },
    { name: 'ip-body-material.png', box: [0.58, 0.42, 0.18, 0.40] },
  ],
  icon: [
    { name: 'back-arrow-icon.png', box: [0.07, 0.04, 0.09, 0.10] },
    { name: 'edit-icon.png', box: [0.37, 0.31, 0.06, 0.08] },
    { name: 'medal-icon-a.png', box: [0.10, 0.55, 0.07, 0.09] },
    { name: 'ticket-icon-a.png', box: [0.10, 0.79, 0.07, 0.08] },
    { name: 'round-rank-icon.png', box: [0.43, 0.27, 0.10, 0.16] },
  ],
  typography: [
    { name: 'nav-typography.png', box: [0.16, 0.05, 0.56, 0.08] },
    { name: 'title-typography.png', box: [0.19, 0.30, 0.22, 0.08] },
    { name: 'number-typography.png', box: [0.10, 0.57, 0.30, 0.10] },
    { name: 'stamp-typography.png', box: [0.81, 0.50, 0.14, 0.18] },
  ],
};

function cropCanvas(source: HTMLImageElement, box: [number, number, number, number], name: string): AssetImage {
  const [x, y, width, height] = box;
  const sx = Math.round(x * source.naturalWidth);
  const sy = Math.round(y * source.naturalHeight);
  const sw = Math.max(1, Math.round(width * source.naturalWidth));
  const sh = Math.max(1, Math.round(height * source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return {
    id: crypto.randomUUID(),
    name,
    dataUrl: canvas.toDataURL('image/png'),
    width: sw,
    height: sh,
  };
}

function intersects(a: DetectedRegion, b: DetectedRegion, padding = 0.012) {
  const ax2 = a.box[0] + a.box[2];
  const ay2 = a.box[1] + a.box[3];
  const bx2 = b.box[0] + b.box[2];
  const by2 = b.box[1] + b.box[3];
  return !(ax2 + padding < b.box[0] || bx2 + padding < a.box[0] || ay2 + padding < b.box[1] || by2 + padding < a.box[1]);
}

function mergeRegions(regions: DetectedRegion[]) {
  const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);
  const merged: DetectedRegion[] = [];
  for (const region of sorted) {
    const hit = merged.find((item) => intersects(item, region));
    if (!hit) {
      merged.push(region);
      continue;
    }
    const x1 = Math.min(hit.box[0], region.box[0]);
    const y1 = Math.min(hit.box[1], region.box[1]);
    const x2 = Math.max(hit.box[0] + hit.box[2], region.box[0] + region.box[2]);
    const y2 = Math.max(hit.box[1] + hit.box[3], region.box[1] + region.box[3]);
    hit.box = [x1, y1, x2 - x1, y2 - y1];
    hit.confidence = Math.max(hit.confidence, region.confidence);
  }
  return merged;
}

function classifyRegion(box: [number, number, number, number], imageWidth: number, imageHeight: number): RegionCategory {
  const [x, y, width, height] = box;
  const area = width * height;
  const aspect = width / Math.max(height, 0.001);
  const centerX = x + width / 2;
  if (area > 0.055 && height > 0.32 && centerX > 0.45) return 'ip';
  if (height < 0.09 && width > 0.08 && aspect > 2.2) return 'typography';
  if (area < 0.018 && width < 0.18 && height < 0.18) return 'icon';
  if (area > 0.012 && aspect > 1.25) return 'componentLibrary';
  if (imageWidth > imageHeight && y < 0.16 && aspect > 2) return 'componentLibrary';
  return 'unknown';
}

function regionName(category: RegionCategory, index: number) {
  const label: Record<RegionCategory, string> = {
    componentLibrary: 'component',
    background: 'background',
    ip: 'ip',
    icon: 'icon',
    typography: 'typography',
    unknown: 'region',
  };
  return `${label[category]}-${String(index + 1).padStart(2, '0')}.png`;
}

async function detectRegions(asset: AssetImage): Promise<DetectedRegion[]> {
  const image = await loadImage(asset.dataUrl);
  const maxWidth = 420;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const lum = new Float32Array(width * height);
  const sat = new Float32Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const r = pixels[index * 4];
    const g = pixels[index * 4 + 1];
    const b = pixels[index * 4 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    lum[index] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[index] = max === 0 ? 0 : (max - min) / max;
  }

  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = Math.abs(lum[index + 1] - lum[index - 1]);
      const gy = Math.abs(lum[index + width] - lum[index - width]);
      const colorJump = Math.abs(pixels[index * 4] - pixels[(index - 1) * 4])
        + Math.abs(pixels[index * 4 + 1] - pixels[(index - 1) * 4 + 1])
        + Math.abs(pixels[index * 4 + 2] - pixels[(index - 1) * 4 + 2]);
      const edge = gx + gy + colorJump * 0.18;
      if (edge > 34 || (sat[index] > 0.34 && edge > 14)) mask[index] = 1;
    }
  }

  const dilated = new Uint8Array(mask);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.006));
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) dilated[(y + dy) * width + x + dx] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const regions: DetectedRegion[] = [];
  const stack: number[] = [];
  for (let start = 0; start < dilated.length; start += 1) {
    if (!dilated[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    while (stack.length) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= dilated.length || visited[next] || !dilated[next]) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const areaRatio = (bw * bh) / (width * height);
    if (count < 18 || areaRatio < 0.0005 || areaRatio > 0.55 || bw < 8 || bh < 8) continue;
    const padX = Math.round(bw * 0.08);
    const padY = Math.round(bh * 0.14);
    const x1 = Math.max(0, minX - padX) / width;
    const y1 = Math.max(0, minY - padY) / height;
    const x2 = Math.min(width, maxX + 1 + padX) / width;
    const y2 = Math.min(height, maxY + 1 + padY) / height;
    const box: [number, number, number, number] = [x1, y1, x2 - x1, y2 - y1];
    const category = classifyRegion(box, image.naturalWidth, image.naturalHeight);
    regions.push({
      name: regionName(category, regions.length),
      category,
      box,
      confidence: Math.min(0.98, 0.42 + Math.sqrt(areaRatio) + count / (width * height)),
    });
  }

  return mergeRegions(regions)
    .filter((region) => region.category !== 'unknown')
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
    .map((region, index) => ({ ...region, name: regionName(region.category, index) }));
}

export async function decomposeReferenceImage(asset: AssetImage, kind: DecompositionKind): Promise<AssetImage[]> {
  const image = await loadImage(asset.dataUrl);
  if (kind !== 'background') {
    const detected = await detectRegions(asset);
    const matched = detected.filter((region) => region.category === kind || (kind === 'componentLibrary' && region.category === 'typography'));
    if (matched.length > 0) {
      return matched
        .slice(0, kind === 'componentLibrary' ? 10 : 8)
        .map((region, index) => cropCanvas(image, region.box, region.name || regionName(kind, index)));
    }
  }
  return REGION_PRESETS[kind].map((region) => cropCanvas(image, region.box, region.name));
}

export async function generateAssetContactSheet(title: string, assets: AssetImage[], palette: string[] = DEFAULT_PALETTE): Promise<AssetImage> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 640;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');
  context.fillStyle = '#101319';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = '#eef2f8';
  context.font = '800 38px system-ui, sans-serif';
  context.fillText(title, 42, 66);
  palette.slice(0, 5).forEach((color, index) => {
    context.fillStyle = color;
    context.roundRect(42 + index * 72, 88, 56, 30, 9);
    context.fill();
  });

  const columns = 2;
  const cellWidth = 420;
  const cellHeight = 150;
  for (const [index, asset] of assets.slice(0, 8).entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 42 + column * 454;
    const y = 140 + row * cellHeight;
    context.fillStyle = 'rgba(255,255,255,0.07)';
    context.roundRect(x, y, cellWidth, cellHeight - 18, 18);
    context.fill();
    const preview = await loadImage(asset.dataUrl);
    const maxW = cellWidth - 28;
    const maxH = cellHeight - 56;
    const scale = Math.min(maxW / (asset.width || maxW), maxH / (asset.height || maxH));
    const w = Math.max(1, Math.round((asset.width || maxW) * scale));
    const h = Math.max(1, Math.round((asset.height || maxH) * scale));
    context.drawImage(preview, x + 14, y + 14, w, h);
    context.fillStyle = '#dce3ee';
    context.font = '14px ui-monospace, monospace';
    context.fillText(asset.name.replace(/\.png$/, ''), x + 14, y + cellHeight - 34);
  }

  return {
    id: crypto.randomUUID(),
    name: `${title.toLowerCase().replace(/\s+/g, '-')}-contact-sheet.png`,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function sliceComponentSheet(sheet: AssetImage, componentTypes: string[]): Promise<SliceAsset[]> {
  const normalizedSheet = await normalizeImageToDataUrl(sheet);
  const image = await loadImage(normalizedSheet.dataUrl);
  return componentTypes.map((type, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 352;
    canvas.height = 212;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持 Canvas');
    const columns = 2;
    const sourceCellWidth = image.width / columns;
    const sourceCellHeight = image.height / Math.ceil(componentTypes.length / columns);
    const sourceX = (index % columns) * sourceCellWidth;
    const sourceY = Math.floor(index / columns) * sourceCellHeight;
    context.drawImage(image, sourceX, sourceY, sourceCellWidth, sourceCellHeight, 0, 0, 352, 212);
    return postProcessComponentCell(canvas, type, index);
  });
}

function colorDistanceSquared(data: Uint8ClampedArray, index: number, color: [number, number, number]) {
  return (data[index] - color[0]) ** 2 + (data[index + 1] - color[1]) ** 2 + (data[index + 2] - color[2]) ** 2;
}

function sampleBackgroundColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const points: Array<[number, number]> = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [Math.floor(width / 2), 2],
    [Math.floor(width / 2), height - 3],
  ];
  const samples = points.map(([x, y]) => {
    const index = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return [data[index], data[index + 1], data[index + 2]] as [number, number, number];
  });
  return [0, 1, 2].map((channel) => {
    const sorted = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }) as [number, number, number];
}

function floodBackground(data: Uint8ClampedArray, width: number, height: number, background: [number, number, number]) {
  const backgroundMask = new Uint8Array(width * height);
  const stack: number[] = [];
  const threshold = 48 ** 2;
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (backgroundMask[pixel]) return;
    const index = pixel * 4;
    if (data[index + 3] < 8 || colorDistanceSquared(data, index, background) <= threshold) {
      backgroundMask[pixel] = 1;
      stack.push(pixel);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const current = stack.pop()!;
    const x = current % width;
    const y = Math.floor(current / width);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return backgroundMask;
}

interface MaskComponent {
  pixels: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function findMaskComponents(mask: Uint8Array, width: number) {
  const visited = new Uint8Array(mask.length);
  const components: MaskComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    const pixels: number[] = [];
    let minX = width;
    let minY = Math.ceil(mask.length / width);
    let maxX = 0;
    let maxY = 0;
    while (stack.length) {
      const current = stack.pop()!;
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    components.push({ pixels, area: pixels.length, minX, minY, maxX, maxY });
  }
  return components.sort((a, b) => b.area - a.area);
}

function boxesIntersect(a: MaskComponent, b: MaskComponent, padding: number) {
  return !(a.maxX + padding < b.minX || b.maxX + padding < a.minX || a.maxY + padding < b.minY || b.maxY + padding < a.minY);
}

function suggestedBorderForType(type: string): [number, number, number, number] {
  const label = type.replace(/\d+$/, '').toLowerCase();
  if (label.includes('panel') || label.includes('button') || label.includes('card') || label.includes('dialog') || label.includes('banner') || /面板|按钮|卡片|对话框|横幅/.test(type)) {
    return [24, 24, 24, 24];
  }
  if (label.includes('progress') || /进度/.test(type)) return [18, 8, 18, 8];
  return [0, 0, 0, 0];
}

function postProcessComponentCell(sourceCanvas: HTMLCanvasElement, type: string, index: number): SliceAsset {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器不支持 Canvas');
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const background = sampleBackgroundColor(data, width, height);
  const backgroundMask = floodBackground(data, width, height, background);
  const foregroundMask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < foregroundMask.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    const nearBackground = colorDistanceSquared(data, offset, background) < 30 ** 2;
    if (alpha > 16 && !backgroundMask[pixel] && !nearBackground) foregroundMask[pixel] = 1;
  }

  const components = findMaskComponents(foregroundMask, width).filter((component) => component.area > 36);
  const main = components[0];
  if (!main) {
    return {
      id: crypto.randomUUID(),
      name: `${String(index + 1).padStart(2, '0')}_${type}_normal.png`,
      dataUrl: sourceCanvas.toDataURL('image/png'),
      width,
      height,
      category: type,
      state: 'normal',
      suggestedBorder: suggestedBorderForType(type),
    };
  }

  const keepMask = new Uint8Array(width * height);
  const keep = components.filter((component) => component === main || boxesIntersect(main, component, 18) || component.area > main.area * 0.45);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  keep.forEach((component) => {
    component.pixels.forEach((pixel) => { keepMask[pixel] = 1; });
    minX = Math.min(minX, component.minX);
    minY = Math.min(minY, component.minY);
    maxX = Math.max(maxX, component.maxX);
    maxY = Math.max(maxY, component.maxY);
  });

  for (let pixel = 0; pixel < keepMask.length; pixel += 1) {
    if (keepMask[pixel]) continue;
    data[pixel * 4 + 3] = 0;
  }

  const padding = 12;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropRight = Math.min(width, maxX + padding + 1);
  const cropBottom = Math.min(height, maxY + padding + 1);
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);
  context.putImageData(imageData, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const outputContext = canvas.getContext('2d');
  if (!outputContext) throw new Error('浏览器不支持 Canvas');
  outputContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return {
    id: crypto.randomUUID(),
    name: `${String(index + 1).padStart(2, '0')}_${type}_normal.png`,
    dataUrl: canvas.toDataURL('image/png'),
    width: cropWidth,
    height: cropHeight,
    category: type,
    state: 'normal',
    suggestedBorder: suggestedBorderForType(type),
  };
}

export function dataUrlToBlob(dataUrl: string) {
  const [metadata, encoded] = dataUrl.split(',');
  const mime = metadata.match(/:(.*?);/)?.[1] ?? 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}
