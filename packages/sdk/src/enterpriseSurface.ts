/**
 * Community build: no Enterprise-licensed exports.
 *
 * Swapped over enterpriseSurface.ts by scripts/community-exclude.txt. The
 * Community SDK still records at decision grain — what is absent is H1
 * byte-exact environment capture and H3 deep replay, both of which need the
 * commercially licensed modules this file deliberately does not import.
 */
export {};
