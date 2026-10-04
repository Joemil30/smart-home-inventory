(() => {
  'use strict';
  const root=document.getElementById('kitchens');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let identity,destination,source,rows=[],busy=false;
  function message(text,error=false){const node=document.getElementById('sync-message');node.textContent=text;node.className='notice'+(error?' error':'');node.setAttribute('role',error?'alert':'status');}
  async function task(fn){if(busy)return;busy=true;const previous=new Map([...root.querySelectorAll('button,select,input')].map(n=>[n,n.disabled]));previous.forEach((_,n)=>n.disabled=true);try{await fn();}catch(e){message(e.message||'That did not finish. Your original records are still intact.',true);}finally{busy=false;previous.forEach((disabled,n)=>n.disabled=disabled);}}
  const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  async function deviceSource(){
    const data={items:[],saved:[],meta:[]},r=indexedDB.open('coldroom',1);
    // A preview on a brand-new browser must not create an empty version-1 DB
    // that would prevent the actual app's onupgradeneeded from creating stores.
    r.onupgradeneeded=()=>r.transaction.abort();
    const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>r.error?.name==='AbortError'?resolve(null):reject(r.error);});
    if(db){try{for(const s of Object.keys(data)){
      if(!db.objectStoreNames.contains(s))continue;
      data[s]=await new Promise((resolve,reject)=>{const t=db.transaction(s),q=t.objectStore(s).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    }}finally{db.close();}}
    return {name:'original-device-kitchen',all:async s=>structuredClone(data[s]||[])};
  }
  function render(){
    root.innerHTML=`<div class="kitchen-grid">
      <article class="kitchen-card"><span class="status-pill">Only you</span><h2>My private kitchen</h2><p>Your food, shopping list and recipes. Not visible to your family—even the household owner.</p><a href="./?kitchen=personal">Open my kitchen →</a></article>
      <article class="kitchen-card"><span class="status-pill">${identity.home?'Family members':'Not joined yet'}</span><h2>${esc(identity.home?.name||'Our household')}</h2><p>Everyone in this household can see and edit its food, shopping list and shared recipes.</p><a href="${identity.home?'./?kitchen=household':'account.html'}">${identity.home?'Open shared kitchen':'Create or join household'} →</a></article>
    </div><p class="note"><a href="./?kitchen=local">Open original device kitchen</a> · This stays separate and isn't uploaded automatically.</p>
    <div id="sync-message" role="status" class="notice"></div>
    <section class="panel"><h2>Bring things with you.</h2><p class="note">Copy selected foods and recipes. Nothing is removed from the source. Sharing makes a separate copy: future edits don't change the private original. Already-copied records are skipped, never overwritten.</p>
      <label>Copy from<select id="source"><option value="local">Original device kitchen</option><option value="personal">My private kitchen</option>${identity.home?'<option value="household">Shared household</option>':''}</select></label>
      <label>Copy into<select id="destination"><option value="personal">My private kitchen · only me</option>${identity.home?'<option value="household">Shared household · all members</option>':''}</select></label>
      <button id="preview" class="primary">Preview food & recipes</button><div id="transfer-preview"></div>
    </section>
    <section class="panel"><h2>Sync & recovery.</h2><p class="note">Choose a kitchen to retry pending edits, review conflicts, or download a recovery copy. Updates never clear these records. Unsynced changes still depend on this browser's storage.</p>
      <label>Kitchen<select id="manage"><option value="personal">My private kitchen</option>${identity.home?'<option value="household">Shared household</option>':''}</select></label>
      <div class="row"><button id="retry">Sync & review</button><button id="export">Download recovery copy</button></div><div id="conflicts"></div>
      <p class="note">Shared data may remain in a member's offline cache or exported copies. Removing access prevents new server reads and writes; it cannot recall copies they already received. Reopening a cloud kitchen requires an online access check.</p>
    </section>`;
    document.getElementById('preview').onclick=()=>task(preview);
    for(const id of ['source','destination'])document.getElementById(id).onchange=()=>{rows=[];document.getElementById('transfer-preview').replaceChildren();};
    document.getElementById('retry').onclick=()=>task(async()=>{const d=await CloudKitchen.connect(document.getElementById('manage').value);await d.sync();await conflicts(d);message(d.status().message);});
    document.getElementById('export').onclick=()=>task(async()=>{const d=await CloudKitchen.connect(document.getElementById('manage').value);download(await d.export(),`stocked-${d.mode}-recovery-${new Date().toISOString().slice(0,10)}.json`);message('Recovery copy downloaded. Keep it private; it contains this kitchen’s data.');});
  }
  async function preview(){
    const from=document.getElementById('source').value,to=document.getElementById('destination').value;
    if(from===to)throw new Error('Choose different source and destination kitchens.');
    source=from==='local'?await deviceSource():await CloudKitchen.connect(from);
    destination=await CloudKitchen.connect(to);
    rows=[];
    for(const store of ['items','saved'])for(const record of await source.all(store)){
      if(record.deleted)continue;
      const id='copy-'+await digest(`${source.name}:${store}:${record.id}`);
      const exists=await destination.get(store,id);
      const remote=await destination.get('remote',JSON.stringify([store,id]));
      rows.push({store,record,id,exists:!!exists||!!remote});
    }
    const node=document.getElementById('transfer-preview');
    node.innerHTML=`<p class="note">${rows.length} foods and recipes found. Nothing is selected automatically.</p><div class="pick-list">${rows.map((r,i)=>`<label class="transfer-row"><input type="checkbox" value="${i}" ${r.exists?'disabled':''}><span>${esc(r.record.name||r.record.title||'Untitled')}<small>${r.store==='items'?'Food':'Recipe'}${r.exists?' · already copied':''}</small></span></label>`).join('')}</div>${rows.some(r=>!r.exists)?'<button id="copy-selected" class="primary">Copy selected items</button>':''}`;
    node.querySelector('#copy-selected')?.addEventListener('click',()=>{
      const selected=[...node.querySelectorAll('input:checked')].map(n=>rows[Number(n.value)]).filter(r=>!r.exists);
      task(()=>transfer(selected));
    });
    message(`Ready to copy into ${to==='personal'?'your private kitchen':'the shared household'}.`);
  }
  async function transfer(selected){
    if(!selected.length)throw new Error('Select at least one food or recipe.');
    const shared=destination.mode==='household';
    if(!confirm(`Copy ${selected.length} selected records into ${shared?'the SHARED household':'your PRIVATE kitchen'}? ${shared?'Every household member can see and edit these copies, and may keep downloaded copies. ':''}The originals stay untouched.`))return message('Nothing copied.');
    await destination.checkpoint({id:'transfer:'+crypto.randomUUID(),at:new Date().toISOString(),source:source.name,records:selected.map(r=>({store:r.store,data:CloudKitchen.clean(r.record)}))});
    let layout=await destination.get('meta','household');
    if(!layout)layout={id:'household',locations:[],members:[{name:identity.user.user_metadata?.display_name||'Me'}],stores:[],staples:[],allergies:[],dislikes:[],people:1,aisleOrder:{}};
    const original=(await source.all('meta')).find(r=>r.id==='household');
    const locs=new Map();
    for(const r of selected.filter(r=>r.store==='items')){
      const old=(original?.locations||[]).find(l=>l.id===r.record.loc)||{id:r.record.loc||'pantry',name:'Pantry',kind:'pantry'};
      let loc=layout.locations.find(l=>l.name===old.name&&l.kind===old.kind);
      if(!loc){loc={id:'loc-'+(await digest(source.name+':'+old.id)).slice(0,24),name:old.name,kind:['fridge','freezer','pantry'].includes(old.kind)?old.kind:'pantry'};layout.locations.push(loc);}
      locs.set(r.record.loc,loc.id);
    }
    // Recipes-only imports still need a usable kitchen layout.
    if(!layout.locations.length)layout.locations=[{id:'fridge',name:'Fridge',kind:'fridge'},{id:'freezer',name:'Freezer',kind:'freezer'},{id:'pantry',name:'Pantry',kind:'pantry'}];
    await destination.put('meta',layout);
    let n=0;
    for(const r of selected){
      if(await destination.get(r.store,r.id))continue;
      const value={...CloudKitchen.clean(r.record),id:r.id};
      if(r.store==='items'){value.loc=locs.get(r.record.loc);delete value.who;}
      // Identity and device/provider settings are never transferred.
      await destination.put(r.store,value);n++;
    }
    await destination.sync();message(`${n} ${n===1?'copy':'copies'} saved. ${destination.status().message}. Originals are unchanged.`);
    document.getElementById('transfer-preview').replaceChildren();
  }
  async function conflicts(d){
    const entries=await d.all('conflicts'),node=document.getElementById('conflicts');
    node.innerHTML=entries.length?entries.map((c,i)=>`<article class="conflict"><h3>${esc(c.local.body.name||c.local.body.title||c.local.key)}</h3><p class="note">Two devices changed this record. Choose deliberately; both versions are kept in recovery history.</p><details><summary>Compare versions</summary><strong>This device${c.local.deleted?' · deleted':''}</strong><pre>${esc(JSON.stringify(c.local.body,null,2))}</pre><strong>Cloud${c.remote?.deleted?' · deleted':''}</strong><pre>${esc(JSON.stringify(c.remote?.body||{},null,2))}</pre></details><div class="row"><button data-local="${i}">Use this device’s version</button><button data-remote="${i}">Use cloud version</button></div></article>`).join(''):'<p class="note">No conflicts to review.</p>';
    for(const side of ['local','remote'])node.querySelectorAll(`[data-${side}]`).forEach(b=>b.onclick=()=>task(async()=>{
      if(!confirm(`Use the ${side==='local'?'device':'cloud'} version? Both versions will stay in recovery history.`))return;
      await d.resolve(entries[Number(b.dataset[side])].id,side==='local');await conflicts(d);message(d.status().message+' · reopen your kitchen to load the result.');
    }));
  }
  (async()=>{identity=await CloudKitchen.authenticate();render();})().catch(e=>{
    root.innerHTML=`<div class="panel"><h2>One quick setup first.</h2><p class="note">${esc(e.message)}</p><p><a href="account.html">Sign in or set up your account</a></p><p><a href="./?kitchen=local">Open original device kitchen</a></p></div>`;
  });
})();
