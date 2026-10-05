/* Operator-owned PUBLIC configuration. Never put a service-role key here.
   Keep disabled until the staging checklist in docs/ACCOUNT_SETUP.md passes.
   This separate account preview never reads the legacy per-device config. */
window.STOCKED_CLOUD_CONFIG = Object.freeze({
  enabled: false,
  accountDeletion: true,
  supabaseUrl: 'https://qeqgxuubasxvpdvmvvda.supabase.co',
  publishableKey: 'sb_publishable_Mi13bdiCZRDwuh2vQFLhfg_SGPGnBKN',
});
