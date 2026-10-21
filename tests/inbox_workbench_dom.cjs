// Live Inbox request tools: health, performance, AD groups and deployment run beside the message
// without switching to Workspace; the deployment panel moves in and back; "Back to Live Inbox"
// after a Live Inbox button opens another page; Workspace is still used outside Live Inbox.
const assert = require('node:assert/strict');
const { fixture } = require('./ui_fixture.cjs');
const { profileSnapshot } = require('./performance_sample.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 4000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(15)) if (check()) return;
  throw Error('Timed out: ' + label);
}
const response = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => data });
const person = { id: 7, full_name: 'Alex Morgan', user_name: 'INBOX0', email: 'alex@example.test' };
const laptop = { name: 'LAPTOP-01', device_kind: 'laptop', windows_remote_supported: 1 };
const sample = { ...profileSnapshot('overview'), computer: 'LAPTOP-01' };
const ad = kind => ({ kind, queried_at: '2026-10-21T09:00:00Z', server: 'dc.example.test', operator: 'EXAMPLE\\operator', warnings: [], nested_complete: true,
  details: kind === 'user' ? { Account: 'INBOX0', Enabled: true, 'Locked out': true, 'Password expired': false } : { Name: 'LAPTOP-01', Enabled: true },
  groups: [{ name: 'Paris-Printers', membership: 'Nested', category: 'Security', scope: 'Global', dn: 'CN=Paris-Printers' },
    { name: 'App-Outlook', membership: 'Direct', category: 'Security', scope: 'Global', dn: 'CN=App-Outlook', description: 'Outlook users' },
    { name: 'Domain Users', membership: 'Primary', category: 'Security', scope: 'Global', dn: 'CN=Domain Users' }] });

