const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

const hashValue = (value) => {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
};

const compareHash = (value, hash) => hashValue(value) === hash;

const encryptValue = (value) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(JWT_SECRET).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value)), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptValue = (value) => {
  const [ivHex, encryptedHex] = String(value).split(':');
  if (!ivHex || !encryptedHex) return null;

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(JWT_SECRET).digest(), iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};

const signToken = (payload) => {
  const basePayload = {
    ...payload,
    role: payload?.role || 'user',
  };

  return jwt.sign(basePayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

module.exports = {
  hashValue,
  compareHash,
  encryptValue,
  decryptValue,
  signToken,
  verifyToken,
};
