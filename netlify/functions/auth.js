// netlify/functions/auth.js
const https=require('https'),crypto=require('crypto');
const {GITHUB_TOKEN:TK,GITHUB_OWNER:OW,GITHUB_REPO:RP,UPLOAD_PATH:UP='uploads',ADMIN_USERNAME:AU='admin',ADMIN_PASSWORD:AP='admin123'}=process.env;
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
function hash(pw){return crypto.createHash('sha256').update(pw+'fv2_s4lt_!').digest('hex')}
async function readJSON(path){
  const r=await ghReq('GET',path,null);
  if(r.status===200){const t=Buffer.from(r.body.content.replace(/\n/g,''),'base64').toString('utf8');return{data:JSON.parse(t),sha:r.body.sha}}
  return{data:null,sha:null};
}
async function writeJSON(path,data,sha,msg){
  const content=Buffer.from(JSON.stringify(data,null,2)).toString('base64');
  return ghReq('PUT',path,{message:msg,content,...(sha?{sha}:{})});
}
const USERS_PATH=`/repos/${OW}/${RP}/contents/${UP}/_meta/users.json`;
const LOGS_PATH=`/repos/${OW}/${RP}/contents/${UP}/_meta/logs.json`;

async function getUsers(){const{data,sha}=await readJSON(USERS_PATH);return{users:data?.users||[],sha}}
async function saveUsers(users,sha){return writeJSON(USERS_PATH,{users,updatedAt:new Date().toISOString()},sha,'👤 FV: update users')}
async function addLog(entry){
  const{data,sha}=await readJSON(LOGS_PATH);
  const logs=(data?.logs||[]);
  logs.unshift({...entry,at:new Date().toISOString(),id:Date.now().toString(36)});
  if(logs.length>500)logs.splice(500);
  await writeJSON(LOGS_PATH,{logs},sha,'📋 FV: add log');
}
function safe(u){const{password:_,...rest}=u;return rest}

