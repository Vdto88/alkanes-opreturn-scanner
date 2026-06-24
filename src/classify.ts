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
  isDieselMint: boolean; // cellpack target 2:0 opcode 77 (mint do genesis alkane DIESEL)
}

const DIESEL_BLOCK = 2n;
const DIESEL_TX = 0n;
const DIESEL_MINT_OPCODE = 77n;

/** Classifica uma tx pelos scriptPubKeys dos vouts. Pura, offline.
 *  OP_RETURN = prefixo 6a; runestone = 6a5d; Alkanes = decodeOpReturn com
 *  algum protostone protocol_tag=1. Bytes = len(scriptpubkey)/2. */
export function classifyTx(vouts: Vout[]): TxClass {
  let hasOpReturn = false;
  let hasRunestone = false;
  let isAlkanes = false;
  let decodeFailed = false;
  let isDieselMint = false;
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
      if (r.protostones.some((p) => p.isAlkanes && p.cellpack
        && p.cellpack.target.block === DIESEL_BLOCK && p.cellpack.target.tx === DIESEL_TX
        && p.cellpack.opcode === DIESEL_MINT_OPCODE)) {
        isDieselMint = true;
      }
    } catch {
      decodeFailed = true;
    }
  });

  return { hasOpReturn, opReturnBytes, hasRunestone, isAlkanes, alkanesBytes, decodeFailed, isDieselMint };
}
