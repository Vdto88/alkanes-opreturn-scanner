import { describe, it, expect } from 'vitest';
import { classifyTx } from './classify';

const ALKANES = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010'; // 29 bytes
const WITNESS_COMMIT = '6a24aa21a9ed' + 'ab'.repeat(32); // coinbase, 38 bytes, não-runestone
const MALFORMED_RUNESTONE = '6a5d00'; // 6a5d + opcode inválido -> decode lança
const P2WPKH = '0014' + '11'.repeat(20); // sem OP_RETURN

describe('classifyTx', () => {
  it('OP_RETURN Alkanes: todas as flags + bytes do output', () => {
    const c = classifyTx([{ scriptpubkey: P2WPKH }, { scriptpubkey: ALKANES }]);
    expect(c.hasOpReturn).toBe(true);
    expect(c.hasRunestone).toBe(true);
    expect(c.isAlkanes).toBe(true);
    expect(c.decodeFailed).toBe(false);
    expect(c.opReturnBytes).toBe(29);
    expect(c.alkanesBytes).toBe(29);
  });

  it('witness commitment: OP_RETURN mas não runestone nem Alkanes', () => {
    const c = classifyTx([{ scriptpubkey: WITNESS_COMMIT }]);
    expect(c.hasOpReturn).toBe(true);
    expect(c.hasRunestone).toBe(false);
    expect(c.isAlkanes).toBe(false);
    expect(c.opReturnBytes).toBe(38);
    expect(c.alkanesBytes).toBe(0);
  });

  it('runestone malformado: hasRunestone + decodeFailed, não Alkanes', () => {
    const c = classifyTx([{ scriptpubkey: MALFORMED_RUNESTONE }]);
    expect(c.hasRunestone).toBe(true);
    expect(c.decodeFailed).toBe(true);
    expect(c.isAlkanes).toBe(false);
  });

  it('sem OP_RETURN: tudo falso/zero', () => {
    const c = classifyTx([{ scriptpubkey: P2WPKH }]);
    expect(c.hasOpReturn).toBe(false);
    expect(c.opReturnBytes).toBe(0);
    expect(c.isAlkanes).toBe(false);
  });
});
