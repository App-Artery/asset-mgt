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
