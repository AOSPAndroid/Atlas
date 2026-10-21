// Live Inbox request tools: health, performance, AD groups and deployment run beside the message
// without switching to Workspace; the deployment panel moves in and back; "Back to Live Inbox"
// after a Live Inbox button opens another page; Workspace is still used outside Live Inbox.
// Support tools: check-up, message on screen, restart later, GPUpdate, unlock, BitLocker keys,
// notes and the work log copied for the ticket.
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
const marie = { id: 9, full_name: 'Marie Dupont', user_name: 'X09', email: 'marie@example.test', written: 'DUPONT Marie', machines: [{ name: 'LAPTOP-09', windows_remote_supported: 1 }] };
const group = (name, membership = 'Direct') => ({ name, membership, category: 'Security', scope: 'Global', dn: 'CN=' + name });
const ad = (kind, identity) => ({ kind, queried_at: '2026-10-21T09:00:00Z', server: 'dc.example.test', operator: 'EXAMPLE\\operator', warnings: [], nested_complete: true,
  details: kind === 'user' ? { Account: identity, Name: identity === 'X09' ? 'Marie Dupont' : 'Alex Morgan', Enabled: true, 'Locked out': identity === 'INBOX0', 'Password expired': false,
    'Password expires': new Date(Date.now() + 3.5 * 86400000).toISOString() } : { Name: identity, Enabled: true },
  groups: identity === 'X09' ? [{ ...group('App-Outlook'), description: 'Outlook users' }, group('APP-Visio'), group('VPN-Users', 'Nested'), group('Domain Users', 'Primary')]
    : [group('Paris-Printers', 'Nested'), { ...group('App-Outlook'), description: 'Outlook users' }, group('Domain Users', 'Primary')] });
const people = { 7: { user: { ...person, department: 'Client Services', location: 'Paris', manager: 'Jo Lead' }, machines: [laptop, { name: 'PHONE-01', device_kind: 'phone', windows_remote_supported: 0 }], desks: [{ id: '04R019086', floor: 4, match: 'confirmed account link' }],
    requests: [{ id: 32, subject: 'Alex Morgan', received_at: '2026-10-21T08:00:00Z' }, { id: 25, subject: 'VPN drops at home', received_at: '2026-10-01T08:00:00Z' }],
    deployments: [{ id: 'job-1', target: 'LAPTOP-01', package: 'Example App', action: 'Install', state: 'failed', started: '2026-10-15 10:00:00' }] },
  9: { user: marie, machines: marie.machines, desks: [] }, 8: { user: { id: 8, full_name: 'Sam Lee', user_name: 'INBOX1' }, machines: [], desks: [] } };

// The check-up of LAPTOP-01: a restart is pending, up 9 days, Outlook keeps crashing, a dock at 100 Mbps.
const checkup = days => ({ ok: true, computer: 'LAPTOP-01', checked_at: '2026-10-21T09:00:00Z', days, errors: ['updates: Access denied'], duration_ms: 4200,
  session: { console_user: 'EXAMPLE\\INBOX0', users: ['EXAMPLE\\INBOX0'], last_boot: '2026-10-12T08:00:00Z', uptime_hours: 217, model: 'Latitude 7440' },
  events: { unexpected_shutdowns: { count: 1, last: '2026-10-18T07:00:00Z' }, bluescreens: { count: 0, last: null }, disk_errors: { count: 0, last: null },
    app_problems: [{ app: 'OUTLOOK.EXE', crashes: 4, hangs: 1, last: '2026-10-21T08:30:00Z' }, { app: 'Teams.exe', crashes: 0, hangs: 1, last: '2026-10-19T08:30:00Z' }] },
  pending_reboot: { pending: true, reasons: ['Windows Update'] }, updates: null,
  network: [{ name: 'Ethernet 2', description: 'Dock Ethernet', ip: ['10.1.2.3', 'fe80::1'], gateway: ['10.1.2.1'], dns: ['10.0.0.10'], mac: '00-11-22-33-44-55', dhcp: true, suffix: 'corp.example', speed_mbps: 100 }] });
