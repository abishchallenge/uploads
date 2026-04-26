// netlify/functions/upload.js
const https=require('https');
const {GITHUB_TOKEN:TK,GITHUB_OWNER:OW,GITHUB_REPO:RP,UPLOAD_PATH:UP='uploads'}=process.env;
const HDRS={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
const MAX_MB=50;

function ghReq(method,path,body){
  return new Promise((res,rej)=>{
    const d=body?JSON.stringify(body):null;
    const r=https.request({hostname:'api.github.com',path,method,headers:{Authorization:`token ${TK}`,'User-Agent':'FV2',Accept:'application/vnd.github.v3+json','Content-Type':'application/json',...(d?{'Content-Length':Buffer.byteLength(d)}:{})}},resp=>{
      let s='';resp.on('data',c=>s+=c);resp.on('end',()=>{try{res({status:resp.statusCode,body:JSON.parse(s)})}catch{res({status:resp.statusCode,body:s})}});
    });
    r.on('error',rej);if(d)r.write(d);r.end();
  });
}
async function readMeta(){
  const path=`/repos/${OW}/${RP}/contents/${UP}/_meta/index.json`;
  const r=await ghReq('GET',path,null);
  if(r.status===200){const t=Buffer.from(r.body.content.replace(/\n/g,''),'base64').toString('utf8');return{files:JSON.parse(t).files||[],sha:r.body.sha,path}}
  return{files:[],sha:null,path};
}
async function writeMeta(m){
  const content=Buffer.from(JSON.stringify({files:m.files,updatedAt:new Date().toISOString()})).toString('base64');
  return ghReq('PUT',m.path,{message:'🗂️ FV: update index',content,...(m.sha?{sha:m.sha}:{})});
}
async function addLog(entry){
  const lp=`/repos/${OW}/${RP}/contents/${UP}/_meta/logs.json`;
  const r=await ghReq('GET',lp,null);
  let logs=[],lsha=null;
  if(r.status===200){const t=Buffer.from(r.body.content.replace(/\n/g,''),'base64').toString('utf8');logs=JSON.parse(t).logs||[];lsha=r.body.sha}
  logs.unshift({...entry,at:new Date().toISOString(),id:Date.now().toString(36)});
  if(logs.length>500)logs.splice(500);
  const content=Buffer.from(JSON.stringify({logs})).toString('base64');
  await ghReq('PUT',lp,{message:'📋 FV: log',content,...(lsha?{sha:lsha}:{})});
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:HDRS,body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,headers:HDRS,body:JSON.stringify({error:'Method not allowed'})};
  if(!TK||!OW||!RP)return{statusCode:500,headers:HDRS,body:JSON.stringify({error:'Missing GitHub env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO'})};

  let p;try{p=JSON.parse(event.body)}catch{return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid JSON'})}}
  const{fileName,fileData,fileType,fileSize,folder='',expiresAt=null,uploadedBy='anonymous',isPublic=true,tags=[]}=p;
  if(!fileName||!fileData)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Missing fileName or fileData'})};

  const b64=fileData.includes(',')?fileData.split(',')[1]:fileData;
  const estBytes=Math.ceil(b64.length*.75);
  if(estBytes>MAX_MB*1024*1024)return{statusCode:413,headers:HDRS,body:JSON.stringify({error:`File too large. Max ${MAX_MB}MB (estimated ${Math.ceil(estBytes/1048576)}MB)`})};

  // Keep original filename — just sanitize unsafe chars
  const safeName=fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()||'file';
  // Add timestamp prefix only to storedName to avoid collisions; display originalName
  const ts=Date.now();
  const storedName=`${ts}_${safeName}`;
  const subDir=folder?`${UP}/${folder.replace(/[^a-zA-Z0-9_\-]/g,'_')}`:UP;
  const filePath=`${subDir}/${storedName}`;
  const apiPath=`/repos/${OW}/${RP}/contents/${filePath}`;

  // Check if same file already there (sha needed to overwrite)
  const chk=await ghReq('GET',apiPath,null);
  const existSha=chk.status===200?chk.body.sha:undefined;

  const uploadRes=await ghReq('PUT',apiPath,{message:`📁 Upload: ${safeName} by ${uploadedBy}`,content:b64,...(existSha?{sha:existSha}:{})});
  if(uploadRes.status!==200&&uploadRes.status!==201){
    const msg=typeof uploadRes.body==='object'?uploadRes.body.message:'GitHub API error';
    return{statusCode:uploadRes.status,headers:HDRS,body:JSON.stringify({error:msg})};
  }

  const record={
    id:`fv${ts}${Math.random().toString(36).slice(2,6)}`,
    originalName:safeName,storedName,path:filePath,folder,
    size:fileSize||estBytes,type:fileType||'',
    sha:uploadRes.body.content?.sha,
    rawUrl:uploadRes.body.content?.download_url,  // GitHub raw URL (never shown in UI)
    uploadedAt:new Date().toISOString(),uploadedBy,isPublic,tags,expiresAt,
    downloads:0,rating:{avg:0,count:0,total:0},comments:[],favouritedBy:[],trashed:false,
  };

  const meta=await readMeta();
  meta.files.unshift(record);
  await writeMeta(meta);

  // Log
  await addLog({type:'upload',username:uploadedBy,fileName:safeName,fileSize:record.size,filePath,folder,fileType:fileType||''});

  return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,file:record})};
};
