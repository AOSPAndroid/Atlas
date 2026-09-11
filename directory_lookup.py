"""Shared database-only directory queries for admin and viewer."""
from directory_exports import field_map
import re


def windows_login(value):
    """The confirmed login convention is G-number export ID -> X-number login."""
    domain, separator, account = str(value or '').strip().rpartition('\\')
    if re.fullmatch(r'g[0-9]+', account, re.IGNORECASE):
        account = 'x' + account[1:]
    return domain + separator + account

# Only these explicit column names ever enter SQL. Values remain parameters.
SEARCH_FIELDS = {alias: (kind, column) for kind in ('user', 'machine')
                 for alias, (column, _) in field_map(kind).items() if alias not in ('name', 'user_name', 'email')}
SEARCH_FIELDS.update({
 'serial': ('machine', 'serial_number'), 'asset': ('machine', 'correlation_id'),
 'model': ('machine', 'model_id'), 'status': ('machine', 'operational_status'),
 'class': ('machine', 'sys_class_name'), 'source': ('machine', 'discovery_source'),
 'infrastructure': ('machine', 'infrastructure_itsi'), 'assigned': ('machine', 'assigned_to'),
 'last_user': ('machine', 'last_logon_user'), 'description': ('machine', 'short_description'),
 'team': ('user', 'department'), 'business': ('user', 'business_unit'),
 'organisation': ('user', 'organisational_unit'), 'office': ('user', 'location'),
 'title': ('user', 'job_role'), 'worker': ('user', 'job_type'),
})

def exact_users(c,value):
 q=' '.join(value.strip().split()).casefold();login=q.rsplit('\\',1)[-1]
 # Resolve Windows X-number logins without rewriting the original export ID.
 # Keep both matches if an export contains separate G and X records.
 exported_login = re.sub(r'^x(?=[0-9]+$)', 'g', login)
 exported_domain = q[:-len(login)] + exported_login if login else q
 return c.execute("select distinct u.* from legacy_users u where u.user_name_norm in (?,?,?,?) or lower(u.email)=? or lower(u.brid)=? or u.name_norm=? or u.id in (select user_id_ref from user_aliases where alias_norm in (?,?)) order by u.name,u.id limit 100",(login,q,exported_login,exported_domain,q,q,q,q,login)).fetchall()

def linked_machines(c,uid):
 return [dict(r) for r in c.execute("""select m.*,max(a.relationship_type='assigned_to') as assigned_relationship,max(a.relationship_type='last_logon_user') as logon_relationship,case when count(distinct a.relationship_type)>1 then 'Assigned + last logged on (inventory)' when max(a.relationship_type)='assigned_to' then 'Assigned' else 'Last logged on (inventory)' end as match_type from assignments a join legacy_machines m on m.id=a.machine_id where a.user_id_ref=? group by m.id order by assigned_relationship desc,case when lower(m.operational_status)='operational' then 0 else 1 end,m.last_discovered desc,m.name""",(uid,))]

def search_directory(c,term:str):
 text=' '.join(term.strip().split());prefix=''
 if ':' in text and text.split(':',1)[0].lower() in SEARCH_FIELDS:
  prefix,text=text.split(':',1);kind,column=SEARCH_FIELDS[prefix.lower()];value=text.strip().lower()
  if not value:return {'users':[],'machines':[]}
  like='%'+value.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
  table='legacy_users' if kind=='user' else 'legacy_machines'
  rows=c.execute('select * from '+table+' where lower("'+column+'") like ? escape \'\\\' order by name,id limit 100',(like,)).fetchall()
  return {'users':[dict(r) for r in rows] if kind=='user' else [],'machines':[dict(r) for r in rows] if kind=='machine' else []}
 if ':' in text and text.split(':',1)[0].lower() in ('machine','user','email','name','brid'):
  prefix,text=text.split(':',1);prefix=prefix.lower();text=text.strip()
 if not text:return {'users':[],'machines':[]}
 q=text.casefold();login=q.rsplit('\\',1)[-1];like='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
 users=[] if prefix=='machine' else exact_users(c,text)
 machines=[] if prefix in ('user','email','name','brid') else c.execute('select * from legacy_machines where name_norm=? or lower(serial_number)=? or lower(correlation_id)=? order by name limit 100',(q.rstrip('.'),q,q)).fetchall()
 if not users and not machines:
  if prefix!='machine':users=c.execute("select * from legacy_users where user_name_norm like ? escape '\\' or name_norm like ? escape '\\' or email_norm like ? escape '\\' or lower(brid) like ? escape '\\' order by name,id limit 100",(like,like,like,like)).fetchall()
  if prefix not in ('user','email','name','brid'):machines=c.execute("select * from legacy_machines where name_norm like ? escape '\\' order by name limit 100",(like,)).fetchall()
 return {'users':[dict(x) for x in users],'machines':[dict(x) for x in machines]}


def prepare_views(c):
    c.create_function('atlas_windows_login', 1, windows_login, deterministic=True)
    c.executescript("\n create temp view legacy_users as select *,user_id as user_name,user_id_norm as user_name_norm,atlas_windows_login(user_id) as login_id,lower(atlas_windows_login(user_id)) as login_norm,full_name as name,full_name_norm as name_norm,employee_number as employee_id,employee_number as brid,job_role as job_title,job_type as worker_type,organisational_unit as organisation,'' as active,'' as country from main.users;\n create temp view legacy_machines as select *,machine_name as name,machine_name_norm as name_norm,last_logon_user as u_last_logon_user,assigned_to as assigned_user,last_logon_user as last_logged_on_user,last_logon_user as most_frequent_user,infrastructure_itsi as u_infrastructure_itsi,sys_class_name as class,short_description as description,updated_on as updated,'' as operating_system,'' as asset_tag,'' as support_group from main.machines;\n ")