(async () => {
  const calls = [];
  const f = await fixture({ fetch: async (url, options = {}) => {
    url = String(url); const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, body });
    if (url === '/api/session') return response({ token: 'fixture' });
    if (url === '/api/health') return response({ identity: 'EXAMPLE\\operator', ok: true });
    if (url.startsWith('/api/user/')) return response({ user: person, machines: [laptop] });
    if (url.startsWith('/api/catalog')) return response({ available: true, items: [{ folder: 'Example App', display_name: 'Example App' }], total: 1 });
    if (url.startsWith('/api/scripts?')) return response({ scripts: url.includes('Repair') ? ['setup_r.ps1'] : ['setup_i.ps1'] });
    if (url.startsWith('/api/machine-health/')) { const [, , , pc, metric] = url.split('/'); return response({ computer: pc, metric, state: 'ready', data: { free_bytes: 50 * 1024 ** 3, total_bytes: 256 * 1024 ** 3, uptime_seconds: 3600 }, checked_at: '2026-10-21T09:00:00Z' }); }
    if (url.startsWith('/api/performance/LAPTOP-01?kind=overview')) return response(sample);
    if (url === '/api/active-directory/lookup') return response(ad(body.kind));
    if (url === '/api/kill') return response({ count: 1, results: [{ Process: 'Renderer.exe', PID: 42, state: 'terminated' }] });
    return response({ deployments: [], items: [] });
  } });
  const { w, run } = f, d = w.document, $ = id => d.getElementById(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {} }); // A desktop-width window.
  let clipboard = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { clipboard = text; } }, configurable: true });
  await f.console();
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  await sleep(60);
  const actions = w.AtlasInboxActions;

  // Outside Live Inbox (or before it has rendered) the Workspace tools are used as before.
  await actions.run({ action: 'health', user: person, machine: 'LAPTOP-01' });
  assert($('workspace').classList.contains('active'), 'Without Live Inbox on screen, Health opens Workspace');

  // Live Inbox as React renders it: the list and the message details in .inbox-grid.
  $('liveInbox').innerHTML = '<div class="live-inbox"><div class="inbox-grid"><div class="inbox-mail-list"></div><div class="inbox-context"><button id="openPerson">Open in Workspace</button></div></div></div>';
  $('openPerson').onclick = () => w.dispatchEvent(new w.CustomEvent('atlas:inbox-person', { detail: { id: 7 } }));
  run("page('inbox')");
  const grid = d.querySelector('.inbox-grid'), work = () => $('inboxWork'), pane = tab => d.querySelector(`[data-work-pane="${tab}"]`);
  const fetched = prefix => calls.filter(c => c.url.startsWith(prefix));
  calls.length = 0;

  // Health: a full scan beside the message; the page does not change.
  await actions.run({ action: 'health', user: person, machine: 'LAPTOP-01' });
  assert($('inbox').classList.contains('active') && !$('workspace').classList.contains('active'), 'Health stays in Live Inbox');
  assert.equal(work().parentNode, grid, 'The tools are the third column of the inbox grid');
  assert(!work().hidden);
  assert.match(d.querySelector('[data-work-title]').textContent, /LAPTOP-01 · Alex Morgan/);
  assert.equal(d.querySelector('[data-work-tab="health"]').getAttribute('aria-selected'), 'true');
  assert.equal(run('S.target'), 'LAPTOP-01', 'Atlas target follows the request');
  await until(() => fetched('/api/machine-health/LAPTOP-01/').length === 8, 'all health checks');
  await until(() => pane('health').querySelector('[data-metric="storage"]')?.textContent.includes('50.0 GiB free'), 'storage reading');

  // Performance: tiles, findings and the busiest processes; End… asks first.
  d.querySelector('[data-work-tab="performance"]').click();
  await until(() => pane('performance').querySelector('.inbox-work-tiles'), 'performance tiles');
  assert.equal(fetched('/api/performance/LAPTOP-01?kind=overview').length, 1);
  const tiles = [...pane('performance').querySelectorAll('.inbox-work-tile')].map(t => [t.querySelector('small').textContent, t.querySelector('b').textContent, t.dataset.tone]);
  assert.deepEqual(tiles.slice(0, 3), [['CPU', '82%', 'warn'], ['Memory', '91%', 'bad'], ['C: free', '5%', 'bad']]);
  assert.match(pane('performance').querySelector('.inbox-work-notes').textContent, /RAM pressure/);
  const first = () => pane('performance').querySelector('tbody tr td').textContent;
  assert.equal(first(), 'Renderer.exe');
  pane('performance').querySelector('[data-work-sort="Memory"]').click();
  assert.equal(first(), 'Renderer.exe');
  assert.equal(pane('performance').querySelector('[data-work-sort="Memory"]').getAttribute('aria-pressed'), 'true');
  const end = () => pane('performance').querySelector('[data-work-end="42"]');
  w.confirm = () => false; end().click(); await sleep(30);
  assert.equal(fetched('/api/kill').length, 0, 'Cancelled End sends nothing');
  w.confirm = () => true; end().click();
  await until(() => fetched('/api/kill').length === 1 && fetched('/api/performance/').length === 2, 'process ended and rescanned');
  assert.deepEqual(fetched('/api/kill')[0].body, { computer: 'LAPTOP-01', value: '42', created: '20260910100000.000000+000', name: 'Renderer.exe' });

  // User groups: account problems first, Direct before Primary before Nested, filter and copy.
  await actions.run({ action: 'user-groups', user: person, machine: 'LAPTOP-01' });
  await until(() => pane('user-groups').querySelector('.inbox-work-groups'), 'user groups');
  assert.deepEqual(fetched('/api/active-directory/lookup').at(-1).body, { kind: 'user', identity: 'INBOX0', server: '' });
  assert.equal(pane('user-groups').querySelector('.inbox-work-chips').textContent, 'Locked out');
  assert.deepEqual([...pane('user-groups').querySelectorAll('[data-group] > span')].map(n => n.textContent), ['App-Outlook', 'Domain Users', 'Paris-Printers']);
  const filter = pane('user-groups').querySelector('[data-work-filter]');
  filter.value = 'paris'; filter.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(pane('user-groups').querySelector('[data-work-hidden]').textContent, /2 groups hidden/);
  pane('user-groups').querySelector('[data-work-copy]').click();
  await until(() => clipboard === 'Paris-Printers', 'copied visible group names');
  assert($('inbox').classList.contains('active'));

  // Machine groups: the computer account; computers report only the checks AD returns.
  await actions.run({ action: 'machine-groups', user: person, machine: 'LAPTOP-01' });
  await until(() => pane('machine-groups').querySelector('.inbox-work-groups'), 'machine groups');
  assert.deepEqual(fetched('/api/active-directory/lookup').at(-1).body, { kind: 'computer', identity: 'LAPTOP-01', server: '' });
  assert.equal(pane('machine-groups').querySelector('.inbox-work-chips').textContent, 'enabled');

  // Deploy: the Workspace deployment panel moves beside the message with the package and script chosen.
  await actions.run({ action: 'deploy', user: person, machine: 'LAPTOP-01', pkg: { folder: 'Example App', display_name: 'Example App' }, deployAction: 'Repair' });
  assert($('inbox').classList.contains('active'), 'Deploy stays in Live Inbox');
  assert.equal($('deploymentPanel').closest('[data-work-pane]'), pane('deploy'));
  assert(!$('deploymentPanel').hidden, 'The deployment panel is usable beside the message');
  assert.deepEqual([$('pkg').value, $('action').value, $('script').value], ['Example App', 'Repair', 'setup_r.ps1']);
  // Switching tools keeps the half-prepared deployment.
  d.querySelector('[data-work-tab="health"]').click();
  assert.equal($('deploymentPanel').closest('[data-work-pane]'), pane('deploy'));
  d.querySelector('[data-work-tab="deploy"]').click();
  assert.equal($('script').value, 'setup_r.ps1');

  // Leaving from the sidebar: the panel returns to Workspace, no "Back" button.
  run("page('workspace')");
  assert.equal($('deploymentPanel').parentNode, $('workspace'));
  assert(!$('deploymentPanel').hidden, 'Workspace shows its deployment panel again');
  assert.equal($('script').value, 'setup_r.ps1', 'The prepared deployment survives the move');
  assert(!$('inboxReturn') || $('inboxReturn').hidden, 'The sidebar does not offer Back to Live Inbox');
  run("page('inbox')");
  assert.equal($('deploymentPanel').closest('[data-work-pane]'), pane('deploy'), 'Coming back re-opens the deployment beside the message');

  // A Live Inbox button that opens another page offers the way back.
  $('openPerson').click();
  assert($('workspace').classList.contains('active'));
  await until(() => $('inboxReturn') && !$('inboxReturn').hidden, 'Back to Live Inbox');
  $('inboxReturn').click();
  assert($('inbox').classList.contains('active'));
  assert($('inboxReturn').hidden);

  // Reboot from the panel keeps its confirmation.
  const reboots = []; w.AtlasReboots.start = async pc => reboots.push(pc);
  w.confirm = () => false; d.querySelector('[data-work-reboot]').click(); await sleep(30);
  assert.deepEqual(reboots, []);
  w.confirm = () => true; d.querySelector('[data-work-reboot]').click();
  await until(() => reboots.length === 1, 'reboot');
  assert.deepEqual(reboots, ['LAPTOP-01']);

  // A sender without a Windows PC: only User groups is available.
  await actions.run({ action: 'user-groups', user: { ...person, id: 8, user_name: 'INBOX1', full_name: 'Sam Lee' }, machine: '' });
  assert.deepEqual([...d.querySelectorAll('[data-work-tab]')].filter(b => !b.disabled).map(b => b.dataset.workTab), ['user-groups']);
  assert(d.querySelector('[data-work-tool="msra"]').disabled);
  assert.match(d.querySelector('[data-work-title]').textContent, /No Windows PC · Sam Lee/);

  // Close: the tools hide and the deployment panel goes home.
  d.querySelector('[data-work-close]').click();
  assert(work().hidden);
  assert.equal($('deploymentPanel').parentNode, $('workspace'));
  assert(calls.every(c => c.method === 'GET' || ['/api/active-directory/lookup', '/api/kill'].includes(c.url)), 'Nothing deploys or reboots by itself');
  await sleep(100);
  assert.deepEqual(f.errors, []);
  w.close();
  console.log('PASS: Live Inbox request tools run health, performance (End… confirmed), user and PC AD groups (filter, copy) and deployment beside the message; the deployment panel moves in and back intact; Back to Live Inbox after a Live Inbox button; reboot confirmed; Workspace fallback outside Live Inbox');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
