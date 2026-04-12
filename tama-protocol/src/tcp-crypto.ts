// Direct port of TAMA_NEW/GhostCapture/TcpCrypto.cs.
//
// The SECRET is not a secret worth guarding -- it is already committed in the
// C# reference, baked into every Paradise firmware, and documented in
// TAMA_NEW/tama-para-research/protocols/. Inline it.

const TCP_SECRET_TEXT = "SPqREQqtuhvgJuRexqMfG8FzstAgmnf7";
const encoder = new TextEncoder();

export const TCP_SECRET: Uint8Array = encoder.encode(TCP_SECRET_TEXT);

// keystream = SHA-256(nonce || SECRET)
// Each call mutates a fresh keystream copy; state does NOT persist across calls,
// so passive observers can decrypt any complete chunk independently.
export async function tcpCrypt(nonce: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (nonce.length === 0) throw new Error("nonce must not be empty");
  if (data.length === 0) return new Uint8Array();

  const seed = new Uint8Array(nonce.length + TCP_SECRET.length);
  seed.set(nonce, 0);
  seed.set(TCP_SECRET, nonce.length);

  const digest = await crypto.subtle.digest("SHA-256", seed as BufferSource);
  const keystream = new Uint8Array(digest);

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const k = i % keystream.length;
    const key = keystream[k] ?? 0;
    const src = data[i] ?? 0;
    out[i] = (src ^ key) & 0xff;
    keystream[k] = ((key * 2 + 1) & 0xff);
  }
  return out;
}
