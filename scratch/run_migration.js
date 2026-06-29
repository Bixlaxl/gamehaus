const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envLocal = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const envVars = {};
envLocal.split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) envVars[k.trim()] = v.trim().replace(/^["']|["']$/g, '');
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log("Running migration to drop UNIQUE constraint and sync short_ids...");
  
  // Also perform direct update via JS client if exec_sql is disabled
  const { data: allMemberships, error: fetchErr } = await supabase
    .from('customer_memberships')
    .select('id, customer_phone, short_id, created_at')
    .order('created_at', { ascending: true });

  if (fetchErr) {
    console.error("Fetch error:", fetchErr);
    return;
  }

  const phoneToShortId = {};
  allMemberships.forEach(m => {
    if (m.customer_phone && m.short_id && !phoneToShortId[m.customer_phone]) {
      phoneToShortId[m.customer_phone] = m.short_id;
    }
  });

  console.log("Found phone to short_id mappings:", phoneToShortId);

  // Attempt SQL execution for dropping constraint
  const { error: rpcErr } = await supabase.rpc('exec_sql', { sql: `
    ALTER TABLE public.customer_memberships DROP CONSTRAINT IF EXISTS customer_memberships_short_id_key;
    ALTER TABLE public.customer_memberships DROP CONSTRAINT IF EXISTS customer_memberships_short_id_unique;
    DROP INDEX IF EXISTS public.customer_memberships_short_id_key;
  ` });
  
  if (rpcErr) console.log("RPC result:", rpcErr.message);

  for (const m of allMemberships) {
    const targetShortId = phoneToShortId[m.customer_phone];
    if (targetShortId && m.short_id !== targetShortId) {
      console.log(`Updating ${m.id} (${m.customer_phone}) from ${m.short_id} to ${targetShortId}`);
      const { error: upErr } = await supabase
        .from('customer_memberships')
        .update({ short_id: targetShortId })
        .eq('id', m.id);
      if (upErr) console.error("Update error:", upErr.message);
    }
  }
  console.log("Done!");
}

run();
