import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  createVapidJwt,
  decryptPushPayload,
  encryptPushPayload,
  generatePushKeyPair,
} from "./push-crypto.js";

describe("push payload encryption (RFC 8291 aes128gcm)", () => {
  it("round-trips a JSON payload through encrypt and decrypt", () => {
    const receiver = generatePushKeyPair();
    const payload = JSON.stringify({
      title: "搭档分享了新商品",
      body: "共 3 件新商品",
      url: "/?workspace=collaboration",
    });
    const encrypted = encryptPushPayload({
      payload,
      p256dh: base64UrlEncode(receiver.publicKey),
      auth: base64UrlEncode(receiver.auth),
    });
    // Header carries the salt and the sender public key.
    expect(encrypted.length).toBeGreaterThan(21 + 65);
    const decrypted = decryptPushPayload({
      body: encrypted,
      receiverPrivateKey: receiver.privateKey,
      auth: base64UrlEncode(receiver.auth),
    });
    expect(decrypted.toString("utf8")).toBe(payload);
  });

  it("fails to decrypt with the wrong auth secret", () => {
    const receiver = generatePushKeyPair();
    const encrypted = encryptPushPayload({
      payload: "hello",
      p256dh: base64UrlEncode(receiver.publicKey),
      auth: base64UrlEncode(receiver.auth),
    });
    expect(() =>
      decryptPushPayload({
        body: encrypted,
        receiverPrivateKey: receiver.privateKey,
        auth: base64UrlEncode(Buffer.alloc(16, 9)),
      }),
    ).toThrow();
  });
});

describe("VAPID JWT", () => {
  it("signs an ES256 token whose signature verifies against the public key", () => {
    const keyPair = generatePushKeyPair();
    // generate-vapid-keys hands out the private key as the raw scalar and
    // the public key as the uncompressed point, both base64url.
    const privateKey = base64UrlEncode(keyPair.privateKey);
    const publicKey = base64UrlEncode(keyPair.publicKey);
    const token = createVapidJwt({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      subject: "mailto:operator@example.com",
      privateKey,
      publicKey,
      nowSeconds: 1_700_000_000,
    });
    const [header, payload, signature] = token.split(".") as [
      string,
      string,
      string,
    ];
    expect(JSON.parse(base64UrlDecode(header).toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(base64UrlDecode(payload).toString()) as {
      aud: string;
      exp: number;
      sub: string;
    };
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:operator@example.com");
    expect(claims.exp).toBe(1_700_000_000 + 12 * 60 * 60);

    const verifier = createVerify("SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    const x = keyPair.publicKey.subarray(1, 33);
    const y = keyPair.publicKey.subarray(33, 65);
    expect(
      verifier.verify(
        {
          key: {
            kty: "EC",
            crv: "P-256",
            x: base64UrlEncode(x),
            y: base64UrlEncode(y),
          },
          format: "jwk",
          dsaEncoding: "ieee-p1363",
        },
        base64UrlDecode(signature),
      ),
    ).toBe(true);
  });
});
