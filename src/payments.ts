/**
 * Lightning payments para Super Peers via LNBits + OpenNode
 *
 * Fluxo:
 * 1. Peer atinge PAYMENT_THRESHOLD eventos verificados
 * 2. Resolve a Lightning Address do peer (LNURL-pay)
 * 3. Busca invoice pelo callback LNURL
 * 4. Paga via LNBits API
 *
 * Ativação: definir LNBITS_ADMIN_KEY + LNBITS_URL no .env do VPS
 * Enquanto não configurado, payments são logados mas não enviados.
 */

import { logger } from './utils/logger';

const log = logger('payments');

const LNBITS_URL = process.env.LNBITS_URL ?? '';           // ex: http://127.0.0.1:8090
const LNBITS_ADMIN_KEY = process.env.LNBITS_ADMIN_KEY ?? ''; // adminkey da wallet Nexus no LNBits
const PAYMENT_ENABLED = !!(LNBITS_URL && LNBITS_ADMIN_KEY);

export const PAYMENT_THRESHOLD = 100; // eventos verificados → 1 pagamento
const SATS_PER_PAYMENT = 10;          // sats por threshold atingido (ajustar conforme saldo)

// Controle de pagamentos em andamento (evita duplo-pagamento por race condition)
const pendingPayments = new Set<string>(); // pubkey

// Tracker de eventos por peer para acionar pagamento
const eventCountSinceLastPayment = new Map<string, number>();

/**
 * Chamado após cada evento verificado no onStats.
 * Quando o peer atinge o threshold, aciona o pagamento.
 */
export function trackVerifiedEvent(peerId: string, pubkey: string, lightningAddress: string, count: number): void {
  if (!lightningAddress) return;

  const current = (eventCountSinceLastPayment.get(peerId) ?? 0) + count;
  eventCountSinceLastPayment.set(peerId, current % PAYMENT_THRESHOLD);

  if (current >= PAYMENT_THRESHOLD) {
    const times = Math.floor(current / PAYMENT_THRESHOLD);
    for (let i = 0; i < times; i++) {
      payPeer(pubkey, lightningAddress, SATS_PER_PAYMENT).catch(err =>
        log.warn(`payment failed for ${pubkey.slice(0, 16)}: ${err.message}`)
      );
    }
  }
}

/**
 * Paga um peer via Lightning Address.
 */
export async function payPeer(pubkey: string, lightningAddress: string, sats: number): Promise<void> {
  if (pendingPayments.has(pubkey)) {
    log.debug(`payment already pending for ${pubkey.slice(0, 16)}, skipping`);
    return;
  }

  if (!PAYMENT_ENABLED) {
    log.info(`[DRY RUN] would pay ${sats} sats to ${lightningAddress} (pubkey ${pubkey.slice(0, 16)})`);
    log.info(`[DRY RUN] set LNBITS_URL + LNBITS_ADMIN_KEY in .env to enable real payments`);
    return;
  }

  pendingPayments.add(pubkey);

  try {
    // 1. Resolver Lightning Address → LNURL endpoint
    const lnurlEndpoint = await resolveLightningAddress(lightningAddress);

    // 2. Buscar invoice do callback
    const amountMsat = sats * 1000;
    const invoice = await fetchInvoiceFromLnurl(lnurlEndpoint, amountMsat);

    // 3. Pagar via LNBits
    await payInvoiceViaLnbits(invoice);

    log.info(`paid ${sats} sats to ${lightningAddress} (peer ${pubkey.slice(0, 16)})`);
  } finally {
    pendingPayments.delete(pubkey);
  }
}

/**
 * Resolve Lightning Address para endpoint LNURL-pay.
 * ex: user@domain.com → https://domain.com/.well-known/lnurlp/user
 */
async function resolveLightningAddress(address: string): Promise<string> {
  const [user, domain] = address.split('@');
  if (!user || !domain) throw new Error(`invalid lightning address: ${address}`);

  const url = `https://${domain}/.well-known/lnurlp/${user}`;
  const res = await fetchWithTimeout(url, 10_000);
  if (!res.ok) throw new Error(`LNURL resolve failed: ${res.status} for ${url}`);

  const data = await res.json() as { status?: string; callback?: string; minSendable?: number; maxSendable?: number };
  if (data.status === 'ERROR') throw new Error(`LNURL error: ${JSON.stringify(data)}`);
  if (!data.callback) throw new Error(`no callback in LNURL response from ${url}`);

  // Validar que o amount está dentro dos limites
  const amountMsat = SATS_PER_PAYMENT * 1000;
  if (data.minSendable && amountMsat < data.minSendable) {
    throw new Error(`amount ${amountMsat} msat below minSendable ${data.minSendable}`);
  }
  if (data.maxSendable && amountMsat > data.maxSendable) {
    throw new Error(`amount ${amountMsat} msat above maxSendable ${data.maxSendable}`);
  }

  return data.callback;
}

/**
 * Busca invoice (bolt11) do callback LNURL.
 */
async function fetchInvoiceFromLnurl(callbackUrl: string, amountMsat: number): Promise<string> {
  const url = `${callbackUrl}?amount=${amountMsat}`;
  const res = await fetchWithTimeout(url, 10_000);
  if (!res.ok) throw new Error(`LNURL callback failed: ${res.status}`);

  const data = await res.json() as { status?: string; pr?: string };
  if (data.status === 'ERROR') throw new Error(`LNURL callback error: ${JSON.stringify(data)}`);
  if (!data.pr) throw new Error('no payment request (pr) in LNURL callback response');

  return data.pr;
}

/**
 * Paga uma invoice via LNBits API.
 */
async function payInvoiceViaLnbits(bolt11: string): Promise<void> {
  const url = `${LNBITS_URL}/api/v1/payments`;
  const res = await fetchWithTimeout(url, 30_000, {
    method: 'POST',
    headers: {
      'X-Api-Key': LNBITS_ADMIN_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ out: true, bolt11 }),
  });

  const data = await res.json() as { payment_hash?: string; detail?: string };

  if (!res.ok || data.detail) {
    throw new Error(`LNBits payment failed: ${data.detail ?? res.status}`);
  }

  log.debug(`LNBits payment_hash: ${data.payment_hash}`);
}

/**
 * fetch com timeout.
 */
function fetchWithTimeout(url: string, timeoutMs: number, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function cleanupPaymentTracker(peerId: string): void {
  eventCountSinceLastPayment.delete(peerId);
}
