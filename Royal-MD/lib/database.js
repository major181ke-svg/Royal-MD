const { Pool } = require('pg');
const config = require('../config');

let pool;
const connectdb = async () => {
  if (!config.DATABASE_URL) {
    console.error('❌ DATABASE_URL is missing. Add Railway PostgreSQL and expose its DATABASE_URL variable.');
    return false;
  }
  try {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', err => console.error('PostgreSQL pool error:', err.message));
    await pool.query(`
      CREATE TABLE IF NOT EXISTS royal_sessions (
        number TEXT PRIMARY KEY, credentials JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS royal_user_configs (
        number TEXT PRIMARY KEY, config JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS royal_otps (
        id BIGSERIAL PRIMARY KEY, number TEXT NOT NULL, otp TEXT NOT NULL,
        config JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS royal_otps_lookup_idx ON royal_otps(number, otp, expires_at);
      CREATE TABLE IF NOT EXISTS royal_active_numbers (
        number TEXT PRIMARY KEY, last_connected TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE, connection_info JSONB
      );
      CREATE TABLE IF NOT EXISTS royal_stats (
        number TEXT NOT NULL, date TEXT NOT NULL, commands_used INTEGER NOT NULL DEFAULT 0,
        messages_received INTEGER NOT NULL DEFAULT 0, messages_sent INTEGER NOT NULL DEFAULT 0,
        groups_interacted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(number, date)
      );
    `);
    console.log('✅ PostgreSQL connected; Royal MD tables are ready');
    return true;
  } catch (e) {
    console.error('❌ PostgreSQL connection failed:', e.message);
    if (pool) await pool.end().catch(() => {});
    pool = null;
    return false;
  }
};
const db = () => {
  if (!pool) throw new Error('PostgreSQL is not connected. Check DATABASE_URL and startup logs.');
  return pool;
};
const clean = number => String(number || '').replace(/[^0-9]/g, '');
const defaults = () => ({
  AUTO_RECORDING: 'false', AUTO_TYPING: 'false', ANTI_CALL: 'false',
  REJECT_MSG: '*🔕 ʏᴏᴜʀ ᴄᴀʟʟ ᴡᴀs ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ʀᴇᴊᴇᴄᴛᴇᴅ..!*',
  READ_MESSAGE: 'false', AUTO_VIEW_STATUS: 'true', AUTO_LIKE_STATUS: 'true',
  AUTO_STATUS_REPLY: 'false', AUTO_STATUS_MSG: 'Hello from Royal MD!',
  AUTO_LIKE_EMOJI: ['❤️', '👍', '😮', '😎'], ANTIDELETE: 'true'
});

