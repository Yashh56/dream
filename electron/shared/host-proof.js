// Domain-separated bytes shared by the host signer and native route verifier.
// A fresh nonce proves possession of the installation key on this TLS channel.
export const hostProofMessage = ({ nonce, audience, host }) =>
  JSON.stringify([
    "dream-host-proof-v1",
    nonce,
    audience,
    host.hostId,
    host.fingerprint,
    host.publicKey,
    host.hostProtocolVersion,
  ]);
