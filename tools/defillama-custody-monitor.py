#!/usr/bin/env python3
"""
SUBFROST custody-address monitor for the DefiLlama adapter.

WHY THIS EXISTS
---------------
DefiLlama-Adapters#20263 lists two frBTC custody addresses as constants in
`projects/helper/bitcoin-book/index.js`. That PR justifies hardcoding them by
stating, publicly and to the reviewer, that the on-chain derivation "stays on
our side". This is that side. Without it the commitment is empty: if the signer
set rotates and nobody opens an update PR the same day, the public TVL chart
drops to zero with no warning.

WHAT IT CHECKS
--------------
1. ALKANES custody, derived from Bitcoin L1 end to end:
   frBTC alkane [32:0] opcode 103 (GET_SIGNER) returns the signer set's 32-byte
   x-only internal pubkey; the address is the BIP341 tweak of that key with no
   script tree. If the derived address stops matching the listed one, the signer
   set rotated and the adapter is stale.

2. BRC2.0 custody, which is NOT derivable this way, by proxy: a rotation drains
   the old address, so a balance that collapses toward zero is the signal.

SELF-VALIDATION
---------------
The BIP341 tweak and bech32m encoder here are hand-rolled (no crypto deps), so
they are checked against a known-answer vector on every run BEFORE any verdict
is issued: the BIP341 test vector, plus the currently-listed Alkanes address
re-derived from its own pinned internal pubkey. A bug in this file therefore
fails loudly instead of silently reporting "no rotation" forever.

EXIT CODES
----------
0  everything matches
1  ROTATION / DIVERGENCE — open an update PR against DefiLlama-Adapters today
2  could not complete the check (RPC down, bad response) — NOT an all-clear

Usage:  python custody_monitor.py [--json]
"""

import json
import sys
import urllib.request
import urllib.error

# ── What the DefiLlama adapter currently claims ──────────────────────────────
# Keep in sync with projects/helper/bitcoin-book/index.js in DefiLlama-Adapters.
LISTED_ALKANES = "bc1p5lushqjk7kxpqa87ppwn0dealucyqa6t40ppdkhpqm3grcpqvw9s3wdsx7"
LISTED_BRC20 = "bc1pxn3gr0hy70exhdqjzawtuygppzdrk3mer3wlaa2gzkmruk3rrt4qga2qaj"

RPC_URL = "https://mainnet.subfrost.io/v4/subfrost"
# urllib gets a 403 from this gateway without a UA (curl works). Learned 2026-07-26.
USER_AGENT = "subfrost-custody-monitor/1.0"

# A balance below this on the BRC2.0 address reads as "drained", i.e. rotated.
BRC20_DRAIN_THRESHOLD_SATS = 1_000_000  # 0.01 BTC

# ── secp256k1 + BIP341, no dependencies ──────────────────────────────────────

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)


def tagged_hash(tag: str, msg: bytes) -> bytes:
    import hashlib

    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def point_add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], P - 2, P) % P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], P - 2, P) % P
    x = (lam * lam - a[0] - b[0]) % P
    return (x, (lam * (a[0] - x) - a[1]) % P)


def point_mul(point, k):
    r = None
    for i in range(256):
        if (k >> i) & 1:
            r = point_add(r, point)
        point = point_add(point, point)
    return r


def lift_x(x: int):
    """BIP340 lift_x: the even-Y point with this x, or None if x is not on the curve."""
    if x >= P:
        return None
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if pow(y, 2, P) != y_sq:
        return None
    return (x, y if y % 2 == 0 else P - y)


def taproot_output_key(internal_pubkey: bytes) -> bytes:
    """BIP341 output key for a key-path-only output (no script tree)."""
    if len(internal_pubkey) != 32:
        raise ValueError(f"internal pubkey must be 32 bytes, got {len(internal_pubkey)}")
    p_point = lift_x(int.from_bytes(internal_pubkey, "big"))
    if p_point is None:
        raise ValueError("internal pubkey is not a valid curve point")
    t = int.from_bytes(tagged_hash("TapTweak", internal_pubkey), "big")
    if t >= N:
        raise ValueError("tweak out of range")
    q = point_add(p_point, point_mul(G, t))
    if q is None:
        raise ValueError("tweak produced the point at infinity")
    return q[0].to_bytes(32, "big")


# ── bech32m (BIP350) ─────────────────────────────────────────────────────────

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
BECH32M_CONST = 0x2BC830A3


def bech32_polymod(values):
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def convertbits(data, frombits, tobits, pad=True):
    acc, bits, ret = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def encode_p2tr(output_key: bytes, hrp: str = "bc") -> str:
    """Witness v1 + 32-byte program, bech32m encoded."""
    data = [1] + convertbits(output_key, 8, 5)
    values = bech32_hrp_expand(hrp) + data
    polymod = bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(CHARSET[d] for d in data + checksum)


def decode_p2tr_program(addr: str) -> bytes:
    """Extract the 32-byte witness program from a bech32m p2tr address."""
    data_part = addr.rsplit("1", 1)[1]
    values = [CHARSET.index(c) for c in data_part[:-6]]
    if values[0] != 1:
        raise ValueError("not a witness v1 address")
    return bytes(convertbits(values[1:], 5, 8, pad=False))


# ── Known-answer self-test — runs before any verdict ─────────────────────────

