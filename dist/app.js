(() => {
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));
  const STORE = 'lokalmart_new_studio_v11_2';
  const META = new Set(['_model', '__action', '_external_id', 'external_id', 'id', 'x_studio2_odoo_id', '__rownum__']);

  const MODEL_PRESETS = [
    ['project.project', 'Project'], ['project.task', 'Task'], ['project.task.type', 'Stage'], ['project.milestone', 'Milestone'],
    ['res.partner', 'Contact/UMKM'], ['product.template', 'Product'], ['product.category', 'Category'],
    ['knowledge.article', 'Knowledge'], ['ir.model', 'Custom Model'], ['ir.model.fields', 'Custom Field'], ['ir.model.access', 'ACL'],
    ['website.page', 'Website Page'], ['ir.ui.view', 'QWeb/View']
  ];

  const state = {
    busy: false,
    nav: 'import',
    conn: { url: '', db: '', username: '', password: '' },
    server: {},
    sheets: [],
    active: 0,
    logs: [],
    schemaSnapshot: null,
    preflight: null,
    importResults: null,
    batchSize: 40,
    customModels: ''
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>'"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[m]));
  }

  function log(level, msg) {
    state.logs.unshift({ time: new Date().toLocaleTimeString('id-ID'), level, msg: String(msg || '') });
    state.logs = state.logs.slice(0, 80);
    render();
  }

  function setBusy(on) {
    state.busy = on;
    render();
  }

  function save() {
    localStorage.setItem(STORE, JSON.stringify({ conn: state.conn, batchSize: state.batchSize, customModels: state.customModels }));
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (saved.conn) state.conn = saved.conn;
      if (saved.batchSize) state.batchSize = saved.batchSize;
      if (saved.customModels) state.customModels = saved.customModels;
    } catch {}
  }

  async function api(payload) {
    const res = await fetch('/api/odoo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection: state.conn, ...payload })
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Server non-JSON ${res.status}: ${text.slice(0, 300)}`); }
    // Some actions, especially schema_snapshot, can return partial_ok=true: usable data exists
    // even when one optional model cannot be inspected. Treat that as a warning, not fatal.
    if (!json.ok && !json.blocked_by_preflight && !json.partial_ok) {
      throw new Error(json.error || JSON.stringify(json).slice(0, 400));
    }
    return json;
  }

  async function checkServer() {
    try {
      const j = await (await fetch('/api/odoo')).json();
      state.server = j.connection || {};
      log('ok', `API aktif: ${j.app || 'New Studio'}`);
    } catch (e) {
      log('error', `API tidak terbaca: ${e.message}`);
    }
  }

  async function testConn() {
    setBusy(true);
    try {
      const j = await api({ action: 'test' });
      log('ok', `Login Odoo sukses. UID ${j.uid}. Contacts ${j.partner_count}. Source ${j.connection_source}.`);
    } catch (e) {
      log('error', `Koneksi gagal: ${e.message}`);
    } finally { setBusy(false); }
  }

  function detectModel(sheetName, rows) {
    const fromRow = rows.find(r => r._model)?._model;
    if (fromRow) return String(fromRow).trim();
    const n = String(sheetName || '').trim();
    const lower = n.toLowerCase();
    if (MODEL_PRESETS.some(([m]) => m === n)) return n;
    const aliases = {
      task: 'project.task', tasks: 'project.task', project: 'project.project', projects: 'project.project',
      product: 'product.template', products: 'product.template', partner: 'res.partner', contact: 'res.partner', contacts: 'res.partner',
      category: 'product.category', fields: 'ir.model.fields', field: 'ir.model.fields', model: 'ir.model', models: 'ir.model', acl: 'ir.model.access', access: 'ir.model.access',
      knowledge: 'knowledge.article', article: 'knowledge.article', view: 'ir.ui.view', qweb: 'ir.ui.view', page: 'website.page'
    };
    return aliases[lower] || n;
  }

  function isHelperSheet(name) {
    const n = String(name || '').toLowerCase();
    return n.startsWith('__') || n.includes('schema.') || n.includes('preflight.') || n.includes('ai.') || n.includes('manifest') || n.includes('readme');
  }

  function columns(rows) {
    const set = new Set();
    rows.slice(0, 1000).forEach(r => Object.keys(r).forEach(k => set.add(k)));
    return [...set];
  }

  async function loadXLSX() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal memuat SheetJS/XLSX CDN.'));
      document.head.appendChild(s);
    });
    return window.XLSX;
  }

  async function readWorkbook(file) {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      state.sheets = wb.SheetNames.map(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false }).map((r, i) => ({ ...r, __rownum__: i + 2 }));
        const helper = isHelperSheet(name);
        const model = helper ? '' : detectModel(name, rows);
        const cols = columns(rows);
        if (!helper) {
          ['_model', '__action', '_external_id'].reverse().forEach(c => { if (!cols.includes(c)) cols.unshift(c); });
          rows.forEach(r => { if (!r._model) r._model = model; if (!r.__action) r.__action = 'upsert'; });
        }
        return { name, model, rows, cols, helper };
      });
      state.active = 0;
      state.preflight = null;
      state.importResults = null;
      log('ok', `${file.name} dibaca: ${state.sheets.length} sheet, ${state.sheets.reduce((a,s)=>a+s.rows.length,0)} rows.`);
    } catch (e) { log('error', `Gagal baca XLSX: ${e.message}`); }
    finally { setBusy(false); }
  }

  function activeSheet() { return state.sheets[state.active]; }
  function importableSheets() { return state.sheets.filter(s => !s.helper && s.rows.length && (s.model || s.rows.some(r => r._model))); }

  function modelsFromWorkbook() {
    const set = new Set();
    importableSheets().forEach(s => {
      if (s.model) set.add(s.model);
      s.rows.forEach(r => { if (r._model) set.add(String(r._model).trim()); });
    });
    String(state.customModels || '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean).forEach(x => set.add(x));
    return [...set].filter(Boolean);
  }

  function sanitize(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 32000);
    return String(v).length > 32000 ? String(v).slice(0, 32000) : v;
  }

  async function downloadSheetsAsXlsx(sheets, filename) {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    Object.entries(sheets || {}).forEach(([name, rows]) => {
      const clean = (rows || []).map(r => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, sanitize(v)])));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clean.length ? clean : [{ empty: '' }]), name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
  }

  async function exportSchemaSnapshot(format = 'xlsx') {
    setBusy(true);
    try {
      const models = modelsFromWorkbook();
      const j = await api({ action: 'schema_snapshot', models, sheets: importableSheets().map(s => ({ name: s.name, model: s.model, rows: s.rows.slice(0, 5) })) });
      state.schemaSnapshot = j;
      if (format === 'json') {
        downloadText(JSON.stringify(j.context || j, null, 2), `lokalmart_odoo_schema_context_${Date.now()}.json`, 'application/json');
      } else if (format === 'txt') {
        downloadText(aiPrompt(j.context || j), `chatgpt_ai_context_schema_${Date.now()}.txt`, 'text/plain');
      } else {
        await downloadSheetsAsXlsx(j.sheets, `lokalmart_odoo_real_schema_${Date.now()}.xlsx`);
      }
      const errCount = Number(j.error_count || (j.context?.errors || []).length || 0);
      log(errCount ? 'warn' : 'ok', `Schema snapshot selesai. Models: ${(j.context?.models || []).length}, warning/error model: ${errCount}. File tetap bisa dipakai; cek sheet schema.errors.`);
    } catch (e) { log('error', `Schema snapshot gagal: ${e.message}`); }
    finally { setBusy(false); }
  }

  function aiPrompt(context) {
    return [
      'KONTEKS WAJIB UNTUK CHATGPT SEBELUM MEMBUAT XLSX ODOO LOKALMART',
      '',
      'Tugas ChatGPT: buat XLSX import-safe hanya berdasarkan schema real berikut. Jangan menebak field.',
      'Aturan: gunakan _model, __action, _external_id; many2one memakai *_external_id; many2many memakai *_external_ids; custom field/model memakai x_*; jalankan preflight sebelum import.',
      '',
      JSON.stringify(context, null, 2)
    ].join('\n');
  }

  function downloadText(text, filename, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function issueCounts(issues) {
    return {
      errors: (issues || []).filter(x => x.level === 'error').length,
      warnings: (issues || []).filter(x => x.level === 'warn').length
    };
  }

  async function preflight(all = true) {
    const sheets = all ? importableSheets() : [activeSheet()].filter(Boolean).filter(s => !s.helper);
    if (!sheets.length) { log('warn', 'Tidak ada sheet importable untuk preflight.'); return; }
    setBusy(true);
    try {
      const payload = { action: 'preflight_import', sheets: sheets.map(s => ({ name: s.name, model: s.model, rows: s.rows })) };
      const j = await api(payload);
      state.preflight = j;
      const c = issueCounts(j.issues);
      log(j.ok ? 'ok' : 'error', `Preflight selesai: ${j.rows_checked} row. Error ${c.errors}, warning ${c.warnings}.`);
      await downloadSheetsAsXlsx(j.sheets, `lokalmart_preflight_report_${Date.now()}.xlsx`);
    } catch (e) { log('error', `Preflight gagal: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function importAll() {
    const sheets = importableSheets();
    if (!sheets.length) { log('warn', 'Tidak ada sheet importable.'); return; }
    if (!state.preflight || !state.preflight.ok) {
      log('warn', 'Import ditahan. Jalankan Preflight Semua dan pastikan error = 0. Ini pagar betisnya.');
      return;
    }
    setBusy(true);
    try {
      const allResults = [];
      for (const sh of sheets) {
        for (let i = 0; i < sh.rows.length; i += Number(state.batchSize || 40)) {
          const rows = sh.rows.slice(i, i + Number(state.batchSize || 40));
          const j = await api({ action: 'import_batch', sheet: sh.name, model: sh.model, rows, skipPreflight: true });
          allResults.push({ sheet: sh.name, ...j });
          const label = `${sh.name} ${i + 1}-${i + rows.length}/${sh.rows.length}`;
          if (j.ok) log('ok', `${label}: created ${j.created}, updated ${j.updated}, failed ${j.failed}.`);
          else log('error', `${label}: gagal ${j.failed || 0}.`);
          const errors = (j.results || []).filter(r => r.status === 'error').slice(0, 6);
          errors.forEach(r => log('error', `row ${r.row} ${r.model}: ${r.error}`));
        }
      }
      state.importResults = allResults;
      const sheetsOut = { 'import.summary': allResults.map(r => ({ sheet: r.sheet, processed: r.processed, created: r.created, updated: r.updated, deleted: r.deleted, skipped: r.skipped, failed: r.failed, ok: r.ok })) };
      sheetsOut['import.rows'] = allResults.flatMap(r => (r.results || []).map(x => ({ sheet: r.sheet, ...x })));
      await downloadSheetsAsXlsx(sheetsOut, `lokalmart_import_report_${Date.now()}.xlsx`);
    } catch (e) { log('error', `Import berhenti: ${e.message}`); }
    finally { setBusy(false); }
  }

  function quickIssues(sh) {
    if (!sh) return [];
    if (sh.helper) return [{ level: 'ok', message: 'Helper/schema sheet; tidak diimport.' }];
    const out = [];
    if (!sh.model) out.push({ level: 'error', message: 'Model kosong.' });
    const unnamed = sh.rows.filter(r => !r.name && !r.display_name && !r._external_id && !r.external_id).length;
    if (unnamed) out.push({ level: 'warn', message: `${unnamed} row tanpa name/display_name/_external_id.` });
    const noAction = sh.rows.filter(r => !r.__action).length;
    if (noAction) out.push({ level: 'warn', message: `${noAction} row tanpa __action.` });
    if (!out.length) out.push({ level: 'ok', message: 'Cek dasar lolos. Tetap wajib preflight server.' });
    return out;
  }

  function render() {
    const sh = activeSheet();
    const pf = state.preflight;
    const c = issueCounts(pf?.issues || []);
    $('#app').innerHTML = `
      <header class="topbar">
        <div class="brand"><span class="logo">L</span><div><strong>Lokalmart New Studio v11.2</strong><small>Schema Real → Preflight → Import Aman</small></div></div>
        <div class="status ${state.busy ? 'busy' : ''}">${state.busy ? 'Working…' : 'Idle'}</div>
      </header>
      <nav class="nav">
        ${tab('import','Import Gate')}${tab('schema','Schema AI')}${tab('report','Report')}${tab('settings','Koneksi')}
      </nav>
      <main>
        ${state.nav === 'import' ? importView(sh) : ''}
        ${state.nav === 'schema' ? schemaView() : ''}
        ${state.nav === 'report' ? reportView(c) : ''}
        ${state.nav === 'settings' ? settingsView() : ''}
      </main>
      <section class="logs">
        <div class="section-title"><h3>Log</h3><button data-action="clearLogs">Clear</button></div>
        ${state.logs.length ? state.logs.map(l => `<div class="log ${esc(l.level)}"><b>${esc(l.time)} · ${esc(l.level)}</b><span>${esc(l.msg)}</span></div>`).join('') : '<p class="muted">Belum ada log.</p>'}
      </section>
    `;
    bind();
  }

  function tab(key, label) {
    return `<button class="tab ${state.nav === key ? 'on' : ''}" data-nav="${key}">${label}</button>`;
  }

  function importView(sh) {
    return `
      <section class="hero">
        <h1>Jangan import dalam gelap.</h1>
        <p>Upload XLSX → export schema real untuk ChatGPT → jalankan preflight komprehensif → baru import batch kecil.</p>
      </section>
      <section class="card">
        <div class="section-title"><h2>1. Upload XLSX</h2><label class="upload">Pilih XLSX<input type="file" accept=".xlsx,.xls" data-file="xlsx"></label></div>
        ${state.sheets.length ? `<div class="sheets">${state.sheets.map((s,i)=>`<button class="sheet ${i===state.active?'on':''} ${s.helper?'helper':''}" data-sheet="${i}"><b>${esc(s.name)}</b><span>${esc(s.model || 'helper')} · ${s.rows.length} row</span></button>`).join('')}</div>` : '<p class="muted">Belum ada file. Upload XLSX dari ChatGPT/barcode/export Odoo.</p>'}
      </section>
      <section class="card">
        <div class="section-title"><h2>2. Review cepat</h2><span>${sh ? esc(sh.name) : 'Belum ada sheet'}</span></div>
        ${sh ? quickIssues(sh).map(x=>`<div class="pill ${x.level}">${esc(x.message)}</div>`).join('') : ''}
        ${sh && !sh.helper ? `<div class="toolbar"><button data-action="schemaXlsx">Export Schema Real XLSX</button><button data-action="schemaTxt">Download AI Context</button><button data-action="preflightActive">Preflight Sheet Ini</button><button class="primary" data-action="preflightAll">Preflight Semua</button></div>` : ''}
        ${sh ? tablePreview(sh) : ''}
      </section>
      <section class="card danger-zone">
        <div class="section-title"><h2>3. Import</h2><span>${state.preflight?.ok ? 'Preflight OK' : 'Terkunci sampai preflight error = 0'}</span></div>
        <p class="muted">Import hanya aktif secara logika setelah preflight semua lolos. Batch kecil supaya Vercel/Odoo Online tidak timeout.</p>
        <label>Batch size <input type="number" min="5" max="100" value="${esc(state.batchSize)}" data-input="batchSize"></label>
        <button class="danger" data-action="importAll">Import Semua Sheet yang Lolos</button>
      </section>
    `;
  }

  function tablePreview(sh) {
    const cols = (sh.cols || []).slice(0, 12);
    const rows = (sh.rows || []).slice(0, 30);
    return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(String(r[c] ?? '').slice(0,90))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${sh.rows.length > 30 ? `<p class="muted">Menampilkan 30/${sh.rows.length} row pertama.</p>` : ''}`;
  }

  function schemaView() {
    return `
      <section class="card">
        <h2>Schema Real untuk ChatGPT</h2>
        <p>Ini fitur kunci. Studio mengambil schema langsung dari database Odoo: field, required, relation, selection, access rights, dan aturan import. File inilah yang ditempel/diupload ke ChatGPT sebelum minta dibuatkan XLSX.</p>
        <label>Tambahan model custom, pisahkan koma/baris
          <textarea data-input="customModels" rows="4" placeholder="x_lokal_id, x_lokal_role_id">${esc(state.customModels)}</textarea>
        </label>
        <div class="toolbar"><button data-action="schemaXlsx">Download Schema XLSX</button><button data-action="schemaJson">Download Schema JSON</button><button class="primary" data-action="schemaTxt">Download AI Context TXT</button></div>
        <div class="model-list">${modelsFromWorkbook().map(m=>`<span>${esc(m)}</span>`).join('') || '<span>Belum ada model dari workbook. Default model Lokalmart tetap akan ikut.</span>'}</div>
      </section>
    `;
  }

  function reportView(c) {
    return `
      <section class="card">
        <h2>Preflight Report</h2>
        ${state.preflight ? `<div class="score ${state.preflight.ok?'ok':'bad'}"><b>${state.preflight.ok?'AMAN UNTUK IMPORT':'IMPORT DITAHAN'}</b><span>${state.preflight.rows_checked} row · ${c.errors} error · ${c.warnings} warning</span></div>` : '<p class="muted">Belum ada preflight report.</p>'}
        ${state.preflight ? `<div class="issue-list">${(state.preflight.issues || []).slice(0,200).map(i=>`<div class="issue ${esc(i.level)}"><b>${esc(i.level)} · ${esc(i.sheet)} row ${esc(i.row)} · ${esc(i.model)} ${i.field?'/ '+esc(i.field):''}</b><span>${esc(i.message)}</span><small>${esc(i.suggestion || '')}</small></div>`).join('')}</div>` : ''}
      </section>
    `;
  }

  function settingsView() {
    const env = state.server || {};
    return `
      <section class="card">
        <h2>Koneksi Odoo</h2>
        <div class="pill ${env.env_configured?'ok':'warn'}">${env.env_configured ? 'Mode aman: Vercel ENV aktif' : 'Env belum lengkap: browser fallback'}</div>
        <p class="muted">${esc(env.public_hint || '')}</p>
        ${env.env_missing?.length ? `<p class="muted">Kurang: ${esc(env.env_missing.join(', '))}</p>` : ''}
        <div class="grid2">
          <label>Odoo URL<input data-conn="url" value="${esc(state.conn.url)}" placeholder="https://namadb.odoo.com"></label>
          <label>Database<input data-conn="db" value="${esc(state.conn.db)}"></label>
          <label>Email/Username<input data-conn="username" value="${esc(state.conn.username)}"></label>
          <label>Password/API Key<input type="password" data-conn="password" value="${esc(state.conn.password)}"></label>
        </div>
        <div class="toolbar"><button data-action="test">Test Koneksi</button><button data-action="refreshServer">Refresh API</button><button data-action="clearConn">Clear Browser Conn</button></div>
      </section>
    `;
  }

  function bind() {
    $$('[data-nav]').forEach(b => b.onclick = () => { state.nav = b.dataset.nav; render(); });
    $('[data-file="xlsx"]')?.addEventListener('change', e => readWorkbook(e.target.files[0]));
    $$('[data-sheet]').forEach(b => b.onclick = () => { state.active = Number(b.dataset.sheet); render(); });
    $$('[data-input]').forEach(el => el.oninput = () => { const k = el.dataset.input; state[k] = el.type === 'number' ? Number(el.value) : el.value; save(); });
    $$('[data-conn]').forEach(el => el.oninput = () => { state.conn[el.dataset.conn] = el.value; save(); });
    $$('[data-action]').forEach(b => b.onclick = () => actions[b.dataset.action]?.());
  }

  const actions = {
    clearLogs: () => { state.logs = []; render(); },
    clearConn: () => { state.conn = { url: '', db: '', username: '', password: '' }; save(); render(); },
    refreshServer: checkServer,
    test: testConn,
    schemaXlsx: () => exportSchemaSnapshot('xlsx'),
    schemaJson: () => exportSchemaSnapshot('json'),
    schemaTxt: () => exportSchemaSnapshot('txt'),
    preflightActive: () => preflight(false),
    preflightAll: () => preflight(true),
    importAll
  };

  load();
  render();
  checkServer();
})();
