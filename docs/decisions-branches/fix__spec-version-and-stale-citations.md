← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:31 - Declare SPEC 2.0 once: spec-version marker, notary bundle, and --version (#277, #267, #278)

**Reasoning:** Three markers disagreed about which document we implement: review-writeback emitted '0.1.0' under the key 'protocol-version', notary-bundle stamped '1.2.0' citing a pre-rewrite SPEC 10.3.3 that no longer exists, and --version printed a bare npm semver. SPEC 4.3 names the key spec-version and defines it as the version of the document the producer implements; 7.1 requires every place the version appears to agree; 7.3 requires the two-line declaration that 5.3 routes contract changes from. All three now derive from one SPEC_VERSION constant. Also renumbered the four user-visible pre-rewrite citations in CLI help and stderr.

**Alternatives considered:** Rename the notary bundle's protocol_version JSON key to spec_version as well. Rejected: it is the wire contract with a deployed notary, SPEC 4.3 governs the review COMMENT rather than the bundle, and the rename buys nothing while risking a skew break. Only the VALUE changed. Also rejected: deleting the PROTOCOL_VERSION export outright, since clud-bug-app re-exports it and 7.5 says a departing surface keeps working until a major removes it.

**Implications:**
- A PR comment now reads '<!-- spec-version: 2.0.0 -->'. Consumers keying on 'protocol-version' see nothing; a grep of both repos found no such consumer (control-tested). clud-bug --version is now two lines, so anything parsing it as a bare semver must read line 1. areas: orient, work, review, propagate, gates -- record is logmind's and versioning is deliberately unclaimed, since 7.3's own logmind example emits the declaration without claiming it.

---

