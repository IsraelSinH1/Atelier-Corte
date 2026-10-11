import React, { useEffect, useState } from 'react';
import { Check, CheckCheck, Layers3, X } from 'lucide-react';
import { BulkMaterialFields } from './MaterialFields.jsx';
import { previewSections } from './orderMaterials.js';
import { parsePoints } from './optimizer.js';

const format = (value, unit) => Number((unit === 'in' ? value / 2.54 : value).toFixed(1)).toString();

function ShapePreview({ section, scale }) {
  const w = Math.max(3, section.width * scale); const h = Math.max(3, section.length * scale);
  const x = (210 - w) / 2; const y = (140 - h) / 2;
  const props = { fill: section.color?.hex || '#e4dfd4', stroke: section.color ? '#596c5d' : '#9b9589', strokeWidth: 1.4, strokeDasharray: section.ready ? undefined : '5 3' };
  const points = parsePoints(section.customPoints);
  return <svg viewBox="0 0 210 140" aria-hidden="true">
    {section.shape === 'circle' ? <ellipse cx="105" cy="70" rx={w / 2} ry={h / 2} {...props} /> : section.shape === 'trapezoid' ? <polygon points={`${x + w * .18},${y} ${x + w * .82},${y} ${x + w},${y + h} ${x},${y + h}`} {...props} /> : section.shape === 'polygon' && points.length >= 3 ? <polygon points={points.map(([px, py]) => `${x + px * w},${y + py * h}`).join(' ')} {...props} /> : <rect x={x} y={y} width={w} height={h} rx="2" {...props} />}
  </svg>;
}

export default function CutMaterialBoard({ data, onAssign, onGoLayouts, onGoProduction }) {
  const sections = previewSections(data.products, data.fabrics, data.order);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const keys = JSON.stringify(sections.map(s => s.key));
  useEffect(() => { const available = new Set(JSON.parse(keys)); setSelected(current => current.filter(key => available.has(key))); }, [keys]);
  const shown = sections.filter(s => (!lineFilter || s.lineId === lineFilter) && (statusFilter === 'all' || (statusFilter === 'pending' ? !s.ready : s.ready)) && `${s.name} ${s.productName} ${s.designName} ${s.groupName}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const targets = sections.filter(s => selected.includes(s.key));
  const readyCount = sections.filter(s => s.ready).length;
  const scope = [...new Set(shown.map(s => s.lineId))];
  const lineOptions = [...new Map(sections.map(s => [s.lineId, s])).values()];
  const scale = Math.min(190 / Math.max(1, ...sections.map(s => s.width)), 110 / Math.max(1, ...sections.map(s => s.length)));
  const toggle = key => setSelected(current => current.includes(key) ? current.filter(k => k !== key) : [...current, key]);
  const selectMany = list => setSelected(current => [...new Set([...current, ...list.map(s => s.key)])]);
  return <section className="cut-material-board">
    <div className="panel cut-material-intro"><div><div className="eyebrow">PASO 1 · PREPARAR MATERIALES</div><h3>Elige las piezas y dales color</h3><p>Toca varias formas y asigna una tela y su color. Cada tarjeta representa una sección del diseño y se repite en las unidades indicadas.</p></div><div className="material-ready-count"><strong>{readyCount} / {sections.length}</strong><span>secciones listas</span><button className="button button-primary small" disabled={!readyCount} onClick={onGoLayouts}>Ver acomodos por tela</button></div></div>
    {!sections.length ? <div className="panel material-board-empty"><Layers3 size={26} /><h3>Prepara tu pedido de producción</h3><p>Agrega productos, tallas y unidades para ver las piezas aquí.</p><button className="button button-primary" onClick={onGoProduction}>Ir a Producción</button></div> : <>
      <div className="material-board-filters"><label><span>Buscar pieza o conjunto</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ej. Panel, exterior…" /></label><label><span>Producto / diseño</span><select value={lineFilter} onChange={e => setLineFilter(e.target.value)}><option value="">Todo el pedido</option>{lineOptions.map((s, index) => <option key={s.lineId} value={s.lineId}>{index + 1}. {s.productName} · {s.sizeName}{s.designName ? ` · ${s.designName}` : ''}</option>)}</select></label><label><span>Estado</span><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Todas las piezas</option><option value="pending">Pendientes</option><option value="ready">Listas para corte</option></select></label></div>
      <div className="panel material-selection-toolbar"><div className="material-selection-head"><strong>{targets.length} sección(es) seleccionada(s)</strong><span>{targets.reduce((sum, s) => sum + s.quantity, 0)} piezas en el pedido</span><button className="text-button" disabled={!shown.length} onClick={() => selectMany(shown)}><CheckCheck size={15} /> Seleccionar visibles</button><button className="text-button" disabled={!selected.length} onClick={() => setSelected([])}><X size={15} /> Limpiar</button></div>
        <BulkMaterialFields fabrics={data.fabrics} targets={targets} onApply={patch => { try { onAssign(targets, patch); setError(''); } catch (e) { setError(e.message); } }} />
        <p>Al cambiar de tela, el color queda pendiente si la tela cambia. El cambio de color conserva la tela. Las selecciones pueden incluir piezas de varios diseños.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <p className="material-board-scale">Formas a una escala común · medidas sin margen en {data.unit === 'in' ? 'pulgadas' : 'centímetros'} · el margen se añade en el acomodo.</p>
      {!shown.length && <div className="panel material-board-empty"><p>No hay piezas que coincidan con estos filtros.</p><button className="text-button" onClick={() => { setQuery(''); setLineFilter(''); setStatusFilter('all'); }}>Mostrar todas</button></div>}
      {scope.map(lineId => {
        const list = shown.filter(s => s.lineId === lineId); const first = list[0];
        return <div className="material-design-section" key={lineId}><div className="material-design-heading"><div><h3>{first.productName} · {first.sizeName}{first.designName ? ` · ${first.designName}` : ''}</h3><span>{first.quantity} unidad(es) de este diseño</span></div><button className="text-button" onClick={() => selectMany(sections.filter(s => s.lineId === lineId))}>Seleccionar este diseño</button></div>
          <div className="material-piece-grid">{list.map(section => <button key={section.key} className={`material-piece-card ${selected.includes(section.key) ? 'selected' : ''} ${section.ready ? '' : 'pending'}`} aria-pressed={selected.includes(section.key)} aria-label={`Seleccionar ${section.name}, ${section.productName}, ${section.designName || section.sizeName}`} onClick={() => toggle(section.key)}>
            <div className="material-piece-art"><span className="material-piece-number">P{String(sections.indexOf(section) + 1).padStart(2, '0')}</span><span className="material-piece-check">{selected.includes(section.key) && <Check size={14} />}</span><ShapePreview section={section} scale={scale} /><span className="material-piece-quantity">× {section.quantity}</span></div>
            <div className="material-piece-copy"><strong>{section.name}</strong><span>{format(section.length, data.unit)} × {format(section.width, data.unit)} {data.unit === 'in' ? 'in' : 'cm'} · {section.groupName}</span><span className="material-piece-assignment"><i style={{ background: section.color?.hex || '#e4dfd4' }} />{section.fabric?.name || 'Sin tela'} · {section.color?.name || 'Sin color'}</span>{!section.ready && <small>{section.length <= 0 || section.width <= 0 ? 'Revisa las medidas del patrón' : 'Completa el material'}</small>}</div>
          </button>)}</div>
        </div>;
      })}
    </>}
  </section>;
}
