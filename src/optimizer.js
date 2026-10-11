const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function findColor(fabrics, fabricId, colorId) {
  return fabrics.find(f => f.id === fabricId)?.colors?.find(c => c.id === colorId);
}

export function materialFor(piece, sizeId, fabrics) {
  const override = piece.materialsBySize?.[sizeId];
  const fabricId = override?.fabricId || piece.fabricId;
  const colorId = override?.colorId || piece.colorId;
  const fabric = fabrics.find(f => f.id === fabricId);
  const color = findColor(fabrics, fabricId, colorId);
  return { fabricId, colorId, fabric, color };
}

function shapeArea(piece, width, height) {
  if (piece.shape === 'circle') return Math.PI * width * height / 4;
  if (piece.shape === 'trapezoid') return width * height * 0.78;
  if (piece.shape === 'polygon') {
    const points = parsePoints(piece.customPoints);
    if (points.length >= 3) {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i]; const [x2, y2] = points[(i + 1) % points.length];
        area += x1 * y2 - x2 * y1;
      }
      return Math.abs(area) * width * height / 2;
    }
  }
  return width * height;
}

export function parsePoints(value) {
  if (!value) return [];
  return value.trim().split(/[;\s]+/).map(pair => pair.split(',').map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1);
}

function expandOrder(products, fabrics, order, gap) {
  const groups = new Map();
  const issues = [];
  for (const line of order) {
    const product = products.find(p => p.id === line.productId);
    const size = product?.sizes?.find(s => s.id === line.sizeId);
    if (!product || !size || line.quantity <= 0) continue;
    for (const piece of product.pieces ?? []) {
      const measurement = piece.measures?.[size.id];
      const { fabric, color, fabricId, colorId } = materialFor(piece, size.id, fabrics);
      if (!measurement || !fabric || !color) {
        issues.push(`Falta asignar medida, tela o color a “${piece.name}” de ${product.name} (${size.name}).`);
        continue;
      }
      const margin = Math.max(0, Number(piece.seamMode === 'global' ? product.globalMargin : piece.seam) || 0);
      const isCircle = piece.shape === 'circle';
      const length = Number(measurement.length) || 0;
      const width = isCircle ? length : Number(measurement.width) || 0;
      if (length <= 0 || width <= 0) {
        issues.push(`La pieza “${piece.name}” de ${product.name} (${size.name}) tiene medidas inválidas.`);
        continue;
      }
      const cutLength = length + margin * 2;
      const cutWidth = width + margin * 2;
      const key = `${fabricId}::${colorId}`;
      if (!groups.has(key)) groups.set(key, { key, fabric, color, items: [], sourceCounts: new Map() });
      const group = groups.get(key);
      const count = Math.max(1, Number(piece.quantity) || 1) * Math.max(1, Number(line.quantity) || 1);
      group.sourceCounts.set(`${product.id}::${size.id}`, (group.sourceCounts.get(`${product.id}::${size.id}`) ?? 0) + count);
      for (let i = 0; i < count; i++) {
        group.items.push({
          id: `${line.id}-${piece.id}-${i + 1}-${uid()}`, pieceId: piece.id, pieceName: piece.name,
          productName: product.name, sizeName: size.name, shape: piece.shape, customPoints: piece.customPoints,
          width: cutWidth, height: cutLength, bareWidth: cutWidth, bareHeight: cutLength,
          seam: margin, gap, canRotate: Boolean(piece.canRotate) && !piece.respectDirection && !fabric.directional && !isCircle,
          fill: color.hex, materialColor: color.name,
        });
      }
    }
  }
  return { groups: [...groups.values()], issues };
}

