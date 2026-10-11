import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, ArrowLeftRight, ArrowRight, BadgeCheck, Box,
  Boxes, Check, ChevronDown, CircleHelp, ClipboardList, CloudUpload, Copy,
  Download, FileImage, FileJson, FileSpreadsheet, FileText, Filter, LayoutDashboard,
  Layers3, Menu, MoreHorizontal, Package, Pencil, Plus, Printer, Ruler,
  Settings2, Shirt, SlidersHorizontal, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import './styles.css';
import { candidateIsValid, createPlan, cuttingList, materialFor, parsePoints, updateMetrics } from './optimizer.js';
import OrderMaterials from './OrderMaterials.jsx';
import { assignSection, changeOrderLine, patchSelectedSections } from './orderMaterials.js';
import MaterialFields, { LayoutMaterialFields } from './MaterialFields.jsx';
import CutMaterialBoard from './CutMaterialBoard.jsx';
import { useSheetsSync } from './useSheetsSync.js';
import { loadGoogleIdentity } from './sheetsClient.js';

const LazyThreeViewer = React.lazy(() => import('./Model3D.jsx'));

const STORAGE_KEY = 'atelier-corte-v1';
const unitNames = { cm: 'cm', in: 'in' };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cmToUnit = (value, unit) => unit === 'in' ? value / 2.54 : value;
const unitToCm = (value, unit) => unit === 'in' ? value * 2.54 : value;
const fmt = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : '0';

function seedData() {
  const sherpa = 'fabric-sherpa';
  const canvas = 'fabric-canvas';
  const sizeS = 'size-chica';
  const sizeM = 'size-mediana';
  const sizeL = 'size-grande';
  const bedId = 'product-cama-nube';
  return {
    version: 1,
    unit: 'cm',
    gap: 1,
    fabrics: [
      { id: sherpa, name: 'Sherpa suave', type: 'Sherpa', width: 150, cost: 245, directional: false, colors: [
        { id: 'color-marfil', name: 'Marfil', hex: '#E9DFD0' },
        { id: 'color-rosa', name: 'Rosa polvo', hex: '#D8ACA8' },
      ] },
      { id: canvas, name: 'Lona resistente', type: 'Lona', width: 160, cost: 185, directional: true, colors: [
        { id: 'color-azul', name: 'Azul noche', hex: '#263955' },
        { id: 'color-salvia', name: 'Salvia', hex: '#87917B' },
      ] },
    ],
    products: [{
      id: bedId, name: 'Cama Nube', description: 'Cama redonda con base firme, cojín suave y borde acolchado.',
      thumbnail: '', sizes: [
        { id: sizeS, name: 'Chica' }, { id: sizeM, name: 'Mediana' }, { id: sizeL, name: 'Grande' },
      ],
      pieces: [
        { id: 'piece-base', name: 'Base inferior', shape: 'circle', quantity: 1, fabricId: canvas, colorId: 'color-azul', seam: 1, canRotate: true, respectDirection: false, customPoints: '', measures: {
          [sizeS]: { length: 48, width: 48 }, [sizeM]: { length: 60, width: 60 }, [sizeL]: { length: 72, width: 72 },
        } },
        { id: 'piece-cushion', name: 'Cojín superior', shape: 'circle', quantity: 1, fabricId: sherpa, colorId: 'color-marfil', seam: 1, canRotate: true, respectDirection: false, customPoints: '', measures: {
          [sizeS]: { length: 43, width: 43 }, [sizeM]: { length: 55, width: 55 }, [sizeL]: { length: 67, width: 67 },
        } },
        { id: 'piece-rim', name: 'Panel del borde', shape: 'rect', quantity: 2, fabricId: sherpa, colorId: 'color-rosa', seam: 1, canRotate: true, respectDirection: false, customPoints: '', measures: {
          [sizeS]: { length: 58, width: 22 }, [sizeM]: { length: 72, width: 25 }, [sizeL]: { length: 86, width: 28 },
        } },
      ],
    }],
    order: [
      { id: 'order-1', productId: bedId, sizeId: sizeS, quantity: 2 },
      { id: 'order-2', productId: bedId, sizeId: sizeM, quantity: 1 },
      { id: 'order-3', productId: bedId, sizeId: sizeL, quantity: 1 },
    ],
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.fabrics) || !Array.isArray(parsed.products) || !Array.isArray(parsed.order)) return seedData();
    return { ...seedData(), ...parsed };
  } catch { return seedData(); }
}

const navItems = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'fabrics', label: 'Telas', icon: Layers3 },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'production', label: 'Producción', icon: ClipboardList },
  { id: 'cut', label: 'Corte', icon: ScissorsIcon },
  { id: 'model', label: 'Vista 3D', icon: Box },
];

function ScissorsIcon(props) {
  return <span className="scissors-glyph" aria-hidden="true">✂</span>;
}

