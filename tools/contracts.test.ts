import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContracts, writeContracts, upsertContracts, topTargets } from './contracts';

describe('contracts-daily', () => {
  it('round-trip + upsert por data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'));
    const p = join(dir, 'c.json');
    let rows = [{ date: '2026-06-20', targets: { '2:77087': 3 } }];
    rows = upsertContracts(rows, { date: '2026-06-19', targets: { '2:5': 1 } });
    rows = upsertContracts(rows, { date: '2026-06-20', targets: { '2:77087': 9 } }); // substitui
    writeContracts(p, rows);
    const read = readContracts(p);
    expect(read.map((r) => r.date)).toEqual(['2026-06-19', '2026-06-20']);
    expect(read.find((r) => r.date === '2026-06-20')!.targets['2:77087']).toBe(9);
    rmSync(dir, { recursive: true, force: true });
  });

  it('readContracts devolve [] quando não existe', () => {
    expect(readContracts(join(tmpdir(), 'nao-existe-ct-xyz.json'))).toEqual([]);
  });

  it('topTargets soma all-time e ordena desc', () => {
    const rows = [
      { date: '2026-06-19', targets: { '2:77087': 2, '2:5': 1 } },
      { date: '2026-06-20', targets: { '2:77087': 5 } },
    ];
    expect(topTargets(rows, 2)).toEqual([{ id: '2:77087', count: 7 }, { id: '2:5', count: 1 }]);
  });
});
