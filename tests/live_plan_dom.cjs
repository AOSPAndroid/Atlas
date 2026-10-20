// Live floor plan card: settings, what Atlas read, held changes; responses are simulated.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fixture, root } = require('./ui_fixture.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const posts = [];
  const held = {
    folder: 'C:\\Plan', enabled: true, checked: '2026-10-20T09:01:00+00:00',
    status: { state: 'held', message: 'Hoche Project_20261020.xlsx: 52 changes in one save; review them before they reach the map.' },
    last: { file: 'Hoche Project_20261020.xlsx', modified: '2026-10-20T08:58:00+00:00', desks: 310,
      reader: { fixes: [{ written: '2R017069', desk: '02R017069', cell: '+2!J4' }], not_in_directory: [{ name: 'Sandrine Kone', desk: '02R019073', ambiguous: false }],
        unknown_desks: [{ desk: '02R999999', label: 'Ghost', cell: '+2!A1' }], conflicts: [] } },
    held: { reason: '52 changes in one save', file: 'Hoche Project_20261020.xlsx', report: { errors: [], changes: [
      { desk: '02R016079', kind: 'moved', from_desk: '02R015079', before: { name: 'Credit Sales' }, after: { name: 'Christophe Duriez' } },
      { desk: '02R015079', kind: 'vacated', from_desk: null, before: { name: 'Christophe Duriez' }, after: { name: 'Vacant desk' } }] } },
    history: [{ at: '2026-10-19T17:00:00+00:00', file: 'Hoche Project_20261002.xlsx', counts: { moved: 2, assigned: 1 } }],
  };
  const synced = { ...held, status: { state: 'synced', message: 'Updated from Hoche Project_20261020.xlsx: 1 moved, 1 freed.' }, held: null,
    history: [{ at: '2026-10-20T09:02:00+00:00', file: 'Hoche Project_20261020.xlsx', counts: { moved: 1, vacated: 1 } }, ...held.history] };
  const response = (data) => ({ ok: true, status: 200, json: async () => data });
  const f = await fixture({ html: 'frontend/database.html', url: 'http://localhost/manage-database', fetch: async (url, options = {}) => {
    if (url === '/api/session') return response({ token: 't' });
    if (url === '/api/seating-sync') return response(held);
    if (url.startsWith('/api/seating-sync/')) { posts.push([url, JSON.parse(options.body || '{}')]); return response(url.endsWith('/apply') ? synced : held); }
    return response({ counts: { users: 1, machines: 1, assignments: 1 }, history: [] });
  } });
  const { w, run } = f, get = (id) => w.document.getElementById(id);
  run(fs.readFileSync(path.join(root, 'frontend/assets/seating-sync.js'), 'utf8'));
  await sleep(30);
  assert.equal(get('live-plan-state').textContent, 'Waiting for review');
  assert.equal(get('live-plan-state').className, 'status-warn');
  assert.equal(get('live-plan-folder').value, 'C:\\Plan');
  assert.match(get('live-plan-details').textContent, /Hoche Project_20261020\.xlsx · saved .* · 310 desks read/);
  assert.match(get('live-plan-details').textContent, /1 desk codes corrected/);
  assert.match(get('live-plan-details').textContent, /2R017069 → 02R017069/);
  assert.match(get('live-plan-details').textContent, /Sandrine Kone · 02R019073/);
  assert.match(get('live-plan-details').textContent, /02R999999 · Ghost/);
  assert(!get('live-plan-held').hidden);
  assert.deepEqual([...get('live-plan-changes').children].map((li) => li.textContent),
    ['02R016079 · moved from 02R015079: Credit Sales → Christophe Duriez', '02R015079 · freed: Christophe Duriez → Vacant desk']);
  get('live-plan-folder').value = '"C:\\Users\\me\\OneDrive\\02_Current_plan"';
  get('live-plan-folder').dispatchEvent(new w.Event('input'));
  await sleep(20);
  assert.equal(get('live-plan-folder').value, '"C:\\Users\\me\\OneDrive\\02_Current_plan"', 'Typing is not overwritten by refreshes');
  get('live-plan-save').onclick(); await sleep(20);
  assert.deepEqual(posts[0], ['/api/seating-sync/settings', { folder: '"C:\\Users\\me\\OneDrive\\02_Current_plan"', enabled: true }]);
  w.confirm = () => false; get('live-plan-apply').onclick(); await sleep(20);
  assert.equal(posts.length, 1, 'Cancelling the confirmation applies nothing');
  w.confirm = () => true; get('live-plan-apply').onclick(); await sleep(20);
  assert.equal(posts[1][0], '/api/seating-sync/apply');
  assert.equal(get('live-plan-state').textContent, 'Synced');
  assert(get('live-plan-held').hidden);
  assert.match(get('live-plan-history').textContent, /Hoche Project_20261020\.xlsx · 1 moved, 1 freed/);
  assert.deepEqual(f.errors, []);
  w.close();
  console.log('PASS: Live floor plan card shows what was read (fixes, unmatched names, unknown desks), keeps typed settings, confirms and applies held changes');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
