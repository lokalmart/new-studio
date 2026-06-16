const SAFE_CELL_LIMIT = 32000;

const HELPER_COLUMNS = new Set([
  '_model', '__action', '_external_id', 'external_id', 'id', 'x_studio2_odoo_id',
  '__rownum__', '_studio_note', '_studio_error', '_studio_warning'
]);

const DEFAULT_SCHEMA_MODELS = [
  'ir.model', 'ir.model.fields', 'ir.model.access', 'ir.model.data',
  'res.partner', 'res.users', 'res.groups',
  'project.project', 'project.task', 'project.task.type', 'project.milestone', 'project.update',
  'product.template', 'product.product', 'product.category', 'product.pricelist',
  'knowledge.article', 'website.page', 'ir.ui.view'
];

const SCHEMA_ATTRS = [
  'string', 'type', 'required', 'readonly', 'relation', 'selection', 'help',
  'store', 'compute', 'related', 'depends', 'sortable', 'groups', 'size',
  'domain', 'context', 'company_dependent', 'tracking'
];

function json(data, status = 200) {
  return { status, data };
}

function cleanUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function envConn() {
  const password = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY || '';
  return {
    url: process.env.ODOO_URL || process.env.ODOO_BASE_URL || '',
    db: process.env.ODOO_DB || process.env.ODOO_DATABASE || '',
    username: process.env.ODOO_USERNAME || process.env.ODOO_EMAIL || '',
    password
  };
}

function hasCompleteConn(conn) {
  return Boolean(conn && conn.url && conn.db && conn.username && conn.password);
}

function getConn(clientConn = {}) {
  const env = envConn();
  if (hasCompleteConn(env)) return { ...env, source: 'vercel_env' };
  return { ...(clientConn || {}), source: 'browser' };
}

function connStatus() {
  const env = envConn();
  const missing = [];
  if (!env.url) missing.push('ODOO_URL');
  if (!env.db) missing.push('ODOO_DB');
  if (!env.username) missing.push('ODOO_USERNAME');
  if (!env.password) missing.push('ODOO_PASSWORD / ODOO_API_KEY');
  return {
    env_configured: missing.length === 0,
    env_missing: missing,
    source: missing.length === 0 ? 'vercel_env' : 'browser_fallback',
    public_hint: missing.length === 0
      ? 'Koneksi Odoo dibaca dari Vercel Environment Variables.'
      : 'Env Vercel belum lengkap; Studio memakai koneksi browser sebagai fallback.'
  };
}

function assertConn(conn) {
  if (!conn || !conn.url || !conn.db || !conn.username || !conn.password) {
    throw new Error('Koneksi Odoo belum lengkap: url, db, username, password/API key wajib diisi.');
  }
}

