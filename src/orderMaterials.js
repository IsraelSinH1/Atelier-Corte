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

export const visualSectionKey = (lineId, pieceId, index) => JSON.stringify([lineId, pieceId, index]);

export function commonMaterial(sections) {
  if (!sections.length) return { fabricId: '', colorId: '' };
  const fabricId = sections.every(s => s.material.fabricId === sections[0].material.fabricId) ? sections[0].material.fabricId || '' : '';
  const colorId = fabricId && sections.every(s => s.material.colorId === sections[0].material.colorId) ? sections[0].material.colorId || '' : '';
  return { fabricId, colorId };
}

// Includes unassigned pieces: the material board must exist before nesting.
export function previewSections(products, fabrics, order) {
  const sections = [];
  for (const line of order) {
    const product = products.find(p => p.id === line.productId);
    const size = product?.sizes.find(s => s.id === line.sizeId);
    if (!product || !size) continue;
    for (const piece of product.pieces ?? []) {
      if (!Number.isInteger(Number(piece.quantity)) || Number(piece.quantity) < 1) continue;
      const m = piece.measures?.[size.id];
      for (let index = 0; index < Number(piece.quantity); index++) {
        const material = resolveMaterialIds(piece, size.id, line, index);
        const fabric = fabrics.find(f => f.id === material.fabricId);
        const color = fabric?.colors.find(c => c.id === material.colorId);
        sections.push({ key: visualSectionKey(line.id, piece.id, index), lineId: line.id, pieceId: piece.id, index,
          productName: product.name, sizeName: size.name, designName: line.designName || '', groupName: piece.materialGroup?.trim() || piece.name,
          name: Number(piece.quantity) > 1 ? `${piece.name} · sección ${index + 1}` : piece.name,
          shape: piece.shape, customPoints: piece.customPoints, width: Number(piece.shape === 'circle' ? m?.length : m?.width) || 0,
          length: Number(m?.length) || 0, quantity: Number(line.quantity), material, fabric, color,
          ready: Boolean(fabric && color && Number(m?.length) > 0 && (piece.shape === 'circle' || Number(m?.width) > 0)),
        });
      }
    }
  }
  return sections;
}

// Independent batch edits are resolved per section, preserving untouched fields.
// Validate all targets first so an invalid color never causes a partial update.
export function patchSelectedSections(order, products, fabrics, targets, patch) {
  const edits = [];
  for (const target of targets) {
    const line = order.find(o => o.id === target.lineId);
    const piece = products.find(p => p.id === line?.productId)?.pieces.find(p => p.id === target.pieceId);
    if (!line || !piece || !Number.isInteger(target.index) || target.index < 0 || target.index >= Number(piece.quantity)) throw new Error('La selección cambió. Vuelve a seleccionar las piezas.');
    const current = resolveMaterialIds(piece, line.sizeId, line, target.index);
    const fabricId = patch.fabricId ?? current.fabricId;
    const fabric = fabrics.find(f => f.id === fabricId);
    if (!fabric) throw new Error('Selecciona una tela disponible.');
    const colorId = patch.colorId ?? (fabricId === current.fabricId ? current.colorId : '');
    if (patch.colorId != null && !fabric.colors?.some(c => c.id === colorId)) throw new Error('El color debe pertenecer a la tela de todas las piezas seleccionadas. Asigna primero la tela.');
    edits.push({ ...target, material: { fabricId, colorId } });
  }
  return order.map(line => {
    let next = line;
    for (const edit of edits) if (edit.lineId === line.id) next = assignSection(next, edit.pieceId, edit.index, edit.material);
    return next;
  });
}
