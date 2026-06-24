export type Source = 'subfrost' | 'mempool' | 'alkanode';

export interface EsploraOptions {
  source?: Source;
  subfrostKey?: string;
  fetchImpl?: typeof fetch;
  /** páginas de tx buscadas em paralelo por bloco (default 8). */
  concurrency?: number;
  /** tentativas por request antes de desistir (default 5). */
  attempts?: number;
  /** espera-base entre tentativas, em ms, com backoff exponencial (default 300; 0 = sem espera). */
  backoffMs?: number;
}

export interface EsploraTx {
  txid: string;
  vout: { scriptpubkey: string }[];
}

const REST_BASE: Record<'mempool' | 'alkanode', string> = {
  mempool: 'https://mempool.space/api',
  alkanode: 'https://api.alkanode.com',
};

/** path esplora ("/block/<h>/txs/0") -> método JSON-RPC do subfrost
 *  ("esplora_block:<h>:txs:0"). O gateway subfrost expõe a superfície esplora
 *  como JSON-RPC, não REST: a rota vira o nome do método (/ -> :). */
export function pathToSubfrostMethod(path: string): string {
  return 'esplora_' + path.replace(/^\//, '').replace(/\//g, ':');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Faz 1 request esplora e devolve o `result` parseado (number|string|object|array).
 *  subfrost = JSON-RPC POST; mempool/alkanode = REST GET. Tenta `attempts` vezes
 *  (default 5) com backoff exponencial: cobre HTTP transiente e erros do gateway
 *  subfrost (-32603 e afins). Um soluço breve não pode derrubar um scan de horas. */
async function esploraRequest(path: string, opts: EsploraOptions): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const source = opts.source ?? 'subfrost';
  const attempts = Math.max(1, opts.attempts ?? 5);
  const backoffMs = opts.backoffMs ?? 300;
  // erro de config (não transiente): falha rápido, sem gastar retries
  if (source === 'subfrost' && !opts.subfrostKey) throw new Error('subfrostKey obrigatória para source subfrost');
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    if (i > 0 && backoffMs > 0) await sleep(backoffMs * 2 ** (i - 1)); // 300, 600, 1200, 2400ms...
    try {
      if (source === 'subfrost') {
        const res = await f(`https://mainnet.subfrost.io/v4/${opts.subfrostKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: pathToSubfrostMethod(path), params: [] }),
        });
        const json = JSON.parse((await res.text()).trim()) as { result?: unknown; error?: { code?: number; message?: string } };
        if (json.error) {
          // pode vir sem `code` (só `message`, ou outra forma) — mensagem legível p/ não logar "undefined"
          lastErr = new Error(`JSON-RPC ${json.error.code ?? json.error.message ?? JSON.stringify(json.error)}`);
          continue; // transiente -> retry
        }
        return json.result;
      }
      const res = await f(`${REST_BASE[source]}${path}`);
      const text = (await res.text()).trim();
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text; // tip height / hash vêm como texto puro no REST
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`esplora request falhou ${path}: ${String(lastErr)}`);
}

export async function tipHeight(opts: EsploraOptions = {}): Promise<number> {
  return Number(await esploraRequest('/blocks/tip/height', opts));
}

export async function blockHash(height: number, opts: EsploraOptions = {}): Promise<string> {
  return String(await esploraRequest(`/block-height/${height}`, opts));
}

export interface BlockInfo {
  tx_count: number;
  mediantime: number; // unix segundos (timestamp real do bloco)
}

export async function blockInfo(hash: string, opts: EsploraOptions = {}): Promise<BlockInfo> {
  const j = (await esploraRequest(`/block/${hash}`, opts)) as { tx_count?: number; mediantime?: number };
  return { tx_count: j.tx_count ?? 0, mediantime: j.mediantime ?? 0 };
}

/** Busca todas as tx do bloco (scriptpubkey-only) + o mediantime real, numa
 *  única passada. Páginas em paralelo (concorrência limitada). */
export async function fetchBlock(hash: string, opts: EsploraOptions = {}): Promise<{ txs: EsploraTx[]; mediantime: number }> {
  const info = await blockInfo(hash, opts);
  const starts: number[] = [];
  for (let s = 0; s < info.tx_count; s += 25) starts.push(s);

  const pages: EsploraTx[][] = new Array(starts.length);
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < starts.length) {
      const i = next++;
      pages[i] = (await esploraRequest(`/block/${hash}/txs/${starts[i]}`, opts)) as EsploraTx[];
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, starts.length) }, worker));
  return { txs: pages.flat(), mediantime: info.mediantime };
}

export async function blockTxs(hash: string, opts: EsploraOptions = {}): Promise<EsploraTx[]> {
  return (await fetchBlock(hash, opts)).txs;
}
