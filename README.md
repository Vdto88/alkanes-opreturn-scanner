# opreturn-scanner (v2)

Varre blocos de BTC e produz, de forma independente e defensável, as **3 métricas** de
OP_RETURN/Alkanes (por **contagem** e por **bytes**):

1. % das tx de BTC que têm **OP_RETURN**
2. % dos **OP_RETURN que são Alkanes**
3. % das tx de BTC que são, portanto, **Alkanes** (= 1 × 2)

Reusa o decoder v1 (`../opreturn-decoder`, `decodeOpReturn`) como classificador "é Alkanes?" —
**não** reimplementa protostone/cellpack. O fetch é **scriptpubkey-only** (não baixa raw hex):
para cada vout, `6a`=OP_RETURN, `6a5d`=runestone, decode→`protocol_tag=1`=Alkanes.

## Uso

```bash
# key subfrost via .env.local (SUBFROST_KEY=...), env, ou --subfrost-key
npm test                                   # suíte vitest (determinística, sem rede)
npm run scan -- --blocks 50                # últimos 50 blocos via subfrost (default)
npm run scan -- --from 954800 --to 954849  # range explícito
npm run scan -- --blocks 50 --concurrency 16   # mais páginas em paralelo
npm run scan -- --sample 100 --from 946000 --to 954000  # amostra 1 a cada 100
```

Flags: `--blocks N` · `--from/--to H` · `--source subfrost|mempool|alkanode` (default subfrost) ·
`--subfrost-key K` · `--sample K` · `--no-cache` · `--concurrency N`.

## Notas

- **Fonte default = subfrost** (`mainnet.subfrost.io/v4/<key>`): é **JSON-RPC POST**, não REST —
  a superfície esplora vira método `esplora_` + path com `/`→`:`. `mempool`/`alkanode` são REST GET.
- **Cache** por bloco em `./cache/<height>.json` (resumível). `--no-cache` ignora.
- **Metodologia** (ver `docs/superpowers/specs/`): bytes = scriptPubKey inteiro do output;
  denominador da métrica 2 = todos os OP_RETURN; coinbase incluída (witness-commitment conta como
  OP_RETURN, nunca Alkanes).
- **Segredo:** a key nunca é commitada (`.env*` no `.gitignore`).
