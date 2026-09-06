const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Dekodiert Base58 zu Bytes. Wirft bei ungültigen Zeichen. */
export function decodeBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = MAP.get(ch);
    if (value === undefined) throw new Error(`Ungültiges Base58-Zeichen: ${ch}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Der Akkumulator startet mit einer 0; überzählige Nullbytes am oberen Ende
  // gehören nicht zum Wert und müssen weg, bevor die echten führenden
  // Nullbytes (jedes '1' im Input) ergänzt werden.
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/** Kodiert Bytes als Base58. */
export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // Führende Nullbytes zählen und aus der Umrechnung heraushalten – sie werden
  // am Ende als '1' ergänzt und würden sonst eine überzählige Stelle erzeugen.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * Prüft, ob ein String eine gültige Solana-Adresse ist: Base58 und exakt
 * 32 Byte. Das schließt Tippfehler und injizierte Werte zuverlässig aus.
 */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}
