const crypto = require('crypto');
const path = require('path');
const {
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config/env');
const { getStorageClient } = require('../config/storage');
const { badRequest } = require('../utils/errors');

/**
 * Object storage for patent documents.
 *
 * Uploads go **directly from the client to MinIO** via a presigned PUT; the
 * API only issues the URL and later confirms the object landed. That keeps
 * multi-megabyte bodies off the Node event loop entirely — an Express process
 * streaming uploads is a process not answering anything else.
 *
 * The tradeoff: an upload can succeed while the follow-up POST /patents never
 * arrives, leaving an orphaned object. Accepted for now; a sweeper over
 * unreferenced keys is future work, noted in the README.
 */

const BUCKET = config.storage.bucket;

/**
 * Filenames arrive from clients and end up in an object key. Strip anything
 * that could traverse a path or confuse a downstream consumer, and cap the
 * length so a pathological name cannot blow the key limit.
 */
const sanitiseFilename = (filename) => {
  const base = path.basename(String(filename || 'document'));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return (cleaned || 'document').slice(0, 120);
};

/**
 * Keys are derived server-side, never taken from the request.
 *
 * A client-supplied key is a directory-traversal and overwrite primitive: it
 * would let one user write over another's document by guessing a path. The
 * uuid segment also makes keys unguessable, so a leaked key is the only way to
 * reach an object.
 */
const buildObjectKey = (userId, filename) =>
  `patents/${userId}/${crypto.randomUUID()}/${sanitiseFilename(filename)}`;

/**
 * Ownership is encoded in the key and checked on presign.
 *
 * Without this, a user could hand us any key they had ever seen — including
 * another user's — and have us attach it to their own patent.
 */
const keyBelongsToUser = (objectKey, userId) =>
  typeof objectKey === 'string' && objectKey.startsWith(`patents/${userId}/`);

const ensureBucket = async () => {
  const client = getStorageClient();

  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
      return;
    }
    throw error;
  }
};

const presignUpload = async ({ userId, filename, contentType }) => {
  if (!config.storage.allowedUploadTypes.includes(contentType)) {
    throw badRequest(
      `Unsupported content type "${contentType}". Allowed: ${config.storage.allowedUploadTypes.join(', ')}`,
    );
  }

  await ensureBucket();

  const objectKey = buildObjectKey(userId, filename);

  // ContentType is signed into the URL, so the client cannot upload a
  // different type than it declared. Size is enforced on the way back in
  // (headObject in patentService) because a presigned PUT cannot express a
  // maximum length on its own.
  const uploadUrl = await getSignedUrl(
    getStorageClient(),
    new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, ContentType: contentType }),
    { expiresIn: config.storage.uploadUrlTtlSeconds },
  );

  return {
    uploadUrl,
    objectKey,
    contentType,
    maxBytes: config.storage.maxUploadBytes,
    expiresAt: new Date(Date.now() + config.storage.uploadUrlTtlSeconds * 1000),
  };
};

const presignDownload = async (objectKey) =>
  getSignedUrl(getStorageClient(), new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }), {
    expiresIn: config.storage.downloadUrlTtlSeconds,
  });

/** Returns { size, contentType } for an existing object, or null if absent. */
const headObject = async (objectKey) => {
  try {
    const result = await getStorageClient().send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }),
    );
    return { size: result.ContentLength, contentType: result.ContentType };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
    throw error;
  }
};

/**
 * Best-effort delete. A failure here must not fail the request that triggered
 * it: the database is the source of truth, and a leftover object is a storage
 * cost, not a correctness problem.
 */
const deleteObject = async (objectKey) => {
  if (!objectKey) return;

  try {
    await getStorageClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey }));
  } catch (error) {
    console.error(`Failed to delete object ${objectKey}:`, error.message);
  }
};

const checkHealth = async () => {
  await getStorageClient().send(new HeadBucketCommand({ Bucket: BUCKET }));
};

module.exports = {
  BUCKET,
  buildObjectKey,
  keyBelongsToUser,
  ensureBucket,
  presignUpload,
  presignDownload,
  headObject,
  deleteObject,
  checkHealth,
};
