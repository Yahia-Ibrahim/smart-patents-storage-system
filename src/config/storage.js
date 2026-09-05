const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./env');

/**
 * The S3 client, behind a setter.
 *
 * `setStorageClient` exists for tests. Without it every patent test would need
 * a live MinIO, which is the fastest way to end up with a suite nobody runs.
 * The service layer always reads through `getStorageClient()` so a fake can be
 * swapped in for the whole process.
 *
 * MinIO is S3-compatible, so the AWS SDK is used rather than the `minio`
 * package: moving to real S3 later is then a config change, not a rewrite.
 */

let client = null;
let presignClient = null;

const build = (endpoint) =>
  new S3Client({
    endpoint,
    region: config.storage.region,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
    // Required for presigned PUTs.
    //
    // Since v3.729 the SDK computes a flexible checksum by default, and when
    // presigning it bakes `x-amz-checksum-crc32` into the signed query — with
    // the CRC32 of an *empty* body, because at signing time there is no body.
    // The client then uploads real bytes whose checksum does not match.
    // MinIO currently lets that slide; S3 rejects it. WHEN_REQUIRED keeps the
    // checksum off unless the operation genuinely needs one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

/** The client this process makes real calls with: head, delete, bucket checks. */
const getStorageClient = () => {
  if (!client) client = build(config.storage.endpoint);
  return client;
};

/**
 * The client used to *sign* URLs somebody else will follow.
 *
 * SigV4 signs the host, so the endpoint baked into a presigned URL has to be
 * the one the eventual caller can actually reach. In compose that is not the
 * one this process uses -- see `publicEndpoint` in config/env.js. When the two
 * are the same, which is the common case, this is the same client and there is
 * no second connection pool.
 */
const getPresignClient = () => {
  if (config.storage.publicEndpoint === config.storage.endpoint) return getStorageClient();

  if (!presignClient) presignClient = build(config.storage.publicEndpoint);

  return presignClient;
};

/**
 * Substitutes both clients at once. Tests get one fake and it covers signing
 * and calling alike; a fake that only replaced one of them would leave the
 * other quietly dialling a real endpoint.
 */
const setStorageClient = (replacement) => {
  client = replacement;
  presignClient = replacement;
};

module.exports = { getStorageClient, getPresignClient, setStorageClient };
