/**
 * Local integration test for the WhatsApp webhook server.
 * Starts the Express server with stub credentials and fires real HTTP requests.
 * No Twilio or Anthropic API keys required.
 */

import assert from 'node:assert/strict';
import http from 'node:http';

// ── Stub environment before any imports ──────────────────────────────────
process.env.TWILIO_ACCOUNT_SID  = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN   = 'test_auth_token';
process.env.TWILIO_WHATSAPP_FROM = '+14155238886';
process.env.WEBHOOK_PORT        = '13099';
process.env.WEBHOOK_PATH        = '/whatsapp/webhook';
process.env.ANTHROPIC_API_KEY   = 'sk-ant-test';
process.env.LOG_LEVEL           = 'error';
process.env.NODE_ENV            = 'test';

// ── Helpers ───────────────────────────────────────────────────────────────

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req  = http.request(
      { hostname: 'localhost', port: 13099, path, method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                   'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: 13099, path, method: 'GET' },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Tests ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

// ── Start server ──────────────────────────────────────────────────────────

console.log('\n🧪 WhatsApp Webhook Integration Tests\n');
console.log('Starting Express webhook server on port 13099...');

// Dynamically import after env is set
const { startWhatsAppServer, whatsappEvents } = await import('../src/gateway/whatsappClient.js');
await startWhatsAppServer();
await sleep(200);
console.log('Server started.\n');

// ── Test suite ────────────────────────────────────────────────────────────

console.log('── Health check ──');
await test('GET /health returns 200 with status:ok', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.status, 'ok');
  assert.ok(typeof json.uptime === 'number');
});

console.log('\n── Webhook endpoint ──');
await test('POST /whatsapp/webhook with valid body returns 200', async () => {
  const res = await post('/whatsapp/webhook', {
    From: 'whatsapp:+15551234567',
    To:   'whatsapp:+14155238886',
    Body: 'Hello!',
    MessageSid: 'SMtest001',
  });
  assert.equal(res.status, 200);
});

await test('POST /whatsapp/webhook emits message event', async () => {
  let received = null;
  whatsappEvents.once('message', (msg) => { received = msg; });

  await post('/whatsapp/webhook', {
    From: 'whatsapp:+15559876543',
    To:   'whatsapp:+14155238886',
    Body: 'Test message',
    MessageSid: 'SMtest002',
  });

  await sleep(50);
  assert.ok(received !== null, 'No message event emitted');
  assert.equal(received.from, 'whatsapp:+15559876543');
  assert.equal(received.body, 'Test message');
  assert.equal(received.messageSid, 'SMtest002');
});

await test('POST /whatsapp/webhook captures ButtonPayload', async () => {
  let received = null;
  whatsappEvents.once('message', (msg) => { received = msg; });

  await post('/whatsapp/webhook', {
    From: 'whatsapp:+15551111111',
    To:   'whatsapp:+14155238886',
    Body: '',
    ButtonPayload: 'approve',
    MessageSid: 'SMtest003',
  });

  await sleep(50);
  assert.ok(received !== null);
  assert.equal(received.buttonPayload, 'approve');
});

await test('POST /whatsapp/webhook with missing From returns 400', async () => {
  const res = await post('/whatsapp/webhook', {
    To:   'whatsapp:+14155238886',
    Body: 'No from field',
    MessageSid: 'SMtest004',
  });
  assert.equal(res.status, 400);
});

console.log('\n── HITL hook resolution ──');

const { resolveHitlResponse, hasPendingHook } = await import('../src/gateway/whatsappHitl.js');

await test('resolveHitlResponse returns false when no pending hook for user', async () => {
  const result = resolveHitlResponse('whatsapp:+19990000000', undefined, 'approve');
  assert.equal(result, false);
});

await test('hasPendingHook returns false for unknown user', async () => {
  assert.equal(hasPendingHook('whatsapp:+19990000000'), false);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
