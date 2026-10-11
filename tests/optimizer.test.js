import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateIsValid, createPlan, maxRects } from '../src/optimizer.js';

test('MaxRects acomoda piezas, respeta separación y solo rota las permitidas', () => {
  const gap = 2;
  const items = [
    { id: 'a', width: 88, height: 35, canRotate: false },
    { id: 'b', width: 116, height: 26, canRotate: true },
    { id: 'c', width: 40, height: 42, canRotate: false },
  ];
  const result = maxRects(items, 120, gap);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.placements.length, items.length);
  const rotated = result.placements.find(p => p.id === 'b');
  assert.equal(rotated.rotated, true);
  for (const p of result.placements) {
    assert.ok(p.x >= 0 && p.y >= 0);
    assert.ok(p.x + p.width + gap <= 120.001);
    assert.ok(p.y + p.height <= result.usedLength + 0.001);
  }
  for (let i = 0; i < result.placements.length; i++) for (let j = i + 1; j < result.placements.length; j++) {
    const a = result.placements[i]; const b = result.placements[j];
    const separated = a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y;
    assert.ok(separated, `piezas ${a.id} y ${b.id} no respetan la separación`);
  }
});

test('createPlan agrupa por tela y color, multiplica cantidades y estima costo', () => {
  const fabrics = [{ id: 'f1', name: 'Lona', width: 100, cost: 200, directional: false, colors: [{ id: 'red', name: 'Rojo', hex: '#aa3322' }, { id: 'blue', name: 'Azul', hex: '#2233aa' }] }];
  const product = {
    id: 'p1', name: 'Bolso', globalMargin: 1, sizes: [{ id: 's', name: 'Mediana' }],
    pieces: [
      { id: 'front', name: 'Frente', shape: 'rect', quantity: 1, fabricId: 'f1', colorId: 'red', seam: 1, canRotate: true, measures: { s: { length: 40, width: 30 } } },
      { id: 'lining', name: 'Forro', shape: 'rect', quantity: 1, fabricId: 'f1', colorId: 'blue', seam: 1, canRotate: true, measures: { s: { length: 38, width: 28 } } },
    ],
  };
  const plan = createPlan([product], fabrics, [{ id: 'o1', productId: 'p1', sizeId: 's', quantity: 2 }], 1);
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups.map(g => g.placements.length).sort(), [2, 2]);
  assert.ok(plan.groups.every(g => g.usedLength > 0 && g.cost > 0));
  assert.deepEqual(new Set(plan.groups.map(g => g.color.id)), new Set(['red', 'blue']));
});

test('la validación manual rechaza cruces y piezas fuera del rollo', () => {
  const group = { fabric: { width: 100 } };
  const placed = [{ id: 'a', x: 0, y: 0, width: 40, height: 30 }];
  assert.equal(candidateIsValid(group, placed, 'b', { id: 'b', x: 42, y: 0, width: 30, height: 20 }, 2), true);
  assert.equal(candidateIsValid(group, placed, 'b', { id: 'b', x: 39, y: 0, width: 30, height: 20 }, 2), false);
  assert.equal(candidateIsValid(group, placed, 'b', { id: 'b', x: 80, y: 0, width: 20, height: 20 }, 2), false);
});
