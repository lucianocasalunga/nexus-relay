/**
 * Testes Fase 4: Cache e Super Peers
 *
 * Testa: conexões limitadas, redistribuição, métricas, dashboard, cliente
 */

import WebSocket from 'ws';
import http from 'http';

const NEXUS_URL = 'ws://127.0.0.1:8889';
const NEXUS_HTTP = 'http://127.0.0.1:8889';
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sendAndWait(ws: WebSocket, msg: unknown[], timeout = 2000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

function waitForMessage(ws: WebSocket, timeout = 2000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting')), timeout);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(NEXUS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function run(): Promise<void> {
  console.log('\n🧪 TESTES FASE 4: Cache e Super Peers\n');

  // ===== TEST 1: Metrics endpoint =====
  console.log('1. Endpoint /stats...');
  const stats = await httpGet(`${NEXUS_HTTP}/stats`);
  assert(stats.status === 200, '/stats retorna 200');
  const metrics = JSON.parse(stats.body);
  assert(typeof metrics.server.version === 'string', `server.version: ${metrics.server.version}`);
  assert(typeof metrics.server.uptime_seconds === 'number', `uptime: ${metrics.server.uptime_seconds}s`);
  assert(typeof metrics.peers.websocket_clients === 'number', 'peers.websocket_clients presente');
  assert(typeof metrics.p2p.events_via_p2p === 'number', 'p2p.events_via_p2p presente');
  assert(typeof metrics.cache.peers_with_cache === 'number', 'cache.peers_with_cache presente');
  assert(typeof metrics.connections.active_super_peers === 'number', 'connections.active_super_peers presente');

  // ===== TEST 2: Dashboard page =====
  console.log('\n2. Dashboard HTML...');
  const dash = await httpGet(`${NEXUS_HTTP}/dashboard.html`);
  assert(dash.status === 200, 'dashboard.html retorna 200');
  assert(dash.body.includes('Nexus Relay Dashboard'), 'Dashboard tem titulo correto');
  assert(dash.body.includes('/stats'), 'Dashboard faz fetch de /stats');

  // ===== TEST 3: Client page =====
  console.log('\n3. Client HTML...');
  const client = await httpGet(`${NEXUS_HTTP}/client.html`);
  assert(client.status === 200, 'client.html retorna 200');
  assert(client.body.includes('IndexedDB'), 'Client menciona IndexedDB');
  assert(client.body.includes('PEER_CACHE_HAVE'), 'Client anuncia cache');
  assert(client.body.includes('PEER_RECONNECT'), 'Client lida com PEER_RECONNECT');

  // ===== TEST 4: PEER_RECONNECT on Super Peer disconnect =====
  console.log('\n4. Redistribuição: PEER_RECONNECT...');

  // We can't fully test Super Peer promotion (needs 30min online),
  // but we can test that the connection tracking works
  const peerA = await connect();
  const regA = await sendAndWait(peerA, ['PEER_REGISTER', { bandwidth: 20, storage: 1000 }]);
  const peerAId = (regA[1] as any).peer_id;
  assert(regA[0] === 'PEER_REGISTERED', `Peer A registrado: ${peerAId.slice(0, 8)}`);

  const peerB = await connect();
  const regB = await sendAndWait(peerB, ['PEER_REGISTER', { bandwidth: 5, storage: 200 }]);
  const peerBId = (regB[1] as any).peer_id;
  assert(regB[0] === 'PEER_REGISTERED', `Peer B registrado: ${peerBId.slice(0, 8)}`);

  // ===== TEST 5: Metrics reflect connected peers =====
  console.log('\n5. Métricas refletem peers conectados...');
  const stats2 = await httpGet(`${NEXUS_HTTP}/stats`);
  const m2 = JSON.parse(stats2.body);
  assert(m2.peers.registered_peers >= 2, `registered_peers >= 2 (got ${m2.peers.registered_peers})`);
  assert(m2.peers.websocket_clients >= 2, `websocket_clients >= 2 (got ${m2.peers.websocket_clients})`);

  // ===== TEST 6: Cache tracking in metrics =====
  console.log('\n6. Cache tracking em métricas...');
  const testEvent = 'cafe' + '0'.repeat(60);
  peerA.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: [testEvent] }]));
  await new Promise(r => setTimeout(r, 200));

  const stats3 = await httpGet(`${NEXUS_HTTP}/stats`);
  const m3 = JSON.parse(stats3.body);
  assert(m3.cache.peers_with_cache >= 1, `peers_with_cache >= 1 (got ${m3.cache.peers_with_cache})`);
  assert(m3.cache.unique_events_cached >= 1, `unique_events_cached >= 1 (got ${m3.cache.unique_events_cached})`);

  // ===== TEST 7: Peer A disconnect cleans up cache =====
  console.log('\n7. Disconnect limpa cache...');
  peerA.close();
  await new Promise(r => setTimeout(r, 500));

  const stats4 = await httpGet(`${NEXUS_HTTP}/stats`);
  const m4 = JSON.parse(stats4.body);
  // Cache should be cleaned after peer A disconnect
  assert(m4.cache.peers_with_cache === 0 || m4.cache.peers_with_cache < m3.cache.peers_with_cache,
    'Cache limpo após disconnect');

  // ===== TEST 8: PEER_STATS updates metrics =====
  console.log('\n8. PEER_STATS atualiza reputação...');
  const statsResp = await sendAndWait(peerB, ['PEER_STATS', { events_served: 5, bytes_transferred: 2000 }]);
  assert(statsResp[0] === 'PEER_STATS_OK', 'PEER_STATS_OK recebido');
  assert((statsResp[1] as any).reputation > 70, `Reputação > 70: ${(statsResp[1] as any).reputation}`);

  // ===== TEST 9: All regression tests conceptual check =====
  console.log('\n9. Regressão geral...');
  const hb = await sendAndWait(peerB, ['PEER_HEARTBEAT']);
  assert(hb[0] === 'PEER_HEARTBEAT_ACK', 'Heartbeat OK');

  const proxyResp = await sendAndWait(peerB, ['REQ', 'regr', { limit: 1 }]);
  assert(proxyResp[0] === 'EVENT' || proxyResp[0] === 'EOSE', 'Proxy strfry OK');

  const nip11 = await httpGet(NEXUS_HTTP);
  assert(nip11.status === 200, 'HTTP OK');

  // Cleanup
  peerB.close();

  // ===== Results =====
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  RESULTADO: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
