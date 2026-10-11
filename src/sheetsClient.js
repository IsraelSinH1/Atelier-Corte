import { SHEET_SCHEMA, columnName, toSheetTables, fromSheetTables, dataFingerprint } from './sheetsSchema.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let googlePromise;
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = setTimeout(() => { script.remove(); googlePromise = null; reject(new Error('Google tardó demasiado en cargar. Revisa tu conexión y vuelve a abrir esta configuración.')); }, 20000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); googlePromise = null; reject(new Error('No se pudo cargar Google. Revisa la conexión o el bloqueador del navegador.')); };
    document.head.appendChild(script);
  });
  return googlePromise;
}
export function parseSpreadsheetId(value) {
  const match = String(value).trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = match ? match[1] : String(value).trim();
  if (!/^[a-zA-Z0-9_-]{15,}$/.test(id)) throw new Error('Pega el enlace completo de Google Sheets o su ID.');
  return id;
}
export function requestGoogleToken(clientId) {
  return new Promise((resolve, reject) => {
    if (!globalThis.google?.accounts?.oauth2) return reject(new Error('Google todavía está cargando. Intenta de nuevo.'));
    const client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SHEETS_SCOPE, include_granted_scopes: false,
      callback: response => {
        if (response.error || !response.access_token) return reject(new Error('No se autorizó la conexión con Google. Tus datos locales siguen guardados.'));
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, SHEETS_SCOPE)) return reject(new Error('Autoriza el acceso a Google Sheets para sincronizar.'));
        resolve({ accessToken: response.access_token, expiresAt: Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000 });
      },
      error_callback: error => reject(new Error(error.type === 'popup_failed_to_open' ? 'Permite las ventanas emergentes para este sitio y vuelve a conectar.' : 'Se cerró la autorización de Google. Puedes volver a conectar.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

export class SheetsClient {
  // Native browser fetch requires its global receiver. Calling an extracted
  // reference as this.fetcher() can throw "Illegal invocation" before sending.
  constructor(spreadsheetId, token, fetcher = (url, options) => globalThis.fetch(url, options)) { this.id = spreadsheetId; this.token = token; this.fetcher = fetcher; }
  async request(path, options = {}) {
    if (Date.now() >= this.token.expiresAt) { const e = new Error('La sesión de Google venció. Pulsa Conectar Google para continuar.'); e.code = 'auth'; throw e; }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.id)}${path}`, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${this.token.accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const result = await response.json();
      if (!response.ok) {
        const messages = { 401: 'La sesión de Google venció. Vuelve a conectar.', 403: 'Google no permitió el acceso. Revisa que la API de Sheets esté habilitada, que autorizaste el permiso y que tienes acceso de edición a la hoja.', 404: 'No se encontró la hoja. Revisa el enlace y la cuenta de Google.', 429: 'Google limitó temporalmente las solicitudes. La app volverá a intentarlo.' };
        const error = new Error(messages[response.status] || `Google Sheets rechazó la solicitud: ${result.error?.message ?? response.status}.`); error.code = response.status === 401 ? 'auth' : 'api'; throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Google Sheets no respondió a tiempo. Tus cambios siguen guardados localmente.');
      if (error instanceof TypeError) throw new Error('No hay conexión con Google Sheets. Tus cambios siguen guardados localmente.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async read() {
    const search = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
    for (const [name, headers] of Object.entries(SHEET_SCHEMA)) search.append('ranges', `'${name}'!A:${columnName(headers.length)}`);
    const result = await this.request(`/values:batchGet?${search}`);
    const tables = Object.fromEntries(Object.keys(SHEET_SCHEMA).map((name, index) => [name, result.valueRanges?.[index]?.values ?? []]));
    const parsed = fromSheetTables(tables);
    return { ...parsed, hash: await dataFingerprint(parsed.data) };
  }
  async write(data, expectedHash) {
    // Re-read immediately before the atomic batch. Sheets has no compare-and-swap;
    // use one editing device at a time (documented in the setup guide).
    const current = await this.read();
    if (current.hash !== expectedHash) { const e = new Error('La hoja cambió antes de guardar. Revisa qué versión quieres conservar.'); e.code = 'conflict'; throw e; }
    const meta = await this.request('?fields=sheets.properties');
    const properties = new Map(meta.sheets.map(s => [s.properties.title, s.properties]));
    const tables = toSheetTables(data, { revision: globalThis.crypto.randomUUID(), modifiedAt: new Date().toISOString() });
    fromSheetTables(tables); // Validate the complete snapshot before touching Google.
    const requests = [];
    for (const [name, rows] of Object.entries(tables)) {
      const property = properties.get(name); if (!property) throw new Error(`Falta la pestaña ${name}. Usa la plantilla entregada.`);
      const columns = SHEET_SCHEMA[name].length; const rowCount = Math.max(property.gridProperties.rowCount, rows.length);
      if (rows.length > property.gridProperties.rowCount) requests.push({ appendDimension: { sheetId: property.sheetId, dimension: 'ROWS', length: rows.length - property.gridProperties.rowCount } });
      if (columns > property.gridProperties.columnCount) requests.push({ appendDimension: { sheetId: property.sheetId, dimension: 'COLUMNS', length: columns - property.gridProperties.columnCount } });
      requests.push({ updateCells: { range: { sheetId: property.sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columns }, rows: rows.map(values => ({ values: values.map(value => ({ userEnteredValue: typeof value === 'boolean' ? { boolValue: value } : typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } })) })), fields: 'userEnteredValue' } });
    }
    await this.request(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
    const verified = await this.read();
    const hash = await dataFingerprint(data);
    if (verified.hash !== hash) { const e = new Error('La hoja cambió durante el guardado. La sincronización se pausó para revisar las versiones.'); e.code = 'conflict'; throw e; }
    return verified;
  }
}
