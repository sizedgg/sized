/**
 * Minimales HS256-JWT, signiert mit dem Supabase-JWT-Secret.
 *
 * Damit akzeptieren PostgREST und Realtime das Token wie ein reguläres
 * Supabase-Auth-Token – nur dass die Identität hier nicht E-Mail oder OAuth
 * ist, sondern die per Zahlung nachgewiesene Wallet im Claim "wallet".
 */

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface WalletClaims {
  wallet: string;
  isAdmin: boolean;
  ttlSeconds: number;
  /**
   * Zeitpunkt der ersten Anmeldung (Unix-Sekunden). Bleibt über alle
   * Verlängerungen hinweg gleich und begrenzt so, wie lange eine Wallet ohne
   * neue Zahlung im Umlauf bleiben kann.
   */
  origIat?: number;
}

export async function signWalletJwt(secret: string, claims: WalletClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    // Von Supabase erwartete Felder
    aud: 'authenticated',
    role: 'authenticated',
    sub: claims.wallet,
    iat: now,
    exp: now + claims.ttlSeconds,
    // Eigene Felder – `wallet` wird in den RLS-Policies ausgewertet
    wallet: claims.wallet,
    is_admin: claims.isAdmin,
    oiat: claims.origIat ?? now,
    app_metadata: { provider: 'solana-payment' },
  };

  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

const fromB64url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/**
 * Prüft Signatur und Ablauf und gibt die Wallet zurück – oder null.
 * Nie den Payload ohne diese Prüfung verwenden: er ist nur Base64, nicht
 * verschlüsselt, und lässt sich sonst beliebig fälschen.
 */
export async function verifyWalletJwt(
  secret: string,
  token: string,
): Promise<{ wallet: string; isAdmin: boolean; origIat: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC', key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.wallet !== 'string' || !payload.wallet) return null;
    return {
      wallet: payload.wallet,
      isAdmin: payload.is_admin === true,
      origIat: Number(payload.oiat) || Number(payload.iat) || 0,
    };
  } catch {
    return null;
  }
}
