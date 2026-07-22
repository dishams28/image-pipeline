/**
 * Computes the Hamming distance between two equal-length hex-encoded
 * bit strings (used to compare perceptual image hashes).
 */
function hammingDistanceHex(hexA, hexB) {
  if (hexA.length !== hexB.length) {
    throw new Error('Hash length mismatch');
  }
  let distance = 0;
  for (let i = 0; i < hexA.length; i++) {
    const a = parseInt(hexA[i], 16);
    const b = parseInt(hexB[i], 16);
    let xor = a ^ b;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

module.exports = { hammingDistanceHex };
