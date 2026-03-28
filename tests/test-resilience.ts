/**
 * Teste de Resiliência e Mobilidade - Fase 7
 * Testa: desconexão/reconexão, cleanup, peers sobrevivem a perturbações
 */

import WebSocket from 'ws';

const NEXUS_URL = 'ws://127.0.0.1:8889';
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(NEXUS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndWait(ws: WebSocket, msg: unknown[], timeout = 3000): Promise<unknown[]> {
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
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function getStats(): Promise<any> {
  return new Promise((resolve, reject) => {
    const http = require('http');
    http.get('http://127.0.0.1:8889/stats', (res: any) => {
      let body = '';
      res.on('data', (c: string) => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function run(): Promise<void> {
  console.log('\n🧪 TESTE DE RESILIÊNCIA E MOBILIDADE\n');

  // ===== 1. Peer disconnect/reconnect =====
  console.log('1. Peer desconecta e reconecta...');
  const ws1 = await connect();
  const reg1 = await sendAndWait(ws1, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  const peerId1 = (reg1[1] as any).peer_id;
  assert(reg1[0] === 'PEER_REGISTERED', `Primeira conexão OK: ${peerId1.slice(0, 8)}`);

  // Cache some events
  ws1.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: ['aaa' + '0'.repeat(61)] }]));
  await new Promise(r => setTimeout(r, 200));

  // Disconnect
  ws1.close();
  await new Promise(r => setTimeout(r, 500));

  // Reconnect
  const ws1b = await connect();
  const reg1b = await sendAndWait(ws1b, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  const peerId1b = (reg1b[1] as any).peer_id;
  assert(reg1b[0] === 'PEER_REGISTERED', `Reconexão OK: ${peerId1b.slice(0, 8)}`);
  assert(peerId1b !== peerId1, 'Novo peer ID atribuído (não reutiliza antigo)');

  // Verify old cache was cleaned
  const ws2 = await connect();
  const reg2 = await sendAndWait(ws2, ['PEER_REGISTER', { bandwidth: 5, storage: 200 }]);
  const resp = await sendAndWait(ws2, ['PEER_REQUEST', { event_ids: ['aaa' + '0'.repeat(61)] }]);
  const offers = (resp[1] as any).offers;
  assert(Object.keys(offers).length === 0, 'Cache do peer antigo foi limpo');

  ws1b.close();
  ws2.close();
  await new Promise(r => setTimeout(r, 300));

  // ===== 2. Rapid connect/disconnect (flapping) =====
  console.log('\n2. Flapping: 20 conexões rápidas (conecta → registra → desconecta)...');
  const flaps: Promise<void>[] = [];
  for (let i = 0; i < 20; i++) {
    flaps.push((async () => {
      const ws = await connect();
      await sendAndWait(ws, ['PEER_REGISTER', { bandwidth: 1 }]);
      ws.close();
    })());
  }
  await Promise.all(flaps);
  await new Promise(r => setTimeout(r, 1500));
  const statsAfterFlap = await getStats();
  assert(statsAfterFlap.peers.registered_peers <= 1, `Flapping: quase todos limpos (${statsAfterFlap.peers.registered_peers} peers restantes)`);

  // ===== 3. Peer survives other peer disconnect =====
  console.log('\n3. Peer A sobrevive quando Peer B desconecta...');
  const peerA = await connect();
  const regA = await sendAndWait(peerA, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  const peerAId = (regA[1] as any).peer_id;

  const peerB = await connect();
  await sendAndWait(peerB, ['PEER_REGISTER', { bandwidth: 5, storage: 200 }]);

  // B disconnects
  peerB.close();
  await new Promise(r => setTimeout(r, 300));

  // A still works
  const hbA = await sendAndWait(peerA, ['PEER_HEARTBEAT']);
  assert(hbA[0] === 'PEER_HEARTBEAT_ACK', 'Peer A heartbeat OK após B desconectar');

  const proxyA = await sendAndWait(peerA, ['REQ', 'survive-test', { limit: 1 }]);
  assert(proxyA[0] === 'EVENT' || proxyA[0] === 'EOSE', 'Peer A proxy OK após B desconectar');

  // ===== 4. Stats endpoint accuracy =====
  console.log('\n4. Métricas refletem estado correto...');
  const statsNow = await getStats();
  assert(statsNow.peers.registered_peers >= 1, `>= 1 peer registrado (got ${statsNow.peers.registered_peers})`);
  assert(statsNow.peers.websocket_clients >= 1, `websocket clients >= 1 (got ${statsNow.peers.websocket_clients})`);

  // ===== 5. Invalid messages don't crash =====
  console.log('\n5. Mensagens inválidas não crasham o servidor...');
  peerA.send('not json at all');
  peerA.send(JSON.stringify('just a string'));
  peerA.send(JSON.stringify([]));
  peerA.send(JSON.stringify([123]));
  peerA.send(JSON.stringify(['PEER_UNKNOWN_TYPE']));
  peerA.send(JSON.stringify(['PEER_REGISTER'])); // duplicate register
  await new Promise(r => setTimeout(r, 300));

  // Server still alive
  const hbAfterBad = await sendAndWait(peerA, ['PEER_HEARTBEAT']);
  assert(hbAfterBad[0] === 'PEER_HEARTBEAT_ACK', 'Servidor sobrevive mensagens inválidas');

  // ===== 6. Many events cached then peer disconnects =====
  console.log('\n6. Cache grande → disconnect → cleanup...');
  const bigPeer = await connect();
  await sendAndWait(bigPeer, ['PEER_REGISTER', { bandwidth: 50, storage: 5000 }]);
  const bigEvents = [];
  for (let i = 0; i < 100; i++) {
    bigEvents.push(`big${i.toString().padStart(4, '0')}${'0'.repeat(58)}`);
  }
  bigPeer.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: bigEvents }]));
  await new Promise(r => setTimeout(r, 300));

  const statsBeforeCleanup = await getStats();
  assert(statsBeforeCleanup.cache.unique_events_cached >= 100, `100+ eventos cacheados (got ${statsBeforeCleanup.cache.unique_events_cached})`);

  bigPeer.close();
  await new Promise(r => setTimeout(r, 500));

  const statsAfterCleanup = await getStats();
  assert(statsAfterCleanup.cache.unique_events_cached < statsBeforeCleanup.cache.unique_events_cached,
    `Cache limpo após disconnect (${statsBeforeCleanup.cache.unique_events_cached} → ${statsAfterCleanup.cache.unique_events_cached})`);

  // Cleanup
  peerA.close();
  await new Promise(r => setTimeout(r, 300));

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
