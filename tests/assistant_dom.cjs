// Local Assistant in the console: settings dialog, Knowledge Base "Draft from notes" with file picker and
// review panel, note files from Search everything, and the read-only Demo. No model runs here.
const assert = require('node:assert/strict');
const { fixture } = require('./ui_fixture.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 4000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(10)) if (check()) return;
  throw Error('Assistant UI did not settle');
}
const STATUS = { ready: false, loading: false, configured: true, mode: 'llama-server', model_name: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  server: 'C:\\Atlas\\llm\\llama-server.exe', model: 'C:\\Atlas\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf', gpu_layers: 99, context: 8192,
  idle_minutes: 30, folders: ['C:\\Notes'], external: false, error: '', detected: { server: 'C:\\Atlas\\llm\\llama-server.exe', model: '' } };
const DRAFT = { title: 'Printer queue stuck', tags: ['printer'], categories: ['printer'], sources: ['spooler.txt'], seconds: 12.5, model: 'Qwen3-4B.gguf', cut: false,
  markdown: '## Steps\n1. Stop the spooler.\n2. Reinstall the driver on PRN-PAR-04.\n\n## Commands\n- `net stop spooler`\n\n## Sources\n- spooler.txt\n',
  checks: [{ section: 'Steps', text: 'Reinstall the driver on PRN-PAR-04.', reasons: ['not in the source: PRN-PAR-04'] },
           { section: 'Summary', text: 'x', reasons: ['its quote only nearly matches the notes'], minor: true }],
  dropped: [{ section: 'Commands', text: 'Restart-Service Spooler -Force', reasons: ['not in the notes'] }] };

const importState = { state: 'idle', total: 0, done: 0, drafted: 0, skipped: 0, failed: 0, current: '', message: '', drafts: { pending: 2 }, files: { drafted: 2 } };
function api(requests, overrides = {}) {
  return async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : undefined;
    requests.push({ url, method: o.method || 'GET', body });
    let data = {};
    if (url === '/api/session') data = { token: 'test' };
    else if (url === '/api/knowledge') data = { documents: [] };
    else if (url === '/api/knowledge/article-categories') data = { categories: [{ id: 'printer', label: 'Printing' }] };
    else if (url === '/api/knowledge/articles') data = { articles: [] };
    else if (url === '/api/assistant/status') data = STATUS;
    else if (url === '/api/assistant/settings') data = { ...STATUS, ...body };
    else if (url === '/api/assistant/start') data = { ...STATUS, loading: true };
    else if (url === '/api/assistant/files') data = body.path === '' ? { path: '', parent: null, items: [{ name: 'C:\\Notes', path: 'C:\\Notes', folder: true }] }
      : { path: 'C:\\Notes', parent: null, items: [{ name: 'printers', path: 'C:\\Notes\\printers', folder: true },
        { name: 'spooler.txt', path: 'C:\\Notes\\spooler.txt', folder: false, size: 10, modified: 1790000000 }] };
    else if (url === '/api/assistant/file') data = { path: body.path, name: body.path.split('\\').pop(), text: 'net stop spooler\n<b>not html</b>', modified: 1790000000 };
    else if (url === '/api/assistant/draft-article') data = DRAFT;
    else if (url === '/api/knowledge/import') data = importState;
    else if (url === '/api/knowledge/import/plan') data = { files: 1240, new: 900, done_before: 340, by_type: { '.docx': 700, '.txt': 500, '.log': 40 }, suggested_types: ['.docx', '.txt'], seconds_per_file: 12 };
    else if (url === '/api/knowledge/import/start') { Object.assign(importState, { state: 'running', total: 900, done: 3, drafted: 2, skipped: 1, current: 'vpn.docx', eta_seconds: 10764 }); data = importState; }
    else if (url === '/api/knowledge/import/pause') { importState.state = 'paused'; data = importState; }
    else if (url === '/api/knowledge/drafts') data = { drafts: [{ id: 7, title: 'VPN fix', path: 'F:\\IT\\vpn.docx', flags: 0, created: '2026-10-16T09:00:00Z', tags: [], categories: [] },
      { id: 8, title: 'Printer', path: 'F:\\IT\\printer.txt', flags: 2, created: '2026-10-16T09:00:00Z', tags: [], categories: [] }] };
    else if (url === '/api/knowledge/drafts/8') data = { id: 8, title: 'Printer', path: 'F:\\IT\\printer.txt', flags: 2, tags: ['printer'], categories: ['printer'],
      markdown: '## Steps\n1. Reinstall the driver on PRN-PAR-04.\n', review: { checks: DRAFT.checks, dropped: [], sources: ['printer.txt'], cut: false, seconds: 9, model: 'm' } };
    else if (url === '/api/knowledge/drafts/8/publish') data = { article: 'printer-1' };
    else if (url === '/api/knowledge/drafts/publish-clean') data = { published: 1, articles: ['vpn-fix-1'] };
    else if (url.startsWith('/api/knowledge/articles/') && o.method === 'PUT') data = { revision: 1, updated: '2026-10-16T09:00:00Z' };
    else if (url.startsWith('/api/knowledge/articles/')) data = { id: 'x', title: 'Saved', markdown: '', tags: [], categories: [], revision: 1, updated: '' };
    else if (url.startsWith('/api/search-everything')) data = { results: [{ kind: 'file', ref: 'C:\\Notes\\spooler.txt', title: '\u0002spooler\u0003.txt', snippet: 'net stop', at: '', extra: {} }] };
    else if (url.includes('/catalog')) data = { items: [] };
    else if (url.includes('/scripts')) data = { scripts: [] };
    else if (url.includes('/deployments')) data = { deployments: [] };
    if (overrides[url]) return overrides[url](body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
  };
}
const fakeMarkdown = (w) => {
  w.marked = { parse: (text) => text.split('\n').map((line) => `<p>${line.replace(/</g, '&lt;')}</p>`).join('') };
  w.DOMPurify = { sanitize: (html) => html };
};

