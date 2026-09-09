#!/usr/bin/env python3
import argparse, os, re, shutil, sqlite3, zipfile, uuid
from identity_links import rebuild_links
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
SS_CACHE={}

def clean(v): return str(v or '').strip()
def norm(v): return re.sub(r'\s+',' ',clean(v)).lower()
def excel_date(v):
    try:
        d=datetime(1899,12,30)+timedelta(days=float(v));return d.isoformat(sep=' ',timespec='seconds')
    except:return clean(v)
def col_idx(ref):
    n=0
    for ch in re.match(r'[A-Z]+',ref or 'A1').group():n=n*26+ord(ch)-64
    return n-1

def workbook_parts(path):
    with zipfile.ZipFile(path) as z:
        wb=ET.fromstring(z.read('xl/workbook.xml'));rr=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'));rels={x.attrib['Id']:x.attrib['Target'] for x in rr}
        return [(s.attrib['name'],('xl/'+rels[s.attrib[REL+'id']].lstrip('/').removeprefix('xl/'))) for s in wb.find(NS+'sheets')]

def shared_strings(z,path_key=''):
    if path_key in SS_CACHE:return SS_CACHE[path_key]
    out=[]
    if 'xl/sharedStrings.xml' not in z.namelist():return out
    with z.open('xl/sharedStrings.xml') as f:
        for _,e in ET.iterparse(f,events=('end',)):
            if e.tag==NS+'si':out.append(''.join(t.text or '' for t in e.iter(NS+'t')));e.clear()
    SS_CACHE[path_key]=out
    return out

def iter_rows(path,target):
    with zipfile.ZipFile(path) as z:
        ss=shared_strings(z,str(path))
        with z.open(target) as f:
            for _,e in ET.iterparse(f,events=('end',)):
                if e.tag!=NS+'row':continue
                cells={}
                for c in e.findall(NS+'c'):
                    i=col_idx(c.attrib.get('r','A1'));k=c.attrib.get('t');v=c.find(NS+'v');val=''
                    if k=='inlineStr':val=''.join(t.text or '' for t in c.iter(NS+'t'))
                    elif v is not None and v.text is not None:val=ss[int(v.text)] if k=='s' else v.text
                    cells[i]=clean(val)
                if cells:
                    row=['']*(max(cells)+1)
                    for i,v in cells.items():row[i]=v
                    yield int(e.attrib.get('r','0')),row
                e.clear()

def canonical_header(v):return re.sub(r'[^a-z0-9]+','_',norm(v)).strip('_')
def rowdict(headers,row):return {headers[i]:clean(row[i]) if i<len(row) else '' for i in range(len(headers))}

def schema(c):
    c.executescript('''
    pragma journal_mode=delete;pragma synchronous=normal;pragma temp_store=memory;
    create table metadata(key text primary key,value text);
    create table users(id integer primary key,canonical_key text unique,user_id text,user_id_norm text,full_name text,full_name_norm text,email text,email_norm text,organisational_unit text,business_unit text,start_date text,manager text,location text,last_login text,job_role text,job_type text,employee_number text,department text,last_login_time text);
    create table user_aliases(id integer primary key,user_id_ref integer,alias_type text,alias_value text,alias_norm text,unique(alias_type,alias_norm,user_id_ref));
    create table machines(id integer primary key,machine_name text,machine_name_norm text unique,infrastructure_itsi text,sys_class_name text,operational_status text,correlation_id text,serial_number text,manufacturer text,model_id text,short_description text,updated_on text,last_discovered text,discovery_source text,assigned_to text,last_logon_user text);
    create table assignments(id integer primary key,user_id_ref integer,machine_id integer,relationship_type text,source_value text,unique(user_id_ref,machine_id,relationship_type));
    create index ix_users_name on users(full_name_norm);create index ix_users_login on users(user_id_norm);create index ix_users_email on users(email_norm);create index ix_alias on user_aliases(alias_norm);create index ix_machine on machines(machine_name_norm);create index ix_assign_user on assignments(user_id_ref);create index ix_assign_machine on assignments(machine_id);
    create view user_machine_links as select u.canonical_key,u.user_id as login_id,u.employee_number as brid,u.email,u.full_name,m.machine_name,a.relationship_type from assignments a join users u on u.id=a.user_id_ref join machines m on m.id=a.machine_id;
    ''')

def name_keys(v):
    s=norm(v).replace(',', ' ')
    s=re.sub(r'[^a-z0-9 ]+',' ',s);s=re.sub(r'\s+',' ',s).strip()
    keys={s}
    parts=s.split()
    if len(parts)>=2:keys.add(' '.join(parts[1:]+parts[:1]))
    return {x for x in keys if x}

def normalise_vendor(v):
    x=clean(v);low=x.lower()
    if low.startswith('dell'):return 'Dell Inc.'
    if low.startswith('vmware'):return 'VMware, Inc.'
    if low.startswith('hewlett') or low=='hp':return 'HP'
    if low.startswith('apple'):return 'Apple'
    return x

