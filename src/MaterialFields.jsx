import React, { useEffect, useState } from 'react';

export default function MaterialFields({ fabrics, material, effective, inheritedLabel = 'Usar predeterminados', label = 'Material', onChange }) {
  const current = material || effective || { fabricId: '', colorId: '' };
  const fabric = fabrics.find(f => f.id === current.fabricId);
  const color = fabric?.colors?.find(c => c.id === current.colorId);
  return <div className="material-fields">
    <label><span>Tela</span><select className="order-material-select" aria-label={`${label}: tela`} value={current.fabricId || ''} onChange={e => onChange(e.target.value ? { fabricId: e.target.value, colorId: e.target.value === current.fabricId ? current.colorId || '' : '' } : null)}>
      <option value="">Seleccionar tela</option>
      {current.fabricId && !fabric && <option value={current.fabricId}>Tela eliminada</option>}
      {fabrics.map(f => <option key={f.id} value={f.id}>{f.name}{f.type && f.type !== f.name ? ` · ${f.type}` : ''}</option>)}
    </select></label>
    <label><span>Color {color && <i style={{ background: color.hex }} />}</span><select className="order-material-select" aria-label={`${label}: color`} disabled={!fabric} value={current.colorId || ''} onChange={e => onChange({ fabricId: current.fabricId, colorId: e.target.value })}>
      <option value="">{fabric ? 'Seleccionar color' : 'Elige una tela primero'}</option>
      {current.colorId && !color && <option value={current.colorId}>Color no disponible</option>}
      {fabric?.colors?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    {material && <button type="button" className="material-reset" onClick={() => onChange(null)}>{inheritedLabel}</button>}
  </div>;
}

export function BulkMaterialFields({ fabrics, targets, onApply }) {
  const [fabricId, setFabricId] = useState('');
  const [colorId, setColorId] = useState('');
  const signature = JSON.stringify(targets.map(t => [t.key, t.material.fabricId, t.material.colorId]));
  useEffect(() => {
    const ids = [...new Set(targets.map(t => t.material.fabricId).filter(Boolean))];
    const common = ids.length === 1 && targets.every(t => t.material.fabricId === ids[0]) ? ids[0] : '';
    setFabricId(common); setColorId('');
  }, [signature]);
  const fabric = fabrics.find(f => f.id === fabricId);
  const validColor = Boolean(fabric?.colors?.some(c => c.id === colorId));
  const colorMatches = targets.length > 0 && targets.every(t => t.material.fabricId === fabricId);
  return <div className="bulk-material-fields">
    <label><span>1. Tela para la selección</span><select className="order-material-select" aria-label="Tela para las piezas seleccionadas" value={fabricId} onChange={e => { setFabricId(e.target.value); setColorId(''); }}><option value="">Seleccionar tela</option>{fabrics.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <label><span>2. Color de esa tela</span><select className="order-material-select" aria-label="Color para las piezas seleccionadas" value={colorId} disabled={!fabric} onChange={e => setColorId(e.target.value)}><option value="">{fabric ? 'Seleccionar color' : 'Elige una tela primero'}</option>{fabric?.colors?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="bulk-material-actions"><button className="button button-outline small" disabled={!targets.length || !fabric} onClick={() => onApply({ fabricId })}>Aplicar solo tela</button><button className="button button-outline small" disabled={!validColor || !colorMatches} onClick={() => onApply({ colorId })}>Aplicar solo color</button><button className="button button-primary small" disabled={!targets.length || !validColor} onClick={() => onApply({ fabricId, colorId })}>Aplicar tela y color</button></div>
    {targets.length > 0 && fabric && !colorMatches && <small>Para cambiar solo el color, todas las piezas seleccionadas deben tener esta tela. Puedes aplicar tela y color juntos.</small>}
    {fabric && !fabric.colors?.length && <small>Esta tela aún no tiene colores. Agrégalos en Telas.</small>}
  </div>;
}

// Keep the editor visible while choosing a new fabric: commit after its color
// is selected, otherwise the piece would disappear from the current layout.
export function LayoutMaterialFields({ fabrics, sourceKey, initial, onApply, onReset }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [sourceKey, initial.fabricId, initial.colorId]);
  const valid = fabrics.find(f => f.id === draft?.fabricId)?.colors?.some(c => c.id === draft?.colorId);
  return <div><MaterialFields fabrics={fabrics} material={draft} inheritedLabel="Restaurar material heredado" label="Sección seleccionada" onChange={material => { if (material) setDraft(material); else onReset(); }} />
    <button className="button button-primary small full-width" disabled={!valid} onClick={() => onApply(draft)}>Aplicar y recalcular</button>
  </div>;
}