(async () => {
  const requests = [];
  const f = await fixture({ fetch: api(requests) });
  fakeMarkdown(f.w);
  await f.console();
  const { w } = f, d = w.document;
  assert(w.AtlasAssistant, 'Settings script loads with the console');
  assert(!requests.some((r) => r.url.startsWith('/api/assistant')), 'Nothing is asked of the Assistant at start-up');

  // Settings dialog: status, detected files, save payload, start.
  await w.AtlasAssistant.openSettings();
  const dialog = d.querySelector('.assistant-dialog');
  assert.match(dialog.querySelector('.assistant-state').textContent, /Stopped · starts by itself/);
  const inputs = [...dialog.querySelectorAll('.assistant-field')];
  const fieldValue = (label) => inputs.find((f) => f.textContent.startsWith(label)).querySelector('input, textarea');
  assert.match(inputs.find((f) => f.textContent.startsWith('llama-server')).textContent, /Found in Atlas\\llm/);
  fieldValue('Notes folders').value = 'C:\\Notes\n\n D:\\Runbooks ';
  fieldValue('GPU layers').value = '20';
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
  await until(() => requests.some((r) => r.url === '/api/assistant/settings'));
  const saved = requests.find((r) => r.url === '/api/assistant/settings');
  assert.deepEqual([saved.body.folders, saved.body.gpu_layers, saved.body.context, saved.body.url], [['C:\\Notes', 'D:\\Runbooks'], 20, 8192, '']);
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Start').click();
  await until(() => /Loading Qwen3/.test(dialog.querySelector('.assistant-state').textContent));
  dialog.close();

  // Knowledge Base: Draft from notes.
  await w.AtlasKnowledge.open(); await sleep(20);
  const kb = d.getElementById('knowledge');
  const templates = kb.querySelector('.kb-article-list select');
  assert.equal(templates.querySelector('option[value="assistant"]').textContent, 'Draft from notes with the Assistant…');
  templates.value = 'assistant'; templates.dispatchEvent(new w.Event('change'));
  await until(() => kb.querySelector('.kb-file-browser .kb-folder'));
  assert.match(kb.querySelector('.kb-assistant-status').textContent, /Stopped · starts by itself/);
  const form = kb.querySelector('.kb-assistant-form');
  form.dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(10);
  assert.match(form.querySelector('[role="status"]').textContent, /Paste some notes or choose a file/);
  assert(!requests.some((r) => r.url === '/api/assistant/draft-article'), 'Nothing is sent without notes');
  kb.querySelector('.kb-file-browser .kb-folder').click();
  await until(() => kb.querySelector('.kb-file-browser input[type="checkbox"]'));
  kb.querySelector('.kb-file-browser input[type="checkbox"]').click();
  assert.match(kb.querySelector('.kb-picked').textContent, /spooler\.txt/);
  form.querySelector('textarea').value = 'extra: PRN-PAR-03 is on floor 3';
  form.querySelector('input').value = 'Printer queue stuck';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => kb.querySelector('.kb-review'));
  assert.deepEqual(requests.find((r) => r.url === '/api/assistant/draft-article').body,
    { notes: 'extra: PRN-PAR-03 is on floor 3', files: ['C:\\Notes\\spooler.txt'], title: 'Printer queue stuck' });
  const editor = kb.querySelector('.kb-article-editor');
  assert(editor.contains(kb.querySelector('.kb-review')), 'The review stays inside the editor, above the fields');
  const review = kb.querySelector('.kb-review');
  assert.match(review.textContent, /Check 1 line before saving/);
  assert.match(review.textContent, /not in the source: PRN-PAR-04/);
  assert.match(review.textContent, /Left out because they are not in your notes as written: Restart-Service Spooler -Force/);
  assert.match(review.textContent, /1 line quote the notes with small differences/);
  assert.match(review.textContent, /Drafted by Qwen3-4B\.gguf in 12\.5 s from spooler\.txt/);
  assert.equal(editor.querySelector('input[aria-label="Article title"]').value, 'Printer queue stuck');
  assert.equal(editor.querySelector('input[value="printer"]').checked, true);
  [...review.querySelectorAll('button')].find((b) => b.textContent === 'Remove from draft').click();
  assert(!editor.querySelector('textarea').value.includes('PRN-PAR-04'), 'The flagged line is removed from the Markdown');
  assert(editor.querySelector('textarea').value.includes('1. Stop the spooler.'));
  editor.dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(30);
  const put = requests.find((r) => r.method === 'PUT');
  assert.equal(put.body.title, 'Printer queue stuck');
  assert(!put.body.markdown.includes('PRN-PAR-04'));

  // Note files from Search everything.
  kb.querySelector('.kb-scope input').click();
  const search = kb.querySelector('.kb-article-search input[type="search"]');
  search.value = 'spooler'; search.dispatchEvent(new w.Event('input')); await sleep(260);
  assert.match(requests.filter((r) => r.url.startsWith('/api/search-everything')).at(-1).url, /kinds=article,diagram,inbox,deployment,file/);
  assert.equal(kb.querySelector('.kb-kind-file').textContent, 'Note');
  kb.querySelector('.kb-kind-file').closest('button').click();
  await until(() => kb.querySelector('.kb-file-text'));
  assert.equal(kb.querySelector('.kb-file-text').textContent, 'net stop spooler\n<b>not html</b>', 'File text is shown as text');
  assert.equal(kb.querySelector('.kb-file-text b'), null);
  [...kb.querySelectorAll('.kb-file button')].find((b) => b.textContent === 'Draft article from this file').click();
  await until(() => kb.querySelector('.kb-assistant-form'));
  assert.match(kb.querySelector('.kb-picked').textContent, /spooler\.txt/, 'The file is already chosen');
  await w.AtlasKnowledge.show('file:C:\\Notes\\vpn.md'); await sleep(20);
  assert.equal(requests.filter((r) => r.url === '/api/assistant/file').at(-1).body.path, 'C:\\Notes\\vpn.md');

  // Import from folders and the review queue.
  await until(() => !kb.querySelector('.kb-drafts-button').hidden);
  assert.equal(kb.querySelector('.kb-drafts-button').textContent, 'Review imported drafts (2)');
  templates.value = 'import'; templates.dispatchEvent(new w.Event('change'));
  await until(() => /1,240 files, 900 not imported yet/.test(kb.querySelector('.kb-import [role="status"]')?.textContent || ''));
  assert.match(kb.querySelector('.kb-import [role="status"]').textContent, /About 3.0 h at 12 s per file/);
  assert.deepEqual([...kb.querySelectorAll('.kb-import-types label')].map((l) => l.textContent.trim()), ['.docx 700', '.txt 500', '.log 40']);
  assert.deepEqual([...kb.querySelectorAll('.kb-import-types input')].map((i) => i.checked), [true, true, false], 'Logs start unticked');
  kb.querySelector('.kb-import-types input[value=".txt"]').click();
  kb.querySelector('.kb-import-fields input[aria-label="Only this folder inside it"]').value = 'C:\\Notes\\IT';
  [...kb.querySelectorAll('.kb-import button')].find((b) => b.textContent === 'Start import').click();
  await until(() => /Importing · 3 of 900 files · about 3.0 h left/.test(kb.querySelector('.kb-import-progress').textContent));
  assert.deepEqual(requests.find((r) => r.url === '/api/knowledge/import/start').body, { folder: 'C:\\Notes\\IT', since: 0, types: ['.docx'], limit: 0 });
  assert.match(kb.querySelector('.kb-import-progress').textContent, /vpn\.docx/);
  [...kb.querySelectorAll('.kb-import-progress button')].find((b) => b.textContent === 'Pause').click();
  await until(() => /Paused/.test(kb.querySelector('.kb-import-progress').textContent));
  importState.state = 'idle';
  await w.AtlasKnowledgeArticles.reviewQueue();
  const queue = kb.querySelector('.kb-review-queue');
  assert.deepEqual([...queue.querySelectorAll('.kb-kind')].map((k) => k.textContent), ['Clean', '2 to check']);
  [...queue.querySelectorAll('.kb-result')][1].click();
  await until(() => kb.querySelector('.kb-article-view .kb-review'));
  assert.match(kb.querySelector('.kb-article-view').textContent, /From F:\\IT\\printer\.txt/);
  assert.equal(kb.querySelector('.kb-article-view .kb-review button'), null, 'The preview has no edit buttons');
  [...kb.querySelectorAll('.kb-article-view button')].find((b) => b.textContent === 'Edit, then publish').click();
  const draftEditor = kb.querySelector('.kb-article-editor');
  assert.equal(draftEditor.querySelector('button[type="submit"]').textContent, 'Publish');
  [...draftEditor.querySelectorAll('.kb-review button')].find((b) => b.textContent === 'Remove from draft').click();
  draftEditor.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => requests.some((r) => r.url === '/api/knowledge/drafts/8/publish'));
  const published = requests.find((r) => r.url === '/api/knowledge/drafts/8/publish').body;
  assert.equal(published.title, 'Printer');
  assert(!published.markdown.includes('PRN-PAR-04'), 'The edited text is what gets published');
  w.confirm = () => true;
  await w.AtlasKnowledgeArticles.reviewQueue();
  [...kb.querySelectorAll('.kb-review-queue button')].find((b) => b.textContent === 'Publish 1 clean draft').click();
  await until(() => requests.some((r) => r.url === '/api/knowledge/drafts/publish-clean'));

  // A failed draft keeps the form and explains why.
  w.close();
  const failing = [];
  const g = await fixture({ fetch: api(failing, { '/api/assistant/draft-article': () => ({ ok: false, status: 409, headers: { get: () => null },
    json: async () => ({ detail: 'No model file. Put a .gguf model in the Atlas\\llm folder.' }) }) }) });
  fakeMarkdown(g.w);
  await g.console();
  await g.w.AtlasKnowledge.open(); await sleep(20);
  g.w.AtlasKnowledgeArticles.draftFromNotes({ notes: 'some notes' });
  await until(() => g.w.document.querySelector('.kb-assistant-form'));
  g.w.document.querySelector('.kb-assistant-form').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await until(() => /No model file/.test(g.w.document.querySelector('.kb-assistant-form [role="status"]').textContent));
  assert.equal(g.w.document.querySelector('.kb-assistant-form button[type="submit"]').disabled, false);
  g.w.close();

  // Read-only Demo: no Assistant anywhere.
  const demoRequests = [];
  const demo = await fixture({ fetch: api(demoRequests) });
  demo.w.AtlasReadOnly = {};
  await demo.console();
  await demo.w.AtlasKnowledge.open(); await sleep(20);
  assert.equal(demo.w.document.querySelector('.kb-article-list select option[value="assistant"]'), null);
  await demo.w.AtlasAssistant.openSettings();
  assert.equal(demo.w.document.querySelector('.assistant-dialog'), null);
  assert(!demoRequests.some((r) => r.url.startsWith('/api/assistant')));
  demo.w.close();
  console.log('PASS: Assistant settings save/start, folder import with counts/types/estimate/progress/pause, review queue preview, edit then publish, publish clean drafts, Draft from notes with file picker, empty-input guard, review panel with flagged and dropped lines, remove flagged line, save, note files from search as text, draft from a file, file links, error kept in form, read-only Demo without Assistant');
})().catch((e) => { console.error(e); process.exit(1); });
