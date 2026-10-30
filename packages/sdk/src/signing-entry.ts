// `@yakfeed/sdk/signing`: verifying what yakfeed signs (the skill, the agent brief, key
// rotation notices), the skill's deterministic archive and manifest, production's public keys,
// and where an agent keeps what it pinned. Node only.
export * from "./signing.js";
export * from "./skill-archive.js";
export * from "./skill-release.js";
export * from "./trust-store.js";
export * from "./signing-client.js";
export { buildVectors, runVector } from "./signing-vectors.js";
export type { SigningVector, VectorSeeds } from "./signing-vectors.js";