async function saveSessionToMongoDB(number, credentials) {
  try { const n=clean(number); await db().query(`INSERT INTO royal_sessions(number,credentials) VALUES($1,$2::jsonb) ON CONFLICT(number) DO UPDATE SET credentials=EXCLUDED.credentials,updated_at=NOW()`,[n,JSON.stringify(credentials)]); return true; }
  catch(e) { console.error('❌ Error saving session to PostgreSQL:',e.message); return false; }
}
async function getSessionFromMongoDB(number) {
  try { const r=await db().query('SELECT credentials FROM royal_sessions WHERE number=$1',[clean(number)]); return r.rows[0]?.credentials ?? null; }
  catch(e) { console.error('❌ Error getting session from PostgreSQL:',e.message); return null; }
}
async function deleteSessionFromMongoDB(number) {
  try { const n=clean(number); await db().query('DELETE FROM royal_sessions WHERE number=$1',[n]); await db().query('DELETE FROM royal_active_numbers WHERE number=$1',[n]); return true; }
  catch(e) { console.error('❌ Error deleting session from PostgreSQL:',e.message); return false; }
}
async function getUserConfigFromMongoDB(number) {
  try { const n=clean(number); const r=await db().query('SELECT config FROM royal_user_configs WHERE number=$1',[n]); if(r.rows[0]) return r.rows[0].config; const value=defaults(); await db().query('INSERT INTO royal_user_configs(number,config) VALUES($1,$2::jsonb) ON CONFLICT(number) DO NOTHING',[n,JSON.stringify(value)]); const again=await db().query('SELECT config FROM royal_user_configs WHERE number=$1',[n]); return again.rows[0]?.config || value; }
  catch(e) { console.error('❌ Error getting user config from PostgreSQL:',e.message); return { ANTIDELETE:'true' }; }
}
async function updateUserConfigInMongoDB(number,newConfig) {
  try { const n=clean(number); const current=await getUserConfigFromMongoDB(n); const merged={...defaults(),...current,...newConfig}; await db().query('INSERT INTO royal_user_configs(number,config) VALUES($1,$2::jsonb) ON CONFLICT(number) DO UPDATE SET config=EXCLUDED.config,updated_at=NOW()',[n,JSON.stringify(merged)]); return true; }
  catch(e) { console.error('❌ Error updating user config in PostgreSQL:',e.message); return false; }
}
async function saveOTPToMongoDB(number,otp,configValue) {
  try { const n=clean(number); await db().query('DELETE FROM royal_otps WHERE number=$1 OR expires_at<=NOW()',[n]); await db().query(`INSERT INTO royal_otps(number,otp,config,expires_at) VALUES($1,$2,$3::jsonb,NOW()+INTERVAL '5 minutes')`,[n,String(otp),JSON.stringify(configValue)]); return true; }
  catch(e) { console.error('❌ Error saving OTP to PostgreSQL:',e.message); return false; }
}
async function verifyOTPFromMongoDB(number,otp) {
  try { const n=clean(number); const client=await db().connect(); try { await client.query('BEGIN'); const r=await client.query('SELECT id,config FROM royal_otps WHERE number=$1 AND otp=$2 AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE',[n,String(otp)]); if(!r.rows[0]) { await client.query('COMMIT'); return {valid:false,error:'Invalid or expired OTP'}; } await client.query('DELETE FROM royal_otps WHERE id=$1',[r.rows[0].id]); await client.query('COMMIT'); return {valid:true,config:r.rows[0].config}; } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  catch(e) { console.error('❌ Error verifying OTP in PostgreSQL:',e.message); return {valid:false,error:'Verification error'}; }
}
async function addNumberToMongoDB(number) { try { await db().query('INSERT INTO royal_active_numbers(number,last_connected,is_active) VALUES($1,NOW(),TRUE) ON CONFLICT(number) DO UPDATE SET last_connected=NOW(),is_active=TRUE',[clean(number)]); return true; } catch(e) { console.error('❌ Error adding active number:',e.message); return false; } }
async function removeNumberFromMongoDB(number) { try { await db().query('DELETE FROM royal_active_numbers WHERE number=$1',[clean(number)]); return true; } catch(e) { console.error('❌ Error removing active number:',e.message); return false; } }
async function getAllNumbersFromMongoDB() { try { const r=await db().query('SELECT number FROM royal_active_numbers WHERE is_active=TRUE'); return r.rows.map(x=>x.number); } catch(e) { console.error('❌ Error listing active numbers:',e.message); return []; } }
async function incrementStats(number,field) {
  const columns={commandsUsed:'commands_used',messagesReceived:'messages_received',messagesSent:'messages_sent',groupsInteracted:'groups_interacted'}; const col=columns[field]; if(!col) return;
  try { const n=clean(number),today=new Date().toISOString().split('T')[0]; await db().query(`INSERT INTO royal_stats(number,date,${col}) VALUES($1,$2,1) ON CONFLICT(number,date) DO UPDATE SET ${col}=royal_stats.${col}+1`,[n,today]); } catch(e) { console.error('❌ Error updating stats:',e.message); }
}
async function getStatsForNumber(number) { try { const r=await db().query('SELECT number,date,commands_used AS "commandsUsed",messages_received AS "messagesReceived",messages_sent AS "messagesSent",groups_interacted AS "groupsInteracted" FROM royal_stats WHERE number=$1 ORDER BY date DESC LIMIT 30',[clean(number)]); return r.rows; } catch(e) { console.error('❌ Error getting stats:',e.message); return []; } }

// Compatibility aliases retain existing plugin imports while the storage engine is PostgreSQL.
module.exports={connectdb,Session:{},UserConfig:{},OTP:{},ActiveNumber:{},Stats:{},saveSessionToMongoDB,getSessionFromMongoDB,deleteSessionFromMongoDB,getUserConfigFromMongoDB,updateUserConfigInMongoDB,saveOTPToMongoDB,verifyOTPFromMongoDB,addNumberToMongoDB,removeNumberFromMongoDB,getAllNumbersFromMongoDB,incrementStats,getStatsForNumber,getUserConfig:async number=>(await getUserConfigFromMongoDB(number))||{},updateUserConfig:updateUserConfigInMongoDB};
