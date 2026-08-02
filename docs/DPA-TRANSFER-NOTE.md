# Kenya DPA 2019 — Cross-Border Transfer Note (`asset-mgt`)

- **Date:** 2026-07-28 (written at scaffold, per advisor condition in
  [DESIGN.md](DESIGN.md))
- **Scope:** processing of staff personal data outside Kenya by the internal
  IT asset register

## What personal data is processed

Staff records limited to: **name**, **work email**, and **employee reference
number** (`Person.name`, `Person.email`, `Person.employeeRef`), plus asset
assignment history linking a person to equipment. Deliberately excluded: the
schema has **no national-ID column anywhere** (Discovery Brief §7.3) and must
never gain one; `employeeRef` is the organisation's own employee number.
Auth flow additionally processes the staff email for magic-link delivery.

**Auth activity data.** For staff who also have an account, the register holds
two timestamps about the act of signing in. Neither is a new field and neither
is a new transfer — both are written by the authentication mechanism already
described above — but they are recorded here because they are now **displayed**
rather than merely stored, which is the trigger in "Reviewing this note if
scope changes" below:

- `User.emailVerified` — written by the Auth.js adapter on every successful
  magic-link redemption, so in practice it is the time of that person's **last
  sign-in**.
- `VerificationToken.createdAt` — when a magic link was last **issued** for an
  address, held only for links that have not been redeemed (a redeemed link's
  row is deleted). The link token itself is never read for display.

Both are shown on `/admin/users`, and only there, so an IT admin can tell an
account whose invitation never arrived from one nobody has invited yet.
**Retention:** no per-sign-in history is kept — each is a single timestamp,
overwritten in place, and nothing about sign-in activity is written to the
append-only `UserEvent` table, where it would be permanently uncorrectable and
unerasable. Engineering change of 2026-08-02 (issue #11); no legal review is
implied.

## Where it is processed

| Processor | Role                                       | Location                                 |
| --------- | ------------------------------------------ | ---------------------------------------- |
| Vercel    | Application hosting (serverless functions) | `fra1` — Frankfurt, Germany (EU)         |
| Neon      | Postgres database                          | `eu-central-1` — Frankfurt, Germany (EU) |
| Resend    | Auth email (magic links)                   | United States (email delivery)           |

Storage and processing outside Kenya constitute a **transfer of personal data
outside Kenya** under **sections 48–49 of the Data Protection Act, 2019**.

## Safeguards (s. 48(1)(a), s. 49)

- **Minimisation:** only the three staff fields above are stored; no national
  ID, no financial or special-category personal data.
- **Jurisdiction with appropriate safeguards:** primary storage and compute
  are in Germany, subject to the GDPR — a jurisdiction with data-protection
  law materially equivalent to (and stronger than) the Act's requirements.
- **Processor terms:** Vercel, Neon, and Resend each process under their
  standard data-processing agreements/addenda (GDPR-based, incorporating
  standard contractual clauses); links to each processor's DPA should be
  attached to the client's records at provisioning.
- **Technical measures:** TLS in transit, encryption at rest (Neon), access
  restricted to provisioned, role-scoped accounts (deny-by-default auth);
  independent nightly logical backups retained under the client's GitHub
  organisation.
- **Role-based visibility tiers** — the technical measure implementing the
  minimisation claim above. The three staff fields are not exposed uniformly
  to every authenticated user; visibility is decided in one place
  (`personSelectFor(role)`, `src/lib/person-visibility.ts`) and enforced in
  the database `select`, so a role that may not see a field is never sent it:

  | Field                         | ADMIN_IT | PROCUREMENT | FINANCE | STAFF_RO |
  | ----------------------------- | -------- | ----------- | ------- | -------- |
  | `Person.name`                 | yes      | yes         | yes     | own only |
  | `Person.employeeRef`          | yes      | yes         | yes     | no       |
  | `Person.email`                | yes      | no          | no      | no       |
  | `User.emailVerified`          | yes      | no          | no      | no       |
  | `VerificationToken.createdAt` | yes      | no          | no      | no       |

  The **set of stored personal-data fields does not change**, so this is
  **not a new transfer**. It is recorded here because the "Reviewing this
  note if scope changes" clause below is triggered by a change in how the
  data is displayed, and widening any cell in the table triggers it again.
  Engineering change of 2026-07-30; no legal review is implied.

  The last two rows are the auth activity timestamps described above, added
  2026-08-02 (issue #11). They are read on `/admin/users` and nowhere else,
  behind `requireRole("ADMIN_IT")` — the only role that can already see every
  staff email — so no role gains sight of a person it could not previously
  identify. They are **not** part of `personSelectFor(role)`: that module
  governs `Person` PII, and these live on `User`/`VerificationToken`, which
  the other three roles never read at all.

- **Necessity:** transfer is necessary for the performance of the tool the
  data subjects' employer operates for its internal asset management
  (s. 48(3) grounds also arguably available; safeguards are relied on
  primarily).

## Client obligations (flag to counsel)

- **ODPC registration:** the client organisation is the **data controller**;
  registration with the Office of the Data Protection Commissioner (and
  keeping it current) is the client's obligation via its own counsel. App
  Artery is not providing legal advice; this note is an engineering record of
  what is processed and where.
- Informing staff (data subjects) of the processing per Part IV of the Act.
- Reviewing this note if scope changes — new PII fields, new processors, or a
  region move — before the change ships.