async function rpc(conn, service, method, args) {
  assertConn(conn);
  const res = await fetch(`${cleanUrl(conn.url)}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now()
    }),
    cache: 'no-store'
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Odoo non-JSON HTTP ${res.status}: ${text.slice(0, 600)}`);
  }
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}: ${text.slice(0, 600)}`);
  if (payload.error) {
    const detail = payload.error?.data?.message || payload.error?.message || JSON.stringify(payload.error);
    throw new Error(`Odoo JSON-RPC fault: ${detail}`);
  }
  return payload.result;
}

async function login(conn) {
  const uid = await rpc(conn, 'common', 'login', [conn.db, conn.username, conn.password]);
  if (!uid) throw new Error('Login Odoo gagal. Periksa database, email, password/API key.');
  return uid;
}

async function executeKw(conn, uid, model, method, args = [], kwargs = {}) {
  return rpc(conn, 'object', 'execute_kw', [conn.db, uid, conn.password, model, method, args, kwargs]);
}

async function fieldsGet(conn, uid, model) {
  return executeKw(conn, uid, model, 'fields_get', [], { attributes: SCHEMA_ATTRS });
}

async function safeExecuteKw(conn, uid, model, method, args = [], kwargs = {}, fallback = null) {
  try {
    return await executeKw(conn, uid, model, method, args, kwargs);
  } catch (err) {
    return fallback;
  }
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'ya', 'iya'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'tidak', ''].includes(s)) return false;
  return null;
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '')
    .replace(/rp/ig, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateLike(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (/^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2}:\d{2})?$/.test(s)) return true;
  return !Number.isNaN(Date.parse(s));
}

function normalizeAction(value) {
  const action = String(value || 'upsert').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['create_or_update', 'create_update', 'create_and_update', 'insert_or_update'].includes(action)) return 'upsert';
  return action || 'upsert';
}

function safeExternalPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 200) || 'unnamed';
}

function splitXmlId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (raw.includes('.')) {
    const [module, ...rest] = raw.split('.');
    return { module: safeExternalPart(module), name: safeExternalPart(rest.join('.')) };
  }
  return { module: 'studio2', name: safeExternalPart(raw) };
}

function completeXmlId(value) {
  const p = splitXmlId(value);
  if (!p) return '';
  return `${p.module}.${p.name}`;
}

async function resolveXmlId(conn, uid, xmlid, cache = new Map()) {
  const key = completeXmlId(xmlid);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const rows = await safeExecuteKw(
    conn, uid, 'ir.model.data', 'search_read', [[['complete_name', '=', key]]],
    { fields: ['complete_name', 'model', 'res_id'], limit: 1 }, []
  );
  const found = rows && rows.length ? { xmlid: key, model: rows[0].model, id: Number(rows[0].res_id) } : null;
  cache.set(key, found);
  return found;
}

async function findModelRecord(conn, uid, technicalModel) {
  const rows = await safeExecuteKw(conn, uid, 'ir.model', 'search_read', [[['model', '=', technicalModel]]], {
    fields: ['id', 'name', 'model', 'state', 'modules', 'transient'],
    limit: 1
  }, []);
  return rows && rows.length ? rows[0] : null;
}

async function checkAccess(conn, uid, model) {
  const out = {};
  for (const perm of ['read', 'create', 'write', 'unlink']) {
    out[perm] = Boolean(await safeExecuteKw(conn, uid, model, 'check_access_rights', [perm], { raise_exception: false }, false));
  }
  return out;
}

async function defaultGet(conn, uid, model, fields) {
  if (!fields.length) return {};
  return await safeExecuteKw(conn, uid, model, 'default_get', [fields], {}, {});
}

async function getSchemaPack(conn, uid, model) {
  const pack = { model, ok: false, fields: {}, fieldRows: [], access: {}, modelMeta: null, error: '' };
  try {
    pack.fields = await fieldsGet(conn, uid, model);
    pack.ok = true;
    pack.access = await checkAccess(conn, uid, model);
    pack.modelMeta = await findModelRecord(conn, uid, model);
    if (pack.modelMeta && pack.modelMeta.id) {
      const fieldSchema = await safeExecuteKw(conn, uid, 'ir.model.fields', 'fields_get', [], {
        attributes: ['type', 'string']
      }, {});
      const wanted = [
        'id', 'name', 'field_description', 'model', 'model_id', 'ttype', 'state', 'required',
        'readonly', 'relation', 'copied', 'store', 'index', 'on_delete', 'ondelete',
        'depends', 'compute', 'related', 'modules'
      ].filter(f => fieldSchema[f]);
      pack.fieldRows = await safeExecuteKw(conn, uid, 'ir.model.fields', 'search_read', [[['model_id', '=', pack.modelMeta.id]]], {
        fields: wanted,
        limit: 5000,
        order: 'name asc'
      }, []);
    }
  } catch (err) {
    pack.error = err?.message || String(err);
  }
  return pack;
}

function sanitizeCell(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value).slice(0, SAFE_CELL_LIMIT);
  if (typeof value === 'string') return value.slice(0, SAFE_CELL_LIMIT);
  return value;
}

function inferModelsFromSheets(sheets = []) {
  const models = new Set();
  for (const sheet of sheets || []) {
    if (sheet.model) models.add(String(sheet.model).trim());
    for (const row of sheet.rows || []) if (row._model) models.add(String(row._model).trim());
  }
  return [...models].filter(Boolean);
}

async function handleSchema(conn, body) {
  const uid = await login(conn);
  const model = String(body.model || '').trim();
  if (!model) throw new Error('Model kosong.');
  const pack = await getSchemaPack(conn, uid, model);
  if (!pack.ok) throw new Error(pack.error || `Model tidak bisa dibaca: ${model}`);
  return { ok: true, ...pack };
}

async function handleSchemaSnapshot(conn, body) {
  const uid = await login(conn);
  const requested = Array.isArray(body.models) && body.models.length ? body.models : inferModelsFromSheets(body.sheets);
  const models = [...new Set([...(requested || []), ...(body.includeDefaults === false ? [] : DEFAULT_SCHEMA_MODELS)])]
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 80);

  const packs = [];
  for (const model of models) packs.push(await getSchemaPack(conn, uid, model));

  const modelRows = [];
  const fieldRows = [];
  const requiredRows = [];
  const relationRows = [];
  const selectionRows = [];
  const accessRows = [];
  const errors = [];

  for (const pack of packs) {
    if (!pack.ok) {
      errors.push({ model: pack.model, error: pack.error });
      modelRows.push({ model: pack.model, ok: false, error: pack.error });
      continue;
    }
    modelRows.push({
      model: pack.model,
      ok: true,
      name: pack.modelMeta?.name || '',
      state: pack.modelMeta?.state || '',
      modules: pack.modelMeta?.modules || '',
      fields: Object.keys(pack.fields).length,
      can_read: pack.access.read,
      can_create: pack.access.create,
      can_write: pack.access.write,
      can_unlink: pack.access.unlink
    });
    accessRows.push({ model: pack.model, ...pack.access });
    for (const [name, f] of Object.entries(pack.fields || {})) {
      const row = {
        model: pack.model,
        name,
        label: f.string || '',
        type: f.type || '',
        required: Boolean(f.required),
        readonly: Boolean(f.readonly),
        relation: f.relation || '',
        selection: f.selection ? JSON.stringify(f.selection) : '',
        store: f.store,
        compute: f.compute || '',
        related: Array.isArray(f.related) ? f.related.join('.') : (f.related || ''),
        help: f.help || '',
        groups: f.groups || ''
      };
      fieldRows.push(row);
      if (f.required) requiredRows.push(row);
      if (['many2one', 'many2many', 'one2many'].includes(f.type)) relationRows.push(row);
      if (f.type === 'selection' && Array.isArray(f.selection)) {
        for (const opt of f.selection) selectionRows.push({ model: pack.model, field: name, value: opt[0], label: opt[1] });
      }
    }
  }

  const aiRules = [
    'Gunakan _model, __action, _external_id di setiap sheet data importable.',
    'Many2one ditulis sebagai field_name_external_id bila memungkinkan; direct ID hanya boleh dari DB target yang sama.',
    'Many2many ditulis sebagai field_name_external_ids berisi external ID dipisah koma/titik koma.',
    'Jangan tulis field readonly/computed/non-stored kecuali memang writable di schema real.',
    'Sebelum data model custom: import ir.model -> ir.model.fields -> ir.model.access -> records.',
    'Custom field Odoo Online gunakan nama x_*; custom model gunakan x_*; jangan ubah field identitas teknis yang sudah ada.',
    'Untuk ir.model.fields many2one wajib relation; jika required true, ondelete/on_delete harus restrict atau cascade.',
    'Jangan import sebelum preflight ok = true.'
  ];

  const compact = {
    exported_at: new Date().toISOString(),
    db: conn.db,
    source: conn.source,
    models: modelRows,
    required_fields: requiredRows,
    relation_fields: relationRows,
    selection_values: selectionRows,
    import_rules: aiRules,
    errors
  };

  // Schema snapshot may be partially successful. A missing/inaccessible optional model
  // should not block export/download because the usable schema rows are still valuable
  // for ChatGPT and preflight. Fatal failures are still caught by the outer POST handler.
  return {
    ok: true,
    partial_ok: errors.length > 0,
    error_count: errors.length,
    exported_at: compact.exported_at,
    sheets: {
      '__manifest': [{ exported_at: compact.exported_at, db: conn.db, source: conn.source, models: modelRows.length, errors: errors.length }],
      'schema.models': modelRows,
      'schema.fields': fieldRows,
      'schema.required': requiredRows,
      'schema.relations': relationRows,
      'schema.selection': selectionRows,
      'schema.access': accessRows,
      'schema.errors': errors,
      'ai.import_rules': aiRules.map((rule, i) => ({ no: i + 1, rule })),
      'ai.context.json': chunkText(JSON.stringify(compact, null, 2), SAFE_CELL_LIMIT).map((text, i) => ({ part: i + 1, text }))
    },
    context: compact
  };
}

function chunkText(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

function rowValue(row, key) {
  return row ? row[key] : undefined;
}

function getRelationExternalKey(key) {
  if (key.endsWith('_external_ids')) return { field: key.replace(/_external_ids$/, ''), many: true };
  if (key.endsWith('_external_id')) return { field: key.replace(/_external_id$/, ''), many: false };
  return null;
}

function addIssue(issues, level, sheet, row, model, field, message, suggestion = '') {
  issues.push({
    level,
    sheet: sheet || '',
    row: row || '',
    model: model || '',
    field: field || '',
    message,
    suggestion
  });
}

function actionNeedsExisting(action) {
  return ['update', 'write', 'delete', 'unlink'].includes(action);
}

function actionCanCreate(action) {
  return ['create', 'upsert'].includes(action);
}

async function locateExisting(conn, uid, model, row, xmlCache, vals = {}) {
  const external = row._external_id || row.external_id || '';
  if (external) {
    const found = await resolveXmlId(conn, uid, external, xmlCache);
    if (found) return { ...found, source: '_external_id' };
  }
  const odooId = Number(row.x_studio2_odoo_id || row.id || 0);
  if (odooId) {
    const count = await safeExecuteKw(conn, uid, model, 'search_count', [[['id', '=', odooId]]], {}, 0);
    if (count) return { model, id: odooId, source: 'id' };
  }
  if (model === 'ir.model' && (row.model || vals.model)) {
    const rows = await safeExecuteKw(conn, uid, 'ir.model', 'search_read', [[['model', '=', String(row.model || vals.model)]]], { fields: ['id'], limit: 1 }, []);
    if (rows.length) return { model, id: Number(rows[0].id), source: 'natural:model' };
  }
  if (model === 'ir.model.fields' && (row.name || vals.name)) {
    let modelId = Number(vals.model_id || row.model_id || 0);
    if (!modelId && row.model_id_external_id) {
      const m = await resolveXmlId(conn, uid, row.model_id_external_id, xmlCache);
      if (m) modelId = Number(m.id);
    }
    if (!modelId && row.model) {
      const m = await findModelRecord(conn, uid, String(row.model));
      if (m) modelId = Number(m.id);
    }
    if (modelId) {
      const rows = await safeExecuteKw(conn, uid, 'ir.model.fields', 'search_read', [[['model_id', '=', modelId], ['name', '=', String(row.name || vals.name)]]], { fields: ['id'], limit: 1 }, []);
      if (rows.length) return { model, id: Number(rows[0].id), source: 'natural:model_id+name' };
    }
  }
  return null;
}

async function validateCell(conn, uid, sheet, rowIndex, model, fieldName, rawValue, schema, issues, xmlCache) {
  const field = schema[fieldName];
  if (!field) {
    addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Kolom '${fieldName}' tidak ada di schema real model ${model}.`, 'Hapus kolom ini atau buat field custom x_* lebih dulu.');
    return;
  }
  if (isBlank(rawValue)) return;
  if (field.readonly) {
    addIssue(issues, 'warn', sheet, rowIndex, model, fieldName, `Field '${fieldName}' readonly/computed menurut schema; importer akan mengabaikannya saat write.`, 'Jangan isi field ini kecuali memang sudah terbukti writable.');
    return;
  }
  if (field.type === 'boolean' && parseBoolean(rawValue) === null) {
    addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Nilai boolean tidak valid: ${rawValue}`, 'Gunakan true/false, 1/0, ya/tidak.');
  }
  if (['integer', 'float', 'monetary'].includes(field.type) && parseNumber(rawValue) === null) {
    addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Nilai angka tidak valid: ${rawValue}`, 'Gunakan angka bersih, contoh 15000 atau 15000.5.');
  }
  if (['date', 'datetime'].includes(field.type) && !parseDateLike(rawValue)) {
    addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Format tanggal/datetime tidak valid: ${rawValue}`, 'Gunakan YYYY-MM-DD atau YYYY-MM-DD HH:mm:ss.');
  }
  if (field.type === 'selection' && Array.isArray(field.selection)) {
    const allowed = field.selection.map(x => String(x[0]));
    if (!allowed.includes(String(rawValue))) {
      addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Value selection tidak valid: ${rawValue}`, `Gunakan salah satu: ${allowed.join(', ')}`);
    }
  }
  if (field.type === 'many2one') {
    const n = Number(rawValue);
    if (!Number.isFinite(n) || n <= 0) {
      addIssue(issues, 'error', sheet, rowIndex, model, fieldName, `Many2one '${fieldName}' tidak boleh berisi nama bebas.`, `Gunakan ${fieldName}_external_id atau ID numeric dari DB target.`);
    }
  }
  if (['many2many', 'one2many'].includes(field.type)) {
    addIssue(issues, 'warn', sheet, rowIndex, model, fieldName, `Relasi ${field.type} langsung di kolom '${fieldName}' rawan gagal.`, `Gunakan ${fieldName}_external_ids untuk many2many, atau import child records lewat sheet sendiri.`);
  }
}

