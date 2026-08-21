const prisma = require('../../config/prisma');
const config = require('../../config/env');
const { badRequest, conflict, notFound } = require('../../utils/errors');
const storageService = require('../storageService');

/**
 * The document side of a patent: getting bytes into storage and back out.
 *
 * Documents never pass through this API. A client asks for a presigned URL,
 * PUTs directly to storage, and hands back the key. Everything here exists to
 * make that safe, since the upload itself happens where we cannot see it.
 */

/**
 * Confirms an uploaded object exists, was issued to this caller, is not
 * already spoken for, and is within the size limit.
 *
 * `allowPatentId` exempts the patent that already owns the key, so re-sending
 * an unchanged `documentKey` in a PATCH is not treated as a collision.
 */
const verifyDocument = async (objectKey, userId, { allowPatentId = null } = {}) => {
  if (!storageService.keyBelongsToUser(objectKey, userId)) {
    throw badRequest('documentKey was not issued to you; request one from POST /patents/uploads');
  }

  // One document, one patent. Two patents sharing a key makes deletion unsafe:
  // deleting the draft would destroy the object the approved patent still
  // points at. The column is unique, but checking here turns a raw constraint
  // violation into an explanatory 409.
  const attached = await prisma.patent.findUnique({
    where: { documentKey: objectKey },
    select: { id: true },
  });

  if (attached && attached.id !== allowPatentId) {
    throw conflict('That document is already attached to another patent');
  }

  const head = await storageService.headObject(objectKey);

  if (!head) {
    throw badRequest('No uploaded document found for that documentKey');
  }

  // Size is checked here rather than on the presigned URL because a presigned
  // PUT cannot express a maximum content length. This is the first moment we
  // can know how big the object actually is.
  if (head.size > config.storage.maxUploadBytes) {
    await storageService.deleteObject(objectKey);
    throw badRequest(
      `Uploaded document is ${head.size} bytes; the maximum is ${config.storage.maxUploadBytes}`,
    );
  }

  return head;
};

const requestUpload = ({ filename, contentType }, user) =>
  storageService.presignUpload({ userId: user.userId, filename, contentType });

const presignDownload = async (patent) => {
  if (!patent.documentKey) throw notFound('This patent has no attached document');

  return {
    downloadUrl: await storageService.presignDownload(patent.documentKey),
    expiresAt: new Date(Date.now() + config.storage.downloadUrlTtlSeconds * 1000),
  };
};

/**
 * Best effort, and deliberately not awaited for correctness: the database is
 * the source of truth, so a leftover object is a storage cost rather than an
 * inconsistency. Failures are logged inside storageService.
 */
const discardObject = (objectKey) => storageService.deleteObject(objectKey);

module.exports = { verifyDocument, requestUpload, presignDownload, discardObject };
