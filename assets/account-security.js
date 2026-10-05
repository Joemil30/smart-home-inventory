/* TOTP setup and challenge. No credentials, setup keys, or codes are logged.
   SQL in account-security.sql enforces this independently of the browser UI. */
window.StockedSecurity = function({root,state,shell,field,esc,task,status,loadHome,bindSignOut}) {
  const mfa=()=>state.client.auth.mfa;
  const guard=()=>{const epoch=state.epoch,user=state.user?.id;return ()=>epoch===state.epoch&&user===state.user?.id&&!!user;};
  const codeField=()=>field('code','Verification code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6"');
  async function factors(){const {data,error}=await mfa().listFactors();if(error)throw error;return data;}
  async function verify(factorId,code){const {error}=await mfa().challengeAndVerify({factorId,code});if(error)throw error;}
  async function challenge() {
    const current=guard(),data=await factors();if(!current())return;
    shell(`<h2>One more step.</h2><p class="note">Enter the six-digit code from your authenticator to open your kitchen.</p>
      <form id="mfa-challenge"><label>Authenticator<select name="factor">${data.totp.map(f=>`<option value="${esc(f.id)}">${esc(f.friendly_name||'Authenticator')}</option>`).join('')}</select></label>
      ${codeField()}<button class="primary" type="submit">Verify & continue</button></form>
      <details><summary>Lost your authenticator?</summary><p class="note">Choose your backup authenticator above. If you lost both, contact the person who runs this Stocked app for identity verification and recovery. A password-reset email does not turn off two-step verification.</p></details><button id="signout" class="text-button">Sign out</button>`);
    bindSignOut();
    root.querySelector('form').onsubmit=e=>{e.preventDefault();const form=new FormData(e.currentTarget);task(async()=>{
      await verify(form.get('factor'),form.get('code'));if(current())await loadHome();
    });};
  }
  function bind() {
    const holder=document.createElement('section');holder.className='account-security';
    holder.innerHTML='<hr class="separator"><h2>Account security</h2><p class="note">Protect your private and shared kitchens with an authenticator app.</p><button>Manage two-step verification</button>';
    root.querySelector('.panel').appendChild(holder);holder.querySelector('button').onclick=()=>task(manage);
  }
  async function manage() {
    const current=guard(),data=await factors();if(!current())return;
    const verified=data.totp;
    shell(`<span class="status-pill">${verified.length?'Two-step verification on':'Extra protection'}</span><h2>Your account, protected.</h2>
      <p class="note">An authenticator adds a code to your password. Add a second authenticator as a backup so losing your phone doesn't lock you out.</p>
      ${verified.map(f=>`<div class="member"><span>${esc(f.friendly_name||'Authenticator')}<small>Verified</small></span><button data-unenroll="${esc(f.id)}" class="danger">Remove</button></div>`).join('')}
      ${verified.length<2?`<form id="mfa-enroll">${field('name','Authenticator name','text','maxlength="40" placeholder="My phone or backup"')}<button class="primary">${verified.length?'Add backup authenticator':'Set up authenticator'}</button></form>`:''}
      <p class="note">Keep your backup separate from your primary phone. Stocked does not generate recovery codes. If every authenticator is lost, recovery needs help from the app operator after verifying your identity.</p><button id="security-back" class="text-button">Back to my account</button>
      ${window.STOCKED_CLOUD_CONFIG?.accountDeletion===true?'<hr class="separator"><button id="delete-account" class="text-button danger">Delete my account</button>':''}`);
    root.querySelector('#security-back').onclick=()=>task(loadHome);
    root.querySelector('#delete-account')?.addEventListener('click',()=>deletion(verified));
    root.querySelectorAll('[data-unenroll]').forEach(b=>b.onclick=()=>task(async()=>{
      if(!confirm(verified.length===1?'Turn off two-step verification? Your account will use only your password.':'Remove this authenticator? Make sure your remaining authenticator works.'))return status('Nothing changed.');
      const {error}=await mfa().unenroll({factorId:b.dataset.unenroll});if(error)throw error;
      const refreshed=await state.client.auth.refreshSession();if(refreshed.error)throw refreshed.error;
      if(current()){await loadHome();status('Authenticator removed.');}
    }));
    root.querySelector('#mfa-enroll')?.addEventListener('submit',e=>{
      e.preventDefault();const name=new FormData(e.currentTarget).get('name').trim();
      task(async()=>{
        // Discard only unfinished enrollments, never a working authenticator.
        for(const f of data.all||[])if(f.factor_type==='totp'&&f.status==='unverified'){
          const {error}=await mfa().unenroll({factorId:f.id});if(error)throw error;
        }
        const {data:factor,error}=await mfa().enroll({factorType:'totp',friendlyName:name,issuer:'Stocked'});if(error)throw error;
        if(current())enrollment(factor);
      });
    });
  }
  function enrollment(factor) {
    const current=guard(),qr=factor.totp.qr_code;
    // SVG is rendered as an image, never executable markup or an external URL.
    const safeQr=qr.startsWith('data:image/svg+xml')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);
    shell(`<h2>Add Stocked to your authenticator.</h2><p class="note">Scan this QR code. Then enter a code to finish setup.</p>
      <img class="mfa-qr" src="${esc(safeQr)}" alt="Authenticator setup QR code">
      <details><summary>Set up without scanning</summary><label>Setup key<input readonly value="${esc(factor.totp.secret)}" autocomplete="off"></label><p class="note">Enter this key in your authenticator. Keep it private.</p></details>
      <form id="mfa-finish">${codeField()}<button class="primary">Enable authenticator</button></form><button id="mfa-cancel" class="text-button">Cancel setup</button>`);
    root.querySelector('form').onsubmit=e=>{e.preventDefault();const code=new FormData(e.currentTarget).get('code');task(async()=>{
      await verify(factor.id,code);if(current()){await manage();status('Authenticator enabled. Add a backup before relying on two-step verification.');}
    });};
    root.querySelector('#mfa-cancel').onclick=()=>task(async()=>{const {error}=await mfa().unenroll({factorId:factor.id});if(error)throw error;if(current())await manage();});
  }
  function deletion(verified) {
    if(state.home?.role==='owner'&&state.home.members.length>1){status('Transfer household ownership on your account page before deleting your account.',true);return;}
    const current=guard();
    shell(`<h2>Delete your account?</h2><p class="note">This permanently deletes your account and private cloud kitchen. Food and recipes you shared remain with your household. If you're its last member, the shared kitchen is deleted too.</p>
      <p class="note">Your original device kitchen and previously downloaded copies are not erased. <a href="kitchens.html">Download a recovery copy first</a>.</p>
      <form id="delete-confirm">${field('password','Current password','password','autocomplete="current-password"')}
      ${verified.length?`<label>Authenticator<select name="factor">${verified.map(f=>`<option value="${esc(f.id)}">${esc(f.friendly_name||'Authenticator')}</option>`).join('')}</select></label>${codeField()}`:''}
      ${field('confirmation','Type DELETE to confirm','text','pattern="DELETE" autocomplete="off" spellcheck="false"')}<button class="primary danger">Permanently delete my account</button></form><button id="delete-cancel" class="text-button">Keep my account</button>`);
    root.querySelector('#delete-cancel').onclick=()=>task(manage);
    root.querySelector('form').onsubmit=e=>{
      e.preventDefault();const data=new FormData(e.currentTarget);
      if(data.get('confirmation')!=='DELETE')return;
      task(async()=>{
        const signed=await state.client.auth.signInWithPassword({email:state.user.email,password:data.get('password')});if(signed.error)throw signed.error;
        if(!current())return;
        if(verified.length)await verify(data.get('factor'),data.get('code'));
        if(!current())return;
        const result=await state.client.functions.invoke('stocked-delete-account',{body:{confirm:'DELETE'}});
        if(result.error){let reason;try{reason=(await result.error.context.json()).error;}catch{}throw new Error(reason||'Account deletion did not finish. Try again.');}
        if(result.data?.ok!==true)throw new Error('Account deletion did not finish. Try again.');
        state.deleted=true;
        await state.client.auth.signOut({scope:'local'});
        state.epoch++;state.user=null;state.home=null;state.recovery=false;
        shell('<h2>Account deleted.</h2><p class="note">Your private cloud data has been removed. Your original device kitchen remains available.</p><a href="./?kitchen=local">Open device kitchen</a>');
      });
    };
  }
  return {bind,challenge};
};