exports.handler=async(event)=>{
  if(!TK||!OW||!RP)return{statusCode:500,headers:HDRS,body:JSON.stringify({error:'Missing GitHub env vars'})};
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:HDRS,body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,headers:HDRS,body:JSON.stringify({error:'Method not allowed'})};
  let p;try{p=JSON.parse(event.body)}catch{return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid JSON'})}}
  const{action}=p;

  // LOGIN
  if(action==='login'){
    const{username,password}=p;
    if(!username||!password)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username and password required'})};
    if(username===AU&&password===AP){
      const user={username:AU,role:'admin',displayName:'Administrator',email:'',avatarUrl:null};
      await addLog({type:'login',username:AU,detail:'Admin login'});
      return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,user})};
    }
    const{users}=await getUsers();
    const u=users.find(x=>x.username===username);
    if(!u)return{statusCode:401,headers:HDRS,body:JSON.stringify({error:'Username not found'})};
    if(u.password!==hash(password))return{statusCode:401,headers:HDRS,body:JSON.stringify({error:'Incorrect password'})};
    if(u.banned)return{statusCode:403,headers:HDRS,body:JSON.stringify({error:'Account suspended. Contact admin.'})};
    await addLog({type:'login',username,detail:'User login'});
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,user:safe(u)})};
  }

  // REGISTER
  if(action==='register'){
    const{username,password,displayName,email}=p;
    if(!username||!password)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username and password required'})};
    if(username.length<3)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username: at least 3 characters'})};
    if(password.length<6)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Password: at least 6 characters'})};
    if(!/^[a-zA-Z0-9_-]+$/.test(username))return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username: only letters, numbers, _ -'})};
    if(username===AU)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username not available'})};
    const{users,sha}=await getUsers();
    if(users.find(x=>x.username===username))return{statusCode:409,headers:HDRS,body:JSON.stringify({error:'Username already taken'})};
    const newUser={username,password:hash(password),displayName:displayName||username,email:email||'',role:'user',createdAt:new Date().toISOString(),banned:false,storageUsed:0,avatarUrl:null,bio:'',recoveryHint:p.recoveryHint||''};
    users.push(newUser);
    await saveUsers(users,sha);
    await addLog({type:'register',username,detail:`New user registered`});
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,user:safe(newUser)})};
  }

  // FORGOT - returns hint
  if(action==='forgot'){
    const{username}=p;
    if(!username)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Username required'})};
    const{users}=await getUsers();
    const u=users.find(x=>x.username===username);
    if(!u)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'Username not found'})};
    return{statusCode:200,headers:HDRS,body:JSON.stringify({hint:u.recoveryHint||'No hint set. Contact admin.'})};
  }

  // RESET PASSWORD (with hint verification)
  if(action==='reset_password'){
    const{username,recoveryHint,newPassword}=p;
    if(!username||!recoveryHint||!newPassword)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'All fields required'})};
    const{users,sha}=await getUsers();
    const idx=users.findIndex(x=>x.username===username);
    if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'User not found'})};
    if(users[idx].recoveryHint!==recoveryHint)return{statusCode:401,headers:HDRS,body:JSON.stringify({error:'Recovery hint does not match'})};
    if(newPassword.length<6)return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Password must be 6+ characters'})};
    users[idx].password=hash(newPassword);
    await saveUsers(users,sha);
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
  }

  // UPDATE PROFILE
  if(action==='update_profile'){
    const{username,displayName,email,bio,newPassword,currentPassword,avatarUrl,newUsername}=p;
    const{users,sha}=await getUsers();
    const idx=users.findIndex(x=>x.username===username);
    if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'User not found'})};
    // Verify current password for sensitive changes
    if((newPassword||newUsername)&&users[idx].password!==hash(currentPassword||''))
      return{statusCode:401,headers:HDRS,body:JSON.stringify({error:'Current password incorrect'})};
    if(newUsername){
      if(!/^[a-zA-Z0-9_-]+$/.test(newUsername))return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Invalid username format'})};
      if(users.find((x,i)=>x.username===newUsername&&i!==idx))return{statusCode:409,headers:HDRS,body:JSON.stringify({error:'Username already taken'})};
      users[idx].username=newUsername;
    }
    if(displayName!==undefined)users[idx].displayName=displayName;
    if(email!==undefined)users[idx].email=email;
    if(bio!==undefined)users[idx].bio=bio;
    if(newPassword)users[idx].password=hash(newPassword);
    if(avatarUrl!==undefined)users[idx].avatarUrl=avatarUrl;
    await saveUsers(users,sha);
    await addLog({type:'profile_update',username,detail:`Profile updated`});
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true,user:safe(users[idx])})};
  }

  // DELETE ACCOUNT
  if(action==='delete_account'){
    const{username,password}=p;
    const{users,sha}=await getUsers();
    const idx=users.findIndex(x=>x.username===username);
    if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'User not found'})};
    if(users[idx].password!==hash(password))return{statusCode:401,headers:HDRS,body:JSON.stringify({error:'Incorrect password'})};
    users.splice(idx,1);
    await saveUsers(users,sha);
    await addLog({type:'delete_account',username,detail:'Account deleted'});
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
  }

  // ADMIN: list users
  if(action==='list_users'){
    const{users}=await getUsers();
    return{statusCode:200,headers:HDRS,body:JSON.stringify({users:users.map(safe)})};
  }

  // ADMIN: ban/unban/delete
  if(action==='admin_user'){
    const{target,op}=p;
    const{users,sha}=await getUsers();
    const idx=users.findIndex(x=>x.username===target);
    if(idx<0)return{statusCode:404,headers:HDRS,body:JSON.stringify({error:'User not found'})};
    if(op==='ban')users[idx].banned=true;
    else if(op==='unban')users[idx].banned=false;
    else if(op==='delete')users.splice(idx,1);
    else if(op==='make_admin')users[idx].role='admin';
    else if(op==='make_user')users[idx].role='user';
    await saveUsers(users,sha);
    await addLog({type:`admin_${op}`,username:target,detail:`Admin action: ${op}`});
    return{statusCode:200,headers:HDRS,body:JSON.stringify({success:true})};
  }

  // GET LOGS
  if(action==='get_logs'){
    const{data}=await readJSON(LOGS_PATH);
    return{statusCode:200,headers:HDRS,body:JSON.stringify({logs:data?.logs||[]})};
  }

  return{statusCode:400,headers:HDRS,body:JSON.stringify({error:'Unknown action'})};
};
