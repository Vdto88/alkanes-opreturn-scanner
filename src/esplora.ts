export type Source = 'subfrost' | 'mempool' | 'alkanode';

export interface EsploraOptions {
  source?: Source;
  subfrostKey?: string;
  fetchImpl?: typeof fetch;
}

export interface EsploraTx {
  txid: string;
  vout: { scriptpubkey: string }[];
}

export function esploraBase(source: Source, subfrostKey?: string): string {
  switch (source) {
    case 'subfrost':
      if (!subfrostKey) throw new Error('subfrostKey obrigatória para source subfrost');
      return `https://mainnet.subfrost.io/v4/${subfrostKey}/esplora`;
    case 'mempool':
      return 'https://mempool.space/api';
    case 'alkanode':
      return 'https://api.alkanode.com';
  }
}

/** Texto do GET com até 3 tentativas. Retry cobre HTTP transiente e o
 *  -32603 do gateway subfrost (vem no corpo). */
async function fetchTextRetry(url: string, f: typeof fetch, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await f(url);
      const text = (await res.text()).trim();
      if (!res.ok || text.includes('-32603')) {
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`fetch falhou ${url}: ${String(lastErr)}`);
}

function base(opts: EsploraOptions): string {
  return esploraBase(opts.source ?? 'subfrost', opts.subfrostKey);
}

export async function tipHeight(opts: EsploraOptions = {}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  return Number(await fetchTextRetry(`${base(opts)}/blocks/tip/height`, f));
}

export async function blockHash(height: number, opts: EsploraOptions = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  return fetchTextRetry(`${base(opts)}/block-height/${height}`, f);
}

export async function blockTxs(hash: string, opts: EsploraOptions = {}): Promise<EsploraTx[]> {
  const f = opts.fetchImpl ?? fetch;
  const b = base(opts);
  const info = JSON.parse(await fetchTextRetry(`${b}/block/${hash}`, f)) as { tx_count: number };
  const out: EsploraTx[] = [];
  for (let start = 0; start < info.tx_count; start += 25) {
    const page = JSON.parse(await fetchTextRetry(`${b}/block/${hash}/txs/${start}`, f)) as EsploraTx[];
    if (page.length === 0) break;
    out.push(...page);
  }
  return out;
}
