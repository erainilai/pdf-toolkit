import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const LOCAL_ROOT = resolve(join(DATA_DIR, 'storage'));
const S3_BUCKET = process.env.S3_BUCKET;

/** Keys are server-generated (jobs/<id>/input|output/<n>-<name>); sanitize the
 *  user-controlled filename segment so it can never escape the storage root. */
export function sanitizeKeySegment(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
}

let s3Client;
async function getS3() {
  if (!s3Client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3Client = new S3Client({ region: process.env.S3_REGION || 'us-east-1' });
  }
  return s3Client;
}

function localPathFor(key) {
  const full = resolve(join(LOCAL_ROOT, key));
  if (!(full + sep).startsWith(LOCAL_ROOT + sep) && full !== LOCAL_ROOT) {
    throw new Error('Invalid storage key');
  }
  return full;
}

export async function putObject(key, buffer) {
  if (S3_BUCKET) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getS3();
    await client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer }));
    return key;
  }
  const path = localPathFor(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  return key;
}

export async function getObject(key) {
  if (S3_BUCKET) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getS3();
    const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return readFile(localPathFor(key));
}

export function storageBackend() {
  return S3_BUCKET ? `s3://${S3_BUCKET}` : `local:${LOCAL_ROOT}`;
}