export function maxRects(items, rollWidth, gap) {
  const blocked = [];
  const ordered = [...items].sort((a, b) => (b.width * b.height - a.width * a.height) || (Math.max(b.width, b.height) - Math.max(a.width, a.height)));
  const tallBound = ordered.reduce((sum, item) => sum + Math.max(item.width, item.height) + gap, 0) + 1;
  let free = [{ x: 0, y: 0, w: rollWidth, h: Math.max(tallBound, 1) }];
  const placements = [];
  for (const item of ordered) {
    const orientations = [{ w: item.width, h: item.height, rotated: false }];
    if (item.canRotate && Math.abs(item.width - item.height) > 0.001) orientations.push({ w: item.height, h: item.width, rotated: true });
    let best = null;
    for (let ri = 0; ri < free.length; ri++) {
      const rect = free[ri];
      for (const oriented of orientations) {
        const outerW = oriented.w + gap;
        const outerH = oriented.h + gap;
        if (outerW > rect.w + 0.0001 || outerH > rect.h + 0.0001) continue;
        const leftoverX = rect.w - outerW; const leftoverY = rect.h - outerH;
        const score = [Math.min(leftoverX, leftoverY), Math.max(leftoverX, leftoverY), rect.y, rect.x];
        if (!best || score.some((value, index) => value < best.score[index] && score.slice(0, index).every((v, j) => Math.abs(v - best.score[j]) < 0.0001))) {
          best = { rect, rectIndex: ri, ...oriented, outerW, outerH, score };
        }
      }
    }
    if (!best) {
      blocked.push(item);
      continue;
    }
    const placed = { ...item, x: best.rect.x, y: best.rect.y, width: best.w, height: best.h, rotated: best.rotated };
    placements.push(placed);
    const used = { x: best.rect.x, y: best.rect.y, w: best.outerW, h: best.outerH };
    const nextFree = [];
    for (const rect of free) {
      if (used.x >= rect.x + rect.w || used.x + used.w <= rect.x || used.y >= rect.y + rect.h || used.y + used.h <= rect.y) {
        nextFree.push(rect);
        continue;
      }
      if (used.x > rect.x) nextFree.push({ x: rect.x, y: rect.y, w: used.x - rect.x, h: rect.h });
      if (used.x + used.w < rect.x + rect.w) nextFree.push({ x: used.x + used.w, y: rect.y, w: rect.x + rect.w - (used.x + used.w), h: rect.h });
      if (used.y > rect.y) nextFree.push({ x: rect.x, y: rect.y, w: rect.w, h: used.y - rect.y });
      if (used.y + used.h < rect.y + rect.h) nextFree.push({ x: rect.x, y: used.y + used.h, w: rect.w, h: rect.y + rect.h - (used.y + used.h) });
    }
    free = nextFree.filter(r => r.w > 0.001 && r.h > 0.001);
    for (let i = free.length - 1; i >= 0; i--) {
      let contained = false;
      for (let j = 0; j < free.length; j++) if (i !== j && free[j].x <= free[i].x && free[j].y <= free[i].y && free[j].x + free[j].w >= free[i].x + free[i].w && free[j].y + free[j].h >= free[i].y + free[i].h) { contained = true; break; }
      if (contained) free.splice(i, 1);
    }
  }
  const usedLength = placements.reduce((max, p) => Math.max(max, p.y + p.height), 0);
  return { placements, blocked, usedLength };
}

function calcGroup(group, placements, gap) {
  const usedLength = placements.reduce((max, p) => Math.max(max, p.y + p.height), 0);
  const pieceArea = placements.reduce((sum, p) => sum + shapeArea(p, p.width, p.height), 0);
  const rollArea = group.fabric.width * usedLength;
  const efficiency = rollArea ? Math.min(100, pieceArea / rollArea * 100) : 0;
  return {
    ...group, placements, usedLength, efficiency, waste: Math.max(0, 100 - efficiency),
    cost: group.fabric.cost == null || group.fabric.cost === '' ? null : (usedLength / 100) * Number(group.fabric.cost),
    totalArea: pieceArea, gap, error: null,
  };
}

export function createPlan(products, fabrics, order, gap) {
  const expanded = expandOrder(products, fabrics, order, gap);
  const groups = expanded.groups.map(group => {
    const isFit = group.items.every(item => {
      const normal = item.width + gap <= group.fabric.width;
      const rotated = item.canRotate && item.height + gap <= group.fabric.width;
      return normal || rotated;
    });
    if (!isFit) {
      const blocked = group.items.filter(item => !(item.width + gap <= group.fabric.width || (item.canRotate && item.height + gap <= group.fabric.width)));
      return { ...group, placements: [], usedLength: 0, efficiency: 0, waste: 0, cost: null, error: `${blocked.length} pieza(s) son más anchas que el rollo de ${group.fabric.width} cm incluso al rotarlas.` };
    }
    const packed = maxRects(group.items, group.fabric.width, gap);
    const result = calcGroup(group, packed.placements, gap);
    if (packed.blocked.length) result.error = `No se pudieron acomodar ${packed.blocked.length} piezas.`;
    return result;
  });
  return { groups, issues: expanded.issues, generatedAt: new Date().toISOString() };
}

export function updateMetrics(group, placements) {
  const usedLength = placements.reduce((max, p) => Math.max(max, p.y + p.height), 0);
  const area = placements.reduce((sum, p) => sum + shapeArea(p, p.width, p.height), 0);
  const rollArea = group.fabric.width * usedLength;
  return { ...group, placements, usedLength, efficiency: rollArea ? Math.min(100, area / rollArea * 100) : 0, waste: rollArea ? Math.max(0, 100 - area / rollArea * 100) : 0, cost: group.fabric.cost == null || group.fabric.cost === '' ? null : usedLength / 100 * Number(group.fabric.cost) };
}

export function candidateIsValid(group, placements, targetId, candidate, gap) {
  const left = candidate.x; const top = candidate.y; const right = left + candidate.width; const bottom = top + candidate.height;
  if (left < 0 || top < 0 || right + gap > group.fabric.width + 0.001) return false;
  for (const other of placements) {
    if (other.id === targetId) continue;
    const separated = right + gap <= other.x || other.x + other.width + gap <= left || bottom + gap <= other.y || other.y + other.height + gap <= top;
    if (!separated) return false;
  }
  return true;
}