async function validateRelationExternal(conn, uid, sheet, rowIndex, model, key, rawValue, schema, issues, xmlCache) {
  const rel = getRelationExternalKey(key);
  if (!rel) return false;
  const field = schema[rel.field];
  if (!field) {
    addIssue(issues, 'error', sheet, rowIndex, model, key, `Kolom relasi '${key}' mengarah ke field '${rel.field}', tetapi field itu tidak ada.`, 'Perbaiki nama kolom atau buat field relasi lebih dulu.');
    return true;
  }
  if (rel.many && field.type !== 'many2many') {
    addIssue(issues, 'error', sheet, rowIndex, model, key, `${key} hanya aman untuk many2many, tetapi '${rel.field}' bertipe ${field.type}.`, 'Gunakan _external_id untuk many2one atau import child rows untuk one2many.');
    return true;
  }
  if (!rel.many && field.type !== 'many2one') {
    addIssue(issues, 'error', sheet, rowIndex, model, key, `${key} hanya aman untuk many2one, tetapi '${rel.field}' bertipe ${field.type}.`, 'Gunakan format relasi yang sesuai tipe field.');
    return true;
  }
  if (isBlank(rawValue)) return true;
  const parts = rel.many ? String(rawValue).split(/[;,]/).map(x => x.trim()).filter(Boolean) : [String(rawValue).trim()];
  for (const part of parts) {
    const found = await resolveXmlId(conn, uid, part, xmlCache);
    if (!found) {
      addIssue(issues, 'error', sheet, rowIndex, model, key, `External ID tidak ditemukan: ${part}`, 'Pastikan record relasi sudah ada/import dulu, atau masukkan sheet relasinya sebelum sheet ini.');
    } else if (field.relation && found.model !== field.relation) {
      addIssue(issues, 'error', sheet, rowIndex, model, key, `External ID ${part} menunjuk model ${found.model}, bukan ${field.relation}.`, 'Gunakan external ID dari model relasi yang benar.');
    }
  }
  return true;
}

