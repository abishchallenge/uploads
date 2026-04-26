// netlify/functions/files.js
const https=require('https');
const {GITHUB_TOKEN:TK,GITHUB_OWNER:OW,GITHUB_REPO:RP,UPLOAD_PATH:UP='uploads'}=process.env;
const HDRS={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};

function ghReq(method,path,body){
  return new Promise((res,rej)=>{
    const d=body?JSON.stringify(body):null;
    const r=https.request({hostname:'api.github.com',path,method,headers:{Authorization:`token ${TK}`,'User-Agent':'FV2',Accept:'application/vnd.github.v3+json','Content-Type':'application/json',...(d?{'Content-Length':Buffer.byteLength(d)}:{})}},resp=>{
      let s='';resp.on('data',c=>s+=c);resp.on('end',()=>{try{res({status:resp.statusCode,body:JSON.parse(s)})}catch{res({status:resp.statusCode,body:s})}});
    });
    r.on('error',rej);if(d)r.write(d);r.end();
  });
}
async function readJSON(apiPath){
  const r=await ghReq('GET',apiPath,null);
  if(r.status===200){const t=Buffer.from(r.body.content.replace(/\n/g,''),'base64').toString('utf8');return{data:JSON.parse(t),sha:r.body.sha}}
  return{data:null,sha:null};
}
async function writeJSON(apiPath,data,sha,msg){
  const content=Buffer.from(JSON.stringify(data,null,2)).toString('base64');
  return ghReq('PUT',apiPath,{message:msg,content,...(sha?{sha}:{})});
}
const META=`/repos/${OW}/${RP}/contents/${UP}/_meta/index.json`;
const LOGS=`/repos/${OW}/${RP}/contents/${UP}/_meta/logs.json`;
async function getMeta(){const{data,sha}=await readJSON(META);return{files:data?.files||[],sha}}
async function saveMeta(files,sha){return writeJSON(META,{files,updatedAt:new Date().toISOString()},sha,'🗂️ FV: meta update')}
async function addLog(entry){
  const{data,sha}=await readJSON(LOGS);const logs=data?.logs||[];
  logs.unshift({...entry,at:new Date().toISOString(),id:Date.now().toString(36)});
  if(logs.length>500)logs.splice(500);
  return writeJSON(LOGS,{logs},sha,'📋 FV: log');
}
function pruneExpired(files){const now=new Date();return files.filter(f=>!f.expiresAt||new Date(f.expiresAt)>now)}
function stripRaw(f){const{rawUrl,...rest}=f;return rest} // Never expose GitHub URL

