import test from 'node:test';
import assert from 'node:assert/strict';
import { toSheetTables, fromSheetTables, dataFingerprint, syncDecision, SHEET_SCHEMA } from '../src/sheetsSchema.js';
import { SheetsClient, parseSpreadsheetId } from '../src/sheetsClient.js';

const data = () => ({ version: 1, unit: 'in', gap: .7, futureSetting: 'conservar', fabrics: [{ id: 'f1', name: 'Sherpa', type: 'Sherpa', width: 150, cost: '', directional: true, stock: 8, colors: [{ id: 'c1', name: 'Rosa', hex: '#D8ACA8' }] }], products: [{ id: 'p1', name: '=Producto seguro', description: 'Descripción, ñ', thumbnail: 'data:image/png;base64,' + 'A'.repeat(95000), globalMargin: 1.4, sizes: [{ id: 's1', name: 'Mediana', variantField: 'preservar' }], pieces: [{ id: 'pc1', name: 'Panel', shape: 'polygon', quantity: 2, fabricId: 'f1', colorId: 'c1', seam: .8, seamMode: 'custom', canRotate: false, respectDirection: true, customPoints: '0,0 1,0 0.5,1', fieldForFuture: true, measures: { s1: { length: 50, width: 75, radius: 4 } }, materialsBySize: { s1: { fabricId: 'f1', colorId: 'c1' } } }] }], order: [{ id: 'o1', productId: 'p1', sizeId: 's1', quantity: 3 }] });

test('Sheets conserva tallas, materiales, extras y miniaturas grandes sin cambiar las unidades internas', async () => {
  const original = data(); const tables = toSheetTables(original);
  assert.equal(tables.Recursos.length, 5);
  assert.ok(tables.Recursos.every(row => String(row[2]).length <= 30000));
  assert.deepEqual(fromSheetTables(tables).data, original);
  assert.equal(await dataFingerprint(original), await dataFingerprint(fromSheetTables(tables).data));
});
test('La migración exige elegir una versión y los cambios en ambos dispositivos provocan conflicto', () => {
  assert.equal(syncDecision('a', 'b', null), 'choose');
  assert.equal(syncDecision('a', 'a', null), 'same');
  assert.equal(syncDecision('b', 'a', { localHash: 'a', remoteHash: 'a' }), 'push');
  assert.equal(syncDecision('a', 'b', { localHash: 'a', remoteHash: 'a' }), 'pull');
  assert.equal(syncDecision('b', 'c', { localHash: 'a', remoteHash: 'a' }), 'conflict');
});
test('La lectura rechaza encabezados, referencias, colores y recursos incompletos antes de reemplazar datos', () => {
  const brokenHeader = toSheetTables(data()); brokenHeader.Telas[0][0] = 'otra_columna'; assert.throws(() => fromSheetTables(brokenHeader), /columnas/);
  const duplicate = toSheetTables(data()); duplicate.Telas.push(duplicate.Telas[1]); assert.throws(() => fromSheetTables(duplicate), /repetido/);
  const missingSize = toSheetTables(data()); missingSize.Medidas[1][2] = 'no-existe'; assert.throws(() => fromSheetTables(missingSize), /talla inexistente/);
  const badColor = toSheetTables(data()); badColor.Colores[1][3] = 'rojo'; assert.throws(() => fromSheetTables(badColor), /hexadecimal/);
  const missingChunk = toSheetTables(data()); missingChunk.Recursos.splice(2, 1); assert.throws(() => fromSheetTables(missingChunk), /incompleta/);
  const missingMeasure = toSheetTables(data()); missingMeasure.Medidas.pop(); assert.throws(() => fromSheetTables(missingMeasure), /Faltan las medidas/);
});

function cloudMock(initial) {
  let tables = initial; let writes = 0; let lastBody;
  const titles = Object.keys(SHEET_SCHEMA);
  const fetcher = async (url, options) => {
    if (url.includes('/values:batchGet')) return { ok: true, json: async () => ({ valueRanges: titles.map(t => ({ values: tables[t] })) }) };
    if (url.includes('?fields=')) return { ok: true, json: async () => ({ sheets: titles.map((title, sheetId) => ({ properties: { title, sheetId, gridProperties: { rowCount: 100, columnCount: 20 } } })) }) };
    if (url.endsWith(':batchUpdate')) {
      writes++; lastBody = JSON.parse(options.body);
      for (const { updateCells } of lastBody.requests) if (updateCells) tables[titles[updateCells.range.sheetId]] = updateCells.rows.map(row => row.values.map(cell => Object.values(cell.userEnteredValue)[0]));
      return { ok: true, json: async () => ({}) };
    }
    throw new Error('Solicitud inesperada');
  };
  return { fetcher, get writes() { return writes; }, get body() { return lastBody; } };
}
test('El cliente llama a fetch con el receptor global que requieren los navegadores', async () => {
  const originalFetch = globalThis.fetch;
  const cloud = cloudMock(toSheetTables(data()));
  globalThis.fetch = function (url, options) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return cloud.fetcher(url, options);
  };
  try {
    const client = new SheetsClient('sheet_1234567890123456', { accessToken: 'test-token', expiresAt: Date.now() + 60000 });
    assert.deepEqual((await client.read()).data, data());
  } finally { globalThis.fetch = originalFetch; }
});
test('Una escritura elimina filas obsoletas y guarda cadenas como texto, conservando formato y pestañas extra', async () => {
  const original = data(); const cloud = cloudMock(toSheetTables(original));
  const client = new SheetsClient('sheet_1234567890123456', { accessToken: 'test-token', expiresAt: Date.now() + 60000 }, cloud.fetcher);
  const next = structuredClone(original); next.order = []; next.products[0].description = 'Cambio';
  await client.write(next, await dataFingerprint(original));
  assert.equal(cloud.writes, 1); assert.deepEqual((await client.read()).data, next);
  const productsUpdate = cloud.body.requests.find(r => r.updateCells?.range.sheetId === 3).updateCells;
  assert.equal(productsUpdate.rows[1].values[1].userEnteredValue.stringValue, '=Producto seguro');
  assert.equal(productsUpdate.fields, 'userEnteredValue');
});
test('No se escribe si Google tiene cambios nuevos o si la autorización venció', async () => {
  const remote = data(); const cloud = cloudMock(toSheetTables(remote)); const local = data(); local.products[0].name = 'Otro';
  const client = new SheetsClient('sheet_1234567890123456', { accessToken: 'test-token', expiresAt: Date.now() + 60000 }, cloud.fetcher);
  await assert.rejects(client.write(local, 'version-anterior'), /hoja cambió/); assert.equal(cloud.writes, 0);
  const invalid = data(); invalid.products[0].pieces[0].quantity = 1.5;
  await assert.rejects(client.write(invalid, await dataFingerprint(remote)), /cantidad/); assert.equal(cloud.writes, 0);
  const expired = new SheetsClient('sheet_1234567890123456', { accessToken: 'test-token', expiresAt: 0 }, cloud.fetcher);
  await assert.rejects(expired.read(), /venció/); assert.equal(cloud.writes, 0);
  assert.equal(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/sheet_1234567890123456/edit'), 'sheet_1234567890123456');
});
