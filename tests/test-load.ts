/**
 * Teste de Carga - Fase 7
 * Simula 50+ peers simultâneos: registro, cache, request, signal, heartbeat
 */

import WebSocket from 'ws';

const NEXUS_URL = 'ws://127.0.0.1:8889';
const NUM_PEERS = 60;
const EVENTS_PER_PEER = 5;

interface PeerConn {
  id: number;
  ws: WebSocket;
  peerId: string | null;
  registered: boolean;
}

function connect(id: number): Promise<PeerConn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(NEXUS_URL);
    const peer: PeerConn = { id, ws, peerId: null, registered: false };
    ws.on('open', () => resolve(peer));
    ws.on('error', reject);
  });
}

function sendAndCollect(ws: WebSocket, msg: unknown[], timeout = 3000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout for ${JSON.stringify(msg[0])}`)), timeout);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

async function run(): Promise<void> {
  console.log(`\n🧪 TESTE DE CARGA: ${NUM_PEERS} peers simultâneos\n`);

  const startMem = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  // ===== 1. Connect all peers =====
  console.log(`1. Conectando ${NUM_PEERS} peers...`);
  const t1 = performance.now();
  const peers: PeerConn[] = [];
  const connectPromises = [];
  for (let i = 0; i < NUM_PEERS; i++) {
    connectPromises.push(connect(i));
  }
  const connected = await Promise.all(connectPromises);
  peers.push(...connected);
  const connectTime = performance.now() - t1;
  console.log(`  ✅ ${peers.length} peers conectados (${connectTime.toFixed(0)}ms)`);

  // ===== 2. Register all peers =====
  console.log(`\n2. Registrando ${NUM_PEERS} peers...`);
  const t2 = performance.now();
  const registerPromises = peers.map(async (peer) => {
    const resp = await sendAndCollect(peer.ws, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
    if (resp[0] === 'PEER_REGISTERED') {
      peer.peerId = (resp[1] as any).peer_id;
      peer.registered = true;
    }
  });
  await Promise.all(registerPromises);
  const registerTime = performance.now() - t2;
  const registeredCount = peers.filter(p => p.registered).length;
  console.log(`  ✅ ${registeredCount}/${NUM_PEERS} registrados (${registerTime.toFixed(0)}ms)`);

  // ===== 3. Each peer caches events =====
  console.log(`\n3. Cada peer cacheia ${EVENTS_PER_PEER} eventos...`);
  const t3 = performance.now();
  let totalEvents = 0;
  for (const peer of peers) {
    const eventIds = [];
    for (let j = 0; j < EVENTS_PER_PEER; j++) {
      eventIds.push(`${peer.id.toString().padStart(4, '0')}${j.toString().padStart(4, '0')}${'0'.repeat(56)}`);
    }
    peer.ws.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: eventIds }]));
    totalEvents += eventIds.length;
  }
  await new Promise(r => setTimeout(r, 500)); // let server process
  const cacheTime = performance.now() - t3;
  console.log(`  ✅ ${totalEvents} eventos cacheados (${cacheTime.toFixed(0)}ms)`);

  // ===== 4. Cross-peer requests =====
  console.log(`\n4. Cross-peer PEER_REQUEST (peer N pede evento de peer N-1)...`);
  const t4 = performance.now();
  let offersReceived = 0;
  let offersWithPeers = 0;
  const requestPromises = peers.slice(1).map(async (peer, idx) => {
    const targetPeer = peers[idx]; // peer N-1
    const eventId = `${targetPeer.id.toString().padStart(4, '0')}0000${'0'.repeat(56)}`;
    const resp = await sendAndCollect(peer.ws, ['PEER_REQUEST', { event_ids: [eventId] }]);
    if (resp[0] === 'PEER_OFFER') {
      offersReceived++;
      const offers = (resp[1] as any).offers;
      if (Object.keys(offers).length > 0) offersWithPeers++;
    }
  });
  await Promise.all(requestPromises);
  const requestTime = performance.now() - t4;
  console.log(`  ✅ ${offersReceived} offers recebidos, ${offersWithPeers} com peers (${requestTime.toFixed(0)}ms)`);

  // ===== 5. Heartbeat all peers =====
  console.log(`\n5. Heartbeat de ${NUM_PEERS} peers...`);
  const t5 = performance.now();
  let heartbeatOk = 0;
  const hbPromises = peers.map(async (peer) => {
    const resp = await sendAndCollect(peer.ws, ['PEER_HEARTBEAT']);
    if (resp[0] === 'PEER_HEARTBEAT_ACK') heartbeatOk++;
  });
  await Promise.all(hbPromises);
  const hbTime = performance.now() - t5;
  console.log(`  ✅ ${heartbeatOk}/${NUM_PEERS} heartbeats OK (${hbTime.toFixed(0)}ms)`);

  // ===== 6. Proxy test (some peers do REQ) =====
  console.log(`\n6. Proxy strfry com peers ativos (10 REQs)...`);
  const t6 = performance.now();
  let proxyOk = 0;
  const proxyPromises = peers.slice(0, 10).map(async (peer) => {
    const resp = await sendAndCollect(peer.ws, ['REQ', `load-${peer.id}`, { limit: 1 }]);
    if (resp[0] === 'EVENT' || resp[0] === 'EOSE' || resp[0] === 'PEER_OFFER') proxyOk++;
  });
  await Promise.all(proxyPromises);
  const proxyTime = performance.now() - t6;
  console.log(`  ✅ ${proxyOk}/10 proxy responses OK (${proxyTime.toFixed(0)}ms)`);

  // ===== 7. Signal relay between peers =====
  console.log(`\n7. Signal relay (20 pares)...`);
  const t7 = performance.now();
  let signalOk = 0;
  const signalPromises = [];
  for (let i = 0; i < 20; i++) {
    const peerA = peers[i * 2];
    const peerB = peers[i * 2 + 1];
    if (!peerA?.peerId || !peerB?.peerId) continue;

    signalPromises.push(new Promise<void>(async (resolve) => {
      const listenPromise = new Promise<void>((res) => {
        const timer = setTimeout(res, 2000);
        peerB.ws.once('message', (data: Buffer) => {
          clearTimeout(timer);
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'PEER_SIGNAL') signalOk++;
          res();
        });
      });
      peerA.ws.send(JSON.stringify(['PEER_SIGNAL', {
        target_peer: peerB.peerId,
        signal_data: { type: 'offer', sdp: `test-${i}` }
      }]));
      await listenPromise;
      resolve();
    }));
  }
  await Promise.all(signalPromises);
  const signalTime = performance.now() - t7;
  console.log(`  ✅ ${signalOk}/20 signals relayed (${signalTime.toFixed(0)}ms)`);

  // ===== 8. Disconnect all =====
  console.log(`\n8. Desconectando ${NUM_PEERS} peers...`);
  const t8 = performance.now();
  for (const peer of peers) peer.ws.close();
  await new Promise(r => setTimeout(r, 1000));
  const disconnectTime = performance.now() - t8;
  console.log(`  ✅ Todos desconectados (${disconnectTime.toFixed(0)}ms)`);

  // ===== Results =====
  const totalTime = performance.now() - startTime;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RESULTADO DO TESTE DE CARGA`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Peers:         ${NUM_PEERS}`);
  console.log(`  Eventos:       ${totalEvents}`);
  console.log(`  Registros:     ${registeredCount}/${NUM_PEERS} OK`);
  console.log(`  Offers:        ${offersWithPeers}/${offersReceived} com peers`);
  console.log(`  Heartbeats:    ${heartbeatOk}/${NUM_PEERS} OK`);
  console.log(`  Proxy:         ${proxyOk}/10 OK`);
  console.log(`  Signals:       ${signalOk}/20 OK`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Connect:       ${connectTime.toFixed(0)}ms`);
  console.log(`  Register:      ${registerTime.toFixed(0)}ms`);
  console.log(`  Cache:         ${cacheTime.toFixed(0)}ms`);
  console.log(`  Requests:      ${requestTime.toFixed(0)}ms`);
  console.log(`  Heartbeats:    ${hbTime.toFixed(0)}ms`);
  console.log(`  Proxy:         ${proxyTime.toFixed(0)}ms`);
  console.log(`  Signals:       ${signalTime.toFixed(0)}ms`);
  console.log(`  Total:         ${totalTime.toFixed(0)}ms`);
  console.log(`${'='.repeat(60)}\n`);

  const allOk = registeredCount === NUM_PEERS && heartbeatOk === NUM_PEERS && proxyOk === 10 && signalOk >= 18;
  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
