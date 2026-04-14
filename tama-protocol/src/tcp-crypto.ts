// Direct port of TAMA_NEW/GhostCapture/TcpCrypto.cs.
//
// PARADISE_TCP_KEY is the firmware-side encryption key burned into every
// Tamagotchi Paradise device. It is published in cyanic's reverse-engineering
// writeups, hardcoded in tama-cli/data/secrets.py, and required client-side
// here because we cannot decode the byte-log stream without it. It is a
// PROTOCOL CONSTANT, not a credential. Do not treat its presence in the JS
// bundle as a leak — there is no version of this code that does not ship it.

const PARADISE_TCP_KEY_TEXT = "SPqREQqtuhvgJuRexqMfG8FzstAgmnf7";
const encoder = new TextEncoder();

export const PARADISE_TCP_KEY: Uint8Array = encoder.encode(PARADISE_TCP_KEY_TEXT);

// keystream = SHA-256(nonce || SECRET)
// Each call mutates a fresh keystream copy; state does NOT persist across calls,
// so passive observers can decrypt any complete chunk independently.
export async function tcpCrypt(nonce: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (nonce.length === 0) throw new Error("nonce must not be empty");
  if (data.length === 0) return new Uint8Array();

  const seed = new Uint8Array(nonce.length + PARADISE_TCP_KEY.length);
  seed.set(nonce, 0);
  seed.set(PARADISE_TCP_KEY, nonce.length);

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
