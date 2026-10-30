// yakfeed's production public keys, bundled so a pinned copy never depends on
// yakfeed.com being honest. The same keys are in github.com/yakfeed/yak, in the npm packages and
// in DNS (TXT at _yakfeed-keys.yakfeed.com), and in infra/aws/envs/signing/keys.tf; a test
// keeps the four in step. Empty until the key ceremony: the
// signing key's public half comes from KMS, the recovery key's from the owner's own machine.
// A new key arrives here only with a rotation notice signed by the recovery key.
import type { Keyset } from "./signing.js";

/** The production API host: the `origin` every production statement names. */
export const PRODUCTION_ORIGIN = "api.yakfeed.com";

export const PRODUCTION_KEYSET: Keyset = {
  origin: PRODUCTION_ORIGIN,
  production: true,
  signingKeys: [],
  recoveryKeys: [],
};
