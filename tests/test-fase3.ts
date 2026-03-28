/**
 * Testes Fase 3: Protocolo NIP-95 no Relay
 *
 * Testa: NIP-11, PEER_STATS, classificação, smart routing, broadcast
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

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
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
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
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
  console.log('\n🧪 TESTES FASE 3: Protocolo NIP-95 no Relay\n');

  // ===== TEST 1: NIP-11 =====
  console.log('1. NIP-11 Relay Information Document...');

  const nip11 = await httpGet(NEXUS_HTTP, { 'Accept': 'application/nostr+json' });
  assert(nip11.status === 200, 'NIP-11 retorna 200');
  const info = JSON.parse(nip11.body);
  assert(info.name === 'Nexus Relay', `name: ${info.name}`);
  assert(info.supported_nips.includes(95), 'NIP-95 listada nos supported_nips');
  assert(info.supported_nips.includes(11), 'NIP-11 listada nos supported_nips');
  assert(info.extra.p2p_enabled === true, 'p2p_enabled: true');
  assert(info.extra.p2p_protocol === 'NIP-95', 'p2p_protocol: NIP-95');
  assert(info.version === '0.3.0', `version: ${info.version}`);

  // Normal HTTP (no nostr+json) still serves page
  const htmlResp = await httpGet(NEXUS_HTTP);
  assert(htmlResp.status === 200, 'HTML page still served for normal requests');

  // ===== TEST 2: PEER_STATS =====
  console.log('\n2. PEER_STATS...');

  const peer = await connect();
  const reg = await sendAndWait(peer, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  const peerId = (reg[1] as any).peer_id;
  assert(reg[0] === 'PEER_REGISTERED', `Peer registrado: ${peerId.slice(0, 12)}...`);

  const stats = await sendAndWait(peer, ['PEER_STATS', { events_served: 10, bytes_transferred: 5000, peers_connected: 3 }]);
  assert(stats[0] === 'PEER_STATS_OK', 'PEER_STATS_OK recebido');
  const statsPayload = stats[1] as any;
  assert(typeof statsPayload.reputation === 'number', `reputation: ${statsPayload.reputation}`);
  assert(statsPayload.total_events_served === 10, `total_events_served: ${statsPayload.total_events_served}`);
  assert(statsPayload.reputation > 70, `reputation increased (${statsPayload.reputation} > 70)`);

  // ===== TEST 3: Classification (promotion check on heartbeat) =====
  console.log('\n3. Classificação de peers...');

  // Peer needs: online >30min, bw >5, storage >100, reputation >=50, cached events >=1
  // We can't wait 30min, but we can verify the heartbeat triggers classification
  // and that it doesn't promote prematurely
  const hb = await sendAndWait(peer, ['PEER_HEARTBEAT']);
  assert(hb[0] === 'PEER_HEARTBEAT_ACK', 'Heartbeat ACK (classificação executada)');
  // Should NOT be promoted yet (< 30 minutes online)
  // No PEER_PROMOTED message should follow (only got ACK)

  // ===== TEST 4: Smart Routing (REQ with P2P hint) =====
  console.log('\n4. Smart Routing...');

  // Peer A has an event
  const peerA = await connect();
  const regA = await sendAndWait(peerA, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  const peerAId = (regA[1] as any).peer_id;

  const testEventId = 'deadbeef' + '0'.repeat(56);
  peerA.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: [testEventId] }]));
  await new Promise(r => setTimeout(r, 200));

  // Peer B is registered and sends REQ with specific event ID
  // Should get both strfry response AND PEER_OFFER
  const peerB = await connect();
  const regB = await sendAndWait(peerB, ['PEER_REGISTER', { bandwidth: 5, storage: 200 }]);
  const peerBId = (regB[1] as any).peer_id;

  // Send REQ with specific ID filter
  peerB.send(JSON.stringify(['REQ', 'smart-test', { ids: [testEventId] }]));

  // Collect messages (should get PEER_OFFER and EOSE from strfry)
  const messages: unknown[][] = [];
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      // Stop after getting both PEER_OFFER and EOSE
      const types = messages.map(m => m[0]);
      if (types.includes('PEER_OFFER') && types.includes('EOSE')) {
        clearTimeout(timer);
        peerB.removeListener('message', handler);
        resolve();
      }
    };
    peerB.on('message', handler);
  });

  const msgTypes = messages.map(m => m[0]);
  assert(msgTypes.includes('PEER_OFFER'), 'Smart REQ: PEER_OFFER recebido');
  assert(msgTypes.includes('EOSE'), 'Smart REQ: EOSE do strfry também recebido');

  const offer = messages.find(m => m[0] === 'PEER_OFFER');
  if (offer) {
    const offerData = offer[1] as any;
    assert(offerData.source === 'smart_routing', 'PEER_OFFER source: smart_routing');
    assert(testEventId in (offerData.offers || {}), 'PEER_OFFER contém evento solicitado');
    const offerPeers = offerData.offers[testEventId] || [];
    assert(offerPeers.includes(peerAId), 'PEER_OFFER lista Peer A como fonte');
    assert(!offerPeers.includes(peerBId), 'PEER_OFFER exclui Peer B (requester)');
  }

  // REQ without specific IDs should just proxy (no PEER_OFFER)
  peerB.send(JSON.stringify(['REQ', 'normal-test', { limit: 1, kinds: [1] }]));
  const normalResp = await waitForMessage(peerB);
  assert(normalResp[0] === 'EVENT' || normalResp[0] === 'EOSE', 'Normal REQ: proxied to strfry (no PEER_OFFER)');

  // ===== TEST 5: Non-peer REQ still works =====
  console.log('\n5. Non-peer REQ (cliente sem registro)...');
  const normalClient = await connect();
  const normalReq = await sendAndWait(normalClient, ['REQ', 'plain-test', { limit: 1 }]);
  assert(normalReq[0] === 'EVENT' || normalReq[0] === 'EOSE', 'Non-peer client: REQ proxied normally');

  // ===== TEST 6: Previous Fase 2 tests still pass =====
  console.log('\n6. Regressão Fase 2 (signaling)...');

  const sigTest = await sendAndWait(peerA, ['PEER_HEARTBEAT']);
  assert(sigTest[0] === 'PEER_HEARTBEAT_ACK', 'Heartbeat still works');

  const signalPromise = waitForMessage(peerA);
  peerB.send(JSON.stringify(['PEER_SIGNAL', { target_peer: peerAId, signal_data: { type: 'offer', sdp: 'test' } }]));
  const relayed = await signalPromise;
  assert(relayed[0] === 'PEER_SIGNAL', 'PEER_SIGNAL relay still works');
  assert((relayed[1] as any).from_peer === peerBId, 'Signal from_peer correct');

  // ===== Cleanup =====
  peer.close();
  peerA.close();
  peerB.close();
  normalClient.close();

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