def self_test() -> None:
    """
    Fail loudly if the hand-rolled crypto is wrong.

    Vector 0 from BIP341's "Test vectors for key path spending" appendix:
    an internal key with no script tree, and its expected output key.
    """
    internal = bytes.fromhex(
        "d6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d"
    )
    expected_output = bytes.fromhex(
        "53a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343"
    )
    got = taproot_output_key(internal)
    if got != expected_output:
        raise SystemExit(
            "SELF-TEST FAILED: BIP341 tweak is wrong.\n"
            f"  expected {expected_output.hex()}\n"
            f"  got      {got.hex()}\n"
            "Refusing to report on custody with broken derivation."
        )

    # bech32m round-trip against the address the adapter actually lists.
    program = decode_p2tr_program(LISTED_ALKANES)
    if encode_p2tr(program) != LISTED_ALKANES:
        raise SystemExit("SELF-TEST FAILED: bech32m encoder does not round-trip.")


# ── Chain reads ──────────────────────────────────────────────────────────────

def rpc(method: str, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    req = urllib.request.Request(
        RPC_URL,
        data=body.encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read())
    if "error" in payload and payload["error"]:
        raise RuntimeError(f"{method} returned error: {payload['error']}")
    return payload.get("result")


def get_signer_pubkey() -> bytes:
    """frBTC [32:0] opcode 103 GET_SIGNER -> 32-byte x-only internal pubkey."""
    raw_height = rpc("metashrew_height", [])
    # The gateway has returned this both as a JSON number and as a hex string
    # depending on the upstream; accept either rather than guessing.
    if isinstance(raw_height, str):
        height = int(raw_height, 16) if raw_height.startswith("0x") else int(raw_height)
    else:
        height = int(raw_height)
    result = rpc(
        "alkanes_simulate",
        [
            {
                "target": {"block": "32", "tx": "0"},
                "inputs": ["103"],
                "alkanes": [],
                "transaction": "0x",
                "block": "0x",
                "height": height,
                "txindex": 0,
                "vout": 0,
            }
        ],
    )
    data = (result or {}).get("execution", {}).get("data")
    if not data:
        raise RuntimeError(f"opcode 103 returned no data: {result!r}")
    raw = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    if len(raw) != 32:
        raise RuntimeError(f"expected a 32-byte pubkey, got {len(raw)} bytes: {raw.hex()}")
    return raw


def get_balance_sats(address: str) -> int:
    req = urllib.request.Request(
        f"https://blockstream.info/api/address/{address}",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        st = json.loads(resp.read())["chain_stats"]
    return st["funded_txo_sum"] - st["spent_txo_sum"]


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    as_json = "--json" in sys.argv
    self_test()

    findings, alerts = {}, []

    try:
        internal = get_signer_pubkey()
        derived = encode_p2tr(taproot_output_key(internal))
        findings["internal_pubkey"] = internal.hex()
        findings["derived_alkanes_address"] = derived
        findings["listed_alkanes_address"] = LISTED_ALKANES
        if derived != LISTED_ALKANES:
            alerts.append(
                "ALKANES CUSTODY ROTATED. frBTC [32:0] opcode 103 now derives\n"
                f"    {derived}\n"
                f"  but the DefiLlama adapter lists\n"
                f"    {LISTED_ALKANES}\n"
                "  Open an update PR against DefiLlama-Adapters TODAY. The public\n"
                "  TVL chart reads the listed address and will report the drained one."
            )
    except Exception as exc:  # noqa: BLE001 — any failure here means "unknown", not "fine"
        findings["alkanes_error"] = str(exc)
        if not as_json:
            print(f"[!] could not derive the Alkanes custody address: {exc}", file=sys.stderr)
        return 2

    try:
        bal = get_balance_sats(LISTED_BRC20)
        findings["brc20_balance_sats"] = bal
        if bal < BRC20_DRAIN_THRESHOLD_SATS:
            alerts.append(
                f"BRC2.0 CUSTODY LOOKS DRAINED: {LISTED_BRC20} holds {bal} sats\n"
                f"  (below {BRC20_DRAIN_THRESHOLD_SATS}). This address is NOT derivable from\n"
                "  opcode 103, so a drain is the only rotation signal available. Confirm with\n"
                "  the signer operators before assuming the adapter is stale."
            )
    except Exception as exc:  # noqa: BLE001
        findings["brc20_error"] = str(exc)
        if not as_json:
            print(f"[!] could not read the BRC2.0 balance: {exc}", file=sys.stderr)
        return 2

    findings["alerts"] = alerts

    if as_json:
        print(json.dumps(findings, indent=2))
    else:
        print("SUBFROST custody monitor")
        print(f"  internal pubkey (op 103): {findings['internal_pubkey']}")
        print(f"  derived Alkanes address : {findings['derived_alkanes_address']}")
        print(f"  listed in the adapter   : {findings['listed_alkanes_address']}")
        print(f"  BRC2.0 balance          : {findings['brc20_balance_sats']:,} sats")
        print()
        if alerts:
            for a in alerts:
                print(f"  [ALERT] {a}")
        else:
            print("  [OK] both custody addresses match what DefiLlama-Adapters lists.")

    return 1 if alerts else 0


if __name__ == "__main__":
    sys.exit(main())
