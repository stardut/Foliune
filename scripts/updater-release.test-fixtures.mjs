import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export function signedFixture(version, contents = 'Foliune test archive', keyPair = generateKeyPairSync('ed25519')) {
  const { privateKey, publicKey } = keyPair;
  const rawPublicKey = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const keyId = createHash('sha256').update(rawPublicKey).digest().subarray(0, 8);
  const payload = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64');
  const archive = Buffer.from(contents);
  const rawSignature = sign(null, createHash('blake2b512').update(archive).digest(), privateKey);
  const signaturePayload = Buffer.concat([Buffer.from('ED'), keyId, rawSignature]).toString('base64');
  const trustedComment = `timestamp:0\tfile:Foliune.app.tar.gz\tversion:${version}`;
  const globalSignature = sign(null, Buffer.concat([rawSignature, Buffer.from(trustedComment)]), privateKey);
  return {
    archive,
    publicKey: Buffer.from(`untrusted comment: test key\n${payload}\n`).toString('base64'),
    signature: Buffer.from(`untrusted comment: test signature\n${signaturePayload}\ntrusted comment: ${trustedComment}\n${globalSignature.toString('base64')}\n`).toString('base64'),
  };
}