function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [activeProductId, setActiveProductId] = useState(data.products[0]?.id ?? '');
  const [modelSizeId, setModelSizeId] = useState(data.products[0]?.sizes[0]?.id ?? '');
  const [plan, setPlan] = useState(() => createPlan(data.products, data.fabrics, data.order, data.gap));
  const importInputRef = useRef(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);
  const sheetsSync = useSheetsSync(data, setData, notify, modal?.type === 'fabric' || modal?.type === 'product');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { notify('El almacenamiento del navegador está lleno. Puedes descargar un respaldo y liberar espacio.'); }
  }, [data, notify]);

  useEffect(() => {
    setPlan(createPlan(data.products, data.fabrics, data.order, Number(data.gap) || 0));
  }, [data.products, data.fabrics, data.order, data.gap]);

  useEffect(() => {
    if (!data.products.some(p => p.id === activeProductId)) setActiveProductId(data.products[0]?.id ?? '');
  }, [data.products, activeProductId]);

  useEffect(() => {
    if (!plan.groups.some(group => group.key === selectedGroupKey)) setSelectedGroupKey(plan.groups[0]?.key ?? '');
  }, [plan.groups, selectedGroupKey]);

  const activeProduct = data.products.find(p => p.id === activeProductId) ?? data.products[0];
  const activeSize = activeProduct?.sizes?.find(s => s.id === modelSizeId) ?? activeProduct?.sizes?.[0];
  const activePlanGroup = plan.groups.find(g => g.key === selectedGroupKey) ?? plan.groups[0];
  const allPlacements = plan.groups.flatMap(g => g.placements ?? []);
  const totalMeters = plan.groups.reduce((sum, g) => sum + (g.usedLength || 0) / 100, 0);
  const totalCost = plan.groups.reduce((sum, g) => sum + (Number(g.cost) || 0), 0);
  const totalPieces = plan.groups.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  const averageEfficiency = plan.groups.length ? plan.groups.reduce((sum, g) => sum + (g.efficiency || 0), 0) / plan.groups.length : 0;
  const selectModelPiece = useCallback((pieceId) => {
    setSelectedPieceId(pieceId);
    const piece = activeProduct?.pieces?.find(p => p.id === pieceId);
    if (!piece || !activeSize) return;
    const material = materialFor(piece, activeSize.id, data.fabrics);
    if (material.fabricId && material.colorId) setSelectedGroupKey(`${material.fabricId}::${material.colorId}`);
  }, [activeProduct, activeSize, data.fabrics]);

  const update = (updater) => setData(prev => typeof updater === 'function' ? updater(prev) : { ...prev, ...updater });
  const recalculate = () => {
    const nextPlan = createPlan(data.products, data.fabrics, data.order, Number(data.gap) || 0);
    setPlan(nextPlan);
    setSelectedGroupKey(nextPlan.groups[0]?.key ?? '');
    notify(nextPlan.issues.length ? 'Plan actualizado. Revisa las alertas de medidas o asignaciones.' : 'Plan de corte actualizado.');
  };

  function saveFabric(fabric) {
    update(prev => ({ ...prev, fabrics: prev.fabrics.some(f => f.id === fabric.id) ? prev.fabrics.map(f => f.id === fabric.id ? fabric : f) : [...prev.fabrics, fabric] }));
    setModal(null); notify('Tela guardada.');
  }
  function deleteFabric(fabricId) {
    const fabric = data.fabrics.find(f => f.id === fabricId);
    if (!fabric) return;
    update(prev => ({ ...prev, fabrics: prev.fabrics.filter(f => f.id !== fabricId) }));
    notify(`Se eliminó “${fabric.name}”. Revisa las piezas que la tenían asignada.`);
  }
  function saveProduct(product) {
    update(prev => ({ ...prev, products: prev.products.some(p => p.id === product.id) ? prev.products.map(p => p.id === product.id ? product : p) : [...prev.products, product] }));
    setActiveProductId(product.id); setModelSizeId(product.sizes[0]?.id ?? ''); setModal(null); notify('Producto guardado como preset.');
  }
  function deleteProduct(productId) {
    const product = data.products.find(p => p.id === productId);
    update(prev => ({ ...prev, products: prev.products.filter(p => p.id !== productId), order: prev.order.filter(o => o.productId !== productId) }));
    notify(`Se eliminó “${product?.name ?? 'el producto'}” y sus renglones de producción.`);
  }
  function duplicateProduct(product) {
    const clone = JSON.parse(JSON.stringify(product));
    const oldIds = new Map(clone.sizes.map(s => [s.id, uid()]));
    clone.id = uid(); clone.name = `${product.name} copia`;
    clone.sizes = clone.sizes.map(s => ({ ...s, id: oldIds.get(s.id) }));
    clone.pieces = clone.pieces.map(piece => {
      const measurements = {};
      for (const [oldId, value] of Object.entries(piece.measures ?? {})) if (oldIds.has(oldId)) measurements[oldIds.get(oldId)] = { ...value };
      const materialsBySize = {};
      for (const [oldId, value] of Object.entries(piece.materialsBySize ?? {})) if (oldIds.has(oldId)) materialsBySize[oldIds.get(oldId)] = { ...value };
      return { ...piece, id: uid(), measures: measurements, materialsBySize };
    });
    saveProduct(clone);
  }
  function changeOrderItem(orderId, field, value) {
    update(prev => ({ ...prev, order: prev.order.map(line => line.id === orderId ? changeOrderLine(line, field, value, prev.products) : line) }));
  }
  function changeOrderMaterials(orderId, updater) {
    update(prev => ({ ...prev, order: prev.order.map(line => line.id === orderId ? updater(line) : line) }));
  }
  function duplicateOrderLine(orderId) {
    update(prev => {
      const original = prev.order.find(line => line.id === orderId);
      if (!original) return prev;
      const copy = { ...structuredClone(original), id: uid(), designName: original.designName ? `${original.designName} copia` : 'Nuevo diseño' };
      return { ...prev, order: [...prev.order, copy] };
    });
  }
  function assignCutMaterials(targets, patch) {
    const order = patchSelectedSections(data.order, data.products, data.fabrics, targets, patch);
    update(prev => ({ ...prev, order }));
    notify(`Material actualizado en ${targets.length} sección(es). Corte recalculado.`);
  }
  function resetCutMaterials(targets) {
    update(prev => ({ ...prev, order: prev.order.map(line => {
      let next = line;
      for (const target of targets) if (target.lineId === line.id) next = assignSection(next, target.pieceId, target.index, null);
      return next;
    }) }));
  }
  function addOrderLine() {
    const product = data.products[0];
    if (!product) return notify('Primero crea un producto con al menos una talla.');
    update(prev => ({ ...prev, order: [...prev.order, { id: uid(), productId: product.id, sizeId: product.sizes[0]?.id ?? '', quantity: 1 }] }));
  }
  function updatePlacement(groupKey, itemId, x, y, rotateTo) {
    const group = plan.groups.find(g => g.key === groupKey);
    const current = group?.placements.find(p => p.id === itemId);
    if (!group || !current) return false;
    const rotated = rotateTo === undefined ? current.rotated : rotateTo;
    const nextW = rotated ? current.bareHeight : current.bareWidth;
    const nextH = rotated ? current.bareWidth : current.bareHeight;
    const candidate = { ...current, x, y, width: nextW, height: nextH, rotated };
    if (!candidateIsValid(group, group.placements, itemId, candidate, Number(data.gap) || 0)) {
      notify('Ese acomodo se sale del rollo o cruza otra pieza.'); return false;
    }
    setPlan(prev => {
      const fresh = prev.groups.find(g => g.key === groupKey);
      if (!fresh) return prev;
      const placements = fresh.placements.map(p => p.id === itemId ? candidate : p);
      return { ...prev, groups: prev.groups.map(g => g.key === groupKey ? updateMetrics(g, placements) : g) };
    });
    return true;
  }

  function exportBackup() {
    downloadFile(`atelier-corte-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
    notify('Respaldo JSON descargado.');
  }
  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!Array.isArray(imported.fabrics) || !Array.isArray(imported.products) || !Array.isArray(imported.order)) throw new Error('El archivo no tiene el formato esperado.');
        setData({ ...seedData(), ...imported }); setTab('overview'); notify('Respaldo restaurado correctamente.');
      } catch { notify('No se pudo importar. Selecciona un respaldo JSON válido de Atelier Corte.'); }
    };
    reader.readAsText(file);
  }
  function exportCsv() {
    const rows = [['Producto', 'Diseño', 'Renglón', 'Talla', 'Pieza / sección', 'Cantidad', 'Largo sin margen (cm)', 'Ancho sin margen (cm)', 'Margen (cm)', 'Largo de corte (cm)', 'Ancho de corte (cm)', 'Tela', 'Color']];
    for (const row of cuttingList(data.products, data.fabrics, data.order, data.gap)) {
      rows.push([row.productName, row.designName, row.orderLineId, row.sizeName, row.pieceName, row.quantity, fmt(row.measureLength), fmt(row.measureWidth), fmt(row.seam), fmt(row.height), fmt(row.width), row.fabricName, row.colorName]);
    }
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
    downloadFile('lista-de-corte.csv', csv, 'text/csv;charset=utf-8'); notify('Lista de corte CSV descargada.');
  }

  function exportSvg() {
    const svg = document.querySelector('.cut-layout-svg');
    if (!svg || !activePlanGroup) return notify('No hay un layout para exportar.');
    const copy = svg.cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(copy);
    downloadFile(`layout-${slugify(activePlanGroup.fabric.name)}-${slugify(activePlanGroup.color.name)}.svg`, source, 'image/svg+xml;charset=utf-8');
    notify('Layout SVG descargado.');
  }
  async function exportPng() {
    const svg = document.querySelector('.cut-layout-svg');
    if (!svg || !activePlanGroup) return notify('No hay un layout para exportar.');
    const copy = svg.cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(copy); const image = new Image();
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(900, image.width * 2); canvas.height = Math.max(1100, image.height * 2);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fffdfa'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) downloadFile(`layout-${slugify(activePlanGroup.fabric.name)}-${slugify(activePlanGroup.color.name)}.png`, blob, 'image/png'); URL.revokeObjectURL(url); }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); notify('No se pudo generar la imagen PNG.'); };
    image.src = url;
  }
  function printCutList() { setTimeout(() => window.print(), 80); }

  return <div className="app-shell antialiased">
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><span>ac</span><i /></div>
        <div><div className="brand-name">atelier<span>corte</span></div><div className="brand-caption">PLANEADOR DE COSTURA</div></div>
      </div>
      <div className="workspace-label">TALLER</div>
      <nav className="main-nav" aria-label="Secciones">
        {navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-link ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><Icon size={18} strokeWidth={1.9} /><span>{item.label}</span>{item.id === 'cut' && plan.groups.length > 0 && <em className="nav-count">{plan.groups.length}</em>}</button>; })}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-badge" title={sheetsSync.status.message}><span className="local-dot" /><div><strong>{sheetsSync.status.kind === 'synced' ? 'Guardado en Google Sheets' : 'Guardado en este equipo'}</strong><small>{sheetsSync.connected ? sheetsSync.status.kind === 'synced' ? 'Copia local y nube' : 'Revisa la sincronización en ⚙' : sheetsSync.config ? 'Conecta Google desde ⚙' : 'Guardado automático local'}</small></div></div>
        <button className="sidebar-footer" onClick={() => setModal({ type: 'help' })}><CircleHelp size={17} /> Ayuda rápida <ArrowRight size={15} /></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title"><div className="eyebrow">TU TALLER · {new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()}</div><h1>{navItems.find(i => i.id === tab)?.label ?? 'Resumen'}</h1></div>
        <div className="topbar-actions">
          <label className="unit-switch"><Ruler size={15} /><select aria-label="Unidades" value={data.unit} onChange={e => update({ unit: e.target.value })}><option value="cm">cm</option><option value="in">pulg</option></select><ChevronDown size={13} /></label>
          <button className="icon-button" title={`Configurar Google Sheets · ${sheetsSync.status.message}`} aria-label="Configurar sincronización con Google Sheets" onClick={() => setModal({ type: 'sync' })}><Settings2 size={17} /></button>
          <button className="icon-button" title="Importar respaldo" onClick={() => importInputRef.current?.click()}><Upload size={17} /></button>
          <button className="button button-primary compact" onClick={exportBackup}><FileJson size={16} /><span>Respaldo</span></button>
          <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={e => { importBackup(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </header>

      <div className="page-content">
        {tab === 'overview' && <Overview data={data} plan={plan} totalMeters={totalMeters} totalPieces={totalPieces} totalCost={totalCost} averageEfficiency={averageEfficiency} onGo={setTab} onOpenProduct={() => setModal({ type: 'product' })} />}
        {tab === 'fabrics' && <FabricsPage fabrics={data.fabrics} unit={data.unit} onAdd={() => setModal({ type: 'fabric' })} onEdit={fabric => setModal({ type: 'fabric', fabric })} onDelete={deleteFabric} />}
        {tab === 'products' && <ProductsPage products={data.products} fabrics={data.fabrics} unit={data.unit} onAdd={() => setModal({ type: 'product' })} onEdit={product => setModal({ type: 'product', product })} onDuplicate={duplicateProduct} onDelete={deleteProduct} />}
        {tab === 'production' && <ProductionPage data={data} plan={plan} totalMeters={totalMeters} totalPieces={totalPieces} totalCost={totalCost} onChange={changeOrderItem} onMaterials={changeOrderMaterials} onDuplicate={duplicateOrderLine} onAdd={addOrderLine} onRemove={id => update(prev => ({ ...prev, order: prev.order.filter(o => o.id !== id) }))} onGapChange={gap => update(prev => ({ ...prev, gap }))} onRecalculate={recalculate} onGoCut={() => setTab('cut')} onGoProducts={() => setTab('products')} />}
        {tab === 'cut' && <CutPage data={data} onAssignMaterials={assignCutMaterials} onResetMaterials={resetCutMaterials} plan={plan} selectedGroup={activePlanGroup} selectedPieceId={selectedPieceId} setSelectedPieceId={setSelectedPieceId} selectedGroupKey={selectedGroupKey} setSelectedGroupKey={setSelectedGroupKey} unit={data.unit} onMove={updatePlacement} onRecalculate={recalculate} onExportCsv={exportCsv} onExportSvg={exportSvg} onExportPng={exportPng} onPrint={printCutList} onGoProduction={() => setTab('production')} />}
        {tab === 'model' && <ModelPage data={data} unit={data.unit} activeProduct={activeProduct} activeSize={activeSize} activeProductId={activeProductId} modelSizeId={modelSizeId} selectedPieceId={selectedPieceId} setSelectedPieceId={selectModelPiece} onProductChange={id => { setActiveProductId(id); const product = data.products.find(p => p.id === id); setModelSizeId(product?.sizes[0]?.id ?? ''); }} onSizeChange={setModelSizeId} onGoCut={() => setTab('cut')} onGoProducts={() => setTab('products')} />}
      </div>
    </main>

    <nav className="mobile-nav" aria-label="Navegación móvil">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><Icon size={19} /><span>{item.id === 'overview' ? 'Inicio' : item.id === 'production' ? 'Pedido' : item.id === 'products' ? 'Presets' : item.id === 'model' ? '3D' : item.label}</span></button>; })}</nav>

    {modal?.type === 'fabric' && <FabricEditor fabric={modal.fabric} unit={data.unit} onClose={() => setModal(null)} onSave={saveFabric} />}
    {modal?.type === 'product' && <ProductEditor product={modal.product} fabrics={data.fabrics} unit={data.unit} onClose={() => setModal(null)} onSave={saveProduct} />}
    {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
    {modal?.type === 'sync' && <SheetsSyncModal sync={sheetsSync} onClose={() => setModal(null)} onBackup={exportBackup} />}
    {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span>{toast}</div>}
  </div>;
}

function downloadFile(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'archivo';
}

function Overview({ data, plan, totalMeters, totalPieces, totalCost, averageEfficiency, onGo, onOpenProduct }) {
  const productsInOrder = new Set(data.order.map(line => line.productId)).size;
  return <div className="overview-page">
    <section className="welcome-banner">
      <div className="welcome-copy"><div className="overline"><Sparkles size={14} /> TU ESPACIO DE TRABAJO</div><h2>Cada centímetro<br /><em>mejor aprovechado.</em></h2><p>Organiza tus materiales, define tus productos y convierte cada pedido en un plan de corte claro.</p><button className="button button-cream" onClick={() => onGo('production')}>Abrir plan de producción <ArrowRight size={16} /></button></div>
      <div className="welcome-visual" aria-hidden="true"><div className="thread-circle circle-one" /><div className="thread-circle circle-two" /><div className="fabric-swatch swatch-a" /><div className="fabric-swatch swatch-b" /><div className="fabric-swatch swatch-c" /><div className="fabric-measure"><Ruler size={15} /><span>150 cm</span></div><div className="stitch-line" /></div>
      <div className="welcome-index">01 <span>/</span> 04</div>
    </section>
    <div className="section-heading compact-heading"><div><div className="eyebrow">VISTA GENERAL</div><h2>Tu taller, en un vistazo</h2></div><span className="saved-pill"><span className="local-dot" /> Todo guardado</span></div>
    <div className="stats-grid">
      <StatCard icon={Layers3} label="Telas registradas" value={data.fabrics.length} note={`${data.fabrics.reduce((sum, f) => sum + (f.colors?.length ?? 0), 0)} colores disponibles`} tint="sage" />
      <StatCard icon={Package} label="Productos preset" value={data.products.length} note="Listos para volver a usar" tint="rose" />
      <StatCard icon={ClipboardList} label="Piezas en este pedido" value={totalPieces} note={`${productsInOrder} ${productsInOrder === 1 ? 'producto' : 'productos'} · ${data.order.length} variantes`} tint="blue" />
      <StatCard icon={Ruler} label="Tela estimada" value={`${fmt(totalMeters, 2)} m`} note={totalCost ? `Costo aprox. $${fmt(totalCost, 0)} MXN` : 'Calculada por color y material'} tint="sand" />
    </div>
    <div className="overview-columns">
      <section className="panel panel-cut-preview"><div className="panel-head"><div><div className="eyebrow">PRODUCCIÓN ACTUAL</div><h3>Resumen del corte</h3></div><button className="text-button" onClick={() => onGo('cut')}>Ver layout <ArrowRight size={15} /></button></div>
        {plan.groups.length ? <div className="overview-cut-list">{plan.groups.slice(0, 4).map(group => <button className="overview-cut-row" key={group.key} onClick={() => onGo('cut')}><span className="fabric-chip" style={{ '--swatch': group.color.hex }}><i /></span><span className="cut-row-name"><strong>{group.fabric.name}</strong><small>{group.color.name} · rollo {group.fabric.width} cm</small></span><span className="cut-row-value">{fmt(group.usedLength / 100, 2)} <small>m</small></span><span className="efficiency-mini"><i style={{ width: `${Math.min(group.efficiency, 100)}%` }} /></span></button>)}</div> : <EmptyState title="Tu plan está vacío" text="Agrega productos y tallas para calcular la tela necesaria." action="Ir a producción" onClick={() => onGo('production')} />}
        <div className="panel-foot"><span>{totalPieces} piezas en total</span><span className="efficiency-text"><Activity size={14} /> {fmt(averageEfficiency, 0)}% de aprovechamiento medio</span></div>
      </section>
      <section className="panel quick-panel"><div className="panel-head"><div><div className="eyebrow">ACCESOS RÁPIDOS</div><h3>Sigue construyendo</h3></div><MoreHorizontal size={18} className="muted-icon" /></div>
        <button className="quick-action" onClick={() => onGo('fabrics')}><span className="quick-icon quick-sage"><Layers3 size={18} /></span><span><strong>Registrar una tela</strong><small>Define rollo, precio y colores</small></span><ArrowRight size={16} /></button>
        <button className="quick-action" onClick={onOpenProduct}><span className="quick-icon quick-rose"><Plus size={19} /></span><span><strong>Crear un producto</strong><small>Guarda sus piezas por talla</small></span><ArrowRight size={16} /></button>
        <button className="quick-action" onClick={() => onGo('model')}><span className="quick-icon quick-blue"><Box size={18} /></span><span><strong>Ver tu producto en 3D</strong><small>Explora medidas y colores</small></span><ArrowRight size={16} /></button>
      </section>
    </div>
    <div className="bottom-note"><BadgeCheck size={16} /><span>Este es un primer plan estimado. Revisa el layout antes de marcar la tela.</span><button onClick={() => onGo('production')}>Continuar <ArrowRight size={14} /></button></div>
  </div>;
}

function StatCard({ icon: Icon, label, value, note, tint }) {
  return <div className="stat-card"><span className={`stat-icon ${tint}`}><Icon size={18} /></span><div className="stat-meta"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><span className="stat-trend">↗</span></div>;
}

function EmptyState({ title, text, action, onClick }) {
  return <div className="empty-state"><span className="empty-icon"><Package size={22} /></span><strong>{title}</strong><p>{text}</p>{action && <button className="button button-outline small" onClick={onClick}>{action}<ArrowRight size={14} /></button>}</div>;
}

function FabricsPage({ fabrics, unit, onAdd, onEdit, onDelete }) {
  const [query, setQuery] = useState('');
  const shown = fabrics.filter(f => `${f.name} ${f.type} ${f.colors?.map(c => c.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="module-page">
    <div className="module-intro"><div><div className="eyebrow">BIBLIOTECA DE MATERIALES</div><h2>Telas y colores</h2><p>Guarda el ancho útil de cada rollo y asigna los colores disponibles para tus productos.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Agregar tela</button></div>
    <div className="toolbar"><label className="search-field"><Filter size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar tela o color" /></label><span className="toolbar-count">{shown.length} {shown.length === 1 ? 'tela' : 'telas'}</span></div>
    {shown.length ? <div className="fabric-grid">{shown.map(fabric => <FabricCard key={fabric.id} fabric={fabric} unit={unit} onEdit={() => onEdit(fabric)} onDelete={() => onDelete(fabric.id)} />)}</div> : <EmptyState title="No hay coincidencias" text="Prueba otra búsqueda o registra una tela nueva." action="Agregar tela" onClick={onAdd} />}
    <div className="helper-banner"><span><CircleHelp size={17} /></span><p><strong>¿Qué es el ancho útil?</strong> Es el ancho real aprovechable después de descontar orillas o zonas dañadas del rollo.</p><span className="helper-ruler">— 150 cm —</span></div>
  </div>;
}

function FabricCard({ fabric, unit, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <article className="fabric-card">
    <div className="fabric-card-art" style={{ '--fabric-base': fabric.colors?.[0]?.hex ?? '#d7cabb', '--fabric-alt': fabric.colors?.[1]?.hex ?? '#f1ede6' }}><div className="fabric-weave" /><span className="fabric-type-tag">{fabric.type || 'Tela'}</span><button className="card-menu" aria-label="Opciones de tela" onClick={() => setMenuOpen(v => !v)}><MoreHorizontal size={19} /></button>{menuOpen && <div className="card-menu-pop"><button onClick={onEdit}><Pencil size={14} /> Editar</button><button className="danger" onClick={onDelete}><Trash2 size={14} /> Eliminar</button></div>}<div className="fabric-label">{fabric.name}</div></div>
    <div className="fabric-card-body"><div className="fabric-meta-grid"><div><small>Ancho útil</small><strong>{fmt(cmToUnit(fabric.width, unit), 1)} {unitNames[unit]}</strong></div><div><small>Costo / metro</small><strong>{fabric.cost ? `$${fmt(fabric.cost, 0)} <small>MXN</small>` : 'Sin costo'}</strong></div><div><small>Dirección</small><strong>{fabric.directional ? 'Sí · respetar' : 'No direccional'}</strong></div></div>
      <div className="color-list"><small>Colores <b>{fabric.colors?.length ?? 0}</b></small><div className="color-swatches">{fabric.colors?.map(color => <span key={color.id} title={`${color.name} · ${color.hex}`}><i style={{ background: color.hex }} />{color.name}</span>)}</div></div></div>
  </article>;
}

function ProductsPage({ products, fabrics, unit, onAdd, onEdit, onDuplicate, onDelete }) {
  const [query, setQuery] = useState('');
  const shown = products.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="module-page">
    <div className="module-intro"><div><div className="eyebrow">PRESETS REUTILIZABLES</div><h2>Productos de costura</h2><p>Define el patrón una vez y elige las telas y colores de cada diseño en Producción.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Crear producto</button></div>
    <div className="toolbar"><label className="search-field"><Filter size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto" /></label><span className="toolbar-count">{shown.length} {shown.length === 1 ? 'preset' : 'presets'}</span></div>
    {shown.length ? <div className="product-list">{shown.map(product => <ProductCard key={product.id} product={product} fabrics={fabrics} unit={unit} onEdit={() => onEdit(product)} onDuplicate={() => onDuplicate(product)} onDelete={() => onDelete(product.id)} />)}</div> : <EmptyState title="Aún no hay productos guardados" text="Crea un preset con sus tallas y piezas para empezar a planear producción." action="Crear producto" onClick={onAdd} />}
  </div>;
}

function ProductCard({ product, fabrics, unit, onEdit, onDuplicate, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <article className="product-card">
    <div className="product-thumb">{product.thumbnail ? <img src={product.thumbnail} alt={product.name} /> : <div className="product-thumb-art"><span className="thread-loop" /><span className="thread-piece piece-one" /><span className="thread-piece piece-two" /><span className="thread-piece piece-three" /><Shirt size={30} strokeWidth={1.2} /></div>}<span className="piece-count-tag">{product.pieces?.length ?? 0} piezas</span></div>
    <div className="product-main"><div className="product-title-row"><div><div className="eyebrow">PRODUCTO PRESET</div><h3>{product.name}</h3></div><div className="card-action-wrap"><button className="icon-button" onClick={() => setMenuOpen(v => !v)} aria-label="Más opciones"><MoreHorizontal size={18} /></button>{menuOpen && <div className="card-menu-pop right"><button onClick={onEdit}><Pencil size={14} /> Editar producto</button><button onClick={onDuplicate}><Copy size={14} /> Duplicar</button><button className="danger" onClick={onDelete}><Trash2 size={14} /> Eliminar</button></div>}</div></div>
      <p className="product-description">{product.description || 'Sin descripción.'}</p><div className="product-size-row"><small>TALLAS</small>{product.sizes?.map(size => <span key={size.id}>{size.name}</span>)}</div>
      <div className="product-piece-list">{product.pieces?.map(piece => { const material = materialFor(piece, product.sizes?.[0]?.id, fabrics); return <span className="piece-pill" key={piece.id}><i style={{ background: material.color?.hex ?? '#d7cabb' }} />{piece.name}</span>; })}</div>
    </div>
    <div className="product-card-side"><div className="size-measure"><small>VARIANTES</small><strong>{product.sizes?.length ?? 0}</strong></div><div className="size-measure"><small>PIEZAS</small><strong>{product.pieces?.reduce((s, p) => s + (Number(p.quantity) || 0), 0) ?? 0}<small> / unidad</small></strong></div><button className="button button-outline small" onClick={onEdit}><Pencil size={14} /> Editar</button></div>
    {unit !== 'cm' && <span className="sr-only">Las medidas se muestran en {unitNames[unit]} al editar.</span>}
  </article>;
}

function ProductionPage({ data, plan, totalMeters, totalPieces, totalCost, onChange, onMaterials, onDuplicate, onAdd, onRemove, onGapChange, onRecalculate, onGoCut, onGoProducts }) {
  const products = data.products;
  const invalidItems = plan.issues.length;
  const sizeBreakdown = data.order.map(line => {
    const product = products.find(p => p.id === line.productId); const size = product?.sizes.find(s => s.id === line.sizeId);
    if (!product || !size) return null;
    const pieces = product.pieces.reduce((sum, piece) => sum + (Number(piece.quantity) || 0), 0) * Number(line.quantity || 0);
    return { id: line.id, product: product.name, size: line.designName ? `${size.name} · ${line.designName}` : size.name, quantity: Number(line.quantity || 0), pieces };
  }).filter(Boolean);
  return <div className="module-page production-page">
    <div className="module-intro"><div><div className="eyebrow">ORDEN DE TALLER</div><h2>Plan de producción</h2><p>Agrega productos, elige talla y cantidad, y asigna telas y colores a cada diseño.</p></div><button className="button button-primary" onClick={onRecalculate}><Sparkles size={16} /> Calcular corte</button></div>
    <div className="production-layout">
      <section className="panel order-panel"><div className="panel-head"><div><div className="eyebrow">PEDIDO ACTIVO</div><h3>Productos y cantidades</h3></div><span className="order-status"><span className="local-dot" /> Borrador</span></div>
        {!products.length ? <EmptyState title="Crea un producto para empezar" text="Tu biblioteca de productos está vacía." action="Ir a productos" onClick={onGoProducts} /> : <div className="order-table-wrap"><table className="order-table"><thead><tr><th>PRODUCTO</th><th>TALLA</th><th>UNIDADES</th><th></th></tr></thead><tbody>{data.order.map(line => {
          const product = products.find(p => p.id === line.productId) ?? products[0];
          const size = product?.sizes.find(s => s.id === line.sizeId) ?? product?.sizes[0];
          return <tr key={line.id}><td><select value={product?.id ?? ''} onChange={e => { const next = products.find(p => p.id === e.target.value); onChange(line.id, 'productId', next?.id ?? ''); }} aria-label="Producto">{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td><td><select value={size?.id ?? ''} onChange={e => onChange(line.id, 'sizeId', e.target.value)} aria-label="Talla">{product?.sizes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td><td><div className="quantity-field"><button onClick={() => onChange(line.id, 'quantity', Math.max(1, Number(line.quantity) - 1))} aria-label="Restar unidad">−</button><input type="number" min="1" step="1" value={line.quantity} onChange={e => onChange(line.id, 'quantity', Math.max(1, Math.floor(Number(e.target.value)) || 1))} aria-label="Cantidad de unidades" /><button onClick={() => onChange(line.id, 'quantity', Number(line.quantity) + 1)} aria-label="Sumar unidad">+</button></div></td><td><button className="icon-button subtle-danger" onClick={() => onRemove(line.id)} aria-label="Quitar producto"><Trash2 size={16} /></button></td></tr>;
        })}</tbody></table></div>}
        <button className="add-order-line" onClick={onAdd}><span><Plus size={15} /></span> Agregar otro producto, talla o diseño</button>
        <div className="order-materials-editor"><div className="form-section-head"><div><h3>Telas y colores del pedido</h3><p>Asigna por conjunto, por pieza o por sección individual.</p></div></div>{data.order.map(line => {
          const product = products.find(p => p.id === line.productId);
          return product ? <OrderMaterials key={`${line.id}-${line.productId}`} line={line} product={product} fabrics={data.fabrics} onUpdate={updater => onMaterials(line.id, updater)} onNameChange={value => onChange(line.id, 'designName', value)} onDuplicate={() => onDuplicate(line.id)} /> : null;
        })}</div>
        <div className="order-settings"><div className="setting-copy"><span className="settings-icon"><SlidersHorizontal size={16} /></span><span><strong>Separación entre piezas</strong><small>Espacio de seguridad en el layout</small></span></div><label className="measure-input"><input type="number" min="0" max="10" step="0.1" value={fmt(cmToUnit(Number(data.gap) || 0, data.unit), 2)} onChange={e => onGapChange(Math.max(0, unitToCm(Number(e.target.value) || 0, data.unit)))} /><span>{unitNames[data.unit]}</span></label></div>
      </section>
      <aside className="panel production-summary"><div className="eyebrow">ESTIMACIÓN DEL PEDIDO</div><h3>Material requerido</h3><p className="summary-caption">Agrupado por tela y color</p>
        {plan.groups.length ? <div className="material-summary-list">{plan.groups.map(group => <div className="material-summary-row" key={group.key}><span className="fabric-chip" style={{ '--swatch': group.color.hex }}><i /></span><span className="summary-material-name"><strong>{group.fabric.name}</strong><small>{group.color.name}{group.cost != null ? ` · $${fmt(group.cost, 0)}` : ' · sin costo capturado'}</small></span><strong className="summary-meters">{fmt(group.usedLength / 100, 2)} <small>m</small></strong></div>)}</div> : <div className="summary-empty">Agrega líneas de producción para ver el consumo.</div>}
        {sizeBreakdown.length > 0 && <div className="size-breakdown"><div className="size-breakdown-heading">DESGLOSE POR TALLA</div>{sizeBreakdown.map(line => <div className="size-breakdown-row" key={line.id}><span><strong>{line.product}</strong><small>{line.size}</small></span><b>{line.quantity} u.</b><small>{line.pieces} piezas</small></div>)}</div>}
        <div className="summary-divider" /><div className="summary-total"><span>Metros totales estimados</span><strong>{fmt(totalMeters, 2)} m</strong></div>{totalCost > 0 && <div className="summary-total"><span>Costo estimado</span><strong>${fmt(totalCost, 0)} <small>MXN</small></strong></div>}
        {invalidItems > 0 && <div className="inline-warning"><CircleHelp size={15} /> Hay {invalidItems} alerta(s) de datos que debes revisar.</div>}
        <button className="button button-primary full-width" onClick={onGoCut}>Revisar layout de corte <ArrowRight size={16} /></button>
        <div className="summary-foot"><BadgeCheck size={14} /> Cálculo estimado por heurística de acomodo 2D</div>
      </aside>
    </div>
    <div className="production-bottom-grid"><div className="panel small-info-panel"><span className="info-badge sage"><Layers3 size={18} /></span><div><strong>{totalPieces} piezas calculadas</strong><small>Se cuentan repeticiones por unidad y talla.</small></div></div><div className="panel small-info-panel"><span className="info-badge blue"><Activity size={18} /></span><div><strong>{plan.groups.length} combinaciones de tela</strong><small>Cada tela y color obtiene su propio layout.</small></div></div><div className="panel small-info-panel"><span className="info-badge rose"><ArrowLeftRight size={18} /></span><div><strong>Rotación según dirección</strong><small>La tela direccional conserva el sentido.</small></div></div></div>
  </div>;
}

function CutPage({ data, onAssignMaterials, onResetMaterials, plan, selectedGroup, selectedPieceId, setSelectedPieceId, selectedGroupKey, setSelectedGroupKey, unit, onMove, onRecalculate, onExportCsv, onExportSvg, onExportPng, onPrint, onGoProduction }) {
  const [cutView, setCutView] = useState('general');
  const selectedPiece = selectedGroup?.placements.find(p => p.id === selectedPieceId || p.pieceId === selectedPieceId) ?? null;
  const rows = plan.groups.flatMap(group => group.placements.map(p => ({ ...p, groupKey: group.key, fabricName: group.fabric.name, colorName: group.color.name, fill: group.color.hex })));
  return <div className="module-page cut-page">
    <div className="module-intro"><div><div className="eyebrow">OPTIMIZADOR 2D · MAXRECTS</div><h2>Layout de corte</h2><p>Revisa cómo acomodar cada pieza sobre el ancho útil de tus rollos.</p></div><div className="cut-actions"><button className="button button-outline" onClick={onExportCsv}><FileSpreadsheet size={16} /> Lista CSV</button><button className="button button-outline" onClick={onPrint}><Printer size={16} /> Imprimir / PDF</button><button className="button button-primary" onClick={onRecalculate}><Sparkles size={16} /> Recalcular</button></div></div>
    <div className="cut-view-switch" role="group" aria-label="Vista de corte"><button className={cutView === 'general' ? 'active' : ''} onClick={() => setCutView('general')}><Layers3 size={16} /> 1. Piezas y materiales</button><button className={cutView === 'layouts' ? 'active' : ''} onClick={() => setCutView('layouts')}><ScissorsIcon /> 2. Acomodos por tela y color <span>{plan.groups.length}</span></button></div>
    {cutView === 'general' && <CutMaterialBoard data={data} onAssign={onAssignMaterials} onGoLayouts={() => setCutView('layouts')} onGoProduction={onGoProduction} />}
    <div className={cutView === 'general' ? 'cut-layouts-hidden' : ''}>
    {plan.issues.length > 0 && <div className="alert-box"><CircleHelp size={17} /><div><strong>Revisa estas asignaciones</strong>{plan.issues.map((issue, i) => <p key={i}>{issue}</p>)}</div></div>}
    {plan.groups.some(g => g.error) && <div className="alert-box warning"><CircleHelp size={17} /><div><strong>Hay piezas que no entran en el rollo</strong>{plan.groups.filter(g => g.error).map(g => <p key={g.key}>{g.fabric.name} · {g.color.name}: {g.error}</p>)}</div></div>}
    {!plan.groups.length ? <EmptyState title="Todavía no hay piezas para cortar" text="Agrega productos y cantidades en Producción para crear tu primer layout." action="Ir a producción" onClick={onGoProduction} /> : <>
      <div className="cut-group-tabs">{plan.groups.map((group, index) => <button key={group.key} className={`cut-group-tab ${selectedGroup?.key === group.key ? 'active' : ''}`} onClick={() => setSelectedGroupKey(group.key)}><span className="fabric-chip" style={{ '--swatch': group.color.hex }}><i /></span><span><strong>{group.fabric.name}</strong><small>{group.color.name}</small></span><em>{fmt(group.usedLength / 100, 2)} m</em>{index === 0 && <span className="group-index">01</span>}</button>)}</div>
      {selectedGroup && <div className="cut-content-grid">
        <section className="panel cut-board-panel"><div className="panel-head cut-board-head"><div><div className="eyebrow">ROLLO · {fmt(cmToUnit(selectedGroup.fabric.width, unit), 1)} {unitNames[unit].toUpperCase()} DE ANCHO ÚTIL</div><h3>{selectedGroup.fabric.name} <span className="heading-separator">/</span> {selectedGroup.color.name}</h3></div><div className="cut-board-tools"><button className="icon-button" title="Exportar layout a imagen PNG" onClick={onExportPng}><FileImage size={17} /></button><button className="icon-button" title="Descargar layout SVG" onClick={onExportSvg}><Download size={17} /></button></div></div>
          <div className="layout-instructions"><span className="drag-hint"><ArrowLeftRight size={14} /> Arrastra una pieza para ajustar el acomodo</span><span><i className="legend-square" /> Margen de costura incluido</span></div>
          {selectedGroup.error ? <div className="layout-error"><CircleHelp size={22} /><strong>{selectedGroup.error}</strong><p>Amplía el ancho útil o modifica las medidas de las piezas.</p></div> : <div className="cut-layout-wrap"><div className="cut-width-label">{fmt(cmToUnit(selectedGroup.fabric.width, unit), 1)} {unitNames[unit]}</div><CutSvgLayout group={selectedGroup} selectedPieceId={selectedPieceId} unit={unit} onSelect={setSelectedPieceId} onMove={onMove} /></div>}
          <div className="layout-scale"><span><i /> 0 {unitNames[unit]}</span><span className="scale-rule"><i /></span><span>{fmt(cmToUnit(selectedGroup.usedLength, unit), 1)} {unitNames[unit]} usados</span></div>
        </section>
        <aside className="cut-side-column"><div className="panel cut-result-panel"><div className="eyebrow">RESULTADO ESTIMADO</div><div className="cut-meters"><strong>{fmt(selectedGroup.usedLength / 100, 2)}</strong><span>m</span></div><span className="cut-subtitle">de {selectedGroup.color.name} · ancho {selectedGroup.fabric.width} cm</span><div className="utilization-bar"><i style={{ width: `${selectedGroup.efficiency}%` }} /></div><div className="utilization-labels"><span>Aprovechamiento</span><strong>{fmt(selectedGroup.efficiency, 1)}%</strong></div><div className="cut-result-row"><span>Desperdicio estimado</span><strong>{fmt(selectedGroup.waste, 1)}%</strong></div><div className="cut-result-row"><span>Piezas acomodadas</span><strong>{selectedGroup.placements.length} / {selectedGroup.items.length}</strong></div>{selectedGroup.cost != null && <div className="cut-result-row"><span>Costo estimado</span><strong>${fmt(selectedGroup.cost, 2)} MXN</strong></div>}<div className="cut-result-note"><CircleHelp size={14} /> Aprovechamiento calculado sobre el área rectangular de las piezas.</div></div>
          <div className="panel selected-piece-panel"><div className="panel-head"><div><div className="eyebrow">PIEZA SELECCIONADA</div><h3>{selectedPiece?.pieceName ?? 'Elige una pieza'}</h3></div>{selectedPiece && <span className="piece-number">{selectedPiece.sizeName}</span>}</div>{selectedPiece ? <><div className="selected-piece-detail"><span className="piece-visual-dot" style={{ '--piece': selectedPiece.fill }}><Layers3 size={17} /></span><div><strong>{selectedPiece.productName}{selectedPiece.designName ? ` · ${selectedPiece.designName}` : ''}</strong><small>{fmt(cmToUnit(selectedPiece.height, unit))} × {fmt(cmToUnit(selectedPiece.width, unit))} {unitNames[unit]} · {selectedPiece.shape === 'circle' ? 'círculo' : selectedPiece.shape === 'trapezoid' ? 'trapecio' : selectedPiece.shape === 'polygon' ? 'polígono' : 'rectángulo'}</small></div></div><div className="layout-material-editor"><p>Tela y color de esta sección en todo el diseño:</p><LayoutMaterialFields fabrics={data.fabrics} sourceKey={JSON.stringify([selectedPiece.orderLineId, selectedPiece.pieceId, selectedPiece.sectionIndex])} initial={{ fabricId: selectedGroup.fabric.id, colorId: selectedGroup.color.id }} onApply={material => onAssignMaterials([{ lineId: selectedPiece.orderLineId, pieceId: selectedPiece.pieceId, index: selectedPiece.sectionIndex }], material)} onReset={() => onResetMaterials([{ lineId: selectedPiece.orderLineId, pieceId: selectedPiece.pieceId, index: selectedPiece.sectionIndex }])} /></div>{selectedPiece.canRotate && <button className="button button-outline small full-width" onClick={() => onMove(selectedGroup.key, selectedPiece.id, selectedPiece.x, selectedPiece.y, !selectedPiece.rotated)}><ArrowLeftRight size={14} /> {selectedPiece.rotated ? 'Regresar a orientación original' : 'Rotar 90°'}</button>}</> : <p className="empty-selection">Selecciona una pieza del layout o de la lista para resaltarla.</p>}</div></aside>
      </div>}
      <section className="panel cut-piece-list-panel"><div className="panel-head"><div><div className="eyebrow">LISTA DE CORTE</div><h3>Piezas de este pedido</h3></div><button className="text-button" onClick={onExportCsv}>Exportar CSV <ArrowRight size={14} /></button></div><div className="cut-piece-list">{rows.map((piece, i) => <button key={piece.id} className={`cut-piece-row ${selectedPieceId === piece.id || selectedPieceId === piece.pieceId ? 'selected' : ''}`} onClick={() => { setSelectedGroupKey(piece.groupKey); setSelectedPieceId(piece.id); }}><span className="piece-list-count">{String(i + 1).padStart(2, '0')}</span><span className="piece-list-color" style={{ background: piece.fill }} /><span className="piece-list-main"><strong>{piece.pieceName}</strong><small>{piece.productName} · talla {piece.sizeName}{piece.designName ? ` · ${piece.designName}` : ''} · unidad {piece.unitIndex + 1}</small></span><span className="piece-list-dims">{fmt(cmToUnit(piece.height, unit))} × {fmt(cmToUnit(piece.width, unit))} {unitNames[unit]}</span><span className="piece-list-fabric">{piece.fabricName}<small>{piece.colorName}</small></span><span className="piece-list-arrow"><ArrowRight size={15} /></span></button>)}</div></section>
      <section className="print-only print-cut-list"><h1>Lista de corte · Atelier Corte</h1><p>Generada el {new Date().toLocaleDateString('es-MX')} · Medidas en centímetros</p><table><thead><tr><th>Pieza</th><th>Producto / diseño</th><th>Talla</th><th>Medidas de corte</th><th>Tela</th><th>Color</th><th>Posición (x, y)</th></tr></thead><tbody>{rows.map(p => <tr key={p.id}><td>{p.pieceName}</td><td>{p.productName}{p.designName ? ` · ${p.designName}` : ''} · unidad {p.unitIndex + 1}</td><td>{p.sizeName}</td><td>{fmt(p.height)} × {fmt(p.width)} cm</td><td>{p.fabricName}</td><td>{p.colorName}</td><td>{fmt(p.x)}, {fmt(p.y)} cm</td></tr>)}</tbody></table></section>
    </>}
    </div>
  </div>;
}

function CutSvgLayout({ group, selectedPieceId, unit, onSelect, onMove }) {
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);
  const length = Math.max(group.usedLength, 1);
  const tickStep = unit === 'in' ? 20 : 50;
  const maxLabels = length > 550 ? 2 : 4;
  function pointInCm(event) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * group.fabric.width, y: (event.clientY - rect.top) / rect.height * length };
  }
  function startDrag(event, piece) {
    event.preventDefault(); event.stopPropagation(); onSelect(piece.id);
    const p = pointInCm(event);
    setDrag({ id: piece.id, startX: p.x, startY: p.y, originX: piece.x, originY: piece.y, previewX: piece.x, previewY: piece.y });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event) {
    if (!drag) return;
    const p = pointInCm(event); setDrag(d => ({ ...d, previewX: d.originX + p.x - d.startX, previewY: d.originY + p.y - d.startY }));
  }
  function endDrag() {
    if (!drag) return;
    const didMove = Math.abs(drag.previewX - drag.originX) > 0.08 || Math.abs(drag.previewY - drag.originY) > 0.08;
    if (didMove) onMove(group.key, drag.id, Math.max(0, drag.previewX), Math.max(0, drag.previewY));
    setDrag(null);
  }
  const displayPlacements = group.placements.map(piece => piece.id === drag?.id ? { ...piece, x: drag.previewX, y: drag.previewY } : piece);
  return <svg ref={svgRef} className="cut-layout-svg" style={{ width: `min(100%, ${Math.min(540 * group.fabric.width / length, 640)}px)` }} viewBox={`0 0 ${group.fabric.width} ${length}`} role="img" aria-label={`Layout de corte de ${group.fabric.name}, ${fmt(cmToUnit(length, unit))} ${unitNames[unit]} de largo`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <defs><pattern id="roll-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#dcd8d0" strokeWidth=".18" strokeDasharray="1.2 1.2" /></pattern><filter id="piece-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy=".5" stdDeviation=".6" floodColor="#4e4037" floodOpacity=".18" /></filter></defs>
    <rect x="0" y="0" width={group.fabric.width} height={length} fill="#f3eee6" />
    <rect x="0" y="0" width={group.fabric.width} height={length} fill="url(#roll-grid)" />
    <line x1="0" y1="0" x2={group.fabric.width} y2="0" stroke="#a9a198" strokeWidth=".8" />
    {Array.from({ length: Math.floor(length / tickStep) + 1 }, (_, i) => <g key={i}><line x1="0" x2="4" y1={i * tickStep} y2={i * tickStep} stroke="#9c9489" strokeWidth=".35" /><text x="5" y={i * tickStep + 2} fontSize="2.4" fill="#827b72">{fmt(cmToUnit(i * tickStep, unit), 1)}</text></g>)}
    {displayPlacements.map((piece, i) => {
      const selected = selectedPieceId === piece.id || selectedPieceId === piece.pieceId; const moving = drag?.id === piece.id;
      const cutW = piece.width; const cutH = piece.height; const cx = piece.x + cutW / 2; const cy = piece.y + cutH / 2;
      const shape = piece.shape === 'circle' ? <ellipse cx={cx} cy={cy} rx={cutW / 2} ry={cutH / 2} /> : piece.shape === 'trapezoid' ? <polygon points={`${piece.x + cutW * .18},${piece.y} ${piece.x + cutW * .82},${piece.y} ${piece.x + cutW},${piece.y + cutH} ${piece.x},${piece.y + cutH}`} /> : piece.shape === 'polygon' && parsePoints(piece.customPoints).length >= 3 ? <polygon points={parsePoints(piece.customPoints).map(([x, y]) => `${piece.x + x * cutW},${piece.y + y * cutH}`).join(' ')} /> : <rect x={piece.x} y={piece.y} width={cutW} height={cutH} rx="1.8" />;
      return <g key={piece.id} className={`layout-piece ${selected ? 'selected' : ''} ${moving ? 'dragging' : ''}`} onPointerDown={e => startDrag(e, piece)} onClick={() => onSelect(piece.id)} filter={selected ? 'url(#piece-shadow)' : undefined}>
        {React.cloneElement(shape, { fill: piece.fill, fillOpacity: selected ? .98 : .83, stroke: selected ? '#293846' : '#fffdfa', strokeWidth: selected ? .9 : .5, vectorEffect: 'non-scaling-stroke' })}
        <text x={cx} y={cy - .6} textAnchor="middle" fontSize={Math.min(5, Math.max(2.6, Math.min(cutW, cutH) * .12))} fill={contrastColor(piece.fill)} pointerEvents="none">{piece.pieceName.length > 21 ? `${piece.pieceName.slice(0, 19)}…` : piece.pieceName}</text>
        {cutW > 20 && cutH > 13 && <text x={cx} y={cy + 4} textAnchor="middle" fontSize="2.6" fill={contrastColor(piece.fill)} opacity=".82" pointerEvents="none">{fmt(cmToUnit(cutH, unit))} × {fmt(cmToUnit(cutW, unit))} {unitNames[unit]}</text>}
        {selected && cutW > 8 && cutH > 8 && <circle cx={piece.x + cutW - 3} cy={piece.y + 3} r="1.3" fill="#fffdfa" stroke="#39485a" strokeWidth=".35" pointerEvents="none" />}
        {i > group.placements.length - maxLabels - 1 && <title>{piece.pieceName} · {piece.productName} · talla {piece.sizeName}</title>}
      </g>;
    })}
    <rect x=".3" y=".3" width={group.fabric.width - .6} height={length - .6} fill="none" stroke="#9f968b" strokeWidth=".4" pointerEvents="none" />
  </svg>;
}

function contrastColor(hex) {
  const value = String(hex ?? '#ffffff').replace('#', '');
  if (value.length !== 6) return '#25323c';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return (.2126 * r + .7152 * g + .0722 * b) > .43 ? '#2c3740' : '#fffdf9';
}

function FabricEditor({ fabric, unit, onClose, onSave }) {
  const isEdit = Boolean(fabric);
  const [form, setForm] = useState(() => fabric ? JSON.parse(JSON.stringify(fabric)) : { id: uid(), name: '', type: 'Sherpa', width: 150, cost: '', directional: false, colors: [{ id: uid(), name: 'Nuevo color', hex: '#c8b49d' }] });
  const [error, setError] = useState('');
  const types = ['Algodón', 'Mezclilla', 'Fleece', 'Sherpa', 'Lona', 'Lino', 'Polar', 'Otro'];
  const isKnownType = types.includes(form.type);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  function save() {
    if (!form.name.trim()) return setError('Escribe un nombre para la tela.');
    if (!Number(form.width) || Number(form.width) <= 0) return setError('El ancho útil debe ser mayor a cero.');
    if (!form.colors.length || form.colors.some(c => !c.name.trim() || !/^#[0-9a-fA-F]{6}$/.test(c.hex))) return setError('Cada color necesita un nombre y un código HEX válido.');
    if (form.cost !== '' && (Number(form.cost) < 0 || !Number.isFinite(Number(form.cost)))) return setError('El costo por metro debe ser cero o mayor.');
    onSave({ ...form, name: form.name.trim(), type: form.type === 'Otro' ? (form.customType?.trim() || 'Otro') : form.type, width: unitToCm(Number(form.width), unit), cost: form.cost === '' ? '' : Number(form.cost), colors: form.colors.map(c => ({ ...c, name: c.name.trim() })) });
  }
  return <Modal onClose={onClose} wide={false}>
    <div className="modal-heading"><div className="eyebrow">BIBLIOTECA DE TELAS</div><h2>{isEdit ? 'Editar tela' : 'Agregar tela'}</h2><p>Guarda los datos del rollo y los colores que manejas.</p></div>
    <div className="form-grid"><label className="field full"><span>Nombre de la tela</span><input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej. Sherpa premium" /></label>
      <label className="field"><span>Tipo de tela</span><select value={isKnownType ? form.type : 'Otro'} onChange={e => set('type', e.target.value)}>{types.map(type => <option key={type}>{type}</option>)}</select></label>
      {(form.type === 'Otro' || !isKnownType) && <label className="field"><span>Nombre del tipo</span><input value={form.customType ?? ''} onChange={e => set('customType', e.target.value)} placeholder="Ej. Gabardina" /></label>}
      <label className="field"><span>Ancho útil del rollo</span><div className="input-with-unit"><input type="number" min="1" step="0.1" value={fmt(cmToUnit(Number(form.width), unit), 2)} onChange={e => set('width', unitToCm(Number(e.target.value) || 0, unit))} /><span className="unit-inline">{unitNames[unit]}</span></div></label>
      <label className="field"><span>Costo por metro <small>opcional</small></span><div className="input-prefix"><b>$</b><input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="0.00" /><em>MXN</em></div></label>
      <label className="toggle-row full"><span className="toggle-text"><strong>Esta tela tiene dirección</strong><small>Hilo, pelo o estampado que debe conservar orientación.</small></span><input type="checkbox" checked={Boolean(form.directional)} onChange={e => set('directional', e.target.checked)} /><i className="toggle-ui" /></label>
    </div>
    <div className="form-section-head"><div><h3>Colores disponibles</h3><p>Usa un nombre reconocible y selecciona una muestra.</p></div><button className="button button-outline small" onClick={() => set('colors', [...form.colors, { id: uid(), name: '', hex: '#b9afa2' }])}><Plus size={14} /> Añadir color</button></div>
    <div className="editable-colors">{form.colors.map((color, index) => <div className="editable-color" key={color.id}><span className="color-preview-large" style={{ background: color.hex }} /><label className="field"><span>Nombre del color {index + 1}</span><input value={color.name} onChange={e => set('colors', form.colors.map(c => c.id === color.id ? { ...c, name: e.target.value } : c))} placeholder="Ej. Azul marino" /></label><label className="field hex-field"><span>Muestra HEX</span><div className="color-input-wrap"><input type="color" value={color.hex} onChange={e => set('colors', form.colors.map(c => c.id === color.id ? { ...c, hex: e.target.value } : c))} /><code>{color.hex.toUpperCase()}</code></div></label><button className="icon-button subtle-danger" disabled={form.colors.length <= 1} onClick={() => set('colors', form.colors.filter(c => c.id !== color.id))} aria-label="Eliminar color"><Trash2 size={15} /></button></div>)}</div>
    {error && <div className="form-error"><CircleHelp size={15} />{error}</div>}
    <div className="modal-actions"><button className="button button-ghost" onClick={onClose}>Cancelar</button><button className="button button-primary" onClick={save}><Check size={16} /> Guardar tela</button></div>
  </Modal>;
}

function ProductEditor({ product, fabrics, unit, onClose, onSave }) {
  const [form, setForm] = useState(() => product ? JSON.parse(JSON.stringify(product)) : { id: uid(), name: '', description: '', thumbnail: '', globalMargin: 1, sizes: [{ id: uid(), name: 'Mediana' }], pieces: [] });
  const [error, setError] = useState('');
  const [baseSizeId, setBaseSizeId] = useState(form.sizes[0]?.id ?? '');
  const [newSizeName, setNewSizeName] = useState('Grande');
  const [factor, setFactor] = useState(1.1);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const updatePiece = (pieceId, updater) => setForm(prev => ({ ...prev, pieces: prev.pieces.map(piece => piece.id === pieceId ? (typeof updater === 'function' ? updater(piece) : { ...piece, ...updater }) : piece) }));
  const addSize = () => {
    const name = newSizeName.trim();
    if (!name) return setError('Escribe el nombre de la nueva talla.');
    if (form.sizes.some(s => s.name.toLowerCase() === name.toLowerCase())) return setError('Ya existe una talla con ese nombre.');
    const source = form.sizes.find(s => s.id === baseSizeId) ?? form.sizes[0];
    if (!source) return setError('Crea la primera talla para usarla como base.');
    const newId = uid(); const scale = Math.max(0.1, Number(factor) || 1);
    const pieces = form.pieces.map(piece => {
      const m = piece.measures?.[source.id];
      return { ...piece, measures: { ...piece.measures, [newId]: m ? { length: Number((m.length * scale).toFixed(2)), width: Number((m.width * scale).toFixed(2)) } : { length: 40 * scale, width: 30 * scale }, ...(piece.measures ?? {}) }, materialsBySize: { ...piece.materialsBySize, ...(piece.materialsBySize?.[source.id] ? { [newId]: { ...piece.materialsBySize[source.id] } } : {}) } };
    });
    setForm(prev => ({ ...prev, sizes: [...prev.sizes, { id: newId, name }], pieces })); setBaseSizeId(newId); setNewSizeName(''); setError('');
  };
  const removeSize = (sizeId) => {
    if (form.sizes.length <= 1) return setError('El producto necesita al menos una talla.');
    setForm(prev => ({ ...prev, sizes: prev.sizes.filter(s => s.id !== sizeId), pieces: prev.pieces.map(piece => { const measures = { ...piece.measures }; const materialsBySize = { ...piece.materialsBySize }; delete measures[sizeId]; delete materialsBySize[sizeId]; return { ...piece, measures, materialsBySize }; }) }));
    if (baseSizeId === sizeId) setBaseSizeId(form.sizes.find(s => s.id !== sizeId)?.id ?? '');
  };
  const addPiece = () => {
    const pieceId = uid();
    const measures = Object.fromEntries(form.sizes.map((size, index) => [size.id, { length: 40 + index * 5, width: 30 + index * 4 }]));
    setForm(prev => ({ ...prev, pieces: [...prev.pieces, { id: pieceId, name: `Pieza ${prev.pieces.length + 1}`, shape: 'rect', quantity: 1, fabricId: '', colorId: '', materialGroup: '', seam: Number(prev.globalMargin) || 0, seamMode: 'global', canRotate: true, respectDirection: false, customPoints: '0,0 1,0 0.5,1', measures, materialsBySize: {} }] }));
    setError('');
  };
  const changeMeasurement = (piece, sizeId, field, entered) => {
    const cmValue = unitToCm(Number(entered) || 0, unit);
    updatePiece(piece.id, p => ({ ...p, measures: { ...p.measures, [sizeId]: { ...p.measures[sizeId], [field]: cmValue } } }));
  };
  function onPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Selecciona una imagen válida.');
    if (file.size > 1_500_000) return setError('La imagen debe pesar menos de 1.5 MB para guardarse en el navegador.');
    const reader = new FileReader(); reader.onload = () => set('thumbnail', String(reader.result)); reader.readAsDataURL(file);
  }
  function save() {
    if (!form.name.trim()) return setError('Escribe el nombre del producto.');
    if (!form.sizes.length || form.sizes.some(s => !s.name.trim())) return setError('Cada talla necesita un nombre.');
    if (!form.pieces.length) return setError('Agrega al menos una pieza al producto.');
    if (form.pieces.some(p => !p.name.trim() || !Number.isInteger(Number(p.quantity)) || Number(p.quantity) < 1)) return setError('Revisa el nombre y la cantidad por unidad de cada pieza.');
    for (const piece of form.pieces) for (const size of form.sizes) {
      const m = piece.measures?.[size.id];
      if (!m || Number(m.length) <= 0 || (piece.shape !== 'circle' && Number(m.width) <= 0)) return setError(`Revisa las medidas de “${piece.name}” para la talla ${size.name}.`);
      if (piece.shape === 'polygon' && parsePoints(piece.customPoints).length < 3) return setError(`El polígono de “${piece.name}” necesita al menos 3 puntos entre 0 y 1.`);
    }
    onSave({ ...form, name: form.name.trim(), description: form.description.trim(), globalMargin: Number(form.globalMargin) || 0, sizes: form.sizes.map(s => ({ ...s, name: s.name.trim() })), pieces: form.pieces.map(p => ({ ...p, materialGroup: (p.materialGroup ?? '').trim(), name: p.name.trim(), quantity: Math.max(1, Number(p.quantity) || 1) })) });
  }
  return <Modal onClose={onClose} wide>
    <div className="modal-heading"><div className="eyebrow">PRESET DE PRODUCTO</div><h2>{product ? 'Editar producto' : 'Crear producto'}</h2><p>Define el patrón: tallas, piezas y medidas. Los materiales son opcionales y se eligen en Producción.</p></div>
    <div className="product-form-top"><div className="form-grid product-info-grid"><label className="field full"><span>Nombre del producto</span><input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej. Cama redonda" /></label><label className="field full"><span>Descripción <small>opcional</small></span><textarea rows="2" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Notas sobre armado, relleno o uso." /></label><label className="field"><span>Margen de costura global</span><div className="input-with-unit"><input type="number" min="0" step="0.1" value={fmt(cmToUnit(Number(form.globalMargin) || 0, unit), 2)} onChange={e => set('globalMargin', unitToCm(Number(e.target.value) || 0, unit))} /><span className="unit-inline">{unitNames[unit]}</span></div></label></div><div className="thumbnail-uploader">{form.thumbnail ? <img src={form.thumbnail} alt="Miniatura del producto" /> : <span><CloudUpload size={20} /></span>}<label className="button button-outline small">{form.thumbnail ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" hidden onChange={e => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>{form.thumbnail && <button className="text-button danger-text" onClick={() => set('thumbnail', '')}>Quitar</button>}<small>Opcional · máximo 1.5 MB</small></div></div>
    <section className="editor-section sizes-editor"><div className="editor-section-title"><div><h3>Tallas / variantes</h3><p>Duplica una talla y ajusta sus medidas por factor de escala.</p></div><span className="step-number">01</span></div><div className="sizes-list">{form.sizes.map((size, i) => <div className="size-edit-card" key={size.id}><span className="size-tag-index">{String(i + 1).padStart(2, '0')}</span><label className="field"><span>Nombre de talla</span><input value={size.name} onChange={e => set('sizes', form.sizes.map(s => s.id === size.id ? { ...s, name: e.target.value } : s))} placeholder="Ej. Chica" /></label>{form.sizes.length > 1 && <button className="icon-button subtle-danger" onClick={() => removeSize(size.id)} title="Eliminar talla"><Trash2 size={15} /></button>}</div>)}</div><div className="duplicate-size-row"><label className="field"><span>Duplicar desde</span><select value={baseSizeId} onChange={e => setBaseSizeId(e.target.value)}>{form.sizes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field"><span>Factor</span><div className="input-with-unit"><input type="number" min="0.1" max="5" step="0.05" value={factor} onChange={e => setFactor(e.target.value)} /><span className="unit-inline">×</span></div></label><label className="field"><span>Nombre de talla</span><input value={newSizeName} onChange={e => setNewSizeName(e.target.value)} placeholder="Ej. Grande" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }} /></label><button className="button button-outline" onClick={addSize}><Copy size={15} /> Duplicar talla</button></div></section>
    <section className="editor-section pieces-editor"><div className="editor-section-title"><div><h3>Piezas del producto</h3><p>Las medidas se capturan por talla; el margen se agrega al tamaño de corte.</p></div><span className="step-number">02</span></div>
      {!form.pieces.length && <div className="empty-editor"><span><ScissorsIcon /></span><strong>Agrega la primera pieza</strong><small>Por ejemplo: panel frontal, base, asa o forro.</small></div>}
      <datalist id="product-material-groups">{[...new Set(form.pieces.map(p => p.materialGroup?.trim()).filter(Boolean))].map(name => <option key={name} value={name} />)}</datalist>
      <div className="piece-editor-list">{form.pieces.map((piece, pieceIndex) => <article className="piece-editor-card" key={piece.id}><div className="piece-editor-head"><span className="piece-index">P{String(pieceIndex + 1).padStart(2, '0')}</span><label className="field piece-name-field"><span>Nombre de la pieza</span><input value={piece.name} onChange={e => updatePiece(piece.id, { name: e.target.value })} placeholder="Ej. Panel frontal" /></label><button className="icon-button subtle-danger" onClick={() => setForm(prev => ({ ...prev, pieces: prev.pieces.filter(p => p.id !== piece.id) }))} aria-label="Eliminar pieza"><Trash2 size={16} /></button></div>
          <div className="piece-settings-grid"><label className="field"><span>Forma</span><select value={piece.shape} onChange={e => updatePiece(piece.id, { shape: e.target.value })}><option value="rect">Rectángulo</option><option value="circle">Círculo</option><option value="trapezoid">Trapecio</option><option value="polygon">Polígono personalizado</option></select></label><label className="field"><span>Piezas por unidad</span><input type="number" min="1" step="1" value={piece.quantity} onChange={e => updatePiece(piece.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></label><label className="field"><span>Margen de costura</span><select value={piece.seamMode ?? 'custom'} onChange={e => updatePiece(piece.id, { seamMode: e.target.value })}><option value="global">Usar margen global ({fmt(cmToUnit(form.globalMargin, unit))} {unitNames[unit]})</option><option value="custom">Personalizado</option></select></label>{(piece.seamMode ?? 'custom') === 'custom' && <label className="field"><span>Margen por pieza ({unitNames[unit]})</span><input type="number" min="0" step="0.1" value={fmt(cmToUnit(Number(piece.seam) || 0, unit), 2)} onChange={e => updatePiece(piece.id, { seam: unitToCm(Number(e.target.value) || 0, unit) })} /></label>}</div>
          <label className="field piece-group-field"><span>Conjunto de materiales <small>opcional</small></span><input list="product-material-groups" value={piece.materialGroup ?? ''} onChange={e => updatePiece(piece.id, { materialGroup: e.target.value })} placeholder="Ej. Exterior, interior, bordes" /><small>Usa el mismo nombre en varias piezas para asignarles tela y color juntas en Producción.</small></label>
          <div className="piece-material-base"><div className="field"><span>Material predeterminado <small>opcional · puedes elegirlo en Corte</small></span><MaterialFields fabrics={fabrics} material={piece.fabricId ? { fabricId: piece.fabricId, colorId: piece.colorId || '' } : null} inheritedLabel="Elegir en Producción / Corte" label={`Predeterminado de ${piece.name}`} onChange={material => updatePiece(piece.id, material || { fabricId: '', colorId: '' })} /></div><span className="rotation-label">Opciones de corte</span><label className="check-line"><input type="checkbox" checked={Boolean(piece.canRotate)} onChange={e => updatePiece(piece.id, { canRotate: e.target.checked })} /><span>Permitir rotar 90°</span></label><label className="check-line"><input type="checkbox" checked={Boolean(piece.respectDirection)} onChange={e => updatePiece(piece.id, { respectDirection: e.target.checked })} /><span>Respetar dirección</span></label></div>
          <div className="piece-measure-heading"><strong>Medidas por talla</strong><span>Largo / diámetro × ancho · {unitNames[unit]}</span></div><div className="piece-measure-table">{form.sizes.map(size => { const m = piece.measures?.[size.id] ?? { length: 0, width: 0 }; const override = piece.materialsBySize?.[size.id]; return <div className="piece-measure-row" key={size.id}><strong>{size.name}</strong><label className="measure-input"><input type="number" min="0.1" step="0.1" value={fmt(cmToUnit(Number(m.length), unit), 2)} onChange={e => changeMeasurement(piece, size.id, 'length', e.target.value)} /><span>{piece.shape === 'circle' ? 'Ø' : 'largo'}</span></label>{piece.shape !== 'circle' && <label className="measure-input"><input type="number" min="0.1" step="0.1" value={fmt(cmToUnit(Number(m.width), unit), 2)} onChange={e => changeMeasurement(piece, size.id, 'width', e.target.value)} /><span>ancho</span></label>}<div className="field override-field"><span>Material predeterminado de talla</span><MaterialFields fabrics={fabrics} material={override} effective={{ fabricId: piece.fabricId, colorId: piece.colorId }} inheritedLabel="Heredar base" label={`${piece.name}, talla ${size.name}`} onChange={material => updatePiece(piece.id, current => { const materialsBySize = { ...current.materialsBySize }; if (material) materialsBySize[size.id] = material; else delete materialsBySize[size.id]; return { ...current, materialsBySize }; })} /></div></div>; })}</div>
          {piece.shape === 'polygon' && <label className="field polygon-field"><span>Puntos normalizados <small>separados por espacio · x,y entre 0 y 1</small></span><input value={piece.customPoints ?? ''} onChange={e => updatePiece(piece.id, { customPoints: e.target.value })} placeholder="0,0 1,0 0.5,1" /></label>}
        </article>)}</div>
      <button className="add-piece-button" onClick={addPiece}><span><Plus size={17} /></span> Añadir pieza</button>
    </section>
    {error && <div className="form-error"><CircleHelp size={15} />{error}</div>}
    <div className="modal-actions sticky-actions"><button className="button button-ghost" onClick={onClose}>Cancelar</button><button className="button button-primary" onClick={save}><Check size={16} /> Guardar producto</button></div>
  </Modal>;
}

function Modal({ children, onClose, wide = false }) {
  useEffect(() => { const listener = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', listener); const prior = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { window.removeEventListener('keydown', listener); document.body.style.overflow = prior; }; }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal-card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>{children}</div></div>;
}

function HelpModal({ onClose }) {
  return <Modal onClose={onClose}><div className="modal-heading"><div className="eyebrow">GUÍA RÁPIDA</div><h2>Tu flujo de trabajo</h2><p>Atelier Corte guarda la información en este navegador. Puedes conectar Google Sheets desde el botón de configuración para compartirla entre tus dispositivos.</p></div><ol className="help-steps"><li><b>1</b><span><strong>Registra tus telas</strong><small>Ancho útil, costo y colores.</small></span></li><li><b>2</b><span><strong>Crea un producto preset</strong><small>Define tallas, piezas, medidas y margen.</small></span></li><li><b>3</b><span><strong>Prepara la producción</strong><small>Elige talla y unidades para el pedido.</small></span></li><li><b>4</b><span><strong>Revisa y exporta el corte</strong><small>Mueve las piezas si hace falta; exporta CSV, imagen o PDF.</small></span></li></ol><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Entendido <Check size={15} /></button></div></Modal>;
}

function SheetsSyncModal({ sync, onClose, onBackup }) {
  const [clientId, setClientId] = useState(sync.config?.clientId ?? '');
  const [spreadsheet, setSpreadsheet] = useState(sync.config?.spreadsheetId ?? '');
  const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [authorizing, setAuthorizing] = useState(false);
  useEffect(() => { let active = true; loadGoogleIdentity().then(() => { if (active) setReady(true); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function connect() { setError(''); setAuthorizing(true); try { await sync.connect({ clientId, spreadsheet }); } catch (e) { setError(e.message); } finally { setAuthorizing(false); } }
  const busy = authorizing || sync.working;
  return <Modal onClose={onClose}><div className="modal-heading"><div className="eyebrow">GUARDADO Y SINCRONIZACIÓN</div><h2>Google Sheets</h2><p>Conecta la misma hoja en tus dispositivos. Tus datos se siguen guardando en este navegador.</p></div>
    <div className="sync-content">
      <p><a href="/guia-google-sheets.html" target="_blank" rel="noopener noreferrer">Ver los pasos de configuración</a> · Configuración inicial en Google Cloud, una sola vez.</p>
      <label className="field"><span>ID de cliente OAuth de Google</span><input value={clientId} disabled={sync.connected || busy} onChange={e => setClientId(e.target.value)} placeholder="123456789-abc.apps.googleusercontent.com" autoComplete="off" /></label>
      <label className="field"><span>Enlace o ID de la hoja</span><input value={spreadsheet} disabled={sync.connected || busy} onChange={e => setSpreadsheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" autoComplete="off" /></label>
      <div className="sync-status" role="status" aria-live="polite"><strong>{sync.status.message}</strong>{sync.status.at && <small>Última sincronización: {new Date(sync.status.at).toLocaleTimeString('es-MX')}</small>}</div>
      {sync.pending && <div className="sync-choice"><strong>{sync.pending.kind === 'choose' ? '¿Qué datos quieres utilizar?' : 'Hay versiones diferentes'}</strong><p>{sync.pending.empty ? 'La hoja está vacía. En este dispositivo elige subir los datos que ya tienes.' : 'Subir reemplaza los datos de la hoja. Usar la hoja reemplaza los de este dispositivo. Antes se conserva una copia de recuperación local; al reemplazar la hoja se descarga su versión anterior.'}</p>{sync.pending.localCount != null && <p>Este dispositivo: {sync.pending.localCount} productos · Hoja: {sync.pending.remoteCount} productos</p>}<div className="sync-buttons"><button className="button button-primary" disabled={busy} onClick={() => sync.sync('push')}>Subir datos de este dispositivo</button><button className="button button-outline" disabled={busy || sync.pending.empty} onClick={() => sync.sync('pull')}>Usar los datos de la hoja</button></div></div>}
      {error && <div className="form-error">{error}</div>}
      <div className="sync-buttons">{!sync.connected ? <button className="button button-primary" disabled={!ready || busy} onClick={connect}>{authorizing ? 'Autorizando…' : !ready ? 'Cargando Google…' : 'Conectar Google'}</button> : <><button className="button button-primary" disabled={busy || Boolean(sync.pending)} onClick={() => sync.sync()}>Sincronizar ahora</button><button className="button button-outline" disabled={busy} onClick={sync.disconnect}>Desconectar</button></>}</div>
      <p>La conexión dura la sesión autorizada de Google. Si vence o vuelves a abrir la app, pulsa Conectar Google. Para evitar cruces, edita desde un dispositivo a la vez.</p>
      <div className="sync-buttons"><button className="button button-outline small" onClick={onBackup}><FileJson size={14} /> Descargar respaldo actual</button>{sync.getRecovery() && <button className="button button-outline small" onClick={() => downloadFile('atelier-corte-antes-de-sincronizar.json', sync.getRecovery(), 'application/json')}>Descargar copia anterior</button>}</div>
    </div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Cerrar <Check size={15} /></button></div>
  </Modal>;
}

function ModelPage({ data, unit, activeProduct, activeSize, activeProductId, modelSizeId, selectedPieceId, setSelectedPieceId, onProductChange, onSizeChange, onGoCut, onGoProducts }) {
  const [mode, setMode] = useState('auto');
  const [uploadedModel, setUploadedModel] = useState(null);
  const [meshNames, setMeshNames] = useState([]);
  const [mapping, setMapping] = useState({});
  const [modelMessage, setModelMessage] = useState('');
  const product = activeProduct;
  const size = activeSize;
  const pieces = product?.pieces ?? [];
  const handleModelFile = async file => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      const { loadThreeModel } = await import('./Model3D.jsx');
      const { object, names: unique } = await loadThreeModel(file, ext);
      if (!unique.length) throw new Error('No encontré partes visibles en ese archivo.');
      setUploadedModel(object); setMeshNames(unique); setMapping(Object.fromEntries(unique.map((name, i) => [name, pieces[i]?.id ?? '']))); setMode('imported'); setModelMessage(`Modelo cargado: ${file.name}`);
    } catch (error) { setModelMessage(error?.message?.startsWith('Usa') || error?.message?.startsWith('No encontré') ? error.message : 'No se pudo leer el modelo. Para incluir texturas, usa un archivo GLB con los recursos integrados.'); }
  };
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  return <div className="module-page model-page">
    <div className="module-intro"><div><div className="eyebrow">PREVISUALIZACIÓN INTERACTIVA</div><h2>Vista 3D</h2><p>Explora proporciones y materiales por talla. Arrastra para orbitar, usa la rueda para acercar y el clic para seleccionar una pieza.</p></div><button className="button button-outline" onClick={onGoCut}><Layers3 size={16} /> Ver piezas de corte</button></div>
    {!product ? <EmptyState title="Crea un producto para generar el modelo" text="La vista 3D utiliza las piezas y medidas de tus presets." action="Ir a productos" onClick={onGoProducts} /> : <div className="model-layout">
      <section className="panel viewer-panel"><div className="viewer-toolbar"><label className="field compact-field"><span>Producto</span><select value={product.id} onChange={e => onProductChange(e.target.value)}>{data.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field compact-field"><span>Talla</span><select value={size?.id ?? ''} onChange={e => onSizeChange(e.target.value)}>{product.sizes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field compact-field"><span>Modelo</span><select value={mode} onChange={e => setMode(e.target.value)}><option value="auto">Auto · según producto</option><option value="bed">Cama con bordes</option><option value="pillow">Caja / cojín</option><option value="bag">Bolso</option><option value="assembled">Ensamblar piezas</option>{uploadedModel && <option value="imported">Modelo cargado</option>}</select></label><label className="button button-outline small model-upload"><Upload size={14} /> Cargar 3D<input type="file" accept=".glb,.gltf,.obj,model/gltf-binary,model/gltf+json,text/plain" hidden onChange={e => { handleModelFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
        <React.Suspense fallback={<div className="three-viewer viewer-loading">Cargando visor 3D…</div>}><LazyThreeViewer product={product} size={size} fabrics={data.fabrics} mode={mode} importedModel={uploadedModel} mappings={mapping} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} /></React.Suspense>
        <div className="viewer-footer"><span><span className="orbit-icon">⟳</span> Arrastra para girar · rueda para zoom · clic en una parte para seleccionarla</span><span>{modelMessage || (mode === 'imported' ? `Modelo importado · ${mappedCount}/${meshNames.length} partes asignadas` : 'Modelo paramétrico')}</span></div>
      </section>
      <aside className="model-side-column"><div className="panel model-parts-panel"><div className="panel-head"><div><div className="eyebrow">DESGLOSE DE PIEZAS</div><h3>{product.name} · {size?.name}</h3></div><span className="piece-count-pill">{pieces.length} piezas</span></div><div className="model-piece-breakdown">{pieces.map((piece, index) => { const m = piece.measures?.[size?.id] ?? { length: 0, width: 0 }; const mat = materialFor(piece, size?.id, data.fabrics); const active = selectedPieceId === piece.id; const dims = piece.shape === 'circle' ? `Ø ${fmt(cmToUnit(m.length, unit), 1)} ${unitNames[unit]}` : `${fmt(cmToUnit(m.length, unit), 1)} × ${fmt(cmToUnit(m.width, unit), 1)} ${unitNames[unit]}`; return <button className={`model-piece-row ${active ? 'selected' : ''}`} key={piece.id} onClick={() => setSelectedPieceId(piece.id)}><span className="model-piece-index">{String(index + 1).padStart(2, '0')}</span><span className="model-piece-swatch" style={{ background: mat.color?.hex ?? '#d5c8b9' }} /><span className="model-piece-copy"><strong>{piece.name}</strong><small>{dims} · {piece.quantity} por unidad</small></span><span className="model-piece-material">{mat.fabric?.name ?? 'Sin tela'}<small>{mat.color?.name ?? 'Sin color'}</small></span><ChevronDown size={14} /></button>; })}</div><button className="button button-primary full-width" onClick={onGoCut}>Ver estas piezas en el corte <ArrowRight size={15} /></button></div>
        {mode === 'imported' && uploadedModel && <div className="panel mapping-panel"><div className="panel-head"><div><div className="eyebrow">ASIGNACIÓN DE PARTES</div><h3>Telas del modelo</h3></div><span className="mapping-count">{mappedCount}/{meshNames.length}</span></div><p className="panel-hint">Relaciona cada malla del archivo con una pieza. El color del preset se aplica al modelo.</p><div className="mapping-list">{meshNames.map(name => <label className="mapping-row" key={name}><span title={name}>{name}</span><select value={mapping[name] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [name]: e.target.value }))}><option value="">Sin asignar</option>{pieces.map(piece => <option key={piece.id} value={piece.id}>{piece.name}</option>)}</select></label>)}</div></div>}
        <div className="panel model-note"><span className="info-badge blue"><CircleHelp size={17} /></span><div><strong>¿Qué representa el modelo?</strong><p>La vista es una guía visual de volumen. Las piezas del layout incluyen margen de costura y medidas de corte.</p></div></div>
      </aside>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