function specialMetadataChecks(sheet, rowIndex, model, row, issues) {
  const action = normalizeAction(row.__action);
  if (model === 'ir.model') {
    const technical = row.model || row.name;
    if (actionCanCreate(action) && technical && !String(technical).startsWith('x_')) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'model', 'Custom model di Odoo Online harus memakai technical name x_*.', 'Contoh: x_lokal_id, bukan lokal.id.');
    }
  }
  if (model === 'ir.model.fields') {
    const name = row.name || '';
    if (actionCanCreate(action) && name && !String(name).startsWith('x_')) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'name', 'Custom field harus memakai nama x_*.', 'Contoh: x_lokal_id, x_role_ids.');
    }
    if (actionCanCreate(action) && !row.model_id && !row.model_id_external_id && !row.model) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'model_id', 'ir.model.fields wajib tahu target model.', 'Isi model_id_external_id atau kolom model dengan technical name.');
    }
    const ttype = String(row.ttype || '').trim();
    if (['many2one', 'many2many', 'one2many'].includes(ttype) && !row.relation) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'relation', `Field ${ttype} wajib punya relation.`, 'Isi relation dengan model target, contoh res.partner.');
    }
    const required = parseBoolean(row.required) === true || row.required === true;
    const ondelete = String(row.ondelete || row.on_delete || '').trim();
    if (ttype === 'many2one' && required && !['restrict', 'cascade'].includes(ondelete)) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'ondelete', 'Many2one required harus memakai ondelete restrict atau cascade.', 'Isi ondelete dan on_delete = restrict bila importer/schema butuh dua-duanya.');
    }
  }
  if (model === 'ir.model.access') {
    if (actionCanCreate(action) && !row.model_id && !row.model_id_external_id) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'model_id', 'ACL wajib punya model_id/model_id_external_id.', 'Buat ACL setelah ir.model sudah ada.');
    }
  }
  if (model === 'project.task') {
    const self = row._external_id || row.external_id || '';
    const parent = row.parent_id_external_id || '';
    if (self && parent && completeXmlId(self) === completeXmlId(parent)) {
      addIssue(issues, 'error', sheet, rowIndex, model, 'parent_id_external_id', 'Task tidak boleh menjadi parent dirinya sendiri.', 'Perbaiki parent_id_external_id.');
    }
  }
}

