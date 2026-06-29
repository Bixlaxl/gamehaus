const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = '/Users/ahmedbilal/Desktop/Gamehaus/.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration in .env.local");
  process.exit(1);
}

async function run() {
  // Query customer_memberships with short_id FI2Q28
  const mUrl = `${supabaseUrl}/rest/v1/customer_memberships?short_id=eq.FI2Q28&select=*,plan:membership_plans(*)`;
  const mRes = await fetch(mUrl, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });

  // Query tables
  const tUrl = `${supabaseUrl}/rest/v1/tables?select=*`;
  const tRes = await fetch(tUrl, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });

  const memberships = await mRes.json();
  const tables = await tRes.json();

  console.log("=== MEMBERSHIPS FOR FI2Q28 ===");
  console.log(JSON.stringify(memberships, null, 2));

  console.log("\n=== TABLES ===");
  console.log(JSON.stringify(tables.map(t => ({ id: t.id, name: t.name, type: t.type, is_active: t.is_active })), null, 2));
}

run().catch(console.error);
