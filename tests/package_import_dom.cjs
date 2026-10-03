// Package metadata uploads operate independently of the directory workbook.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {fixture} = require('./ui_fixture.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = (data, status = 200) => ({ok: status < 400, status, json: async () => data});
(async () => {
 let finish, saves = 0, previews = 0, statuses = 0;
 const delayed = new Promise(resolve => finish = resolve);
 const preview = {id:'package-stage',source:'package.csv',report:{unique:2000,added:1900,changed:50,unchanged:50,retained:100,source_available:true,matched:1500,source_packages:8000,metadata_only:499,ambiguous:1,duplicates:0,extra_columns:[],examples:[{short_name:'ixExample',state:'Work in Progress',package_id:'EPP123',packager:'Operator'}]}};
 const f = await fixture({html:'frontend/database.html',url:'http://localhost/manage-database',fetch:async (url, options={}) => {
   assert(!url.startsWith('/api/database/'), 'Package workflow never calls directory APIs');
   if(url==='/api/session')return response({token:'test'});
   if(url==='/api/package-data/import/status') { statuses++; return response({count:statuses===1?100:2100,last_import:null}); }
   if(url==='/api/package-data/import/preview') { previews++; return previews===1 ? delayed : response(preview); }
   if(url==='/api/package-data/import/apply/package-stage') { saves++; return saves===1 ? response({detail:'Preview expired'},409) : response({count:2100,backup:'package-data-test.json.gz'}); }
   if(url==='/api/package-data/import/preview/package-stage' && options.method==='DELETE') return response({ok:true});
   throw Error('Unexpected request '+url);
 }});
 const {w,run} = f,d=w.document,get=id=>d.getElementById('package-data-'+id);
 assert.equal(new Set([...d.querySelectorAll('[id]')].map(node=>node.id)).size,d.querySelectorAll('[id]').length,'Uploader IDs stay unique');
 run(fs.readFileSync('frontend/assets/package-data-import.js','utf8'));await sleep(30);
 assert(!get('validate').disabled && get('review').hidden && get('apply').disabled);
 await get('validate').onclick();assert.match(get('message').textContent,/Choose a package CSV/);assert.equal(previews,0);
 const select=name=>{Object.defineProperty(get('file'),'files',{configurable:true,value:[{name,size:100}]});get('file').onchange();};
 select('users.xlsx');await get('validate').onclick();assert.equal(previews,0);
 select('package.csv');const work=get('validate').onclick();await sleep(30);assert(get('validate').disabled && !get('progress').hidden);
 assert(!d.getElementById('validate').disabled,'A package validation does not disable the directory uploader');
 await get('validate').onclick();assert.equal(previews,1,'Busy state prevents duplicate uploads');
 finish(response(preview));await work;assert(!get('review').hidden && !get('apply').disabled);assert.match(get('summary').textContent,/100 existing records retained/);assert.match(get('coverage').textContent,/1,500 matched to 8,000/);
 assert(d.getElementById('preview').hidden,'Package preview never opens directory replacement controls');
 await get('apply').onclick();assert.match(get('message').textContent,/Preview expired/);assert(!get('apply').disabled,'A failed save remains retryable');
 select('replacement.csv');assert(get('review').hidden && get('apply').disabled,'Changing the CSV invalidates the prior preview');
 await get('validate').onclick();await get('cancel').onclick();assert(get('review').hidden && get('apply').disabled);
 await get('validate').onclick();await get('apply').onclick();assert.match(get('message').textContent,/Package data saved: 2,100 records/);assert(get('review').hidden);assert.match(get('status').textContent,/2,100/);
 assert.deepEqual(f.errors,[]);w.close();console.log('PASS: independent package CSV validation, busy feedback, preview coverage, retry, cancellation and metadata save');
})().catch(error=>{console.error(error);process.exitCode=1});