function buildImportOrderWarning(sheets, issues) {
  const order = [];
  for (const sheet of sheets || []) {
    for (const row of sheet.rows || []) {
      const m = row._model || sheet.model;
      if (m && !order.includes(m)) order.push(m);
    }
  }
  const pos = (m) => order.indexOf(m);
  if (pos('ir.model.fields') >= 0 && pos('ir.model') >= 0 && pos('ir.model.fields') < pos('ir.model')) {
    addIssue(issues, 'error', '', '', 'ir.model.fields', '', 'Urutan import salah: ir.model.fields muncul sebelum ir.model.', 'Import ir.model dulu, baru ir.model.fields.');
  }
  if (pos('ir.model.access') >= 0 && pos('ir.model.fields') >= 0 && pos('ir.model.access') < pos('ir.model.fields')) {
    addIssue(issues, 'warn', '', '', 'ir.model.access', '', 'ACL muncul sebelum field selesai.', 'Umumnya aman: ir.model -> ir.model.fields -> ir.model.access -> data records.');
  }
}

async function handlePreflight(conn, body) {
  const uid = await login(conn);
  const sheets = Array.isArray(body.sheets) ? body.sheets : [];
  if (!sheets.length) throw new Error('Tidak ada sheet untuk preflight.');

  const issues = [];
  const plan = [];
  const schemaCache = new Map();
  const xmlCache = new Map();
  const seenExternal = new Map();
  let rowsChecked = 0;

  buildImportOrderWarning(sheets, issues);

  for (const sheet of sheets) {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = row.__rownum__ || i + 2;
      const model = String(row._model || sheet.model || '').trim();
      const action = normalizeAction(row.__action);
      rowsChecked++;

      if (['skip', 'ignore'].includes(action)) {
        plan.push({ sheet: sheet.name, row: rowIndex, model, action, decision: 'skip' });
        continue;
      }
      if (!model) {
        addIssue(issues, 'error', sheet.name, rowIndex, model, '_model', 'Model kosong.', 'Isi _model atau beri nama sheet sesuai technical model Odoo.');
        continue;
      }
      if (!['upsert', 'create', 'update', 'write', 'delete', 'unlink'].includes(action)) {
        addIssue(issues, 'error', sheet.name, rowIndex, model, '__action', `Action tidak dikenal: ${action}`, 'Gunakan upsert/create/update/delete/skip.');
      }
      if (!schemaCache.has(model)) schemaCache.set(model, await getSchemaPack(conn, uid, model));
      const pack = schemaCache.get(model);
      if (!pack.ok) {
        addIssue(issues, 'error', sheet.name, rowIndex, model, '_model', `Model tidak bisa dibaca: ${pack.error}`, 'Pastikan model ada dan user punya akses.');
        continue;
      }
      const schema = pack.fields;
      const access = pack.access || {};
      if (['create', 'upsert'].includes(action) && !access.create) addIssue(issues, 'error', sheet.name, rowIndex, model, '__action', `User tidak punya akses create pada ${model}.`, 'Tambahkan ir.model.access atau gunakan user admin.');
      if (['update', 'write', 'upsert'].includes(action) && !access.write) addIssue(issues, 'error', sheet.name, rowIndex, model, '__action', `User tidak punya akses write pada ${model}.`, 'Tambahkan ACL atau gunakan user admin.');
      if (['delete', 'unlink'].includes(action) && !access.unlink) addIssue(issues, 'error', sheet.name, rowIndex, model, '__action', `User tidak punya akses delete/unlink pada ${model}.`, 'Archive lebih aman daripada delete untuk record yang direferensikan.');

      const external = row._external_id || row.external_id || '';
      if (external) {
        const key = completeXmlId(external);
        const first = seenExternal.get(key);
        if (first) addIssue(issues, 'error', sheet.name, rowIndex, model, '_external_id', `Duplicate _external_id dengan ${first.sheet} row ${first.row}.`, 'Setiap record harus punya external ID unik.');
        else seenExternal.set(key, { sheet: sheet.name, row: rowIndex, model });
        const found = await resolveXmlId(conn, uid, external, xmlCache);
        if (found && found.model !== model) {
          addIssue(issues, 'error', sheet.name, rowIndex, model, '_external_id', `External ID sudah dipakai oleh model ${found.model}.`, 'Ganti _external_id atau target model.');
        }
      }

      const existing = await locateExisting(conn, uid, model, row, xmlCache);
      if (actionNeedsExisting(action) && !existing) {
        addIssue(issues, 'error', sheet.name, rowIndex, model, '_external_id', `${action} butuh record existing, tetapi tidak ditemukan.`, 'Isi _external_id yang sudah ada atau x_studio2_odoo_id/id.');
      }

      const requiredFields = Object.entries(schema)
        .filter(([name, f]) => f.required && !f.readonly && !['id', 'display_name'].includes(name))
        .map(([name]) => name);
      const defaults = await defaultGet(conn, uid, model, requiredFields);
      if (actionCanCreate(action) && !existing) {
        for (const fieldName of requiredFields) {
          const hasDirect = !isBlank(rowValue(row, fieldName));
          const hasExternal = !isBlank(rowValue(row, `${fieldName}_external_id`));
          const hasDefault = defaults && Object.prototype.hasOwnProperty.call(defaults, fieldName) && !isBlank(defaults[fieldName]);
          if (!hasDirect && !hasExternal && !hasDefault) {
            addIssue(issues, 'error', sheet.name, rowIndex, model, fieldName, `Required field kosong: ${fieldName}.`, 'Isi nilai, pakai *_external_id untuk many2one, atau pastikan default_get menyediakan default.');
          }
        }
      }

      for (const [key, rawValue] of Object.entries(row)) {
        if (HELPER_COLUMNS.has(key)) continue;
        if (isBlank(rawValue)) continue;
        const handledRelationExternal = await validateRelationExternal(conn, uid, sheet.name, rowIndex, model, key, rawValue, schema, issues, xmlCache);
        if (handledRelationExternal) continue;
        await validateCell(conn, uid, sheet.name, rowIndex, model, key, rawValue, schema, issues, xmlCache);
      }
      specialMetadataChecks(sheet.name, rowIndex, model, row, issues);
      plan.push({
        sheet: sheet.name,
        row: rowIndex,
        model,
        action,
        existing_id: existing?.id || '',
        existing_source: existing?.source || '',
        decision: issues.some(x => x.sheet === sheet.name && x.row === rowIndex && x.level === 'error') ? 'blocked' : (existing ? 'update/write candidate' : 'create candidate')
      });
    }
  }

  const errors = issues.filter(x => x.level === 'error').length;
  const warnings = issues.filter(x => x.level === 'warn').length;
  return {
    ok: errors === 0,
    rows_checked: rowsChecked,
    errors,
    warnings,
    issues,
    plan,
    sheets: {
      'preflight.summary': [{ ok: errors === 0, rows_checked: rowsChecked, errors, warnings, checked_at: new Date().toISOString() }],
      'preflight.issues': issues,
      'preflight.plan': plan
    }
  };
}