exports.handler=async(event)=>{
  if(!TK||!OW||!RP)return{statusCode:500,headers:HDRS,body:JSON.stringify({error:'Missing GitHub env vars'})};
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:HDRS,body:''};

  // ── GET: list files ────────────────────────────
  if(event.httpMethod==='GET'){
    const q=event.queryStringParameters||{};
    const{files,sha}=await getMeta();
    // Auto-delete expired
    const valid=pruneExpired(files);
    if(valid.length!==files.length){
      const expired=files.filter(f=>f.expiresAt&&new Date(f.expiresAt)<=new Date());
      for(const f of expired){
        // Move expired to recycle bin meta
        f.trashed=true;f.trashedAt=new Date().toISOString();f.trashReason='expired';
        valid.push(f);
      }
      await saveMeta(valid,sha);
    }

    let result=[...valid];
    // Filters
    if(q.trashed==='true') result=result.filter(f=>f.trashed);
    else if(q.trashed==='false') result=result.filter(f=>!f.trashed);
    if(q.user)   result=result.filter(f=>f.uploadedBy===q.user);
    if(q.folder) result=result.filter(f=>(f.folder||'')===q.folder);
    if(q.public==='true') result=result.filter(f=>f.isPublic&&!f.trashed);
    if(q.search){const s=q.search.toLowerCase();result=result.filter(f=>f.originalName.toLowerCase().includes(s))}
    if(q.tag)    result=result.filter(f=>(f.tags||[]).includes(q.tag));

    const active=valid.filter(f=>!f.trashed);
    const totalSize=active.reduce((a,f)=>a+(f.size||0),0);
    const today=new Date().toDateString();
    const todayCount=active.filter(f=>f.uploadedAt&&new Date(f.uploadedAt).toDateString()===today).length;
    const folders=[...new Set(active.map(f=>f.folder).filter(Boolean))];
    const trashCount=valid.filter(f=>f.trashed).length;

    return{statusCode:200,headers:HDRS,body:JSON.stringify({
      files:result.map(stripRaw),
      total:active.length,totalSize,todayCount,folders,trashCount
    })};
  }

  // ── POST: mutations ────────────────────────────
  if(event.httpMethod==='POST'){
    let p;try{p=JSON.parse(event.body)}catch{return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid JSON'})}}
    const{action,fileId}=p;
    const{files,sha}=await getMeta();
    const idx=files.findIndex(f=>f.id===fileId);

    // ── DELETE (move to recycle bin) ──
    if(action==='delete'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'File not found'})};
      files[idx].trashed=true;files[idx].trashedAt=new Date().toISOString();files[idx].trashReason='user_delete';
      await saveMeta(files,sha);
      await addLog({type:'delete',username:p.username||'?',fileName:files[idx].originalName,filePath:files[idx].path,fileSize:files[idx].size});
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── PERMANENT DELETE ──
    if(action==='permanent_delete'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'File not found'})};
      const f=files[idx];
      // Delete from GitHub repo
      if(f.sha){await ghReq('DELETE',`/repos/${OW}/${RP}/contents/${f.path}`,{message:`🗑️ Perm delete: ${f.originalName}`,sha:f.sha})}
      files.splice(idx,1);
      await saveMeta(files,sha);
      await addLog({type:'permanent_delete',username:p.username||'?',fileName:f.originalName,filePath:f.path});
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── RESTORE FROM BIN ──
    if(action==='restore'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      files[idx].trashed=false;delete files[idx].trashedAt;delete files[idx].trashReason;
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── RENAME ──
    if(action==='rename'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      const newName=p.newName.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim();
      if(!newName)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid name'})};
      const old=files[idx].originalName;
      files[idx].originalName=newName;
      await saveMeta(files,sha);
      await addLog({type:'rename',username:p.username||'?',fileName:old,detail:`→ ${newName}`});
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,file:stripRaw(files[idx])})};
    }

    // ── MOVE ──
    if(action==='move'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      files[idx].folder=p.newFolder||'';
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── RATE ──
    if(action==='rate'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      if(!files[idx].rating)files[idx].rating={avg:0,count:0,total:0};
      // Store per-user rating to prevent duplicates
      if(!files[idx].ratedBy)files[idx].ratedBy={};
      const old=files[idx].ratedBy[p.username||'anon']||0;
      files[idx].rating.total=files[idx].rating.total-old+p.stars;
      files[idx].ratedBy[p.username||'anon']=p.stars;
      files[idx].rating.count=Object.keys(files[idx].ratedBy).length;
      files[idx].rating.avg=parseFloat((files[idx].rating.total/files[idx].rating.count).toFixed(1));
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,rating:files[idx].rating})};
    }

    // ── COMMENT ──
    if(action==='comment'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      if(!files[idx].comments)files[idx].comments=[];
      const c={id:Date.now().toString(36),username:p.username||'anon',text:p.text.slice(0,500),at:new Date().toISOString()};
      files[idx].comments.push(c);
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,comment:c})};
    }

    // ── DELETE COMMENT ──
    if(action==='delete_comment'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      files[idx].comments=(files[idx].comments||[]).filter(c=>c.id!==p.commentId);
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── FAVOURITE ──
    if(action==='favourite'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      if(!files[idx].favouritedBy)files[idx].favouritedBy=[];
      const fi=files[idx].favouritedBy.indexOf(p.username);
      if(fi>-1)files[idx].favouritedBy.splice(fi,1);
      else files[idx].favouritedBy.push(p.username);
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,faved:files[idx].favouritedBy.includes(p.username)})};
    }

    // ── DOWNLOAD COUNT ──
    if(action==='downloaded'){
      if(idx>=0){files[idx].downloads=(files[idx].downloads||0)+1;await saveMeta(files,sha)}
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── TOGGLE PUBLIC ──
    if(action==='toggle_public'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      files[idx].isPublic=!files[idx].isPublic;
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,isPublic:files[idx].isPublic})};
    }

    // ── SET EXPIRY ──
    if(action==='set_expiry'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      files[idx].expiresAt=p.expiresAt||null;
      await saveMeta(files,sha);
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
    }

    // ── GET RAW URL (for preview only — returned once, never stored in frontend) ──
    if(action==='get_raw_url'){
      if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Not found'})};
      return{statusCode:200,headers:HDRS,body:JSON.stringify({rawUrl:files[idx].rawUrl||null})};
    }

    // ── CREATE FOLDER ──
    if(action==='create_folder'){
      const folder=p.folderName.replace(/[^a-zA-Z0-9_\- ]/g,'_').trim();
      if(!folder)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid folder name'})};
      // Create a .gitkeep in the folder
      const fpath=`/repos/${OW}/${RP}/contents/${UP}/${folder}/.gitkeep`;
      await ghReq('PUT',fpath,{message:`📁 Create folder: ${folder}`,content:Buffer.from('').toString('base64')});
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,folder})};
    }

    return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Unknown action'})};
  }

  return{statusCode:405,headers:HDRS,body:JSON.stringify({error:'Method not allowed'})};
};
