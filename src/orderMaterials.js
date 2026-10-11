// Material assignments belong to an order line; the product remains a pattern.
export const sectionKey = (pieceId, index) => JSON.stringify([pieceId, index]);
export const materialGroupKey = piece => piece.materialGroup?.trim() ? `group:${piece.materialGroup.trim()}` : `piece:${piece.id}`;

export function materialGroups(product) {
  const groups = new Map();
  for (const piece of product.pieces ?? []) {
    const key = materialGroupKey(piece);
    if (!groups.has(key)) groups.set(key, { key, name: piece.materialGroup?.trim() || piece.name, pieces: [] });
    groups.get(key).pieces.push(piece);
  }
  return [...groups.values()];
}

export function resolveMaterialIds(piece, sizeId, line, index) {
  const assignment = (index != null && line?.sectionMaterials?.[sectionKey(piece.id, index)])
    || line?.pieceMaterials?.[piece.id]
    || line?.groupMaterials?.[materialGroupKey(piece)]
    || piece.materialsBySize?.[sizeId];
  // Explicit assignments must never silently fall back to another fabric/color.
  return assignment ? { fabricId: assignment.fabricId, colorId: assignment.colorId }
    : { fabricId: piece.fabricId, colorId: piece.colorId };
}

function clearSections(line, pieceIds) {
  const sectionMaterials = { ...line.sectionMaterials };
  for (const key of Object.keys(sectionMaterials)) {
    try { if (pieceIds.includes(JSON.parse(key)[0])) delete sectionMaterials[key]; } catch { delete sectionMaterials[key]; }
  }
  return sectionMaterials;
}

export function assignPieces(line, pieceIds, material) {
  const pieceMaterials = { ...line.pieceMaterials };
  for (const id of pieceIds) {
    if (material) pieceMaterials[id] = { ...material };
    else delete pieceMaterials[id];
  }
  return { ...line, pieceMaterials, sectionMaterials: clearSections(line, pieceIds) };
}

export function assignGroup(line, group, material) {
  const next = assignPieces(line, group.pieces.map(p => p.id), null);
  const groupMaterials = { ...next.groupMaterials };
  if (material) groupMaterials[group.key] = { ...material };
  else delete groupMaterials[group.key];
  return { ...next, groupMaterials };
}

export function assignSection(line, pieceId, index, material) {
  const sectionMaterials = { ...line.sectionMaterials };
  const key = sectionKey(pieceId, index);
  if (material) sectionMaterials[key] = { ...material };
  else delete sectionMaterials[key];
  return { ...line, sectionMaterials };
}

export function resetOrderMaterials(line) {
  const { groupMaterials, pieceMaterials, sectionMaterials, ...rest } = line;
  return rest;
}

export function changeOrderLine(line, field, value, products) {
  if (field === 'productId' && value !== line.productId) {
    return { ...resetOrderMaterials(line), productId: value, sizeId: products.find(p => p.id === value)?.sizes[0]?.id ?? '' };
  }
  return { ...line, [field]: value };
}

export function validateOrderMaterials(line) {
  for (const field of ['groupMaterials', 'pieceMaterials', 'sectionMaterials']) {
    const assignments = line[field];
    if (assignments == null) continue;
    if (typeof assignments !== 'object' || Array.isArray(assignments)) throw new Error(`Asignaciones inválidas en Pedido/${field}.`);
    for (const [key, material] of Object.entries(assignments)) {
      if (!material || typeof material.fabricId !== 'string' || typeof material.colorId !== 'string') throw new Error(`Tela o color inválidos en Pedido/${field}.`);
      if (field === 'sectionMaterials') {
        let section;
        try { section = JSON.parse(key); } catch { /* report below */ }
        if (!Array.isArray(section) || section.length !== 2 || typeof section[0] !== 'string' || !Number.isInteger(section[1]) || section[1] < 0) throw new Error('Sección individual inválida en Pedido.');
      }
    }
  }
}
