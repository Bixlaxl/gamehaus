const fs = require('fs');
const https = require('https');

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

const url = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tables?select=*`);
const options = {
  headers: {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  }
};

https.get(url, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("TABLES STATUS:", res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log("TABLES DATA:", JSON.stringify(parsed, null, 2));
    } catch(e) {
      console.log("DATA RAW:", data);
    }
  });
}).on('error', err => console.error(err));