def build(src,out):
    src=Path(src);out=Path(out);candidate=out.with_name(out.stem+'_'+uuid.uuid4().hex+'_new.db')
    if candidate.exists():candidate.unlink()
    SS_CACHE.clear()
    c=sqlite3.connect(candidate);schema(c)
    parts={('Users' if n.casefold()=='users' else 'computers' if n.casefold()=='computers' else n):v for n,v in workbook_parts(src)}
    # Users
    it=iter_rows(src,parts['Users']);_,header=next(it);headers=[canonical_header(x) for x in header]
    aliases={'user_name':'user_id','name':'full_name','u_organisational_unit':'organisational_unit','u_business_unit':'business_unit','u_start_date':'start_date','title':'job_role','u_job_type':'job_type'}
    headers=[aliases.get(h,h) for h in headers]
    if not {'user_id','full_name','email'}.issubset(headers):raise ValueError('Users sheet is missing identity columns')
    user_count=0
    for _,row in it:
        d=rowdict(headers,row);uid=clean(d.get('user_id'));email=clean(d.get('email'));name=clean(d.get('full_name'))
        if not (uid or email or name):continue
        key=('uid:'+norm(uid)) if uid else ('email:'+norm(email)) if email else ('name:'+norm(name))
        vals=(key,uid,norm(uid),name,norm(name),email,norm(email),d.get('organisational_unit',''),d.get('business_unit',''),excel_date(d.get('start_date','')),d.get('manager',''),d.get('location',''),excel_date(d.get('last_login','')),d.get('job_role',''),d.get('job_type',''),d.get('employee_number',''),d.get('department',''),d.get('last_login_time',''))
        c.execute('insert into users(canonical_key,user_id,user_id_norm,full_name,full_name_norm,email,email_norm,organisational_unit,business_unit,start_date,manager,location,last_login,job_role,job_type,employee_number,department,last_login_time) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(canonical_key) do update set user_id=excluded.user_id,user_id_norm=excluded.user_id_norm,full_name=excluded.full_name,full_name_norm=excluded.full_name_norm,email=excluded.email,email_norm=excluded.email_norm,organisational_unit=excluded.organisational_unit,business_unit=excluded.business_unit,start_date=excluded.start_date,manager=excluded.manager,location=excluded.location,last_login=excluded.last_login,job_role=excluded.job_role,job_type=excluded.job_type,employee_number=excluded.employee_number,department=excluded.department,last_login_time=excluded.last_login_time',vals)
        ref=c.execute('select id from users where canonical_key=?',(key,)).fetchone()[0]
        user_count+=1
        if user_count%5000==0:c.commit()
    c.commit()
    # Rebuild aliases only from final records; keep duplicate names as ambiguous.
    c.execute('delete from user_aliases')
    for ref,uid,email,name,employee in c.execute('select id,user_id,email,full_name,employee_number from users').fetchall():
        for typ,val in [('user_id',uid),('email',email),('name',name),('employee_number',employee)]:
            if clean(val):c.execute('insert or ignore into user_aliases(user_id_ref,alias_type,alias_value,alias_norm) values(?,?,?,?)',(ref,typ,val,norm(val)))
    # Machines
    it=iter_rows(src,parts['computers']);_,header=next(it);headers=[canonical_header(x) for x in header]
    machine_count=0
    for _,row in it:
        d=rowdict(headers,row);name=clean(d.get('name')).upper()
        if not name:continue
        values=(name,norm(name),d.get('u_infrastructure_itsi',''),d.get('sys_class_name',''),d.get('operational_status',''),d.get('u_barclays_correlation_id','').upper(),re.sub(r'\s+',' ',d.get('serial_number','')).strip(),normalise_vendor(d.get('manufacturer','')),re.sub(r'\s+',' ',d.get('model_id','')).strip(),d.get('short_description',''),excel_date(d.get('sys_updated_on','')),excel_date(d.get('last_discovered','')),d.get('discovery_source',''),d.get('assigned_to',''),d.get('u_last_logon_user',''))
        c.execute('insert or replace into machines(machine_name,machine_name_norm,infrastructure_itsi,sys_class_name,operational_status,correlation_id,serial_number,manufacturer,model_id,short_description,updated_on,last_discovered,discovery_source,assigned_to,last_logon_user) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',values)
        mid=c.execute('select id from machines where machine_name_norm=?',(norm(name),)).fetchone()[0]
        machine_count+=1
        if machine_count%5000==0:c.commit()
    links=rebuild_links(c)
    print('Relationship matching:',links)
    c.executemany('insert into metadata(key,value) values(?,?)',[('schema_version','2'),('created_at',datetime.now().isoformat(sep=' ',timespec='seconds')),('source_file',src.name)])
    c.commit();check=c.execute('pragma integrity_check').fetchone()[0]
    counts={t:c.execute(f'select count(*) from {t}').fetchone()[0] for t in ('users','machines','assignments','user_aliases')};c.close()
    if check!='ok':raise RuntimeError(check)
    if out.exists():shutil.copy2(out,out.with_name(out.stem+'_'+datetime.now().strftime('%Y%m%d_%H%M%S_%f')+'.backup.db'))
    os.replace(candidate,out)
    print('SUCCESS',out)
    for k,v in counts.items():print(f'{k}: {v:,}')

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',default='database040926.xlsx');p.add_argument('--db',default='wmi_packager_master.db');a=p.parse_args();build(a.source,a.db)
if __name__=='__main__':main()