function convertByFieldType(value, field) {
  if (!field) return value;
  if (isBlank(value)) return false;
  switch (field.type) {
    case 'boolean': return Boolean(parseBoolean(value));
    case 'integer': return Math.round(parseNumber(value) || 0);
    case 'float':
    case 'monetary': return parseNumber(value) || 0;
    case 'many2one': return typeof value === 'number' ? value : Number(value);
    case 'char':
    case 'text':
    case 'html': return String(value);
    default: return value;
  }
}

async function buildVals(conn, uid, model, row, schema, xmlCache) {
  const vals = {};
  const skipped = [];
  const warnings = [];
  for (const [key, rawValue] of Object.entries(row)) {
    if (HELPER_COLUMNS.has(key)) continue;
    if (isBlank(rawValue)) continue;
    const rel = getRelationExternalKey(key);
    if (rel) {
      const field = schema[rel.field];
      if (!field) { skipped.push(key); continue; }
      if (rel.many) {
        const ids = [];
        for (const part of String(rawValue).split(/[;,]/).map(x => x.trim()).filter(Boolean)) {
          const found = await resolveXmlId(conn, uid, part, xmlCache);
          if (found?.id) ids.push(found.id); else warnings.push(`${key}: external ID tidak ditemukan (${part})`);
        }
        vals[rel.field] = [[6, 0, ids]];
      } else {
        const found = await resolveXmlId(conn, uid, String(rawValue), xmlCache);
        if (found?.id) vals[rel.field] = found.id; else warnings.push(`${key}: external ID tidak ditemukan (${rawValue})`);
      }
      continue;
    }
    const field = schema[key];
    if (!field || field.readonly) { skipped.push(key); continue; }
    vals[key] = convertByFieldType(rawValue, field);
  }
  return { vals, skipped, warnings };
}

