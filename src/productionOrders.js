import { createPlan, cuttingList } from './optimizer.js';
import { assignSection, resolveMaterialIds } from './orderMaterials.js';

export function estimate(data, order = data.order, suppliedPlan) {
  const plan = suppliedPlan || createPlan(data.products, data.fabrics, order, Number(data.gap) || 0);
  const valid = order.length > 0 && !plan.issues.length && !plan.groups.some(g => g.error);
  const units = order.reduce((sum, l) => sum + Number(l.quantity), 0);
  const priced = valid && plan.groups.every(g => g.cost != null && Number.isFinite(g.cost));
  const fabricCost = priced ? plan.groups.reduce((sum, g) => sum + g.cost, 0) : null;
  let extras = 0;
  for (const line of order) {
    const product = data.products.find(p => p.id === line.productId);
    const costs = product?.costsBySize?.[line.sizeId] ?? {};
    extras += ['labor', 'fill', 'other'].reduce((sum, key) => sum + (Number(costs[key]) || 0), 0) * Number(line.quantity);
  }
  return { valid, priced, units, fabricCost, extras, total: fabricCost == null ? null : fabricCost + extras,
    meters: valid ? plan.groups.reduce((sum, g) => sum + g.usedLength / 100, 0) : null,
    materials: plan.groups.map(g => ({ fabric: g.fabric.name, color: g.color.name, meters: g.usedLength / 100, cost: g.cost, efficiency: g.efficiency })),
    issues: [...plan.issues, ...plan.groups.filter(g => g.error).map(g => g.error)] };
}

export function compareBatch(data, order = data.order, suppliedPlan) {
  const batch = estimate(data, order, suppliedPlan);
  let soloTotal = 0; let soloMeters = 0; let valid = batch.valid; let priced = batch.priced;
  for (const line of order) {
    const solo = estimate(data, [{ ...line, quantity: 1 }]);
    valid &&= solo.valid; priced &&= solo.priced;
    soloTotal += (solo.total || 0) * Number(line.quantity);
    soloMeters += (solo.meters || 0) * Number(line.quantity);
  }
  return { ...batch, soloTotal: priced ? soloTotal : null, soloMeters: valid ? soloMeters : null,
    savings: priced ? soloTotal - batch.total : null, perUnit: batch.total == null || !batch.units ? null : batch.total / batch.units };
}

export function registerProduction(data, { name = '', notes = '', id = globalThis.crypto.randomUUID(), now = new Date().toISOString(), plan: suppliedPlan } = {}) {
  const summary = compareBatch(data, data.order, suppliedPlan);
  if (!summary.valid) throw new Error('Completa las telas, colores y medidas y resuelve las piezas que no caben antes de pasar a producción.');
  const history = data.productionHistory ?? [];
  const number = Math.max(0, ...history.map(o => Number(o.number) || 0)) + 1;
  const plan = suppliedPlan || createPlan(data.products, data.fabrics, data.order, Number(data.gap) || 0);
  const lines = data.order.map(line => {
    let frozen = structuredClone(line);
    const product = data.products.find(p => p.id === line.productId);
    for (const piece of product.pieces) for (let index = 0; index < Number(piece.quantity); index++) frozen = assignSection(frozen, piece.id, index, resolveMaterialIds(piece, line.sizeId, line, index));
    return frozen;
  });
  const record = { id, number, folio: `OP-${String(number).padStart(4, '0')}`, name: name.trim() || `Producción ${number}`, notes: notes.trim(), status: 'production', createdAt: now,
    summary, lines, cuttingList: cuttingList(data.products, data.fabrics, data.order, data.gap),
    layouts: structuredClone(plan.groups.map(g => ({ fabric: g.fabric.name, color: g.color.name, width: g.fabric.width, length: g.usedLength, placements: g.placements }))) };
  // Archive a frozen result, independent of later library or price changes.
  return { ...data, order: [], productionHistory: [...history, record] };
}
