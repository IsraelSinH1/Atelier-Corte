import { useCallback, useEffect, useRef, useState } from 'react';
import { dataFingerprint, syncDecision } from './sheetsSchema.js';
import { SheetsClient, parseSpreadsheetId, requestGoogleToken } from './sheetsClient.js';

const CONFIG_KEY = 'atelier-corte-google-sheets-v1';
const BASE_KEY = 'atelier-corte-google-baseline-v1';
const BACKUP_KEY = 'atelier-corte-antes-de-sincronizar-v1';
const LOCAL_DATA_KEY = 'atelier-corte-v1';
function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function downloadRecovery(value, label) {
  const blob = new Blob([JSON.stringify({ ...value, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `atelier-corte-${label}-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function persistLocal(value) {
  try { localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(value)); }
  catch { throw new Error('No hay espacio para guardar estos datos en el navegador. Descarga un respaldo y libera espacio antes de continuar la sincronización.'); }
}
export function useSheetsSync(data, setData, notify, editing = false) {
  const [config, setConfig] = useState(() => readStorage(CONFIG_KEY, null));
  const [status, setStatus] = useState({ kind: 'local', message: 'Guardado local' });
  const [pending, setPending] = useState(null);
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const clientRef = useRef(null); const busy = useRef(false); const dataRef = useRef(data); const paused = useRef(false);
  const baseline = useRef(readStorage(BASE_KEY, null)); const mounted = useRef(true);
  const editingRef = useRef(editing); editingRef.current = editing;
  dataRef.current = data;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const checkpoint = useCallback((localHash, remoteHash, spreadsheetId) => {
    baseline.current = { localHash, remoteHash, spreadsheetId }; localStorage.setItem(BASE_KEY, JSON.stringify(baseline.current));
  }, []);
  const backup = useCallback((value) => {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...value, exportedAt: new Date().toISOString() })); }
    catch { downloadRecovery(value, 'copia-anterior'); notify('Se descargó la copia anterior porque no había espacio para guardarla en el navegador.'); }
  }, [notify]);
  const sync = useCallback(async (force = null) => {
    const client = clientRef.current;
    if (!client || busy.current || editingRef.current || (paused.current && !force)) return;
    if (!navigator.onLine) { setStatus({ kind: 'offline', message: 'Sin conexión · cambios guardados localmente' }); return; }
    busy.current = true; setWorking(true); setStatus({ kind: 'syncing', message: 'Sincronizando…' });
    let wrote = false;
    try {
      const snapshot = dataRef.current; const localHash = await dataFingerprint(snapshot); const remote = await client.read();
      if (dataRef.current !== snapshot || editingRef.current) { setStatus({ kind: 'pending', message: 'Hay cambios locales pendientes' }); return; }
      const base = baseline.current?.spreadsheetId === client.id ? baseline.current : null;
      let action = syncDecision(localHash, remote.hash, base);
      if (force === 'pull' && remote.empty) throw new Error('La hoja está vacía. Primero sube tus datos desde el dispositivo que ya los contiene.');
      if (force) action = force;
      if (action === 'choose' || action === 'conflict') {
        paused.current = true; setPending({ kind: action, empty: remote.empty, localCount: snapshot.products.length, remoteCount: remote.data.products.length });
        setStatus({ kind: 'conflict', message: action === 'choose' ? 'Elige los datos de la primera sincronización' : 'Cambios en ambos lugares · revisa las versiones' }); return;
      }
      if (action === 'push') {
        // A cloud write must never advance the baseline past the durable local copy.
        persistLocal(snapshot);
        if (force && !remote.empty) {
          downloadRecovery(remote.data, 'hoja-antes-de-reemplazar');
        }
        await client.write(snapshot, remote.hash); wrote = true;
        if (!mounted.current || client !== clientRef.current) return;
        checkpoint(localHash, localHash, client.id);
      } else if (action === 'pull') {
        backup(snapshot);
        const latestHash = await dataFingerprint(dataRef.current);
        if (latestHash !== localHash || editingRef.current) { setStatus({ kind: 'pending', message: 'Hay cambios locales pendientes' }); return; }
        if (!mounted.current || client !== clientRef.current) return;
        persistLocal(remote.data);
        setData(remote.data); checkpoint(remote.hash, remote.hash, client.id);
      } else { persistLocal(snapshot); checkpoint(localHash, remote.hash, client.id); }
      paused.current = false; setPending(null);
      setStatus({ kind: 'synced', message: 'Guardado en Google Sheets', at: Date.now() });
      if (force) notify(wrote ? 'Datos guardados en Google Sheets.' : 'Datos de Google Sheets cargados. Se conservó una copia local anterior.');
    } catch (error) {
      if (error.code === 'auth') { clientRef.current = null; setConnected(false); setStatus({ kind: 'auth', message: error.message }); }
      else if (error.code === 'conflict') { paused.current = true; setPending({ kind: 'conflict', empty: false }); setStatus({ kind: 'conflict', message: error.message }); }
      else setStatus({ kind: 'error', message: error.message });
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }, [backup, checkpoint, notify, setData]);

  const connect = useCallback(async ({ clientId, spreadsheet }) => {
    if (busy.current) return;
    if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new Error('Introduce el ID de cliente OAuth de tipo Aplicación web.');
    const id = parseSpreadsheetId(spreadsheet);
    const token = await requestGoogleToken(clientId.trim());
    const value = { clientId: clientId.trim(), spreadsheetId: id };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(value)); setConfig(value);
    clientRef.current = new SheetsClient(id, token); paused.current = false; setPending(null); setConnected(true);
    await sync();
  }, [sync]);
  const disconnect = useCallback(() => {
    if (busy.current) return;
    clientRef.current = null; paused.current = true; setConnected(false); setPending(null); setStatus({ kind: 'local', message: 'Guardado local · Google desconectado' });
  }, []);
  useEffect(() => {
    if (!connected) return;
    if (!paused.current && !busy.current) setStatus(prev => ({ ...prev, kind: 'pending', message: 'Cambios pendientes de sincronizar' }));
    const timer = setTimeout(() => sync(), 1800); return () => clearTimeout(timer);
  }, [data, connected, sync, editing]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => { if (!document.hidden) sync(); }, 30000);
    const resume = () => { if (!document.hidden) sync(); };
    window.addEventListener('online', resume); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [connected, sync]);
  const getRecovery = () => localStorage.getItem(BACKUP_KEY);
  return { config, status, pending, connected, working, connect, disconnect, sync, getRecovery };
}
