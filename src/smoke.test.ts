import { describe, it, expect } from 'vitest';
import { decodeOpReturn } from '../../opreturn-decoder/src/decode';

// OP_RETURN scriptPubKey real (vout 1 da burned-bond tx do v1) — protostone Alkanes
const ALKANES_OPRETURN = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010';

describe('cross-package reuse do decoder v1', () => {
  it('decodeOpReturn classifica o OP_RETURN Alkanes', () => {
    const r = decodeOpReturn(ALKANES_OPRETURN, 1);
    expect(r.protostones.some((p) => p.isAlkanes)).toBe(true);
  });
});
