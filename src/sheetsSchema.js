// Shared contract for the downloadable workbook and the Google Sheets adapter.
import { validateOrderMaterials } from './orderMaterials.js';
export const SHEET_SCHEMA = {
  Configuracion: ['clave', 'valor'],
  Telas: ['tela_id', 'nombre', 'tipo', 'ancho_util_cm', 'costo_metro', 'direccional', 'extra_json'],
  Colores: ['tela_id', 'color_id', 'nombre', 'hex', 'extra_json'],
  Productos: ['producto_id', 'nombre', 'descripcion', 'miniatura_recurso_id', 'margen_global_cm', 'extra_json'],
  Tallas: ['producto_id', 'talla_id', 'nombre', 'extra_json'],
  Piezas: ['producto_id', 'pieza_id', 'nombre', 'forma', 'cantidad', 'tela_id', 'color_id', 'margen_cm', 'margen_modo', 'puede_rotar', 'respetar_direccion', 'puntos_poligono', 'extra_json'],
  Medidas: ['producto_id', 'pieza_id', 'talla_id', 'largo_o_diametro_cm', 'ancho_cm', 'extra_json'],
  Variantes: ['producto_id', 'pieza_id', 'talla_id', 'tela_id', 'color_id', 'extra_json'],
  Pedido: ['linea_id', 'producto_id', 'talla_id', 'unidades', 'extra_json'],
  Recursos: ['recurso_id', 'fragmento', 'contenido'],
};

const extra = (value, fields) => {
  const remaining = Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !fields.includes(key)));
  return Object.keys(remaining).length ? JSON.stringify(remaining) : '';
};
const json = (value, label) => {
  if (!value) return {};
  try { const result = JSON.parse(value); if (result && typeof result === 'object' && !Array.isArray(result)) return result; } catch { /* report below */ }
  throw new Error(`JSON inválido en ${label}. No se reemplazaron tus datos locales.`);
};
const bool = value => {
  if (value === true || value === 1 || /^(true|verdadero|si|sí)$/i.test(String(value))) return true;
  if (value === false || value === 0 || value === '' || value == null || /^(false|falso|no)$/i.test(String(value))) return false;
  throw new Error(`Valor booleano inválido: ${value}. Usa TRUE o FALSE.`);
};
const number = (value, label, optional = false) => {
  if (optional && (value === '' || value == null)) return '';
  const result = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (value === '' || value == null || !Number.isFinite(result)) throw new Error(`Número inválido en ${label}.`);
  return result;
};
const key = (...ids) => JSON.stringify(ids.map(String));
export function columnName(count) { let name = ''; while (count) { count--; name = String.fromCharCode(65 + count % 26) + name; count = Math.floor(count / 26); } return name; }

export function toSheetTables(data, { revision = '', modifiedAt = '' } = {}) {
  const result = Object.fromEntries(Object.entries(SHEET_SCHEMA).map(([name, headers]) => [name, [[...headers]]]));
  const row = (name, values) => result[name].push(values.map(value => value ?? ''));
  [['schema_version', 1], ['unidad', data.unit ?? 'cm'], ['separacion_cm', data.gap ?? 1], ['revision', revision], ['modificado_utc', modifiedAt], ['extra_json', extra(data, ['version', 'unit', 'gap', 'fabrics', 'products', 'order'])]].forEach(values => row('Configuracion', values));
  for (const f of data.fabrics) {
    row('Telas', [f.id, f.name, f.type, f.width, f.cost, !!f.directional, extra(f, ['id', 'name', 'type', 'width', 'cost', 'directional', 'colors'])]);
    for (const c of f.colors ?? []) row('Colores', [f.id, c.id, c.name, c.hex, extra(c, ['id', 'name', 'hex'])]);
  }
  for (const p of data.products) {
    const resourceId = p.thumbnail ? `thumbnail:${p.id}` : '';
    row('Productos', [p.id, p.name, p.description, resourceId, p.globalMargin, extra(p, ['id', 'name', 'description', 'thumbnail', 'globalMargin', 'sizes', 'pieces'])]);
    if (p.thumbnail) for (let offset = 0, fragment = 0; offset < p.thumbnail.length; offset += 30000, fragment++) row('Recursos', [resourceId, fragment, p.thumbnail.slice(offset, offset + 30000)]);
    for (const s of p.sizes ?? []) row('Tallas', [p.id, s.id, s.name, extra(s, ['id', 'name'])]);
    for (const pc of p.pieces ?? []) {
      row('Piezas', [p.id, pc.id, pc.name, pc.shape, pc.quantity, pc.fabricId, pc.colorId, pc.seam, pc.seamMode, !!pc.canRotate, !!pc.respectDirection, pc.customPoints, extra(pc, ['id', 'name', 'shape', 'quantity', 'fabricId', 'colorId', 'seam', 'seamMode', 'canRotate', 'respectDirection', 'customPoints', 'measures', 'materialsBySize'])]);
      for (const [sizeId, m] of Object.entries(pc.measures ?? {})) row('Medidas', [p.id, pc.id, sizeId, m.length, m.width, extra(m, ['length', 'width'])]);
      for (const [sizeId, m] of Object.entries(pc.materialsBySize ?? {})) row('Variantes', [p.id, pc.id, sizeId, m.fabricId, m.colorId, extra(m, ['fabricId', 'colorId'])]);
    }
  }
  // Keep existing columns: order designs/assignments round-trip through extra_json.
  for (const o of data.order) { validateOrderMaterials(o); row('Pedido', [o.id, o.productId, o.sizeId, o.quantity, extra(o, ['id', 'productId', 'sizeId', 'quantity'])]); }
  for (const [name, values] of Object.entries(result)) for (const valuesRow of values) if (valuesRow.some(v => String(v).length > 45000)) throw new Error(`Un campo en ${name} supera el tamaño permitido. Usa una imagen más pequeña o revisa extra_json.`);
  return result;
}