function sanitizeWriteValsForModel(model, vals) {
  const out = { ...vals };
  const warnings = [];
  const drop = (keys, reason) => {
    const removed = [];
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(out, key)) { delete out[key]; removed.push(key); }
    if (removed.length) warnings.push(`${reason}: ${removed.join(', ')}`);
  };
  if (model === 'ir.model') drop(['model', 'state', 'transient', 'modules'], 'field immutable ir.model tidak ditulis saat update');
  if (model === 'ir.model.fields') {
    const removed = Object.keys(out);
    for (const key of removed) delete out[key];
    if (removed.length) warnings.push(`field sudah ada; properties ir.model.fields tidak ditulis ulang: ${removed.join(', ')}`);
  }
  if (model === 'ir.model.access') drop(['name', 'model_id', 'group_id'], 'identity ACL tidak ditulis saat update');
  return { vals: out, warnings };
}

async function createExternalId(conn, uid, model, resId, xmlid) {
  const parsed = splitXmlId(xmlid);
  if (!parsed || !resId) return null;
  const existing = await resolveXmlId(conn, uid, `${parsed.module}.${parsed.name}`, new Map());
  if (existing) return existing;
  return safeExecuteKw(conn, uid, 'ir.model.data', 'create', [{
    module: parsed.module,
    name: parsed.name,
    model,
    res_id: Number(resId),
    noupdate: true
  }], {}, null);
}

