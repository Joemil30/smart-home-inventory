/* Account-scoped storage. Never reuses, clears or silently uploads coldroom.
   RPC writes are revision-checked; local edits and their outbox commit together. */
(() => {
  'use strict';
  const STORES=['items','catalog','recipes','meta','log','shopping','plan','saved'];
  const INTERNAL=['outbox','remote','conflicts','checkpoints'];
  const SYNCED=['items','catalog','saved','shopping','plan'];
  const syncable=(s,id)=>SYNCED.includes(s)||(s==='meta'&&id==='household');
  const copy=v=>structuredClone(v);
  const key=(s,id)=>JSON.stringify([s,id]);
  const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const completed=t=>new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Storage transaction was cancelled.'));});
  const clean=v=>{const out=copy(v);delete out._cloudRevision;delete out._cloudPending;return out;};
  const describe=e=>String(e?.message||'Could not sync. Your pending changes remain on this device.');
  let client,user,home,active,bootPromise,blocked=false;
  const config=()=>window.STOCKED_CLOUD_CONFIG||{};
  function validConfig() {
    const c=config();if(c.enabled!==true)return false;
    try {
      const u=new URL(c.supabaseUrl);
      if(u.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)||u.pathname!=='/'||u.search||u.hash||u.username||u.password)return false;
      if(/^sb_publishable_[\w-]+$/.test(c.publishableKey))return true;
      return JSON.parse(atob(c.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';
    }catch(_){return false;}
  }
  function selected() {
    if(location.protocol==='file:'||document.getElementById('shelflife-restore'))return 'local';
    const q=new URLSearchParams(location.search).get('kitchen');
    let remembered='local';try{remembered=sessionStorage.getItem('stocked-kitchen')||'local';}catch(_){}
    return ['personal','household','local'].includes(q)?q:remembered;
  }
  async function authenticate() {
    if(bootPromise)return bootPromise;
    bootPromise=(async()=>{
      if(!validConfig())throw new Error('Cloud accounts are not configured on this build yet. Your original device kitchen is unchanged.');
      if(!window.supabase?.createClient)await new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src='supabase.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('Could not load accounts. Reconnect and try again.'));document.head.appendChild(s);
      });
      client=window.supabase.createClient(config().supabaseUrl,config().publishableKey,{auth:{flowType:'pkce',storageKey:'stocked-account-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      const {data,error}=await client.auth.getUser();if(error||!data?.user)throw new Error('Sign in to open your cloud kitchen. Nothing from this device has been uploaded.');
      user=data.user;
      client.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==user.id)){
          blocked=true;window.dispatchEvent(new CustomEvent('stocked-cloud-locked'));
        }
      });
      const available=await rpc('stocked_cloud_status');
      if(!available?.ready||available.syncProtocol!==1||available.inventorySync!==true)throw new Error('The cloud kitchen needs its database setup completed. Your original kitchen is safe.');
      home=await rpc('stocked_account_home');
      return {user,home};
    })();
    return bootPromise;
  }
  async function rpc(name,args={}) {
    if(blocked)throw new Error('Account access changed. Sign in again.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    let result;
    try{const call=client.rpc(name,args);result=await (call.abortSignal?call.abortSignal(controller.signal):call);}finally{clearTimeout(timer);}
    const {data,error}=result;
    if(blocked)throw new Error('Account access changed. Sign in again.');
    if(error){if(error.code==='42501'){blocked=true;window.dispatchEvent(new CustomEvent('stocked-cloud-locked'));}throw error;}
    return data;
  }
  async function openDatabase(name) {
    const r=indexedDB.open(name,1);
    r.onupgradeneeded=()=>[...STORES,...INTERNAL].forEach(s=>{if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:'id'});});
    const db=await request(r);db.onversionchange=()=>db.close();return db;
  }
  async function connect(mode) {
    await authenticate();
    if(!['personal','household'].includes(mode))throw new Error('Choose a kitchen.');
    if(mode==='household'&&!home)throw new Error('Create or join a household first.');
    if(!navigator.locks?.request)throw new Error('This browser cannot safely coordinate cloud edits. Use an updated browser; your device kitchen still works.');
    const target=mode==='personal'?user.id:home.id;
    const name=`stocked-cloud-v1:${new URL(config().supabaseUrl).hostname}:${user.id}:${mode}:${target}`;
    const db=await openDatabase(name);
    const lock=fn=>navigator.locks.request(name,fn);
    const all=async s=>{const t=db.transaction(s);const end=completed(t);const result=await request(t.objectStore(s).getAll());await end;return result;};
    const get=async(s,id)=>{const t=db.transaction(s);const end=completed(t);const result=await request(t.objectStore(s).get(id));await end;return result;};
    const localPut=async(s,v)=>{const t=db.transaction(s,'readwrite');const end=completed(t);t.objectStore(s).put(copy(v));await end;return v.id;};
    let message='Connecting…',changed=false,running=false;
    const notify=()=>window.dispatchEvent(new CustomEvent('stocked-cloud-status'));
    const ensure=()=>{if(blocked)throw new Error('Account access changed. Your pending changes are preserved for this account.');};
    async function put(s,value,deleted=false) {
      ensure();
      if(!syncable(s,value.id))return localPut(s,value);
      return lock(async()=>{
        ensure();
        const id=key(s,value.id),pending=await get('outbox',id),remote=await get('remote',id);
        // A stale tab must not coalesce over another tab's unacknowledged edit.
        const stale=async()=>{await localPut('checkpoints',{id:'draft:'+crypto.randomUUID(),at:new Date().toISOString(),store:s,body:clean(value),deleted});throw new Error('This item has a newer edit. Your attempted edit was kept in recovery history. Reload the kitchen before editing it.');};
        if(pending&&value._cloudPending!==pending.op)return stale();
        const base=pending?pending.base:(value._cloudPending&&value._cloudPending===remote?._ack?remote.version:(value._cloudRevision??0));
        if(!pending&&remote&&base!==remote.version)return stale();
        const op=crypto.randomUUID(),body=clean(value);
        const queued={id,store:s,key:value.id,body,base,deleted,op};
        const optimistic={...body,_cloudRevision:base,_cloudPending:op};
        const t=db.transaction([s,'outbox','conflicts'],'readwrite'),end=completed(t);
        deleted?t.objectStore(s).delete(value.id):t.objectStore(s).put(optimistic);
        t.objectStore('outbox').put(queued);t.objectStore('conflicts').delete(id);
        await end;Object.assign(value,optimistic);
        message='Saved on this device · waiting to sync';notify();
        return value.id;
      });
    }
    async function del(s,id,expected) {
      if(syncable(s,id)){const value=expected||await get(s,id);if(value)await put(s,value,true);return;}
      const t=db.transaction(s,'readwrite'),end=completed(t);t.objectStore(s).delete(id);await end;
    }
    async function flushUnlocked() {
      ensure();
      const conflicts=new Set((await all('conflicts')).map(c=>c.id));
      for(const q of await all('outbox')) {
        if(conflicts.has(q.id))continue;
        const result=await rpc('stocked_kitchen_write',{kind:mode,target,bucket:q.store,key:q.key,payload:q.body,base_version:q.base,remove_record:q.deleted,op:q.op});
        if(result?.conflict) {await localPut('conflicts',{id:q.id,local:q,remote:result.record});continue;}
        const r=result?.record;
        if(!r||r.version!==q.base+1||r.store!==q.store||r.record_id!==q.key)throw new Error('Unexpected sync response. Your pending change was kept.');
        const t=db.transaction([q.store,'outbox','remote'],'readwrite'),end=completed(t);
        t.objectStore('remote').put({...r,id:q.id,_ack:q.op});t.objectStore('outbox').delete(q.id);
        // Preserve a stable pending marker in the cache; S still holds this copy.
        if(!r.deleted)t.objectStore(q.store).put({...r.body,_cloudRevision:r.version,_cloudPending:q.op});
        await end;
      }
    }
    async function snapshot() {
      const result=await rpc('stocked_kitchen_read',{kind:mode,target});
      if(result?.protocol!==1||!Array.isArray(result.records))throw new Error('Unsupported sync response. No local records were replaced.');
      return result.records;
    }
    async function refresh() {
      return lock(async()=>{
        await flushUnlocked();const records=await snapshot();
        const pending=new Set((await all('outbox')).map(q=>q.id));
        const known=new Map((await all('remote')).map(r=>[r.id,r]));
        const t=db.transaction([...STORES,'remote'],'readwrite'),end=completed(t);
        for(const r of records){
          if(!syncable(r.store,r.record_id)||r.body?.id!==r.record_id){t.abort();throw new Error('Invalid cloud record.');}
          const id=key(r.store,r.record_id),previous=known.get(id);
          t.objectStore('remote').put({...r,id,_ack:previous?.version===r.version?previous._ack:undefined});
          if(!pending.has(id))r.deleted?t.objectStore(r.store).delete(r.record_id):t.objectStore(r.store).put({...r.body,_cloudRevision:r.version});
        }
        await end;changed=false;message=(await all('conflicts')).length?'Changes need your review':'Up to date';notify();
      });
    }
    async function sync() {
      if(running||blocked)return;running=true;
      try{await lock(async()=>{
        await flushUnlocked();
        const records=await snapshot(),known=new Map((await all('remote')).map(r=>[r.id,r.version]));
        changed=records.some(r=>known.get(key(r.store,r.record_id))!==r.version);
        message=(await all('conflicts')).length?'Changes need your review':changed?'New changes available · reload kitchen':'Up to date';
      });}catch(e){message=navigator.onLine?describe(e):'Offline · edits stay queued on this device';}
      finally{running=false;notify();}
    }
    async function resolve(id,useLocal) {
      await lock(async()=>{
        ensure();const c=await get('conflicts',id);if(!c)return;
        const q=c.local,r=c.remote;
        // Keep a recoverable copy of BOTH sides even after a user resolves.
        const t=db.transaction([q.store,'outbox','remote','conflicts','checkpoints'],'readwrite'),end=completed(t);
        t.objectStore('checkpoints').put({...c,id:'conflict:'+crypto.randomUUID(),at:new Date().toISOString(),conflictId:c.id});
        t.objectStore('conflicts').delete(id);
        if(r)t.objectStore('remote').put({...r,id});
        if(useLocal){q.base=r?.version||0;q.op=crypto.randomUUID();t.objectStore('outbox').put(q);
          if(!q.deleted)t.objectStore(q.store).put({...q.body,_cloudRevision:q.base,_cloudPending:q.op});
        }else{t.objectStore('outbox').delete(id);if(r&&!r.deleted)t.objectStore(q.store).put({...r.body,_cloudRevision:r.version});else t.objectStore(q.store).delete(q.key);}
        await end;
      });await sync();
    }
    // Authorization must succeed at every new page load; never fall back to an
    // unverified household cache on another account or after revocation.
    await refresh();
    return {mode,target,name,user,home,all,get,put,del,refresh,sync,resolve,
      status:()=>({message,changed,blocked}),checkpoint:v=>localPut('checkpoints',v),
      export:async()=>{const data={};for(const s of [...STORES,...INTERNAL])data[s]=(await all(s)).filter(r=>s!=='meta'||r.id!=='cfg');return {format:'stocked-cloud-recovery-v1',mode,target,at:new Date().toISOString(),data};}};
  }
  async function init() {
    const mode=selected();
    if(mode==='local'){try{sessionStorage.removeItem('stocked-kitchen');}catch(_){}return null;}
    active=await connect(mode);sessionStorage.setItem('stocked-kitchen',mode);return active;
  }
  function guard(error) {
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    let box=document.getElementById('cloud-blocked');
    if(!box){box=document.createElement('section');box.id='cloud-blocked';box.setAttribute('role','alert');document.body.appendChild(box);}
    box.style.cssText='position:fixed;inset:0;z-index:99999;background:#faf9f6;color:#252d27;padding:15vh 24px;overflow:auto;font:16px/1.6 system-ui';
    box.innerHTML='<div style="max-width:460px;margin:auto"><h1 style="font:36px Georgia">Your kitchen is protected.</h1><p id="cloud-error"></p><p>This action did not complete. Previously saved pending edits stay with the account that made them. Your original device kitchen has not been reset.</p><p><a href="account.html">Sign in / account settings</a></p><p><a href="kitchens.html">Kitchens & recovery</a></p><p><a href="?kitchen=local">Open the original device kitchen</a></p><button onclick="location.reload()">Try again</button></div>';
    box.querySelector('#cloud-error').textContent=describe(error);
  }
  function attach() {
    if(!validConfig()&&!active)return;
    let bar=document.getElementById('cloud-kitchen-bar');
    if(!bar){bar=document.createElement('div');bar.id='cloud-kitchen-bar';bar.style.cssText='padding:9px 20px;background:#e8eee5;color:#355e46;font:12px/1.5 system-ui;display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap';document.getElementById('app').before(bar);}
    const draw=()=>{
      bar.replaceChildren();const label=document.createElement('span');
      label.textContent=active?`${active.mode==='personal'?'My private kitchen':'Shared · '+active.home.name} · ${active.status().message}`:'On this device · not account-synced';bar.appendChild(label);
      const link=document.createElement('a');link.href='kitchens.html';link.textContent='Kitchens & sharing';link.style.color='inherit';bar.appendChild(link);
      if(active?.status().changed){const reload=document.createElement('button');reload.textContent='Load new changes';reload.onclick=()=>location.reload();bar.appendChild(reload);}
    };
    draw();window.addEventListener('stocked-cloud-status',draw);
    if(active){setInterval(()=>active.sync(),30000);window.addEventListener('online',()=>active.sync());}
  }
  window.addEventListener('stocked-cloud-locked',()=>guard(new Error('Your sign-in or household access changed. Sign in again to continue.')));
  window.CloudKitchen={init,connect,authenticate,selected,validConfig,guard,attach,clean,stores:STORES,get active(){return active;}};
})();
