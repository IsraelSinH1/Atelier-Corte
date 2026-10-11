import React, { useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';
import { materialFor } from './optimizer.js';
import { assignGroup, assignPieces, assignSection, materialGroups, resetOrderMaterials, sectionKey } from './orderMaterials.js';

const encode = material => material ? JSON.stringify([material.fabricId, material.colorId]) : '';
const decode = value => { if (!value) return null; const [fabricId, colorId] = JSON.parse(value); return { fabricId, colorId }; };

function MaterialSelect({ fabrics, material, inheritedLabel, onChange, label }) {
  const value = encode(material);
  const options = fabrics.flatMap(f => (f.colors ?? []).map(c => ({ value: encode({ fabricId: f.id, colorId: c.id }), label: `${f.name} · ${c.name}` })));
  return <select className="order-material-select" aria-label={label} value={value} onChange={e => onChange(decode(e.target.value))}>
    <option value="">{inheritedLabel}</option>
    {value && !options.some(o => o.value === value) && <option value={value}>Material eliminado · vuelve a seleccionar</option>}
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>;
}

function MaterialPreview({ piece, line, fabrics, index }) {
  const material = materialFor(piece, line.sizeId, fabrics, line, index);
  return <span className={`order-material-preview ${!material.fabric || !material.color ? 'missing' : ''}`}>
    <i style={{ background: material.color?.hex ?? '#e5e0d8' }} />
    {material.fabric && material.color ? `${material.fabric.name} · ${material.color.name}` : 'Pendiente de asignar tela y color'}
  </span>;
}

export default function OrderMaterials({ line, product, fabrics, onUpdate, onNameChange, onDuplicate }) {
  const [selected, setSelected] = useState([]);
  const [batchMaterial, setBatchMaterial] = useState(null);
  const groups = materialGroups(product);
  const quantity = product.pieces.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
  return <details className="order-design-card" open>
    <summary><strong>{product.name} · {product.sizes.find(s => s.id === line.sizeId)?.name ?? 'Revisa la talla'}{line.designName ? ` · ${line.designName}` : ''}</strong><span>{line.quantity} unidad(es) · {quantity} secciones por unidad</span></summary>
    <div className="order-design-body">
      <div className="order-design-top"><label className="field"><span>Nombre del diseño <small>opcional</small></span><input value={line.designName ?? ''} onChange={e => onNameChange(e.target.value)} placeholder="Ej. Azul marino con interior crema" /></label>
        <button className="button button-outline small" onClick={onDuplicate}><Copy size={14} /> Duplicar diseño</button>
        <button className="text-button" onClick={() => onUpdate(resetOrderMaterials)}><RotateCcw size={14} /> Usar predeterminados</button>
      </div>
      <p className="order-design-help">Este diseño se repite en las {line.quantity} unidad(es) del renglón. Para fabricar otra combinación, duplica el diseño. Los cambios aquí no modifican el producto.</p>
      {!fabrics.some(f => f.colors?.length) && <p className="order-material-warning">Agrega una tela con colores en Telas para poder asignar materiales.</p>}
      <div className="order-batch-toolbar"><span>Selecciona piezas para asignarlas juntas.</span>
        <MaterialSelect fabrics={fabrics} material={batchMaterial} inheritedLabel="Elegir tela y color para la selección" label="Material para piezas seleccionadas" onChange={setBatchMaterial} />
        <button className="button button-outline small" disabled={!selected.length || !batchMaterial} onClick={() => { onUpdate(current => assignPieces(current, selected, batchMaterial)); setSelected([]); }}>Aplicar a {selected.length} pieza(s)</button>
      </div>
      <p className="order-design-help">Asignar a un conjunto o a una pieza completa sustituye sus excepciones individuales.</p>
      {groups.map(group => <section className="order-material-group" key={group.key}>
        <div className="order-material-group-head"><span><strong>{group.name}</strong><small>{group.pieces.length} tipo(s) de pieza · {group.pieces.reduce((sum, p) => sum + Number(p.quantity || 0), 0)} secciones</small></span>
          <MaterialSelect fabrics={fabrics} material={line.groupMaterials?.[group.key]} inheritedLabel="Predeterminados del patrón" label={`Tela y color del conjunto ${group.name}`} onChange={material => onUpdate(current => assignGroup(current, group, material))} />
        </div>
        {group.pieces.map(piece => <div className="order-material-piece" key={piece.id}>
          <div className="order-material-piece-head"><label className="order-piece-check"><input type="checkbox" checked={selected.includes(piece.id)} onChange={e => setSelected(current => e.target.checked ? [...current, piece.id] : current.filter(id => id !== piece.id))} /><span><strong>{piece.name}</strong><small>{piece.quantity} sección(es) por unidad</small></span></label>
            <MaterialSelect fabrics={fabrics} material={line.pieceMaterials?.[piece.id]} inheritedLabel="Heredar conjunto / patrón" label={`Material de todas las secciones de ${piece.name}`} onChange={material => onUpdate(current => assignPieces(current, [piece.id], material))} />
          </div>
          {Number(piece.quantity) === 1 ? <MaterialPreview piece={piece} line={line} fabrics={fabrics} index={0} /> : <details className="order-section-details" open><summary>Secciones individuales ({piece.quantity}) · tela y color por sección</summary>
            {Array.from({ length: Number(piece.quantity) }, (_, index) => <div className="order-section-row" key={index}><span><strong>{piece.name} · sección {index + 1}</strong><MaterialPreview piece={piece} line={line} fabrics={fabrics} index={index} /></span>
              <MaterialSelect fabrics={fabrics} material={line.sectionMaterials?.[sectionKey(piece.id, index)]} inheritedLabel="Heredar material de la pieza" label={`Material de ${piece.name}, sección ${index + 1}`} onChange={material => onUpdate(current => assignSection(current, piece.id, index, material))} />
            </div>)}
          </details>}
        </div>)}
      </section>)}
    </div>
  </details>;
}