async function handleImportBatch(conn, body) {
  const uid = await login(conn);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const defaultModel = String(body.model || '').trim();
  if (!rows.length) throw new Error('Tidak ada row untuk import.');
  if (!body.skipPreflight) {
    const pf = await handlePreflight(conn, { sheets: [{ name: body.sheet || defaultModel || 'import', model: defaultModel, rows }] });
    if (!pf.ok) return { ok: false, blocked_by_preflight: true, preflight: pf };
  }

  const schemaCache = new Map();
  const xmlCache = new Map();
  const results = [];
  let created = 0, updated = 0, skipped = 0, failed = 0, deleted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = row.__rownum__ || i + 2;
    const model = String(row._model || defaultModel || '').trim();
    const action = normalizeAction(row.__action);
    try {
      if (!model) throw new Error('Model kosong. Isi _model atau pilih model target.');
      if (['skip', 'ignore'].includes(action)) {
        skipped++;
        results.push({ row: rowIndex, model, status: 'skipped' });
        continue;
      }
      if (!schemaCache.has(model)) schemaCache.set(model, await fieldsGet(conn, uid, model));
      const schema = schemaCache.get(model);
      const { vals, skipped: skippedCols, warnings } = await buildVals(conn, uid, model, row, schema, xmlCache);
      let existing = await locateExisting(conn, uid, model, row, xmlCache, vals);

      if (['delete', 'unlink'].includes(action)) {
        if (!existing?.id) throw new Error('Tidak bisa delete: record tidak ditemukan dari _external_id / id.');
        await executeKw(conn, uid, model, 'unlink', [[existing.id]]);
        deleted++;
        results.push({ row: rowIndex, model, status: 'deleted', id: existing.id });
        continue;
      }

      if (existing?.id && ['upsert', 'update', 'write'].includes(action)) {
        const safe = sanitizeWriteValsForModel(model, vals);
        const allWarnings = warnings.concat(safe.warnings || []);
        if (Object.keys(safe.vals).length) await executeKw(conn, uid, model, 'write', [[existing.id], safe.vals]);
        if (row._external_id || row.external_id) await createExternalId(conn, uid, model, existing.id, row._external_id || row.external_id);
        updated++;
        results.push({ row: rowIndex, model, status: 'updated', id: existing.id, skippedCols, warnings: allWarnings, existing_source: existing.source || '' });
      } else if (['upsert', 'create'].includes(action)) {
        const newId = await executeKw(conn, uid, model, 'create', [vals]);
        if (row._external_id || row.external_id) await createExternalId(conn, uid, model, newId, row._external_id || row.external_id);
        created++;
        results.push({ row: rowIndex, model, status: 'created', id: newId, skippedCols, warnings });
      } else {
        skipped++;
        results.push({ row: rowIndex, model, status: 'skipped_unknown_action', action });
      }
    } catch (err) {
      failed++;
      results.push({ row: rowIndex, model, status: 'error', action, error: err?.message || String(err), external_id: row._external_id || row.external_id || '' });
    }
  }
  return { ok: failed === 0, processed: rows.length, created, updated, deleted, skipped, failed, results };
}

async function handleTest(conn) {
  const uid = await login(conn);
  const partner_count = await executeKw(conn, uid, 'res.partner', 'search_count', [[]]);
  return { ok: true, uid, partner_count, connection_source: conn.source };
}

async function handleNameSearch(conn, body) {
  const uid = await login(conn);
  const model = String(body.model || '').trim();
  if (!model) throw new Error('Model kosong.');
  const records = await executeKw(conn, uid, model, 'name_search', [body.name || ''], { limit: Math.min(Number(body.limit || 20), 80) });
  return { ok: true, records };
}

async function handleRecordScan(conn, body) {
  const uid = await login(conn);
  const model = String(body.model || '').trim();
  if (!model) throw new Error('Model kosong.');
  const limit = Math.min(Number(body.limit || 80), 300);
  const offset = Number(body.offset || 0);
  const domain = Array.isArray(body.domain) ? body.domain : [];
  const schema = await fieldsGet(conn, uid, model);
  const requested = Array.isArray(body.fields) && body.fields.length ? body.fields : ['display_name', 'name', 'email', 'phone', 'default_code', 'barcode', 'create_date', 'write_date'];
  const fields = ['id', ...requested.filter(f => schema[f] && f !== 'id')];
  const records = await executeKw(conn, uid, model, 'search_read', [domain], { fields, limit, offset, order: 'id desc' });
  const count = await executeKw(conn, uid, model, 'search_count', [domain]);
  return { ok: true, model, count, limit, offset, has_more: offset + records.length < count, records: records.map(r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, sanitizeCell(v)]))) };
}

async function GET() {
  return json({
    ok: true,
    app: 'Lokalmart New Studio v11.2 Schema Snapshot + Preflight Gate',
    connection: connStatus(),
    actions: ['test', 'schema', 'schema_snapshot', 'preflight_import', 'import_batch', 'record_scan', 'name_search'],
    rule: 'Import should run only after schema snapshot and preflight ok.'
  });
}

async function POST(req) {
  try {
    const body = await req.json();
    const conn = getConn(body.connection);
    const action = body.action;
    if (!action) throw new Error('Action kosong.');
    let result;
    if (action === 'test') result = await handleTest(conn);
    else if (action === 'schema') result = await handleSchema(conn, body);
    else if (action === 'schema_snapshot') result = await handleSchemaSnapshot(conn, body);
    else if (action === 'preflight_import') result = await handlePreflight(conn, body);
    else if (action === 'import_batch') result = await handleImportBatch(conn, body);
    else if (action === 'record_scan') result = await handleRecordScan(conn, body);
    else if (action === 'name_search') result = await handleNameSearch(conn, body);
    else throw new Error(`Action tidak dikenal: ${action}`);
    return json(result);
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err) }, 200);
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function handler(req, res) {
  try {
    let response;
    if (req.method === 'GET') response = await GET();
    else if (req.method === 'POST') {
      const parsedBody = await readBody(req);
      response = await POST({ json: async () => parsedBody });
    } else response = json({ ok: false, error: 'Method not allowed' }, 405);
    res.status(response.status || 200).json(response.data ?? response);
  } catch (err) {
    res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
