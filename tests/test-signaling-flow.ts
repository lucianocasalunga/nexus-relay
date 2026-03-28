/**
 * Teste Fase 2: Fluxo completo de signaling
 *
 * Simula: Peer A registra e cacheia evento → Peer B pede evento →
 * Nexus oferece Peer A → B envia signal para A → A recebe signal relayed
 */

import WebSocket from 'ws';

const NEXUS_URL = 'ws://127.0.0.1:8889';
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
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
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
  console.log('\n🧪 TESTE FASE 2: Fluxo de Signaling Completo\n');

  // --- Connect two peers ---
  console.log('1. Conectando dois peers...');
  const peerA = await connect();
  const peerB = await connect();
  assert(true, 'Peer A conectado');
  assert(true, 'Peer B conectado');

  // --- Register Peer A ---
  console.log('\n2. Registrando Peer A...');
  const regA = await sendAndWait(peerA, ['PEER_REGISTER', { bandwidth: 10, storage: 500 }]);
  assert(regA[0] === 'PEER_REGISTERED', `PEER_REGISTERED recebido (status: ${(regA[1] as any).status})`);
  const peerAId = (regA[1] as any).peer_id;
  assert(typeof peerAId === 'string' && peerAId.length > 0, `Peer A ID: ${peerAId.slice(0, 12)}...`);

  // --- Register Peer B ---
  console.log('\n3. Registrando Peer B...');
  const regB = await sendAndWait(peerB, ['PEER_REGISTER', { bandwidth: 5, storage: 200 }]);
  assert(regB[0] === 'PEER_REGISTERED', `PEER_REGISTERED recebido (status: ${(regB[1] as any).status})`);
  const peerBId = (regB[1] as any).peer_id;
  assert(typeof peerBId === 'string' && peerBId.length > 0, `Peer B ID: ${peerBId.slice(0, 12)}...`);

  // --- Peer A caches an event ---
  console.log('\n4. Peer A anuncia evento em cache...');
  const fakeEventId = 'abc123def456789012345678901234567890123456789012345678901234abcd';
  peerA.send(JSON.stringify(['PEER_CACHE_HAVE', { event_ids: [fakeEventId] }]));
  await new Promise(r => setTimeout(r, 200)); // give server time to process
  assert(true, `PEER_CACHE_HAVE enviado (event: ${fakeEventId.slice(0, 16)}...)`);

  // --- Peer B requests event ---
  console.log('\n5. Peer B pede evento via PEER_REQUEST...');
  const offer = await sendAndWait(peerB, ['PEER_REQUEST', { event_ids: [fakeEventId] }]);
  assert(offer[0] === 'PEER_OFFER', 'PEER_OFFER recebido');
  const offers = (offer[1] as any).offers;
  assert(fakeEventId in offers, `Evento ${fakeEventId.slice(0, 16)}... encontrado no offer`);
  assert(offers[fakeEventId].includes(peerAId), 'Peer A listado como fonte do evento');
  assert(!offers[fakeEventId].includes(peerBId), 'Peer B NAO listado (nao se oferece a si mesmo)');

  // --- Peer B sends signal to Peer A via Nexus ---
  console.log('\n6. Peer B envia PEER_SIGNAL para Peer A (via Nexus)...');
  const fakeSignalData = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n...' };

  // Set up listener on A before B sends signal
  const signalPromise = waitForMessage(peerA);
  peerB.send(JSON.stringify(['PEER_SIGNAL', { target_peer: peerAId, signal_data: fakeSignalData }]));

  const relayed = await signalPromise;
  assert(relayed[0] === 'PEER_SIGNAL', 'PEER_SIGNAL relayed para Peer A');
  const relayedPayload = relayed[1] as any;
  assert(relayedPayload.from_peer === peerBId, `from_peer correto: ${peerBId.slice(0, 12)}...`);
  assert(relayedPayload.signal_data.type === 'offer', 'signal_data.type preservado (offer)');
  assert(relayedPayload.signal_data.sdp === fakeSignalData.sdp, 'signal_data.sdp preservado');

  // --- Peer A responds with answer signal ---
  console.log('\n7. Peer A responde com signal answer...');
  const fakeAnswerData = { type: 'answer', sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n...' };
  const answerPromise = waitForMessage(peerB);
  peerA.send(JSON.stringify(['PEER_SIGNAL', { target_peer: peerBId, signal_data: fakeAnswerData }]));

  const relayedAnswer = await answerPromise;
  assert(relayedAnswer[0] === 'PEER_SIGNAL', 'PEER_SIGNAL answer relayed para Peer B');
  const answerPayload = relayedAnswer[1] as any;
  assert(answerPayload.from_peer === peerAId, `from_peer correto: ${peerAId.slice(0, 12)}...`);
  assert(answerPayload.signal_data.type === 'answer', 'signal_data.type preservado (answer)');

  // --- Request event that no peer has ---
  console.log('\n8. Peer B pede evento inexistente...');
  const noOffer = await sendAndWait(peerB, ['PEER_REQUEST', { event_ids: ['0000000000000000000000000000000000000000000000000000000000000000'] }]);
  assert(noOffer[0] === 'PEER_OFFER', 'PEER_OFFER recebido');
  assert(Object.keys((noOffer[1] as any).offers).length === 0, 'Offers vazio (nenhum peer tem)');
  assert((noOffer[1] as any).fallback === 'strfry', 'Fallback para strfry indicado');

  // --- Heartbeat ---
  console.log('\n9. Heartbeat...');
  const hbA = await sendAndWait(peerA, ['PEER_HEARTBEAT']);
  assert(hbA[0] === 'PEER_HEARTBEAT_ACK', 'Heartbeat ACK recebido');

  // --- Proxy still works alongside peer ---
  console.log('\n10. Proxy strfry funciona ao lado do P2P...');
  const proxyResp = await sendAndWait(peerA, ['REQ', 'test-proxy', { limit: 1 }]);
  assert(Array.isArray(proxyResp) && proxyResp[0] === 'EVENT', 'Evento recebido do strfry via proxy');

  // --- Cleanup ---
  peerA.close();
  peerB.close();

  // --- Results ---
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  RESULTADO: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
