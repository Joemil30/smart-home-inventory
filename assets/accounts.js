/* Account boundary only. Deliberately no access to coldroom IndexedDB, legacy
   SYNC, per-device provider keys, or pantry records. No implicit data transfer. */
(() => {
  'use strict';
  const root = document.getElementById('account');
  const state = { client:null,user:null,home:null,mode:'signin',busy:false,recovery:false,ready:false,epoch:0,invite:'' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const field = (name,label,type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" required ${extra}></label>`;
  const status = (message,error=false) => {
    let node=root.querySelector('#account-status');
    if(!node){ node=document.createElement('p');node.id='account-status';root.appendChild(node); }
    node.className='notice'+(error?' error':''); node.setAttribute('role',error?'alert':'status'); node.textContent=message;
  };
  const callbackUrl = () => new URL('account.html',location.href).href.split(/[?#]/)[0];
  const pendingKey = 'stocked-pending-invite';
  function pending(value) { try { value ? sessionStorage.setItem(pendingKey,value) : sessionStorage.removeItem(pendingKey); } catch (_) {} }
  function readInvite() {
    const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
    if(!invite)return false;
    try { state.invite=tokenFrom(invite);pending(state.invite); } catch (_) { state.invite='';pending(''); }
    history.replaceState(null,'',location.pathname+location.search);
    return true;
  }
  function tokenFrom(value) {
    let token=String(value||'').trim();
    if(token.startsWith('https://') || token.startsWith('http://')) {
      const link=new URL(token);
      if(link.origin!==location.origin || link.pathname!==new URL(callbackUrl()).pathname) throw new Error('Use a Stocked invitation for this app.');
      token=new URLSearchParams(link.hash.slice(1)).get('invite') || '';
    }
    if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('Paste a complete Stocked invitation link.');
    return token;
  }
  function configValid(c) {
    if(!c || c.enabled!==true) return false;
    try {
      const u=new URL(c.supabaseUrl);
      if(u.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname!=='/') return false;
      if(/^sb_publishable_[\w-]+$/.test(c.publishableKey)) return true;
      const payload=JSON.parse(atob(String(c.publishableKey).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      return payload.role==='anon';
    } catch (_) { return false; }
  }
  function errorText(error) {
    if(!navigator.onLine) return 'You’re offline. Your local kitchen still works. Reconnect and try again.';
    const text=String(error?.message || '');
    if(/invalid login credentials/i.test(text)) return 'That email and password didn’t work. Try again or reset your password.';
    if(/email not confirmed/i.test(text)) return 'Verify your email first. You can request another verification email below.';
    if(/rate|too many|seconds|429/i.test(text)) return 'Too many attempts. Wait a moment before trying again.';
    if(/fetch|network/i.test(text)) return 'Couldn’t reach Stocked accounts. Check your connection and try again.';
    if(/invitation|household|ownership|member|Verify your email|Enter |Paste |Use a Stocked|Passwords|Password must/i.test(text)) return text;
    return 'That didn’t finish. Please try again. If it keeps happening, the account service needs attention.';
  }
  async function rpc(name,args={}) {
    const user=state.user?.id,epoch=state.epoch;
    const {data,error}=await state.client.rpc(name,args);
    if(user!==state.user?.id || epoch!==state.epoch)throw new Error('Your account session changed. Sign in again to continue.');
    if(error) throw error;
    return data;
  }
  async function task(fn) {
    if(state.busy) return;
    state.busy=true;
    root.querySelectorAll('button,input').forEach(node=>node.disabled=true);
    status('Working…');
    try { await fn(); } catch(error) { status(errorText(error),true); }
    finally { state.busy=false;root.querySelectorAll('button,input').forEach(node=>node.disabled=false); }
  }
  function shell(html) { root.innerHTML=`<div class="panel">${html}<p id="account-status" class="notice" role="status"></p></div>`; }
  function selectMode(mode) { if(state.busy)return;state.mode=mode;renderAuth();root.querySelector('input')?.focus(); }
  function renderAuth() {
    const mode=state.recovery?'password':state.mode;
    const signup=mode==='signup',reset=mode==='reset',password=mode==='password';
    shell(`${!reset&&!password?`<div class="tabs" role="tablist" aria-label="Account action"><button role="tab" aria-selected="${!signup}" data-mode="signin">Sign in</button><button role="tab" aria-selected="${signup}" data-mode="signup">Create account</button></div>`:`<h2>${password?'Choose a new password.':'Let’s get you back in.'}</h2>`}
      ${state.invite?'<p class="note">An invitation is ready. Sign in or verify your new account to review it.</p>':''}
      <form id="account-form"><fieldset>
      ${signup?field('displayName','Your name','text','autocomplete="name" maxlength="60"'):''}
      ${!password?field('email','Email address','email','autocomplete="email" inputmode="email" maxlength="254"'):''}
      ${!reset?field('password',password?'New password':'Password','password',`autocomplete="${signup||password?'new-password':'current-password'}" ${signup||password?'minlength="12"':''} maxlength="128"`):''}
      ${signup||password?'<p class="note">Use at least 12 characters. A unique password or passphrase is best.</p>'+field('confirm','Confirm password','password','autocomplete="new-password" minlength="12" maxlength="128"'):''}
      <button class="primary" type="submit">${signup?'Create my account':reset?'Send reset email':password?'Save new password':'Sign in'}</button>
      </fieldset></form>
      ${!password?`<button class="text-button" data-mode="${reset?'signin':'reset'}">${reset?'Back to sign in':'Forgot your password?'}</button>`:''}
      ${!password&&!reset?'<button class="text-button" id="resend-email">Resend verification email</button>':''}`);
    root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>selectMode(b.dataset.mode));
    root.querySelector('#resend-email')?.addEventListener('click',()=>{
      const input=root.querySelector('[name=email]');
      if(!input.reportValidity())return;
      const email=input.value.trim();
      task(async()=>{ const {error}=await state.client.auth.resend({type:'signup',email,options:{emailRedirectTo:callbackUrl()}});if(error)throw error;status('If verification is needed, an email is on its way. Check spam too.'); });
    });
    root.querySelector('form').onsubmit=event=>{
      event.preventDefault();
      const data=new FormData(event.currentTarget),email=String(data.get('email')||'').trim(),secret=String(data.get('password')||'');
      if((signup||password) && secret!==data.get('confirm'))return status('Passwords do not match.',true);
      if((signup||password) && secret.length<12)return status('Password must have at least 12 characters.',true);
      task(async()=>{
        if(reset) {
          const {error}=await state.client.auth.resetPasswordForEmail(email,{redirectTo:callbackUrl()+'?flow=recovery'});
          if(error)throw error;
          status('If an account exists for that email, a reset link is on its way. Open it in this browser.');
        } else if(password) {
          if(!state.recovery||!state.user)throw new Error('Request a fresh password reset email.');
          const {error}=await state.client.auth.updateUser({password:secret});if(error)throw error;
          state.recovery=false;await loadHome();status('Password updated.');
        } else if(signup) {
          const {data:result,error}=await state.client.auth.signUp({email,password:secret,options:{emailRedirectTo:callbackUrl(),data:{display_name:String(data.get('displayName')).trim()}}});
          if(error)throw error;
          root.querySelectorAll('input[type=password]').forEach(n=>n.value='');
          if(result?.session) { state.user=result.session.user;await loadHome(); }
          else status('Check your email to verify your account. If you already have an account, sign in or reset your password. Your food has not been uploaded.');
        } else {
          const {data:result,error}=await state.client.auth.signInWithPassword({email,password:secret});if(error)throw error;
          state.user=result?.session?.user || null;await loadHome();
        }
      });
    };
  }
  async function loadHome() {
    const epoch=++state.epoch,user=state.user?.id;
    if(!user)return renderAuth();
    if(state.recovery)return renderAuth();
    const availability=await rpc('stocked_cloud_status');
    if(epoch!==state.epoch || user!==state.user?.id)return;
    if(availability?.protocol!==1 || availability?.ready!==true) {
      shell('<h2>Account connected.</h2><p class="note">The household service needs an operator setup check. Your local kitchen is unchanged; nothing is syncing yet.</p><button id="signout">Sign out</button>');bindSignOut();return;
    }
    const home=await rpc('stocked_account_home');
    if(epoch!==state.epoch || user!==state.user?.id)return;
    state.home=home;home?renderHome():renderSetup();
  }
  function bindSignOut() { root.querySelector('#signout').onclick=()=>task(async()=>{
    const {error}=await state.client.auth.signOut({scope:'local'});if(error)throw error;
    state.epoch++;state.user=null;state.home=null;state.recovery=false;state.invite='';pending('');state.mode='signin';renderAuth();
    status('Signed out on this device. Your local kitchen was not changed.');
  }); }
  function renderSetup() {
    shell(`<span class="status-pill">Account connected</span><h2>Who’s in your kitchen?</h2><p class="account-email">${esc(state.user.email)}</p>
      <form id="home-create">${field('homeName','Household name','text','maxlength="80" placeholder="Our home"')}${field('displayName','Your name','text',`maxlength="60" autocomplete="name" value="${esc(state.user.user_metadata?.display_name||'')}"`)}<button class="primary" type="submit">Create household</button></form>
      <hr class="separator"><h2>Have an invitation?</h2><form id="home-join">${field('invite','Invitation link','text',`autocomplete="off" spellcheck="false" value="${esc(state.invite)}"`)}${field('displayName','Your name in this home','text',`maxlength="60" value="${esc(state.user.user_metadata?.display_name||'')}"`)}<button type="submit" class="primary">Review & join household</button></form>
      <p class="note">Joining changes your cloud membership only. Nothing from this device is uploaded or merged.</p><button id="signout" class="text-button">Sign out</button>`);
    bindSignOut();
    root.querySelector('#home-create').onsubmit=e=>{e.preventDefault();const data=new FormData(e.currentTarget);task(async()=>{state.home=await rpc('stocked_create_home',{home_name:data.get('homeName').trim(),member_name:data.get('displayName').trim()});renderHome();status('Household created. Inventory is still local; transfer is not enabled in this preview.');});};
    root.querySelector('#home-join').onsubmit=e=>{e.preventDefault();const data=new FormData(e.currentTarget);task(async()=>{
      const token=tokenFrom(data.get('invite'));
      const preview=await rpc('stocked_preview_invite',{invite_token:token});
      // The link is one-time and trusted only after the server verifies it.
      if(!window.confirm(`Join “${preview.name}”, owned by ${preview.owner}? Your local food will stay separate and will not be uploaded.`))return status('No changes made.');
      state.home=await rpc('stocked_join_home',{invite_token:token,member_name:data.get('displayName').trim()});state.invite='';pending('');renderHome();status('You joined the household. Inventory sync is not active in this preview.');
    });};
  }
  function renderHome() {
    const h=state.home,owner=h.role==='owner';
    shell(`<span class="status-pill">Household membership connected</span><h2>${esc(h.name)}</h2><p class="account-email">${esc(state.user.email)}</p>
      <p class="note">Inventory sync is not active yet. Your current kitchen remains on this device.</p>
      <div aria-label="Household members">${h.members.map(m=>`<div class="member"><span>${esc(m.name)}${m.user_id===state.user.id?' (you)':''}<small>${m.role==='owner'?'Household owner':'Member'}</small></span>${owner&&m.user_id!==state.user.id?`<button data-remove="${esc(m.user_id)}" class="danger">Remove</button>`:''}</div>`).join('')}</div>
      ${owner?'<button class="primary" id="invite-create">Invite someone</button><p class="note">One person · expires in 48 hours. A new invitation replaces the previous unused link. Only share it with someone you want in your household.</p><div id="invite-result"></div><button id="invite-revoke" class="text-button">Revoke unused invitation</button>':'<button id="leave-home" class="text-button danger">Leave household</button>'}
      ${owner&&h.members.length>1?`<details><summary>Transfer household ownership</summary><p class="note">The new owner can invite and remove people, including you.</p>${h.members.filter(m=>m.user_id!==state.user.id).map(m=>`<button data-transfer="${esc(m.user_id)}">Make ${esc(m.name)} the owner</button>`).join('')}</details>`:''}
      <footer><button id="refresh-home">Refresh household</button><button id="signout" class="text-button">Sign out on this device</button></footer>`);
    bindSignOut();root.querySelector('#refresh-home').onclick=()=>task(loadHome);
    root.querySelector('#invite-create')?.addEventListener('click',()=>task(async()=>{
      const invite=await rpc('stocked_create_invite');
      if(!/^[a-f0-9]{64}$/.test(invite?.token||''))throw new Error('Invalid invitation response.');
      const link=callbackUrl()+'#invite='+invite.token;
      root.querySelector('#invite-result').innerHTML=`<label>Invitation link<input id="invite-link" readonly value="${esc(link)}"></label><button id="copy-invite">Copy invitation</button>`;
      root.querySelector('#copy-invite').onclick=()=>task(async()=>{try{await navigator.clipboard.writeText(link);status('Invitation copied.');}catch(_){root.querySelector('#invite-link').select();status('Select and copy the invitation link above.');}});
      status('Invitation created. It expires '+new Date(invite.expiresAt).toLocaleString()+'.');
    }));
    root.querySelector('#invite-revoke')?.addEventListener('click',()=>task(async()=>{await rpc('stocked_revoke_invites');root.querySelector('#invite-result').innerHTML='';status('Unused invitations revoked.');}));
    root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>task(async()=>{if(!window.confirm('Remove this person from the cloud household?'))return status('No changes made.');await rpc('stocked_remove_member',{member_id:b.dataset.remove});await loadHome();status('Member removed.');}));
    root.querySelector('#leave-home')?.addEventListener('click',()=>task(async()=>{if(!window.confirm('Leave this cloud household? Your separate local kitchen stays on this device.'))return status('No changes made.');await rpc('stocked_remove_member',{member_id:state.user.id});await loadHome();status('You left the household.');}));
    root.querySelectorAll('[data-transfer]').forEach(b=>b.onclick=()=>task(async()=>{if(!window.confirm('Transfer ownership? This person will be able to manage membership and remove you.'))return status('No changes made.');await rpc('stocked_transfer_home',{member_id:b.dataset.transfer});await loadHome();status('Ownership transferred.');}));
  }
  async function boot() {
    if(!readInvite())try { state.invite=sessionStorage.getItem(pendingKey)||''; } catch (_) {}
    const config=window.STOCKED_CLOUD_CONFIG;
    if(!configValid(config)) { shell('<h2>Still local. Still yours.</h2><p class="note">Cloud accounts are not enabled on this build yet. Your kitchen continues to work on this device.</p><a href="./">Return to Stocked</a>');return; }
    if(!window.supabase?.createClient)throw new Error('Account service could not load.');
    const callbackError=new URLSearchParams(location.hash.slice(1)).get('error_description') || new URLSearchParams(location.search).get('error_description');
    state.client=window.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{flowType:'pkce',storageKey:'stocked-account-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    state.client.auth.onAuthStateChange((event,session)=>{
      const changed=state.user?.id!==session?.user?.id;state.user=session?.user||null;
      if(event==='PASSWORD_RECOVERY')state.recovery=true;
      if(event==='SIGNED_OUT'){state.home=null;state.recovery=false;state.epoch++;if(state.ready)setTimeout(renderAuth,0);}
      // Never await Supabase calls inside its auth callback (auth lock deadlock).
      if(state.ready && !state.busy && (changed||event==='PASSWORD_RECOVERY')) setTimeout(()=>loadHome().catch(e=>status(errorText(e),true)),0);
    });
    let sessionResult;
    try { sessionResult=await state.client.auth.getSession(); }
    finally { history.replaceState(null,'',location.pathname); }
    const {data,error}=sessionResult;if(error)throw error;
    state.user=data?.session?.user||null;state.ready=true;
    if(state.user)await loadHome();else renderAuth();
    if(callbackError)status('That email link could not be used. Request a new verification or password reset email.',true);
  }
  window.addEventListener('hashchange',()=>{
    if(!readInvite() || !state.ready || state.busy)return;
    if(state.home)status('You already belong to '+state.home.name+'. Leave that household before joining another. Your invitation is saved for this tab.');
    else if(state.user)renderSetup();else renderAuth();
  });
  boot().catch(error=>{shell('<h2>Couldn’t connect.</h2><p class="note">Your local kitchen is unchanged. Reload to try again, or return to Stocked.</p><a href="./">Back to your kitchen</a>');status(errorText(error),true);});
})();
