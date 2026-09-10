// Fictional metrics shared by the browser test and local design preview.
const GiB=1024**3, MiB=1024**2;
const snapshot={ok:true,computer:'TESTPC',kind:'cpu',checked_at:'2026-09-10T12:00:00Z',total_processes:184,limit:100,warnings:[],summary:{
  cpu_percent:82.4,logical_processors:8,total_memory_bytes:32*GiB,available_memory_bytes:3*GiB,memory_percent:90.6,commit_percent:86.2,page_reads_sec:48,processor_queue:10,context_switches_sec:15320,thread_count:2418,uptime_seconds:320400,os:'Windows 11 (fixture)',gpu_percent:76,gpu_engine:'3D',
  cores:[98,91,87,79,92,81,64,67].map((percent,i)=>({name:String(i),percent})),
  disks:[{name:'0 C:',read_ms:28.4,write_ms:12.8,queue:3,read_bytes_sec:18*MiB,write_bytes_sec:4*MiB}],volumes:[{name:'C:',total_bytes:512*GiB,free_bytes:26*GiB,free_percent:5.1}]
},items:[
  ['Renderer.exe',42,27.4,88,8,760,18],['VideoCall.exe',84,18.2,35,3.2,104,3],['Browser.exe',120,13.8,8,4.5,216,2],['SearchIndex.exe',160,9.1,null,.7,48,7],['Explorer.exe',224,2.3,1,.4,92,.1],['SecurityService.exe',320,1.8,null,.6,86,1.2]
].map(([Process,PID,CPU,GPU,memory,Threads,io])=>({Process,PID,CPU,GPU,MemoryBytes:memory*GiB,MemoryPercent:Math.round(memory/32*1000)/10,PrivateBytes:memory*GiB*1.1,MemoryMB:memory*1024,Threads,IOBytesPerSec:io*MiB,Handles:1234,PageFaultsPerSec:32,SessionId:2,Engine:GPU==null?null:'3D',CommandLine:Process,CreatedAt:'20260910100000.000000+000',CanTerminate:true,BlockReason:''}))};
const threads={ok:true,computer:'TESTPC',pid:42,name:'Renderer.exe',logical_processors:8,total_threads:760,limit:200,warnings:[],items:[
  {TID:421,CoreCPU:96,CPU:12,State:'Running',WaitReason:null,ContextSwitches:218,Priority:8},
  {TID:422,CoreCPU:67.2,CPU:8.4,State:'Ready',WaitReason:null,ContextSwitches:104,Priority:8},
  {TID:423,CoreCPU:0,CPU:0,State:'Waiting',WaitReason:'User request',ContextSwitches:2,Priority:8},
  {TID:424,CoreCPU:null,CPU:null,State:'Waiting',WaitReason:'Page in',ContextSwitches:null,Priority:8}
]};
module.exports={snapshot,threads};