const keys = [{ id: '1A2B3C4D-0000-0000-0000-000000000001', created: '2025-01-05T10:00:00Z', password: '111111-222222-333333-444444-555555-666666-777777-888888' },
  { id: '9F8E7D6C-0000-0000-0000-000000000002', created: '2026-06-01T10:00:00Z', password: '999999-888888-777777-666666-555555-444444-333333-222222' }];

(async () => {
  const calls = [], pendingLookups = new Map(), notes = {};
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
    if (url === '/api/active-directory/lookup') return response(ad(body.kind, body.identity));
    if (url.startsWith('/api/inbox/person/')) return response(people[url.split('/').at(-1)]);
    if (url.startsWith('/api/search?term=') && pendingLookups.has(decodeURIComponent(url.split('term=')[1]))) return pendingLookups.get(decodeURIComponent(url.split('term=')[1]));
    if (url.startsWith('/api/search?term=')) return response(url.endsWith('=sam') ? { users: [{ id: 8, full_name: 'Sam Lee', user_name: 'INBOX1' }, { id: 12, full_name: 'Sam Green', user_name: 'X12' }], machines: [] }
      : url.endsWith('=laptop-09') ? { users: [], machines: [{ name: 'LAPTOP-09', windows_remote_supported: 1 }] } : { users: [], machines: [] });
    if (url === '/api/knowledge/articles/visio') return response({ id: 'visio', title: 'Visio requests', tags: ['software'], markdown: '## Steps\n1. Check the licence group.' });
    if (url === '/api/kill') return response({ count: 1, results: [{ Process: 'Renderer.exe', PID: 42, state: 'terminated' }] });
    if (url === '/api/companion') return response({ online: true, capabilities: ['outlook.reply', 'outlook.open', 'open.url'] });
    if (url === '/api/companion/commands') return response({ id: 'c' + calls.length, kind: body.kind, state: 'done', result: {}, error: '' });
    if (url.startsWith('/api/diagnose/LAPTOP-01?days=')) return response(checkup(Number(url.split('=')[1])));
    if (url === '/api/support/message') return response({ computer: body.computer, pid: 11, seconds: body.seconds });
    if (url === '/api/support/restart') return response({ computer: body.computer, pid: 12, seconds: body.minutes * 60 });
    if (url === '/api/support/restart/cancel') return response({ computer: body.computer, pid: 13, cancelled: true });
    if (url === '/api/support/gpupdate') return response({ computer: body.computer, pid: 14 });
    if (url === '/api/support/unlock') return response({ account: body.identity, was_locked: true, locked: false });
    if (url === '/api/support/bitlocker') return response({ computer: body.computer, keys });
    if (url.startsWith('/api/support/notes') && method === 'PUT') {
      notes[body.kind + ':' + body.key] = body.text ? { text: body.text, updated: '2026-10-21T10:00:00', by: 'EXAMPLE\\operator' } : null;
      return response({ kind: body.kind, key: body.key, note: notes[body.kind + ':' + body.key] });
    }
    if (url.startsWith('/api/support/notes?')) { const query = new URLSearchParams(url.split('?')[1]); return response({ user: notes['user:' + query.get('user')] || null, machine: notes['machine:' + query.get('machine')] || null }); }
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
  assert.deepEqual([...pane('user-groups').querySelectorAll('.inbox-work-chips span')].map(n => [n.textContent, n.dataset.tone]), [['Locked out', 'bad'], ['Password expires in 3 days', 'warn']]);
  // Locked out: unlocked from here, then looked up again.
  pane('user-groups').querySelector('[data-work-unlock]').click();
  await until(() => fetched('/api/support/unlock').length === 1 && fetched('/api/active-directory/lookup').length === 2, 'unlock and look up again');
  assert.deepEqual(fetched('/api/support/unlock')[0].body, { identity: 'INBOX0', server: '' });
  await until(() => pane('user-groups').querySelector('[data-work-filter]'), 'groups after unlock');
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
  // BitLocker recovery keys from AD: newest first, found by the Key ID on the screen, copied.
  pane('machine-groups').querySelector('[data-work-bitlocker-show]').click();
  await until(() => pane('machine-groups').querySelectorAll('.inbox-work-keys li').length === 2, 'BitLocker keys');
  assert.deepEqual(fetched('/api/support/bitlocker')[0].body, { computer: 'LAPTOP-01', server: '' });
  assert.deepEqual([...pane('machine-groups').querySelectorAll('.inbox-work-keys b')].map(n => n.textContent), ['9F8E7D6C', '1A2B3C4D']);
  const keyFilter = pane('machine-groups').querySelector('[data-work-key-filter]');
  keyFilter.value = '1a2b-3c'; keyFilter.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.deepEqual([...pane('machine-groups').querySelectorAll('.inbox-work-keys li')].map(li => [li.hidden, li.hasAttribute('data-match')]), [[true, false], [false, true]]);
  pane('machine-groups').querySelector('[data-work-key-copy="1"]').click();
  await until(() => clipboard === keys[0].password, 'recovery key copied');

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

  // Person: record, desk and devices; their PC tools in one click.
  await actions.run({ action: 'person', user: person });
  await until(() => pane('person').querySelector('.inbox-work-record'), 'person record');
  const record = Object.fromEntries([...pane('person').querySelectorAll('.inbox-work-record dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual([record.Department, record.Location, record.Desk, record.Manager], ['Client Services', 'Paris', '04R019086 (floor 4)', 'Jo Lead']);
  assert.match(pane('person').querySelector('[data-work-device="PHONE-01"]').textContent, /Inventory only/);
  pane('person').querySelector('[data-work-use="LAPTOP-01"][data-then="performance"]').click();
  assert.equal(d.querySelector('[data-work-tab="performance"]').getAttribute('aria-selected'), 'true');

  // The message's people and PCs, one click each; a person without a PC given gets their own.
  w.dispatchEvent(new w.CustomEvent('atlas:inbox-detail', { detail: { match: { user: person }, machines: [laptop], analysis: { machines: [], people: [marie, { ambiguous: true, written: 'Lee Wong', candidates: [] }] } } }));
  const chips = () => [...d.querySelectorAll('[data-work-request] button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]);
  assert.deepEqual(chips(), [['Alex Morgan · sender', 'true'], ['Marie Dupont', 'false'], ['LAPTOP-01', 'true'], ['LAPTOP-09', 'false']]);
  d.querySelector('[data-work-person="1"]').click();
  await until(() => w.AtlasInboxWork.state().machine === 'LAPTOP-09', "Marie's PC picked");
  assert.match(d.querySelector('[data-work-title]').textContent, /LAPTOP-09 · Marie Dupont/);
  d.querySelector('[data-work-machine="0"]').click();
  assert.deepEqual([w.AtlasInboxWork.state().machine, w.AtlasInboxWork.state().user], ['LAPTOP-01', 7], 'A PC chip brings its owner');

  // Same access as a colleague: groups Marie has that Alex lacks.
  d.querySelector('[data-work-tab="user-groups"]').click();
  await until(() => pane('user-groups').querySelector('[data-work-compare-with]'), 'compare offer');
  pane('user-groups').querySelector('[data-work-compare-with="X09"]').click();
  await until(() => pane('user-groups').querySelector('[data-compare="missing"]'), 'comparison');
  assert.deepEqual([...pane('user-groups').querySelectorAll('[data-compare="missing"] [data-group] > span')].map(n => n.textContent), ['APP-Visio', 'VPN-Users']);
  assert.match(pane('user-groups').querySelector('[data-work-compare-result]').textContent, /Marie Dupont has, Alex Morgan lacks \(2\)[\s\S]*Only Alex Morgan has \(1\)[\s\S]*2 groups in common/);
  pane('user-groups').querySelector('[data-work-copy-missing]').click();
  await until(() => clipboard === 'APP-Visio\nVPN-Users', 'copied missing groups');

  // Anyone else: several matches are listed, one opens directly.
  const find = term => { const form = d.querySelector('[data-work-lookup]'); form.elements.term.value = term; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
  find('sam');
  await until(() => d.querySelectorAll('[data-work-pick-user]').length === 2, 'lookup results');
  d.querySelector('[data-work-pick-user="0"]').click();
  await until(() => /Sam Lee/.test(d.querySelector('[data-work-title]').textContent), 'picked person');
  find('laptop-09');
  await until(() => w.AtlasInboxWork.state().machine === 'LAPTOP-09' && w.AtlasInboxWork.state().tab === 'health', 'single PC opens');

  // Late lookup responses cannot replace a newer result or an explicit context change.
  const deferredLookup = term => {
    let finish;
    pendingLookups.set(term, new Promise(resolve => { finish = (data, status = 200) => resolve(response(data, status)); }));
    find(term);
    return finish;
  };
  const obsoletePc = { users: [], machines: [{ name: 'OBSOLETE-PC', windows_remote_supported: 1 }] };
  const results = d.querySelector('[data-work-results]');
  const oldSuccess = deferredLookup('old-success');
  const oldFailure = deferredLookup('old-failure');
  const latest = deferredLookup('latest');
  oldSuccess(obsoletePc); oldFailure({ detail: 'OBSOLETE LOOKUP FAILURE' }, 503);
  await sleep(30);
  assert.equal(results.getAttribute('aria-busy'), 'true', 'Obsolete completions cannot finish the latest loading state');
  assert(!results.textContent.includes('OBSOLETE'));
  latest({ users: [], machines: [{ name: 'LAPTOP-09', windows_remote_supported: 1 }] });
  await until(() => results.hidden, 'latest lookup opens its PC');
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09');

  const afterLatest = deferredLookup('after-latest');
  find('laptop-09');
  await until(() => results.hidden, 'newer PC result selected');
  afterLatest(obsoletePc); await sleep(30);
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09', 'An older response completing after the latest result cannot replace its PC');

  const beforeManualChoice = deferredLookup('before-manual-choice');
  d.querySelector('[data-work-person="1"]').click();
  await until(() => w.AtlasInboxWork.state().user === 9, 'manual request person');
  beforeManualChoice(obsoletePc); await sleep(30);
  assert.deepEqual([w.AtlasInboxWork.state().user, w.AtlasInboxWork.state().machine], [9, 'LAPTOP-09'], 'An earlier search cannot replace a manually chosen person and their PC');

  for (const selector of ['[data-work-person="1"]', '[data-work-machine="1"]']) {
    const beforeSameChoice = deferredLookup('before-same-' + selector);
    d.querySelector(selector).click();
    beforeSameChoice(obsoletePc); await sleep(30);
    assert.deepEqual([w.AtlasInboxWork.state().user, w.AtlasInboxWork.state().machine], [9, 'LAPTOP-09'], 'Explicitly choosing the current person or PC also cancels pending lookup');
  }

  const beforeClear = deferredLookup('before-clear');
  find(''); beforeClear(obsoletePc); await sleep(30);
  assert(results.hidden && !results.hasAttribute('aria-busy'), 'Clearing lookup invalidates pending results');
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09');

  const beforeMessage = deferredLookup('before-message');
  w.dispatchEvent(new w.CustomEvent('atlas:inbox-detail', { detail: { message: { id: 200 }, match: { user: marie }, analysis: {} } }));
  beforeMessage(obsoletePc); await sleep(30);
  assert(results.hidden);
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09', 'An earlier message lookup cannot replace the current selection');

  const beforeClose = deferredLookup('before-close');
  d.querySelector('[data-work-close]').click();
  beforeClose(obsoletePc); await sleep(30);
  assert(work().hidden, 'An obsolete lookup cannot reopen closed tools');
  w.AtlasInboxWork.open({ user: marie, machine: 'LAPTOP-09' }, 'person');
  const beforeLeaving = deferredLookup('before-leaving');
  run("page('workspace');page('inbox')");
  beforeLeaving(obsoletePc); await sleep(30);
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09', 'Leaving and returning cannot revive an obsolete lookup');

  // PC tools that open over Live Inbox.
  const opened = []; w.AtlasSoftware.load = pc => opened.push(['software', pc]); w.AtlasServices = { load: () => opened.push(['services', run('S.target')]) }; w.AtlasHealth.specs = pc => opened.push(['specs', pc]);
  for (const key of ['software', 'services', 'specs']) d.querySelector(`[data-work-${key}]`).click();
  assert.deepEqual(opened, [['software', 'LAPTOP-09'], ['services', 'LAPTOP-09'], ['specs', 'LAPTOP-09']]);
  assert($('inbox').classList.contains('active'));

  // Knowledge Base articles open beside the message; diagrams still need the viewer.
  w.AtlasKnowledgeArticles = { render: async (markdown, target) => { target.textContent = 'rendered: ' + markdown; } };
  await actions.run({ action: 'knowledge', document: 'article:visio' });
  await until(() => /rendered: ## Steps/.test(pane('knowledge').textContent), 'article');
  assert.match(pane('knowledge').textContent, /Visio requests/);
  assert.equal(w.AtlasInboxWork.state().machine, 'LAPTOP-09', 'An article keeps the PC on screen');
  const diagrams = []; w.AtlasKnowledge.show = id => diagrams.push(id);
  await actions.run({ action: 'knowledge', document: 'kb-network' });
  assert.deepEqual(diagrams, ['kb-network']);

  // Reply: templates in the email's language, filled from the message; Outlook opens the reply (never sends it).
  const commands = () => calls.filter(c => c.url === '/api/companion/commands').map(c => c.body);
  const french = { message: { id: 31, subject: 'Commande Téléphone pro', body: "Bonjour, pourriez-vous installer Example App ? Ticket INC0012345. Merci", sender_name: 'Lair de Gourmont, Amaury Pierre Marie : GTB Europe', sender_address: 'amaury@example.test', outlook: true, content_kind: 'mail', channel: 'outlook' },
    match: { user: { id: 7, full_name: 'Lair de Gourmont, Amaury Pierre Marie', email: 'amaury@example.test' } }, machines: [], analysis: { machines: [], people: [], packages: [{ display_name: 'Example App' }] } };
  w.dispatchEvent(new w.CustomEvent('atlas:inbox-detail', { detail: french }));
  await actions.run({ action: 'reply', user: french.match.user });
  assert.equal(d.querySelector('[data-work-tab="reply"]').getAttribute('aria-selected'), 'true');
  assert.equal(pane('reply').querySelector('[data-work-lang="fr"]').getAttribute('aria-pressed'), 'true', 'A French email gets French templates');
  await until(() => w.AtlasInboxWork.state().machine === 'LAPTOP-01', "the sender's own PC");
  pane('reply').querySelector('[data-work-template="installed"]').click();
  const box = pane('reply').querySelector('[data-work-reply]');
  assert.match(box.value, /^Bonjour Amaury,\n\nExample App est maintenant installé sur LAPTOP-01\./, 'Given name, package and PC');
  pane('reply').querySelector('[data-work-template="ticket"]').click();
  assert.match(box.value, /J'ai ouvert INC0012345/);
  box.value += '\nRedouane'; box.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('[data-work-tab="health"]').click(); d.querySelector('[data-work-tab="reply"]').click();
  assert.match(pane('reply').querySelector('[data-work-reply]').value, /Redouane$/, 'The draft survives switching tools');
  pane('reply').querySelector('[data-work-reply-all]').click();
  pane('reply').querySelector('[data-work-reply-outlook]').click();
  await until(() => /press Send/.test(pane('reply').querySelector('[data-work-reply-status]').textContent), 'reply opened');
  assert.deepEqual([commands().at(-1).kind, commands().at(-1).args.message_id, commands().at(-1).args.reply_all], ['outlook.reply', 31, true]);
  assert.match(commands().at(-1).args.text, /INC0012345[\s\S]*Redouane$/);
  pane('reply').querySelector('[data-work-lang="en"]').click();
  pane('reply').querySelector('[data-work-template="restart"]').click();
  assert.match(pane('reply').querySelector('[data-work-reply]').value, /^Hi Amaury,\n\nCould you please restart LAPTOP-01/);
  // A Teams preview is answered in a Teams chat, prefilled, opened in the operator's own Teams.
  const teams = { ...french, message: { ...french.message, id: 32, subject: 'Alex Morgan', body: 'Is my laptop ready?', content_kind: 'notification', channel: 'teams', outlook: false, sender_address: '' }, match: { user: person } };
  w.dispatchEvent(new w.CustomEvent('atlas:inbox-detail', { detail: teams }));
  assert.equal(pane('reply').querySelector('[data-work-lang="en"]').getAttribute('aria-pressed'), 'true');
  assert(!pane('reply').querySelector('[data-work-reply-outlook]'), 'No Outlook reply for a Teams preview');
  pane('reply').querySelector('[data-work-template="done"]').click();
  pane('reply').querySelector('[data-work-reply-teams]').click();
  await until(() => commands().at(-1).kind === 'open.url', 'teams chat');
  assert.match(commands().at(-1).args.url, /^https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0\?users=alex%40example\.test&message=Hi%20Alex/);
  // Teams chat and call with anyone from their record.
  await actions.run({ action: 'person', user: person });
  await until(() => pane('person').querySelector('[data-work-link="call"]'), 'person links');
  pane('person').querySelector('[data-work-link="call"]').click();
  await until(() => /l\/call\/0\/0\?users=alex%40example\.test$/.test(commands().at(-1).args.url || ''), 'teams call');

  // Check-up: what stands out first, from the Check-up button of a request PC.
  await actions.run({ action: 'checkup', user: person, machine: 'LAPTOP-01' });
  assert.equal(d.querySelector('[data-work-tab="checkup"]').getAttribute('aria-selected'), 'true');
  await until(() => pane('checkup').querySelector('.inbox-work-findings'), 'check-up');
  assert.equal(fetched('/api/diagnose/LAPTOP-01?days=7').length, 1);
  const checked = [...pane('checkup').querySelectorAll('.inbox-work-tile')].map(t => [t.querySelector('small').textContent, t.querySelector('b').textContent, t.dataset.tone]);
  assert.deepEqual(checked, [['Signed in', 'INBOX0', ''], ['Uptime', '9 days', 'warn'], ['Restart', 'Pending', 'bad'], ['Crashes', '1', 'warn'], ['Updates', '–', '']]);
  assert.deepEqual([...pane('checkup').querySelectorAll('.inbox-work-findings li')].map(li => [li.dataset.tone, li.textContent]), [
    ['bad', 'Restart pending: Windows Update'], ['warn', 'Not restarted for 9 days'], ['warn', '1 unexpected shutdown in 7 days (power loss or freeze)'],
    ['warn', 'OUTLOOK.EXE: 4 crashes, 1 hang'], ['warn', 'Ethernet 2 at 100 Mbps: check the cable or the dock']]);
  assert.match(pane('checkup').querySelector('.inbox-work-network').textContent, /10\.1\.2\.3 · DHCP · corp\.example[\s\S]*Gateway 10\.1\.2\.1/);
  assert.match(pane('checkup').textContent, /Not checked \(1\)/);
  const days = pane('checkup').querySelector('[data-work-checkup-days]');
  days.value = '14'; days.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => fetched('/api/diagnose/LAPTOP-01?days=14').length === 1 && /in 14 days/.test(pane('checkup').textContent), 'check-up over 14 days');
  pane('checkup').querySelector('[data-work-checkup-copy]').click();
  await until(() => /^Check-up of LAPTOP-01[\s\S]*- Restart pending: Windows Update/.test(clipboard), 'check-up copied');

  // Message on screen and restart later: small forms under the PC tools; a restart can be cancelled.
  const form = () => d.querySelector('[data-work-form]');
  pane('checkup').querySelector('[data-work-act="restart"]').click();
  assert(!form().hidden && form().querySelector('[data-work-schedule-restart]'), 'Restart later from the check-up');
  form().querySelector('[name="minutes"]').value = '30';
  form().querySelector('[data-work-schedule-restart]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => fetched('/api/support/restart').length === 1 && form().hidden, 'restart planned');
  assert.deepEqual(fetched('/api/support/restart')[0].body, { computer: 'LAPTOP-01', message: 'IT support will restart your PC. Please save your work.', minutes: 30 });
  d.querySelector('[data-work-act="restart"]').click();
  form().querySelector('[data-work-restart-cancel]').click();
  await until(() => fetched('/api/support/restart/cancel').length === 1 && form().hidden, 'restart cancelled');
  d.querySelector('[data-work-act="message"]').click();
  form().querySelector('[data-work-screen="0"]').click();
  form().querySelector('[name="seconds"]').value = '900';
  form().querySelector('[data-work-send-message]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => fetched('/api/support/message').length === 1, 'message sent');
  assert.deepEqual(fetched('/api/support/message')[0].body, { computer: 'LAPTOP-01', text: 'IT support is connecting to your PC now to look at your request.', seconds: 900 });
  d.querySelector('[data-work-act="message"]').click(); d.querySelector('[data-work-act="message"]').click();
  assert(form().hidden, 'The same button closes its form');
  d.querySelector('[data-work-gpupdate]').click();
  await until(() => fetched('/api/support/gpupdate').length === 1, 'Group Policy refresh');

  // Person: their other requests open in Live Inbox; the latest deployments to their PCs.
  await actions.run({ action: 'person', user: person });
  await until(() => pane('person').querySelector('[data-work-open-message]'), 'request history');
  assert.deepEqual([...pane('person').querySelectorAll('[data-work-open-message]')].map(b => b.dataset.workOpenMessage), ['25'], 'The message on screen is not listed');
  assert.match(pane('person').querySelector('[data-state="failed"]').closest('li').textContent, /Example App · Install[\s\S]*LAPTOP-01/);
  const opens = []; w.addEventListener('atlas:inbox-open', event => opens.push(event.detail.id));
  pane('person').querySelector('[data-work-open-message="25"]').click();
  assert.deepEqual(opens, [25]);

  // Notes: shared notes on the person and the PC; the work log lists what was done, ready for the ticket.
  d.querySelector('[data-work-tab="notes"]').click();
  await until(() => pane('notes').querySelector('[data-work-note="user"]'), 'notes');
  assert(fetched('/api/support/notes?').some(c => c.url === '/api/support/notes?user=account%3Ainbox0&machine=LAPTOP-01'));
  const userNote = pane('notes').querySelector('[data-work-note="user"]');
  userNote.elements.text.value = 'Prefers Teams calls before 10:00';
  userNote.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /Saved/.test(userNote.querySelector('[data-work-note-status]').textContent), 'note saved');
  assert.deepEqual(calls.find(c => c.method === 'PUT').body, { kind: 'user', key: 'account:inbox0', text: 'Prefers Teams calls before 10:00' });
  const logged = () => [...pane('notes').querySelectorAll('.inbox-work-log li span')].map(n => n.textContent);
  assert.deepEqual(logged(), ['Reply prepared in Teams chat', 'Check-up of LAPTOP-01 (7 days): Restart pending: Windows Update; Not restarted for 9 days; 1 unexpected shutdown in 7 days (power loss or freeze); OUTLOOK.EXE: 4 crashes, 1 hang; Ethernet 2 at 100 Mbps: check the cable or the dock',
    'Check-up of LAPTOP-01 (14 days): Restart pending: Windows Update; Not restarted for 9 days; 1 unexpected shutdown in 14 days (power loss or freeze); OUTLOOK.EXE: 4 crashes, 1 hang; Ethernet 2 at 100 Mbps: check the cable or the dock',
    'Restart of LAPTOP-01 planned for ' + new Date(Date.now() + 1800e3).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'Planned restart of LAPTOP-01 cancelled',
    'Message shown on LAPTOP-01: "IT support is connecting to your PC now to look at your request."', 'Group Policy refresh started on LAPTOP-01']);
  const line = pane('notes').querySelector('[data-work-log-add]');
  line.elements.text.value = 'Called Alex, Outlook works after the restart';
  line.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => logged().length === 8, 'manual log line');
  pane('notes').querySelector('[data-work-log-copy]').click();
  await until(() => /^Request: Alex Morgan\nFrom: Lair de Gourmont[\s\S]*User: Alex Morgan · INBOX0\nPC: LAPTOP-01\n\nWork done:\n[\s\S]*Called Alex, Outlook works after the restart$/.test(clipboard), 'ticket text');
  // The person note shows on their record.
  await actions.run({ action: 'person', user: person });
  await until(() => pane('person').querySelector('.inbox-work-pinned'), 'pinned note');
  assert.match(pane('person').querySelector('.inbox-work-pinned').textContent, /Prefers Teams calls before 10:00/);
  // Another message has its own work log.
  w.dispatchEvent(new w.CustomEvent('atlas:inbox-detail', { detail: { ...teams, message: { ...teams.message, id: 33 } } }));
  d.querySelector('[data-work-tab="notes"]').click();
  await until(() => pane('notes').querySelector('[data-work-log]') && !pane('notes').querySelector('.inbox-work-log'), 'empty log for another message');
  assert.match(pane('notes').querySelector('[data-work-log]').textContent, /Work log for this request \(0\)/);

  // A sender without a Windows PC: Person, User groups, Knowledge, Reply and Notes only.
  await actions.run({ action: 'user-groups', user: { ...person, id: 8, user_name: 'INBOX1', full_name: 'Sam Lee' }, machine: '' });
  assert.deepEqual([...d.querySelectorAll('[data-work-tab]')].filter(b => !b.disabled).map(b => b.dataset.workTab), ['person', 'user-groups', 'knowledge', 'reply', 'notes']);
  assert(d.querySelector('[data-work-tool="msra"]').disabled);
  assert.match(d.querySelector('[data-work-title]').textContent, /No Windows PC · Sam Lee/);

  // Close: the tools hide and the deployment panel goes home.
  d.querySelector('[data-work-close]').click();
  assert(work().hidden);
  assert.equal($('deploymentPanel').parentNode, $('workspace'));
  assert(calls.every(c => c.method === 'GET' || ['/api/active-directory/lookup', '/api/kill', '/api/companion/commands'].includes(c.url) || c.url.startsWith('/api/support/')), 'Nothing deploys or reboots by itself');
  await sleep(100);
  assert.deepEqual(f.errors, []);
  w.close();
  console.log('PASS: Live Inbox request tools run person (record, desk, devices), health, performance (End… confirmed), user and PC AD groups (filter, copy, compare with a colleague), deployment, software/services/specs and articles beside the message; replies (FR/EN templates, Outlook reply window, Teams chat) and Teams chat/call; request people and PCs one click each; check-up, message on screen, restart later (and cancel), GPUpdate, unlock, password expiry, BitLocker keys found by Key ID, other requests and deployments, notes and the work log copied for the ticket; lookup of anyone; the deployment panel moves in and back intact; Back to Live Inbox after a Live Inbox button; reboot confirmed; Workspace fallback outside Live Inbox');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
