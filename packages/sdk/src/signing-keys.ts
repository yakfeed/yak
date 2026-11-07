// yakfeed's production public keys, bundled so a pinned copy never depends on
// yakfeed.com being honest. The same keys are in github.com/yakfeed/yak, in the npm packages and
// in DNS (TXT at _yakfeed-keys.yakfeed.com), and in yakfeed's infrastructure; a test keeps them
// in step. They came from the key ceremony: the signing key's public half from KMS, the recovery
// key's from the owner's own machine.
// A new key arrives here only with a rotation notice signed by the recovery key.
import type { Keyset } from "./signing.js";

/** The production API host: the `origin` every production statement names. */
export const PRODUCTION_ORIGIN = "api.yakfeed.com";

export const PRODUCTION_KEYSET: Keyset = {
  origin: PRODUCTION_ORIGIN,
  production: true,
  signingKeys: [{ id: "yk-80c19631947f0af1", alg: "ed25519", publicKey: "fQtPL1vbVjaIIdmRduU/JCU84Q2ymnm1n38TBDGo/zI=", notBefore: "2026-11-03T00:00:00.000Z" }],
  recoveryKeys: [{ id: "yk-6b208b2f98b67437", alg: "ed25519", publicKey: "JBR4BwilUtJaP0y2G6fSHOoItDN2UjzUPwwjyjW3OL4=", notBefore: "2026-11-03T00:00:00.000Z" }],
};