export function fromSheetTables(tables) {
  const records = {};
  for (const [name, headers] of Object.entries(SHEET_SCHEMA)) {
    const values = tables[name];
    if (!values || headers.some((h, i) => values[0]?.[i] !== h)) throw new Error(`La pestaña ${name} no tiene las columnas esperadas. Usa la plantilla y conserva sus encabezados.`);
    records[name] = values.slice(1).filter(r => r.some(v => v !== '' && v != null)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  }
  const config = Object.fromEntries(records.Configuracion.map(r => [r.clave, r.valor]));
  if (Number(config.schema_version) !== 1) throw new Error('Versión de plantilla incompatible. Usa la plantilla de Atelier Corte.');
  const data = { ...json(config.extra_json, 'Configuracion'), version: 1, unit: config.unidad || 'cm', gap: number(config.separacion_cm, 'separacion_cm'), fabrics: [], products: [], order: [] };
  if (!['cm', 'in'].includes(data.unit) || data.gap < 0) throw new Error('Revisa la unidad (cm/in) y la separación de piezas.');
  const fabrics = new Map(); const products = new Map(); const pieces = new Map(); const sizes = new Set(); const seen = new Set();
  const unique = (collection, id) => { if (!id || seen.has(key(collection, id))) throw new Error(`Identificador vacío o repetido en ${collection}: ${id}.`); seen.add(key(collection, id)); };
  const find = (map, id, label) => { const object = map.get(id); if (!object) throw new Error(`Referencia inexistente en ${label}. Revisa los identificadores.`); return object; };
  const requireSize = (productId, sizeId) => { if (!sizes.has(key(productId, sizeId))) throw new Error('Una medida o variante apunta a una talla inexistente.'); };
  for (const r of records.Telas) {
    unique('Telas', r.tela_id); const f = { ...json(r.extra_json, 'Telas'), id: String(r.tela_id), name: String(r.nombre), type: String(r.tipo), width: number(r.ancho_util_cm, 'Telas/ancho'), cost: number(r.costo_metro, 'Telas/costo', true), directional: bool(r.direccional), colors: [] };
    if (f.width <= 0 || (f.cost !== '' && f.cost < 0)) throw new Error('El ancho de tela debe ser positivo y el costo no puede ser negativo.');
    fabrics.set(f.id, f); data.fabrics.push(f);
  }
  for (const r of records.Colores) { const f = find(fabrics, String(r.tela_id), 'Colores'); unique(`Colores/${f.id}`, r.color_id); if (!/^#[0-9a-f]{6}$/i.test(r.hex)) throw new Error('Color inválido en Colores. Usa un hexadecimal como #E9DFD0.'); f.colors.push({ ...json(r.extra_json, 'Colores'), id: String(r.color_id), name: String(r.nombre), hex: String(r.hex) }); }
  const resources = new Map();
  for (const r of records.Recursos) { const order = number(r.fragmento, 'Recursos/fragmento'); if (!Number.isInteger(order) || order < 0) throw new Error('Fragmento de recurso inválido.'); unique(`Recursos/${r.recurso_id}`, String(order)); if (!resources.has(r.recurso_id)) resources.set(r.recurso_id, []); resources.get(r.recurso_id).push([order, String(r.contenido)]); }
  for (const chunks of resources.values()) { chunks.sort((a, b) => a[0] - b[0]); if (chunks.some(([order], i) => order !== i)) throw new Error('La miniatura está incompleta: faltan fragmentos en Recursos.'); }
  for (const r of records.Productos) {
    unique('Productos', r.producto_id); if (r.miniatura_recurso_id && !resources.has(r.miniatura_recurso_id)) throw new Error('Falta una miniatura en Recursos.');
    const p = { ...json(r.extra_json, 'Productos'), id: String(r.producto_id), name: String(r.nombre), description: String(r.descripcion), thumbnail: (resources.get(r.miniatura_recurso_id) ?? []).map(([, content]) => content).join(''), sizes: [], pieces: [] };
    if (r.margen_global_cm !== '') p.globalMargin = number(r.margen_global_cm, 'Productos/margen');
    products.set(p.id, p); data.products.push(p);
  }
  for (const r of records.Tallas) { const p = find(products, String(r.producto_id), 'Tallas'); unique(`Tallas/${p.id}`, r.talla_id); sizes.add(key(p.id, r.talla_id)); p.sizes.push({ ...json(r.extra_json, 'Tallas'), id: String(r.talla_id), name: String(r.nombre) }); }
  for (const r of records.Piezas) {
    const p = find(products, String(r.producto_id), 'Piezas'); unique(`Piezas/${p.id}`, r.pieza_id);
    const pc = { ...json(r.extra_json, 'Piezas'), id: String(r.pieza_id), name: String(r.nombre), shape: String(r.forma), quantity: number(r.cantidad, 'Piezas/cantidad'), fabricId: String(r.tela_id), colorId: String(r.color_id), seam: number(r.margen_cm, 'Piezas/margen'), canRotate: bool(r.puede_rotar), respectDirection: bool(r.respetar_direccion), customPoints: String(r.puntos_poligono), measures: {}, materialsBySize: {} };
    if (r.margen_modo) pc.seamMode = String(r.margen_modo);
    if (!['rect', 'circle', 'trapezoid', 'polygon'].includes(pc.shape) || !Number.isInteger(pc.quantity) || pc.quantity <= 0 || pc.seam < 0) throw new Error('Revisa forma, cantidad y margen en Piezas.');
    pieces.set(key(p.id, pc.id), pc); p.pieces.push(pc);
  }
  for (const r of records.Medidas) { const pc = find(pieces, key(r.producto_id, r.pieza_id), 'Medidas'); requireSize(r.producto_id, r.talla_id); unique(`Medidas/${r.producto_id}/${r.pieza_id}`, r.talla_id); const m = { ...json(r.extra_json, 'Medidas'), length: number(r.largo_o_diametro_cm, 'Medidas/largo'), width: number(r.ancho_cm, 'Medidas/ancho', pc.shape === 'circle') }; if (m.length <= 0 || (pc.shape !== 'circle' && m.width <= 0)) throw new Error('Las medidas deben ser mayores que cero.'); pc.measures[r.talla_id] = m; }
  for (const r of records.Variantes) { const pc = find(pieces, key(r.producto_id, r.pieza_id), 'Variantes'); requireSize(r.producto_id, r.talla_id); unique(`Variantes/${r.producto_id}/${r.pieza_id}`, r.talla_id); pc.materialsBySize[r.talla_id] = { ...json(r.extra_json, 'Variantes'), fabricId: String(r.tela_id), colorId: String(r.color_id) }; }
  for (const r of records.Pedido) { unique('Pedido', r.linea_id); const quantity = number(r.unidades, 'Pedido/unidades'); if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Las unidades del pedido deben ser enteros positivos.'); data.order.push({ ...json(r.extra_json, 'Pedido'), id: String(r.linea_id), productId: String(r.producto_id), sizeId: String(r.talla_id), quantity }); }
  for (const line of data.order) validateOrderMaterials(line);
  for (const p of data.products) for (const pc of p.pieces) for (const s of p.sizes) {
    if (!pc.measures[s.id]) throw new Error(`Faltan las medidas de ${pc.name} para la talla ${s.name}.`);
  }
  return { data, empty: !data.fabrics.length && !data.products.length && !data.order.length, revision: String(config.revision || '') };
}

export async function dataFingerprint(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(toSheetTables(data)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function syncDecision(localHash, remoteHash, baseline) {
  if (localHash === remoteHash) return 'same';
  if (!baseline) return 'choose';
  const localChanged = localHash !== baseline.localHash;
  const remoteChanged = remoteHash !== baseline.remoteHash;
  if (localChanged && remoteChanged) return 'conflict';
  return localChanged ? 'push' : 'pull';
}
