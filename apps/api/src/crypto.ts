import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

let key: Buffer | undefined;

/** AES-256-GCM key from SWARM_KMS_KEY (base64, 32 bytes). Without it, a per-process random key: credentials then only live as long as the process, which is enough for a run. */
export function kmsKey(): Buffer {
  if (key) return key;
  const b64 = process.env.SWARM_KMS_KEY?.trim();
  if (b64) {
    const k = Buffer.from(b64, "base64");
    // A 32-byte base64 key is used as-is; any other secret (e.g. Render's generateValue) is stretched with SHA-256.
    key = k.length === 32 ? k : createHash("sha256").update(b64).digest();
  } else {
    key = randomBytes(32);
    console.warn("[swarm-api] SWARM_KMS_KEY not set; using an ephemeral key (bring-your-own credentials will not survive a restart)");
  }
  return key;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kmsKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T = unknown>(blob: string): T | undefined {
  try {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", kmsKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}
