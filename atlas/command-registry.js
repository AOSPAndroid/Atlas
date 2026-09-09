// The single command catalogue used by the map and IT console.
export const COMMANDS = [
 ['atlas','Floor atlas','Find desks and people on the office map','map floor seating'],
 ['workspace','IT workspace','Directory, machines and application deployment','console install workspace'],
 ['admin','Remote Admin','Open machine administration controls','remote tools processes reboot'],
 ['bulk','Bulk Deploy','Review a multi-machine deployment','bulk rollout deploy'],
 ['history','Deployment history','Review recent operations','history results'],
 ['active','Ongoing deployments','View live deployment progress','ongoing monitor jobs'],
 ['recent','Recent deployment logs','Inspect recent job events','logs events'],
 ['queue','Deployment queue','Review and manage queued deployments','queue waiting'],
 ['catalogue','Package catalogue','Browse applications and scripts','software packages catalogue'],
 ['settings','Settings','Configure the package repository','settings configuration repository'],
 ['database','Manage database','Open directory imports and seating tools','database import excel moves'],
 ['view','Switch 2D / 3D map','Change the map view','map view 2d 3d'],
 ['reset','Reset map view','Fit the current floor','reset zoom map'],
 ['refresh','Refresh records','Reload the latest directory and seating data','refresh reload'],
 ['deploy','Deploy selected package','Review the package and target before deployment','deploy install execute'],
 ['copy','Copy package only','Review copy-only deployment controls','copy package'],
 ['queue-add','Add deployment to queue','Prepare a package and target for the queue','add queue package'],
 ['msra','Remote Assistance','Review assistance tools for the selected machine','msra assistance'],
 ['cshare','Open C$ share','Review file access tools for the selected machine','c$ share files'],
 ['health','Target health','Inspect the selected machine health panel','health status'],
 ['cleanup','Clean package folder','Review cleanup controls for the selected machine','clean cleanup packages'],
 ['summary','Copy support summary','Open the selected machine support-summary control','copy summary clipboard'],
 ['software','Installed software','Open installed-software controls','inventory software applications'],
 ['report','Machine report','Open machine reporting controls','copy complete report'],
 ['shortcuts','Keyboard shortcuts','View console keyboard shortcuts','help shortcuts keyboard']
].map(([id,title,detail,keywords])=>({id,title,detail,keywords,kind:'Action'}));
export const MAP_COMMANDS = new Set(['atlas','catalogue','settings','database','view','reset','refresh']);
export function commandUrl(id,target=''){
 if(!COMMANDS.some(c=>c.id===id))throw Error('Unknown Atlas command');
 const query=new URLSearchParams({command:id});if(target)query.set('machine',target);
 return (MAP_COMMANDS.has(id)?'/':'/installer')+'?'+query;
}
