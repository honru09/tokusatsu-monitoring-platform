import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createSign,
  hkdfSync,
  randomBytes,
  type ECDH,
} from "node:crypto";

/**
 * Web Push protocol pieces built on Node's crypto only (RFC 8291 message
 * encryption, RFC 8188 aes128gcm content coding, RFC 8292 VAPID). The
 * `web-push` package is not in the offline dependency store, and this
 * surface is small enough to carry directly instead of adding a
 * dependency that cannot be installed or audited here.
 */

export function base64UrlEncode(value: Buffer): string {
  return value.toString("base64url");
}

export function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function publicKeyCoordinates(publicKey: Buffer): { x: Buffer; y: Buffer } {
  // Uncompressed P-256 point: 0x04 || x (32) || y (32).
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("expected an uncompressed P-256 public key");
  }
  return { x: publicKey.subarray(1, 33), y: publicKey.subarray(33, 65) };
}

function senderFromPrivateKey(privateKey: Buffer): ECDH {
  const sender = createECDH("prime256v1");
  sender.setPrivateKey(privateKey);
  return sender;
}

/**
 * Signed VAPID JWT (ES256) for one push endpoint. The private key is the
 * raw base64url scalar handed out by `web-push generate-vapid-keys`; the
 * matching public key supplies the JWK coordinates the signature needs.
 */
export function createVapidJwt(input: {
  endpoint: string;
  subject: string;
  privateKey: string;
  publicKey: string;
  /** Seconds from now until expiry; push services cap this at 24h. */
  expiresInSeconds?: number;
  nowSeconds?: number;
}): string {
  const audience = new URL(input.endpoint).origin;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const payload = base64UrlEncode(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: now + (input.expiresInSeconds ?? 12 * 60 * 60),
        sub: input.subject,
      }),
    ),
  );
  const privateScalar = base64UrlDecode(input.privateKey);
  const { x, y } = publicKeyCoordinates(base64UrlDecode(input.publicKey));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  // ieee-p1363 gives the raw R||S form JWS requires instead of DER.
  const signature = signer.sign({
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(x),
      y: base64UrlEncode(y),
      d: base64UrlEncode(privateScalar),
    },
    format: "jwk",
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}

function deriveKeyMaterial(input: {
  ecdhSecret: Buffer;
  authSecret: Buffer;
  receiverPublicKey: Buffer;
  senderPublicKey: Buffer;
  salt: Buffer;
}): { cek: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    input.receiverPublicKey,
    input.senderPublicKey,
  ]);
  const ikm = Buffer.from(
    hkdfSync("sha256", input.ecdhSecret, input.authSecret, keyInfo, 32),
  );
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      input.salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      input.salt,
      Buffer.from("Content-Encoding: nonce\0"),
      12,
    ),
  );
  return { cek, nonce };
}

const RECORD_SIZE = 4096;

/**
 * Encrypt one push payload for a subscription. Single record only: push
 * payloads here are a short JSON notification, far below one record.
 * `salt` / `senderPrivateKey` are injectable for tests.
 */
export function encryptPushPayload(input: {
  payload: string | Buffer;
  p256dh: string;
  auth: string;
  salt?: Buffer;
  senderPrivateKey?: Buffer;
}): Buffer {
  const receiverPublicKey = base64UrlDecode(input.p256dh);
  const authSecret = base64UrlDecode(input.auth);
  const salt = input.salt ?? randomBytes(16);
  const sender = input.senderPrivateKey
    ? senderFromPrivateKey(input.senderPrivateKey)
    : createECDH("prime256v1");
  if (!input.senderPrivateKey) sender.generateKeys();
  const senderPublicKey = sender.getPublicKey(
    null,
    "uncompressed",
  ) as Buffer;
  const ecdhSecret = sender.computeSecret(receiverPublicKey);
  const { cek, nonce } = deriveKeyMaterial({
    ecdhSecret,
    authSecret,
    receiverPublicKey,
    senderPublicKey,
    salt,
  });
  const plaintext = Buffer.concat([
    Buffer.isBuffer(input.payload)
      ? input.payload
      : Buffer.from(input.payload),
    // Final-record delimiter; no extra padding.
    Buffer.from([0x02]),
  ]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.alloc(16 + 4 + 1 + senderPublicKey.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublicKey.length, 20);
  senderPublicKey.copy(header, 21);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

/** Inverse of encryptPushPayload, for the round-trip test. */
export function decryptPushPayload(input: {
  body: Buffer;
  receiverPrivateKey: Buffer;
  auth: string;
}): Buffer {
  const salt = input.body.subarray(0, 16);
  const keyLength = input.body.readUInt8(20);
  const senderPublicKey = input.body.subarray(21, 21 + keyLength) as Buffer;
  const ciphertext = input.body.subarray(21 + keyLength);
  const receiver = senderFromPrivateKey(input.receiverPrivateKey);
  const receiverPublicKey = receiver.getPublicKey(
    null,
    "uncompressed",
  ) as Buffer;
  const ecdhSecret = receiver.computeSecret(senderPublicKey);
  const { cek, nonce } = deriveKeyMaterial({
    ecdhSecret,
    authSecret: base64UrlDecode(input.auth),
    receiverPublicKey,
    senderPublicKey,
    salt,
  });
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const decrypted = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // Strip zero padding, then the record delimiter byte.
  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0) end -= 1;
  if (end === 0 || (decrypted[end - 1] !== 0x01 && decrypted[end - 1] !== 0x02)) {
    throw new Error("push payload is missing its record delimiter");
  }
  return decrypted.subarray(0, end - 1);
}

/** A fresh P-256 keypair for tests / receiver fixtures. */
export function generatePushKeyPair(): {
  privateKey: Buffer;
  publicKey: Buffer;
  auth: Buffer;
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(null, "uncompressed") as Buffer,
    auth: randomBytes(16),
  };
}
