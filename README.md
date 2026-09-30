# opreturn-scanner (v2)

📊 **Live dashboard (updated daily):** https://vdto88.github.io/alkanes-opreturn-stats/
The same charts on the site: https://subfrost.io/metrics

Scans Bitcoin blocks and produces, independently and reproducibly, the **3 metrics** of
OP_RETURN/Alkanes (by **count** and by **bytes**):

1. % of BTC transactions that carry an **OP_RETURN**
2. % of **OP_RETURNs that are Alkanes**
3. % of BTC transactions that are therefore **Alkanes** (= 1 × 2)

It reuses the v1 decoder ([alkanes-opreturn-decoder](https://github.com/Vdto88/alkanes-opreturn-decoder),
`decodeOpReturn`) as the "is it Alkanes?" classifier and does **not** reimplement protostone/cellpack.
`src/classify.ts` imports it by relative path (`../../opreturn-decoder/src/decode`), so the public
decoder repo must be cloned next to this one as `../opreturn-decoder`:

```bash
git clone https://github.com/Vdto88/alkanes-opreturn-scanner
git clone https://github.com/Vdto88/alkanes-opreturn-decoder opreturn-decoder
cd alkanes-opreturn-scanner && npm install
```

The fetch is **scriptpubkey-only** (no raw hex): for each vout, `6a` = OP_RETURN, `6a5d` = runestone,
decode → `protocol_tag=1` = Alkanes.

## Usage

```bash
# subfrost key via .env.local (SUBFROST_KEY=...), env, or --subfrost-key
npm test                                   # vitest suite (deterministic, no network)
npm run scan -- --blocks 50                # last 50 blocks via subfrost (default)
npm run scan -- --from 954800 --to 954849  # explicit range
npm run scan -- --blocks 50 --concurrency 16   # more pages in parallel
npm run scan -- --sample 100 --from 946000 --to 954000  # sample 1 block in 100
npm run scan -- --source mempool --from 954800 --to 954849  # mempool.space, no key
```

Flags: `--blocks N` · `--from/--to H` · `--source subfrost|mempool|alkanode` (default subfrost) ·
`--subfrost-key K` · `--sample K` · `--no-cache` · `--cache-dir D` · `--concurrency N`.

### Daily history + chart

`history.csv` holds **one row per day** (the aggregate of that day's blocks). It is the durable record.

```bash
npx tsx tools/snapshot.ts        # scans recent blocks and writes/updates TODAY's row
npx tsx tools/build-report.ts    # builds report.html (rollups yesterday/7d/30d + daily timeline)
npx tsx tools/seed-history.ts    # (once) seeds history.csv from the local cache
```

`tools/snapshot.ts` also fetches the day's BTC price (`tools/price.ts`, CoinGecko) and updates
`contracts-daily.json` (non-DIESEL contract calls per day). `tools/seed-history.ts [cacheDir] [historyPath] [--merge]`
dates each cached block by its own time; with `--merge` it keeps existing days instead of overwriting.

`report.html` is standalone (opens in a browser, no server). `build-report.ts` also reads
`blockspace-daily.json` from the same directory as `history.csv` for the census charts; without it,
those charts are skipped.

### `history.csv` schema

One row per UTC day. **Parse by column NAME** (not by position): columns may be appended at the end
without breaking consumers. Columns (21):

`date, fromHeight, toHeight, blocksScanned, totalTx, txWithOpReturn, txAlkanes, opReturnBytes,
runestoneBytes, alkanesBytes, dieselMints, feeTotalSats, feeAlkanesSats, feeOpReturnSats, btcUsd,
weightTotal, weightAlkanes, ugMints, dieselUg, txAlkRunestone, txPureRunes`

The first **15** come from the scanner (`tools/snapshot.ts`, `tools/seed-history.ts`); `btcUsd` comes
from CoinGecko via `tools/price.ts`. `blocksScanned` is the number of blocks read for that day: for
today's row it is the sampled count, and once the dense pass has run (see Automation) it is every
block from `fromHeight` to `toHeight`.

The **last 6** come from the metashrew census in
[alkanes-opreturn-indexer](https://github.com/Vdto88/alkanes-opreturn-indexer) (every block of the
day), through the side file `blockspace-daily.json`:

- `weightTotal` / `weightAlkanes`: weight (WU) of the day, total and of Alkanes transactions →
  **"Alkanes' share of block space (by weight)"** = `weightAlkanes / weightTotal` (literal block space).
- `ugMints` / `dieselUg`: mints of the UNCOMMON•GOODS rune (`1:0`) and those that **also** are DIESEL →
  **"UNCOMMON•GOODS mints that are DIESEL"** = `dieselUg / ugMints`. (Use `dieselUg`, **not**
  `dieselMints`, as the numerator: only `dieselUg` is the DIESEL∩UG subset.)
- `txAlkRunestone` / `txPureRunes`: Runestone transactions that are Alkanes (`protocol_tag=1`) and that
  are not (pure Runes). These two are **scaled to a 144-block day**: `round(count / census blocks × 144)`,
  computed from the census block count of that day (`tools/backfill-runestone-cols.ts`, same formula
  as `perDayCensus` in the indexer's `tools/metashrew-export.ts`). Plot them directly; do not
  extrapolate again with the row's `blocksScanned`, which has a different base.

The first 4 are copied by `tools/merge-blockspace.ts`, the last 2 by `tools/backfill-runestone-cols.ts`.

**Coverage:** the published file starts at 2025-01-20 (block 880,000), and the census columns are
filled from that first row on. A day **without** census data gets an **empty cell** (not `0`: `0` is
a real value, e.g. `dieselUg=0` in early 2025). The two scaled columns are also left empty when the
estimate rounds below 1 (e.g. `txAlkRunestone` on 2025-01-23). The first 15 columns never change
order or name.

### Automation (GitHub Actions)

Two workflows produce the dataset, in this order:

1. **`.github/workflows/census.yml`** (cron 04:45 UTC, or "Run workflow" with an optional `dry_run`):
   clones the indexer and `kungfuflex/alkanes-rs` at `888f4fe6`, builds `rockshrew-mono` and the
   indexer WASM, restores the indexer database from the Actions cache and indexes from block 951535
   up to the tip, then runs the indexer's `tools/export-blockspace.ts` over the frozen snapshot
   (880000 to 951534) plus the live database. It commits **`blockspace-daily.json`** back to this repo
   (on `master`, not in a dry run, and only if the last day's `toHeight` does not go backwards).
   Needs the secret `CENSUS_RPC_URL` (a Bitcoin RPC).
2. **`.github/workflows/daily.yml`** (cron 06:17 UTC, or "Run workflow"): clones the public decoder
   to `../opreturn-decoder`, runs `npm test`, then:
   - `tools/snapshot.ts --blocks 144 --sample 6` writes today's sampled row;
   - a dense pass (`src/cli.ts --sample 1` over the last row's range, from `fromHeight - 72`, then
     `tools/seed-history.ts cache history.csv --merge`) turns yesterday into a full census. A merge
     never replaces a day with one built from fewer blocks. This step may fail without failing the job;
   - `tools/merge-blockspace.ts` and `tools/backfill-runestone-cols.ts` fill the 6 census columns
     from `blockspace-daily.json`;
   - `tools/build-report.ts` builds `report.html`;
   - `index.html`, `history.csv`, `LICENSE`, `figures/` and a README are published to
     [alkanes-opreturn-stats](https://github.com/Vdto88/alkanes-opreturn-stats) (GitHub Pages);
   - `history.csv`, `report.html` and `contracts-daily.json` are committed back to this repo.

   Needs the secrets `SUBFROST_KEY` and `PAGES_DEPLOY_KEY`. The source is set by `SCAN_SOURCE` at
   the top of the workflow (default `subfrost`). (Without a key, switch it to `mempool`: public,
   keyless. The workflow notes that mempool.space held up for spot checks but not for the dense pass:
   blocks that fail to fetch are skipped, so the job can stay green with a partial day.)

## Notes

- **Default source = subfrost** (`mainnet.subfrost.io/v4/<key>`): it is **JSON-RPC POST**, not REST.
  The esplora surface becomes the method `esplora_` + the path with `/`→`:`. `mempool`/`alkanode` are
  REST GET.
- **Cache** per block in `./cache/<height>.json` (resumable). `--no-cache` ignores it; `--cache-dir`
  moves it.
- **Methodology** (see `docs/superpowers/specs/`): bytes = the whole scriptPubKey of the output;
  denominator of metric 2 = all OP_RETURNs; coinbase included (the witness commitment counts as an
  OP_RETURN, never as Alkanes).
- **Secret:** the key is never committed (`.env*` is in `.gitignore`).

## Related

- [alkanes-opreturn-decoder](https://github.com/Vdto88/alkanes-opreturn-decoder): decodes one transaction offline; the classifier used here.
- [alkanes-opreturn-indexer](https://github.com/Vdto88/alkanes-opreturn-indexer): the metashrew census behind the weight, UNCOMMON•GOODS and Runestone columns.
- [alkanes-opreturn-stats](https://github.com/Vdto88/alkanes-opreturn-stats): the published dataset, [`history.csv`](https://vdto88.github.io/alkanes-opreturn-stats/history.csv).
- [subfrost.io/metrics](https://subfrost.io/metrics): the same charts on the site.
