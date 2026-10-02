// Directory import state and transport recovery; all responses are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture, root} = require('./ui_fixture.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
const response = (data, status = 200) => ({ok: status < 400, status, json: async () => data});
const counts = {before: 1, after: 2, added: 1, removed: 0, changed: 0, added_examples: [], removed_examples: []};
const preview = {id: 'stage-one', source: 'emea.xlsx', report: {
  users: counts, machines: counts, relationships: counts,
  warnings: [], unlinked_machine_references: 0, missing_desk_accounts: [],
}};
(async () => {
  const startup = deferred(), upload = deferred(), requests = [];
  let sessions = 0, previews = 0, applications = 0, statusCalls = 0;
  const f = await fixture({html: 'frontend/database.html', url: 'http://localhost/manage-database', fetch: async (url, options = {}) => {
    requests.push({url, options});
    if (url === '/api/database/status') {
      if (++statusCalls === 1) return startup.promise;
      throw Error('Status refresh unavailable');
    }
    if (url === '/api/session') {
      if (++sessions === 1) throw Error('Session connection failed');
      return response({token: 'token-' + sessions});
    }
    if (url === '/api/database/preview') {
      previews++;
      if (previews === 1) return upload.promise;
      if (previews === 2) return response({detail: 'Session expired'}, 403);
      assert.equal(options.headers.get('X-Atlas-Token'), 'token-3');
      return response(preview);
    }
    if (url === '/api/database/apply/stage-one') {
      assert.deepEqual(JSON.parse(options.body), {confirmation: 'APPLY', full_snapshot: true});
      if (++applications === 1) return response({detail: 'Jobs are active'}, 409);
      return response({backup: 'test-backup.db'});
    }
    throw Error('Unexpected request: ' + url);
  }});
  const {w, run} = f, get = id => w.document.getElementById(id);
  w.HTMLElement.prototype.getClientRects = function() {return this.closest('[hidden]') ? [] : [{}]};
  for (const file of ['database.js', 'edge-controls.js']) run(fs.readFileSync(path.join(root, 'frontend/assets', file), 'utf8'));
  await sleep(50);
  assert(!get('validate').disabled, 'Slow status loading does not disable validation');
  assert(!w.document.querySelector('.atlas-edge-panel'), 'Upload workflows never move into floating controls');
  assert(get('preview').hidden, 'Confirmation remains hidden before a valid preview');
  assert.equal(w.document.querySelectorAll('.atlas-upload-grid > section').length, 2);
  assert(get('full').closest('#preview'));
  assert(get('seating-file').closest('#seating-panel'));
  assert(get('seating-confirm').closest('#seating-result'));
  assert(get('moves-file').closest('#desk-moves-panel'));
  assert(get('moves-confirm').closest('#moves-result'));
  await get('validate').onclick();
  assert.match(get('directory-message').textContent, /Choose an Excel workbook/);
  assert.equal(sessions, 0);
  function select(name, size = 10) {
    Object.defineProperty(get('file'), 'files', {configurable: true, value: [{name, size}]});
    get('file').onchange();
  }
  select('wrong.csv'); await get('validate').onclick();
  assert.match(get('directory-message').textContent, /Use an .xlsx/);
  select('large.xlsx', 51 * 1024 * 1024); await get('validate').onclick();
  assert.match(get('directory-message').textContent, /50 MB/);
  assert.equal(sessions, 0, 'Invalid files do not start a request');
  select('emea.xlsx'); await get('validate').onclick();
  assert.match(get('directory-message').textContent, /Session connection failed/);
  assert(!get('validate').disabled && get('directory-progress').hidden);
  const pending = get('validate').onclick(); await sleep(20);
  assert.equal(get('validate').textContent, 'Validating…');
  assert(get('validate').disabled && get('file').disabled && !get('directory-progress').hidden);
  startup.resolve(response({counts: {users: 1, machines: 1, assignments: 1}, history: []}));
  await sleep(750);
  assert.equal(w.document.querySelector('[data-database-controls="directory"]').getAttribute('aria-busy'), 'true');
  assert.match(get('directory-message').textContent, /Validating emea.xlsx/);
  assert.match(get('message').textContent, /Validating emea.xlsx/, 'Late status cannot overwrite the active operation');
  await get('validate').onclick(); assert.equal(previews, 1, 'Repeated clicks never duplicate an upload');
  upload.resolve(response(preview)); await pending; await sleep(40);
  assert(!get('preview').hidden && !get('full').closest('[hidden]'), 'Successful validation opens inline review controls');
  assert(get('apply').disabled);
  get('full').checked = true; get('full').onchange(); assert(get('apply').disabled);
  get('confirm').value = 'APPLY'; get('confirm').oninput(); assert(!get('apply').disabled);
  select('replacement.xlsx'); await sleep(40);
  assert(get('preview').hidden && get('apply').disabled);
  assert(!get('full').checked && get('confirm').value === '', 'A replacement file invalidates the old preview and consent');
  await get('validate').onclick();
  assert.match(get('directory-message').textContent, /Session expired/);
  assert.equal(sessions, 2);
  await get('validate').onclick(); assert.equal(sessions, 3, 'The next click gets a fresh session after 403');
  get('full').checked = true; get('confirm').value = 'APPLY'; get('confirm').oninput();
  await get('apply').onclick();
  assert.match(get('review-message').textContent, /Jobs are active/);
  assert(!get('preview').hidden && !get('apply').disabled, 'A rejected apply remains reviewable and can be retried');
  await get('apply').onclick();
  assert.match(get('directory-message').textContent, /Import completed. Backup: test-backup.db/);
  assert.match(get('directory-message').textContent, /Counts and history could not refresh/);
  assert(get('preview').hidden && get('apply').disabled);
  assert.equal(applications, 2);
  assert.equal(f.errors.length, 0, f.errors.join('\n'));
  w.dispatchEvent(new w.Event('pagehide')); w.close();
  console.log('PASS: visible import feedback, slow startup, upload progress, session recovery, scoped controls, stale-file invalidation and guarded apply retry.');
})().catch(error => {console.error(error); process.exitCode = 1;});
