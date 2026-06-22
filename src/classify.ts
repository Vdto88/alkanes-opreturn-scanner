import { decodeOpReturn } from '../../opreturn-decoder/src/decode';

export interface Vout {
  scriptpubkey: string;
}

export interface TxClass {
  hasOpReturn: boolean;
  opReturnBytes: number;
  hasRunestone: boolean;
  isAlkanes: boolean;
  alkanesBytes: number;
  decodeFailed: boolean;
}

/** Classifica uma tx pelos scriptPubKeys dos vouts. Pura, offline.
 *  OP_RETURN = prefixo 6a; runestone = 6a5d; Alkanes = decodeOpReturn com
 *  algum protostone protocol_tag=1. Bytes = len(scriptpubkey)/2. */
export function classifyTx(vouts: Vout[]): TxClass {
  let hasOpReturn = false;
  let hasRunestone = false;
  let isAlkanes = false;
  let decodeFailed = false;
  let opReturnBytes = 0;
  let alkanesBytes = 0;

  vouts.forEach((v, i) => {
    const spk = v.scriptpubkey.toLowerCase();
    if (!spk.startsWith('6a')) return;
    hasOpReturn = true;
    const bytes = spk.length / 2;
    opReturnBytes += bytes;
    if (!spk.startsWith('6a5d')) return;
    hasRunestone = true;
    try {
      const r = decodeOpReturn(spk, i);
      if (r.protostones.some((p) => p.isAlkanes)) {
        isAlkanes = true;
        alkanesBytes += bytes;
      }
    } catch {
      decodeFailed = true;
    }
  });

  return { hasOpReturn, opReturnBytes, hasRunestone, isAlkanes, alkanesBytes, decodeFailed };
}
