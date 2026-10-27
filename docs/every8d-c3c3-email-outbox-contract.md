**C3c-3 REVISED CONTRACT FREEZE CANDIDATE**

This message is the complete revised candidate. It supersedes the previous candidate for review. It is **not frozen**, and implementation remains **not authorized**.

No files, branches, worktrees, migrations, rollback scripts, TypeScript modules, tests, commits or PRs were created. No production operations, configuration changes, key generation or provider calls occurred.

**1. Pinned main/base evidence**

Reverified on 2026-10-26:

| Check                    | Result                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| Repository               | `hugolamcloser/win-crm.ai-lineconnect`                                |
| `git fetch origin`       | Successful                                                            |
| Required main            | `0817596034b69c1badca2fdac1bf56b0490e4a3d`                            |
| Fetched `origin/main`    | Exact required SHA                                                    |
| GitHub main ref          | Checked before revision and again before delivery; exact required SHA |
| PR #117                  | GitHub reports merged                                                 |
| PR #117 merge commit     | Exact required SHA                                                    |
| Newer main drift         | None observed                                                         |
| Local checkout           | Left unchanged; pinned Git objects inspected                          |
| Existing untracked files | Left untouched                                                        |

PR body text contains historical pre-merge statuses; current GitHub merge metadata establishes the merged status. [PR #117](https://github.com/hugolamcloser/win-crm.ai-lineconnect/pull/117)

**2. Current repository evidence and preserved authority**

| Authority                         | Pinned evidence                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Frozen C3c architecture           | `docs/every8d-c3c-settings-auth-contract.md`, blob `8da38c47f40749219ca7b0260bd3722c198f4346`            |
| C3c-2a migration                  | `202610220001_every8d_settings_session_consumption.sql`, blob `315cc15888adc1edd96cf1ca2b8f0ef2b0171375` |
| C3c-2a rollback                   | Corresponding rollback blob `2b47b98e2460e92d557423b8d64a3663ca7cba45`                                   |
| C3b challenge preparation service | Blob `5794d92450d756b605d395d695733de8ec67af0e`                                                          |
| Existing email delivery types     | Blob `049cbd52b21d78d8d74308b9d4308daffcab696a`                                                          |
| C3c-2b session service            | Blob `cb3afd8d35655a3fc8e537c70f9ef3a23eba57f2`                                                          |

Inspected authorities include C3a enrollment/session/lifecycle protections; C3b challenge persistence, failure ledger, recorder, cleanup, primitives and orchestration; C3c-2 session consumption/runtime; configuration and repository conventions; PG17 proof conventions; pilot governance.

The existing challenge recorder remains unchanged. It accepts only:

```
provider_rejected
delivery_outcome_unknown
sender_unavailable
```

It locks the challenge and returns `false` when recording is no longer permitted, including expiry, supersession, prior resolution, locking, verification or consumption.

Existing challenge/session/grant authority, rate limits, protected LINE flows, OAuth behavior and Phase2F configuration remain unchanged. [Pinned C3c contract](https://github.com/hugolamcloser/win-crm.ai-lineconnect/blob/0817596034b69c1badca2fdac1bf56b0490e4a3d/docs/every8d-c3c-settings-auth-contract.md)

**3. Exact new database object inventory**

All new objects are in `public`, owned by the existing trusted common owner.

| Category                    | Exact objects                                            |
| --------------------------- | -------------------------------------------------------- |
| Runtime table               | `every8d_settings_auth_email_outbox`                     |
| Maintenance singleton table | `every8d_settings_auth_email_outbox_installation_guard`  |
| Sequence                    | `every8d_settings_auth_email_outbox_fence_seq`           |
| Runtime wrappers            | Six frozen names in item 8                               |
| Owner cores                 | Six exact cores in item 9                                |
| Pure encoding helper        | `every8d_settings_auth_email_aad_v1`                     |
| Outbox protection function  | `protect_every8d_settings_auth_email_outbox_v1`          |
| Guard protection function   | `protect_every8d_settings_auth_email_outbox_guard_v1`    |
| Outbox row trigger          | `protect_every8d_settings_auth_email_outbox`             |
| Outbox statement trigger    | `deny_every8d_settings_auth_email_outbox_truncate`       |
| Guard row trigger           | `protect_every8d_settings_auth_email_outbox_guard`       |
| Guard statement trigger     | `deny_every8d_settings_auth_email_outbox_guard_truncate` |

Inventory totals:

- Two tables.
- One sequence.
- Fifteen functions: six wrappers, six cores, one encoding helper, two protection functions.
- Four explicit triggers.
- Seven indexes: outbox primary/unique indexes, four explicit outbox indexes, guard primary index.
- PostgreSQL’s internally generated FK enforcement triggers.

No additional tables, enums, domains, extensions, roles or policies.

The singleton is necessary maintenance metadata for conservative server-epoch rollback eligibility. It is not a runtime history ledger.

Sequence definition:

```
type bigint
INCREMENT BY 1
MINVALUE 1
MAXVALUE 9223372036854775807
START WITH 1
CACHE 1
NO CYCLE
OWNED BY NONE
```

The sequence supplies fresh fence generations and conservative allocation evidence within the same uninterrupted, administratively unmodified server epoch. It is **not an immutable crash-durable audit ledger**.

**4. Exact table schemas**

`NN` means `NOT NULL`; `—` means no default.

Outbox table:

| Column                             | Type          | Nullability/default                 |
| ---------------------------------- | ------------- | ----------------------------------- |
| `job_id`                           | `uuid`        | NN / —                              |
| `challenge_id`                     | `uuid`        | NN / —                              |
| `request_token_hash`               | `bytea`       | NN / —                              |
| `purpose`                          | `text`        | NN / —                              |
| `envelope_version`                 | `smallint`    | NN / —                              |
| `payload_version`                  | `smallint`    | NN / —                              |
| `template_version`                 | `smallint`    | NN / —                              |
| `enqueue_fingerprint`              | `bytea`       | NN / —                              |
| `state`                            | `text`        | NN / `'PENDING'`                    |
| `attempt_count`                    | `smallint`    | NN / `0`                            |
| `fence_generation`                 | `bigint`      | NN / assigned by protection trigger |
| `lease_id`                         | `uuid`        | Nullable / NULL                     |
| `leased_at`                        | `timestamptz` | Nullable / NULL                     |
| `lease_expires_at`                 | `timestamptz` | Nullable / NULL                     |
| `available_at`                     | `timestamptz` | Nullable / —                        |
| `last_attempt_started_at`          | `timestamptz` | Nullable / NULL                     |
| `last_provider_deadline_at`        | `timestamptz` | Nullable / NULL                     |
| `delivery_deadline_at`             | `timestamptz` | NN / —                              |
| `encryption_key_version`           | `text`        | Nullable / —                        |
| `nonce`                            | `bytea`       | Nullable / —                        |
| `ciphertext`                       | `bytea`       | Nullable / —                        |
| `authentication_tag`               | `bytea`       | Nullable / —                        |
| `created_at`                       | `timestamptz` | NN / `clock_timestamp()`            |
| `terminal_at`                      | `timestamptz` | Nullable / NULL                     |
| `terminal_disposition`             | `text`        | Nullable / NULL                     |
| `provider_message_id`              | `text`        | Nullable / NULL                     |
| `challenge_recording`              | `text`        | NN / `'not_applicable'`             |
| `resolution_kind`                  | `text`        | Nullable / NULL                     |
| `resolution_provider_outcome`      | `text`        | Nullable / NULL                     |
| `resolution_pre_send_disposition`  | `text`        | Nullable / NULL                     |
| `resolution_non_acceptance_proven` | `boolean`     | Nullable / NULL                     |
| `resolution_lease_id`              | `uuid`        | Nullable / NULL                     |
| `resolution_fence_generation`      | `bigint`      | Nullable / NULL                     |
| `resolution_attempt_count`         | `smallint`    | Nullable / NULL                     |
| `resolved_at`                      | `timestamptz` | Nullable / NULL                     |

`resolution_non_acceptance_proven` makes the duplicate-resolution comparison explicit.

`job_id` is generated in TypeScript before encryption as a canonical lowercase UUIDv4.

`delivery_deadline_at` equals the locked challenge’s `expires_at`, is immutable, and cannot be extended.

No enrollment-grant identity is duplicated in the outbox. The authoritative relationship remains `challenge.enrollment_grant_id`.

Installation guard table:

| Column                            | Type          | Nullability/default |
| --------------------------------- | ------------- | ------------------- |
| `guard_id`                        | `boolean`     | NN, primary key / — |
| `migration_postmaster_started_at` | `timestamptz` | NN / —              |
| `created_at`                      | `timestamptz` | NN / —              |

Exactly one bootstrap row is inserted by the migration:

```
guard_id = true
migration_postmaster_started_at = pg_postmaster_start_time()
created_at = clock_timestamp()
```

The migration inserts that row before installing the guard’s mutation-denial triggers, within the same transaction.

No runtime function reads or mutates the guard. Application roles, including `service_role`, receive no SELECT or DML privilege.

**5. Exact constraints, indexes, triggers and responsibility division**

Outbox constraints:

| Name                                           | Static row-shape obligation                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `e8d_settings_email_outbox_pkey`               | Primary key on `job_id`                                                                                                          |
| `e8d_settings_email_outbox_challenge_key`      | Unique `challenge_id`                                                                                                            |
| `e8d_settings_email_outbox_challenge_fk`       | `challenge_id → every8d_settings_auth_challenges(id)`; MATCH SIMPLE; RESTRICT/RESTRICT; validated; nondeferrable                 |
| `e8d_settings_email_outbox_identity_check`     | UUIDv4 job; 32-byte request hash and enqueue fingerprint; purpose `login` or `enrollment`                                        |
| `e8d_settings_email_outbox_versions_check`     | Envelope, payload and template versions exactly `1`                                                                              |
| `e8d_settings_email_outbox_state_check`        | Nine-state vocabulary                                                                                                            |
| `e8d_settings_email_outbox_counter_check`      | Attempts `0..3`; positive fence; state-specific attempt bounds                                                                   |
| `e8d_settings_email_outbox_payload_check`      | Complete encrypted tuple in nonterminal states; all four encrypted fields NULL in terminal states; key grammar and binary bounds |
| `e8d_settings_email_outbox_lease_check`        | Active lease tuple present exactly in LEASED/SENDING; expiry=leased time+30 seconds                                              |
| `e8d_settings_email_outbox_schedule_check`     | Availability present in nonterminal states and NULL in terminal states; RETRY_WAIT arithmetic                                    |
| `e8d_settings_email_outbox_attempt_time_check` | Attempt timestamps both NULL iff attempts=0; otherwise provider deadline=start+10 seconds                                        |
| `e8d_settings_email_outbox_terminal_check`     | Terminal timestamp/disposition iff terminal; exact state/disposition/count combinations                                          |
| `e8d_settings_email_outbox_provider_id_check`  | Provider ID only in ACCEPTED; 1..255 printable non-whitespace ASCII bytes                                                        |
| `e8d_settings_email_outbox_resolution_check`   | Exact resolution vocabulary, NULL combinations, evidence and receipt-state relationships                                         |
| `e8d_settings_email_outbox_time_check`         | Finite timestamps and static chronological relationships                                                                         |

Guard constraints:

```
e8d_settings_email_outbox_guard_pkey
  PRIMARY KEY (guard_id)

e8d_settings_email_outbox_guard_singleton_check
  CHECK (guard_id = true)

e8d_settings_email_outbox_guard_time_check
  finite timestamps
  migration_postmaster_started_at <= created_at
```

The primary/check combination permits at most one row. Bootstrap plus mutation-denial triggers and maintenance cardinality checks preserve exactly one row.

All CHECK alternatives must explicitly handle required non-NULL values; SQL’s acceptance of UNKNOWN must not admit incomplete tuples. CHECKs do not inspect parents, current time or prior row state.

Explicit outbox indexes:

```
e8d_settings_email_outbox_ready_idx
  (available_at, job_id)
  WHERE state IN ('PENDING','RETRY_WAIT')

e8d_settings_email_outbox_lease_idx
  (lease_expires_at, job_id)
  WHERE state IN ('LEASED','SENDING')

e8d_settings_email_outbox_deadline_idx
  (delivery_deadline_at, job_id)
  WHERE state IN ('PENDING','LEASED','SENDING','RETRY_WAIT')

e8d_settings_email_outbox_terminal_idx
  (terminal_at, job_id)
  WHERE state IN (
    'ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN',
    'CANCELLED','EXPIRED'
  )
```

Exact triggers:

| Trigger                                                  | Event                            | Function          |
| -------------------------------------------------------- | -------------------------------- | ----------------- |
| `protect_every8d_settings_auth_email_outbox`             | BEFORE INSERT/UPDATE/DELETE, row | Outbox protection |
| `deny_every8d_settings_auth_email_outbox_truncate`       | BEFORE TRUNCATE, statement       | Outbox protection |
| `protect_every8d_settings_auth_email_outbox_guard`       | BEFORE INSERT/UPDATE/DELETE, row | Guard protection  |
| `deny_every8d_settings_auth_email_outbox_guard_truncate` | BEFORE TRUNCATE, statement       | Guard protection  |

Guard protection always rejects those mutations after bootstrap.

Responsibilities are divided as follows:

| Layer                     | Responsibility                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHECKs                    | Static vocabulary, bounds, tuple shapes, lengths and timestamp arithmetic                                                                                                                 |
| Outbox protection trigger | Immutable fields; transition/change allowlists; exact attempt delta; initial/fresh fence assignment; terminal closure and scrub; direct-DML guard; DELETE eligibility; TRUNCATE rejection |
| Owner cores               | Parent/lifecycle/challenge locks; post-wait decision time; current usability; lease/fence authority; retry precedence; recorder invocation; duplicate decision; batch ordering            |
| FK                        | Durable challenge existence and restrictive deletion/update behavior                                                                                                                      |

The protection trigger may compare immutable challenge identity/hash/purpose/deadline metadata on insertion using a nonlocking read. It does not independently decide lifecycle or challenge usability.

It never acquires a new parent row lock after the outbox is held.

For supported runtime DML, cores set and restore transaction-local operation context:

```
wincrm.c3c3_outbox_operation
```

Allowed values are `enqueue`, `claim`, `begin_send`, `finalize`, `recover`, `purge`. Missing/mismatched context rejects owner direct DML. Context is an internal guard, not a credential or substitute for constraints and ACLs. An adversarial owner able to disable triggers is outside that security boundary.

Transition-specific changed-column sets:

- Claim: state, fresh fence, active lease tuple.
- Successful begin: state, attempt count, attempt timestamps.
- Retry finalization: state, availability, active lease clearing, resolution tuple.
- Terminalization: state, terminal tuple, permitted provider/recorder metadata, resolution tuple, encrypted-field scrub, active lease/availability clearing.
- Safe expired-LEASED requeue: state and active lease clearing only.
- No-op or terminal updates: rejected.
- Delete: purge-only eligibility.
- Truncate: always rejected.

Encrypted values cannot change in nonterminal states. Their only permitted update is terminal NULL scrubbing.

No new deferred integrity trigger is required.

**6. Exact states and transition authority**

```
PENDING
LEASED
SENDING
RETRY_WAIT
ACCEPTED
FAILED_TERMINAL
DELIVERY_OUTCOME_UNKNOWN
CANCELLED
EXPIRED
```

| Transition                                     | Authority                                     |
| ---------------------------------------------- | --------------------------------------------- |
| Absent → PENDING                               | Enqueue                                       |
| PENDING/due RETRY_WAIT → LEASED                | Claim                                         |
| LEASED → SENDING                               | Begin send                                    |
| SENDING → ACCEPTED                             | Finalize accepted                             |
| SENDING → FAILED_TERMINAL                      | Finalize rejected/exhausted retryable         |
| SENDING → DELIVERY_OUTCOME_UNKNOWN             | Finalize unknown                              |
| SENDING → RETRY_WAIT                           | Eligible positive non-acceptance finalization |
| LEASED → FAILED_TERMINAL                       | Pre-send sender unavailable                   |
| Expired LEASED → PENDING/RETRY_WAIT            | Safe recovery                                 |
| Expired SENDING → DELIVERY_OUTCOME_UNKNOWN     | Recovery                                      |
| Unusable pre-send state → appropriate terminal | Begin/recovery                                |
| Retained terminal → deletion                   | Purge                                         |

Forbidden:

```
RETRY_WAIT → SENDING
terminal → any state
SENDING → PENDING
expired SENDING → a resend-authorizing state
```

CANCELLED and EXPIRED require zero attempts. Previously attempted, positively non-accepted work uses FAILED_TERMINAL when no further attempt is eligible.

**7. Exact terminal disposition taxonomy**

| Disposition                   | State                    |
| ----------------------------- | ------------------------ |
| `accepted`                    | ACCEPTED                 |
| `provider_rejected`           | FAILED_TERMINAL          |
| `delivery_outcome_unknown`    | DELIVERY_OUTCOME_UNKNOWN |
| `sender_unavailable_pre_send` | FAILED_TERMINAL          |
| `retry_budget_exhausted`      | FAILED_TERMINAL          |
| `retry_deadline_exhausted`    | FAILED_TERMINAL          |
| `retry_unusable`              | FAILED_TERMINAL          |
| `cancelled_pre_send`          | CANCELLED                |
| `expired_pre_send`            | EXPIRED                  |

These are internal outbox dispositions, not new C3b failure classes.

Exact additional vocabularies:

```
resolution_kind:
  provider
  pre_send
  recovery
  unusable

challenge_recording:
  not_applicable
  recorded
  not_recorded
```

No arbitrary diagnostic/reason text or provider response body is stored.

**8. Exact six runtime wrapper signatures**

These are complete signature contracts, not executable migration statements. No parameter has a default.

```
public.runtime_enqueue_every8d_settings_auth_email_v1(
  input_job_id uuid,
  input_challenge_id uuid,
  input_request_token_hash bytea,
  input_purpose text,
  input_envelope_version smallint,
  input_payload_version smallint,
  input_template_version smallint,
  input_encryption_key_version text,
  input_nonce bytea,
  input_ciphertext bytea,
  input_authentication_tag bytea
)
```

```
public.runtime_claim_every8d_settings_auth_email_v1(
  input_batch_size integer
)
```

```
public.runtime_begin_every8d_settings_auth_email_send_v1(
  input_job_id uuid,
  input_lease_id uuid,
  input_fence bigint
)
```

```
public.runtime_finalize_every8d_settings_auth_email_v1(
  input_job_id uuid,
  input_lease_id uuid,
  input_fence bigint,
  input_attempt_count smallint,
  input_provider_outcome text,
  input_pre_send_disposition text,
  input_non_acceptance_proven boolean,
  input_provider_message_id text
)
```

```
public.runtime_recover_every8d_settings_auth_email_v1(
  input_batch_size integer
)
```

```
public.runtime_purge_every8d_settings_auth_email_v1(
  input_batch_size integer
)
```

No seventh runtime API is introduced.

**9. Exact owner-core/helper signatures and metadata**

```
public.enqueue_every8d_settings_auth_email_core_v1(
  input_job_id uuid,
  input_challenge_id uuid,
  input_request_token_hash bytea,
  input_purpose text,
  input_envelope_version smallint,
  input_payload_version smallint,
  input_template_version smallint,
  input_encryption_key_version text,
  input_nonce bytea,
  input_ciphertext bytea,
  input_authentication_tag bytea
)
```

```
public.claim_every8d_settings_auth_email_core_v1(
  input_batch_size integer
)
```

```
public.begin_every8d_settings_auth_email_send_core_v1(
  input_job_id uuid,
  input_lease_id uuid,
  input_fence bigint
)
```

```
public.finalize_every8d_settings_auth_email_core_v1(
  input_job_id uuid,
  input_lease_id uuid,
  input_fence bigint,
  input_attempt_count smallint,
  input_provider_outcome text,
  input_pre_send_disposition text,
  input_non_acceptance_proven boolean,
  input_provider_message_id text
)
```

```
public.recover_every8d_settings_auth_email_core_v1(
  input_batch_size integer
)
```

```
public.purge_every8d_settings_auth_email_core_v1(
  input_batch_size integer
)
```

Each core returns exactly the corresponding table in item 11.

Encoding helper:

```
public.every8d_settings_auth_email_aad_v1(
  input_job_id uuid,
  input_challenge_id uuid,
  input_request_token_hash bytea,
  input_purpose text,
  input_envelope_version smallint,
  input_payload_version smallint,
  input_template_version smallint,
  input_encryption_key_version text
) RETURNS bytea
```

Protection functions:

```
public.protect_every8d_settings_auth_email_outbox_v1()
  RETURNS trigger

public.protect_every8d_settings_auth_email_outbox_guard_v1()
  RETURNS trigger
```

Metadata:

| Functions                | Exact metadata                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Six wrappers             | SQL; SECURITY DEFINER; VOLATILE; CALLED ON NULL INPUT; PARALLEL UNSAFE; not leakproof; COST 100      |
| Six cores                | PL/pgSQL; otherwise same metadata                                                                    |
| Two protection functions | PL/pgSQL; SECURITY DEFINER; VOLATILE; CALLED ON NULL INPUT; PARALLEL UNSAFE; not leakproof; COST 100 |
| AAD helper               | PL/pgSQL; SECURITY INVOKER; IMMUTABLE; CALLED ON NULL INPUT; PARALLEL SAFE; not leakproof; COST 100  |

All functions have exactly:

```
search_path = pg_catalog, public
```

Set-returning estimates:

- Enqueue/begin/finalize/purge: `ROWS 1`.
- Claim: `ROWS 10`.
- Recover: `ROWS 100`.

Runtime operations require READ COMMITTED. Other isolation levels raise fixed SQLSTATE `25000`; no downgrade.

**10. Exact parameter admission and failure semantics**

Shared admission:

- Required UUIDs and fences are non-NULL.
- Job identity is UUIDv4; TypeScript requires canonical lowercase hyphenated spelling.
- Request hash: exactly 32 bytes.
- Versions: exactly `1`.
- Fence: positive signed bigint.
- Claim batch: `1..10`.
- Recover/purge batch: `1..100`.
- Attempt count: `0..3`, with branch-specific bounds.
- Non-acceptance boolean: never NULL.
- Finalization input combinations: exactly item 17.

Malformed structure raises SQLSTATE `22023`, fixed generic message, no protected values.

Validly shaped but missing, stale, unauthorized, conflicting or ineligible single-job requests return zero rows.

Unexpected database errors abort the transaction. Repository code returns only its closed sanitized failure category and does not retry.

Runtime repository usage is one RPC transaction per external operation. Internal wrapper→core→recorder calls remain in that same transaction. Arbitrary multi-RPC transactions are not a supported application composition.

All authoritative time checks use post-lock `clock_timestamp()`, never transaction-start `now()`.

**11. Exact return contracts**

These return tables apply identically to wrapper and corresponding core.

Enqueue — zero or one row:

```
job_id uuid
state text
created_at timestamptz
delivery_deadline_at timestamptz
```

Claim — zero through `input_batch_size` rows:

```
job_id uuid
challenge_id uuid
request_token_hash bytea
purpose text
envelope_version smallint
payload_version smallint
template_version smallint
encryption_key_version text
nonce bytea
ciphertext bytea
authentication_tag bytea
lease_id uuid
fence text
lease_expires_at timestamptz
attempt_count smallint
available_at timestamptz
delivery_deadline_at timestamptz
leased_at timestamptz
db_now timestamptz
```

Begin send — zero or one row:

```
job_id uuid
state text
attempt_count smallint
lease_id uuid
fence text
attempt_started_at timestamptz
provider_deadline_at timestamptz
lease_expires_at timestamptz
delivery_deadline_at timestamptz
terminal_disposition text
terminal_at timestamptz
db_now timestamptz
```

Only a newly committed SENDING receipt authorizes an attempt. A pre-send terminalization receipt has NULL lease/send-authorization fields; its retained fence is informational.

Finalize — zero or one row:

```
job_id uuid
state text
attempt_count smallint
terminal_disposition text
terminal_at timestamptz
available_at timestamptz
provider_message_id text
challenge_recording text
resolved_at timestamptz
```

Recover — zero through `input_batch_size` rows:

```
job_id uuid
previous_state text
state text
attempt_count smallint
terminal_disposition text
terminal_at timestamptz
available_at timestamptz
challenge_recording text
recovered_at timestamptz
```

Purge — exactly one row:

```
purged_count integer
```

Fences are returned as canonical decimal **text**, including values above `2^53−1`. Input SQL types remain bigint; TypeScript transmits validated decimal strings.

No plaintext recipient, OTP, raw capability, raw key or database diagnostic is returned.

**12. Enqueue, uniqueness and exact provider idempotency**

Enqueue:

1. Validates input.
2. Locks/revalidates the committed challenge and applicable parents.
3. Requires unresolved usable pending-delivery state.
4. Binds job/challenge/request hash/purpose/versions.
5. Derives deadline from the locked challenge.
6. Computes the fingerprint.
7. Inserts one encrypted PENDING job.

Durable uniqueness:

```
UNIQUE(challenge_id)
+
restrictive challenge FK
+
immutable linkage protection
```

Fingerprint:

```
SHA-256(
  canonical_AAD
  || LP(nonce)
  || LP(ciphertext)
  || LP(authentication_tag)
)
```

An exact duplicate with identical job/linkage/fingerprint returns the existing receipt without mutation, including after terminal scrub. Its returned state is the existing current state.

A different job for that challenge, reused job for another challenge, or changed encrypted envelope returns zero rows.

Duplicate lookup precedes new-job usability admission because returning an existing receipt creates no authority. After purge there is no receipt; new enqueue must revalidate challenge expiry and unresolved state under lock and returns zero rows.

No automatic retry after ambiguous enqueue. Re-encryption with a new nonce is not an exact duplicate.

Provider idempotency key is exactly:

```
wincrm-c3c3-email-v1:<job_uuid>
```

Contract:

- Prefix exactly `wincrm-c3c3-email-v1:`.
- Suffix exactly canonical lowercase hyphenated 36-character `job_id`.
- Total exactly 57 ASCII bytes.
- Deterministic from job identity only.
- Identical across all attempts and retries of that job.
- Computed, not separately stored.
- Contains no recipient, OTP, capability/hash, lease, fence, key version, credential, installation or administrator identity.

Exact synthetic vector:

```
job_id:
00000000-0000-4000-8000-000000000001

idempotency key:
wincrm-c3c3-email-v1:00000000-0000-4000-8000-000000000001
```

C3c-4 MUST use this exact value. A vendor-specific alternative requires an explicit later contract amendment.

Although non-secret, the key contains a protected job identifier and is not authorized for logging.

**13. Claim semantics**

Admit only:

- PENDING or due RETRY_WAIT.
- Usable challenge/lifecycle.
- Attempts below three.
- Full strict provider window fits: `T + 10 seconds < delivery_deadline_at`.

`T` is captured after relevant locks/waits.

Candidate order:

```
available_at ASC, job_id ASC
```

Select an unlocked locator prefix of at most `input_batch_size`. Acquire the complete applicable parent set before challenge/job locks. Use SKIP LOCKED for candidate row locks.

Skipped/ineligible candidates are not replaced within that invocation. Return count may be zero. Fairness is best-effort oldest-eligible-first, not a strict starvation guarantee.

Each successful claim establishes:

```
fresh database-generated lease UUID
fresh nextval fence
leased_at = T
lease_expires_at = T + 30 seconds
```

Claim never increments attempts, enters SENDING, records challenge delivery, decrypts or calls a provider.

**14. Lease, fencing and initial generation**

The lease UUID is a non-secret claimant identity, not a separate bearer secret.

Active authority requires all of:

```
trusted runtime execution
exact job ID
appropriate LEASED/SENDING state
exact current lease UUID
exact current fence
T < lease_expires_at
```

Chosen initial-generation design:

- INSERT allocates an initial positive `fence_generation`.
- That value is job-generation metadata only.
- PENDING has no active lease.
- Initial generation alone authorizes neither begin-send nor finalize.
- Every transition into LEASED allocates another fresh sequence value.
- Recovery clears expired lease authority; subsequent claim allocates again.

Leaving active lease states clears the active lease tuple. Resolution lease/fence fields are historical receipt data and cannot authorize another send.

Within uninterrupted, unmodified runtime operation, nextval allocations are distinct and increasing; gaps from aborts are expected. No runtime reset, `setval`, restart or cycle exists.

The sequence is not an audit guarantee across crash/restart, promotion/failover, restore or privileged administration. Automatic rollback is therefore restricted by item 35’s epoch and maintenance guards. PostgreSQL explicitly documents uncertainty for uncommitted sequence changes across crash recovery. [PG17 sequence semantics](https://www.postgresql.org/docs/17/functions-sequence.html)

**15. Begin-send semantics**

Under the lock graph, require:

```
state = LEASED
matching lease UUID and fence
T < lease_expires_at
available_at <= T
attempt_count < 3
current usable challenge/lifecycle
T + 10 seconds < delivery_deadline_at
T + 10 seconds < lease_expires_at
```

`T` is captured after relevant waits/locks.

Successful transaction:

```
LEASED → SENDING
attempt_count := attempt_count + 1
last_attempt_started_at := T
last_provider_deadline_at := T + 10 seconds
```

The response is the new exact attempt receipt.

Repeated begin from SENDING returns zero rows and no renewed authorization.

A valid live lease whose work is unusable/window-exhausted may instead be terminalized according to item 26, without incrementing attempts. That terminal receipt authorizes no provider call.

No network operation occurs inside the DB transaction.

Ambiguous commit, late/invalid receipt, transport failure or zero rows authorizes no provider call.

If acknowledgement arrives at or after the provider deadline, the future worker must not invoke the provider, even though SENDING may have committed. Recovery later closes ambiguity.

A successful receipt may be consumed once by the future process; it must not be reconstructed by repeating begin.

**16. Attempt counting and provider deadlines**

Attempt count increments exactly once, only on committed LEASED→SENDING.

No increment at enqueue, claim, RETRY_WAIT, recovery, result processing, unavailable-sender handling or terminalization.

State bounds:

| State      | Attempt count             |
| ---------- | ------------------------- |
| PENDING    | 0                         |
| LEASED     | 0..2                      |
| SENDING    | 1..3                      |
| RETRY_WAIT | 1..2                      |
| Terminal   | Disposition-specific 0..3 |

A committed begin with lost acknowledgement consumes its slot. It permits no replacement send.

The DB persists:

- Immutable challenge-bounded delivery deadline.
- Exact attempt start.
- Exact provider deadline=start+10 seconds.

Actual request cancellation/timeout and provider invocation remain C3c-4.

The future process must conservatively account for RPC elapsed time using a monotonic clock. Local wall-clock timestamps cannot extend DB authority. Invocation at provider-deadline equality is forbidden.

Authoritative outcomes may still be truthfully finalized while the current lease remains valid; the provider deadline does not authorize another call or reopen a resolved job.

**17. Finalize input matrix and duplicate compatibility**

Exactly these structural combinations are accepted:

| Meaning                  | `input_provider_outcome` | `input_pre_send_disposition` | `input_non_acceptance_proven` | `input_provider_message_id` |
| ------------------------ | ------------------------ | ---------------------------- | ----------------------------- | --------------------------- |
| Accepted                 | `accepted`               | NULL                         | false                         | Required valid ID           |
| Rejected                 | `rejected`               | NULL                         | false                         | NULL                        |
| Unknown                  | `outcome_unknown`        | NULL                         | false                         | NULL                        |
| Retryable non-acceptance | `not_accepted_retryable` | NULL                         | true                          | NULL                        |
| Sender unavailable       | NULL                     | `sender_unavailable`         | false                         | NULL                        |

Every other combination, including NULL boolean, raises SQLSTATE `22023`.

Provider-result branches require current SENDING and exact current attempt/lease/fence, with `T < lease_expires_at`.

Sender-unavailable requires current LEASED, exact existing attempt count/lease/fence and an unexpired lease.

Provider evidence is asserted by the later trusted adapter. SQL verifies the closed representation and authority; it cannot independently establish vendor acceptance.

Resolution persistence:

- `resolution_kind` identifies the actual authority path.
- Provider/pre-send input values and non-acceptance boolean are stored exactly.
- Lease/fence/attempt tuple identifies the resolved authority.
- Provider ID is stored only for ACCEPTED.
- `resolved_at` is the captured first resolution decision time.
- Terminal rows have `resolved_at = terminal_at`.
- RETRY_WAIT stores the scheduling resolution time.
- Claim/begin preserve earlier retry resolution as historical evidence; they do not make it current authority.

Compatibility matrix:

| Resolution                          | Required stored kind and outcome/disposition                     | Evidence / provider ID                                                                          | Required resulting state/disposition                                                              | Duplicate result                        |
| ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Accepted                            | `provider`; outcome `accepted`; pre-send NULL                    | false; exact same valid provider ID                                                             | ACCEPTED / `accepted`                                                                             | Stored receipt                          |
| Rejected                            | `provider`; outcome `rejected`; pre-send NULL                    | false; ID NULL                                                                                  | FAILED_TERMINAL / `provider_rejected`                                                             | Stored receipt                          |
| Provider unknown                    | `provider`; outcome `outcome_unknown`; pre-send NULL             | false; ID NULL                                                                                  | DELIVERY_OUTCOME_UNKNOWN / `delivery_outcome_unknown`                                             | Stored receipt                          |
| Eligible retryable                  | `provider`; outcome `not_accepted_retryable`; pre-send NULL      | true; ID NULL                                                                                   | RETRY_WAIT; terminal fields NULL                                                                  | Stored receipt only in same generation  |
| Sender unavailable                  | `pre_send`; provider outcome NULL; pre-send `sender_unavailable` | false; ID NULL                                                                                  | FAILED_TERMINAL / `sender_unavailable_pre_send`                                                   | Stored receipt                          |
| Retry exhaustion from finalize      | `provider`; outcome `not_accepted_retryable`; pre-send NULL      | true; ID NULL                                                                                   | FAILED_TERMINAL / stored `retry_budget_exhausted`, `retry_deadline_exhausted` or `retry_unusable` | Stored receipt                          |
| Recovery terminalization            | `recovery`; no adapter outcome/pre-send disposition fabricated   | False for unknown/never-attempted; true only for previously established positive non-acceptance | Exact stored recovery terminal state/disposition                                                  | No finalize-compatible input; zero rows |
| Begin-send unusable terminalization | `unusable`; no adapter outcome/pre-send disposition              | False when never attempted; true only from prior positive non-acceptance                        | Exact stored unusable terminal state/disposition                                                  | No finalize-compatible input; zero rows |

For every compatible finalize duplicate:

- Derived input kind must equal stored kind.
- Provider/pre-send values must match exactly, including NULLs.
- Resolution lease ID, fence and attempt count must match exactly.
- Non-acceptance boolean and provider ID must match exactly.
- Resulting stored state/disposition must match the matrix.
- Return the original stored `resolved_at`, availability, terminal timestamp and recorder receipt.
- Do not recompute timing, disposition or retry schedule.
- Do not update any row or invoke the recorder.

For RETRY_WAIT duplication, additionally require:

```
state = RETRY_WAIT
current fence_generation = resolution_fence_generation
input fence = that generation
```

After a fresh claim, the old retry receipt is incompatible—even if later expired-LEASED recovery returns the job to RETRY_WAIT.

All conflicts return zero rows.

Repeated recovery never selects an already terminal job. Late explicit `outcome_unknown` is not equated with a recovery-origin terminal receipt.

**18. Exact retry scheduling**

Database-controlled schedule:

```
completed attempt 1:
available_at = resolved_at + 5 seconds

completed attempt 2:
available_at = resolved_at + 20 seconds

attempt 3:
no RETRY_WAIT
```

All must hold:

```
adapter outcome exactly not_accepted_retryable
positive non-acceptance evidence
current valid lease/fence/attempt
attempt_count < 3
current non-temporal usability
available_at + 10 seconds < delivery_deadline_at
```

RETRY_WAIT:

- Is nonterminal.
- Retains encrypted payload and immutable linkage.
- Retains exact eligibility time.
- Clears active lease authority.
- Does not increment attempts.
- Does not call the recorder.
- Does not scrub payload.

`available_at` remains as provenance through LEASED/SENDING so begin can revalidate eligibility. Terminalization clears it.

Every retry requires fresh LEASED and fresh SENDING commits.

**19. Sender-unavailable handling**

Use the existing finalize RPC’s pre-send branch:

```
provider outcome = NULL
pre-send disposition = sender_unavailable
non-acceptance proven = false
provider message ID = NULL
```

Only valid current LEASED authority may use it.

Result:

```
FAILED_TERMINAL
sender_unavailable_pre_send
```

No attempt increment.

It may occur before the first attempt or before a later retry whose earlier attempts were positively non-accepted.

Recorder mapping is `sender_unavailable`, subject to unchanged recorder eligibility.

Cryptographic failure is never sender-unavailable evidence.

**20. Retry exhaustion and deterministic crypto-failure closure**

For a valid positively non-accepted provider result, precedence is:

1. Count three → `retry_budget_exhausted`.
2. Non-temporal challenge/lifecycle unusability → `retry_unusable`.
3. Time/deadline cannot admit another complete provider window → `retry_deadline_exhausted`.
4. Otherwise RETRY_WAIT.

The first three terminalize as FAILED_TERMINAL, scrub immediately and do not call the challenge recorder.

Stale authority cannot terminalize or schedule retry; it returns zero rows.

For any claimed envelope that cannot be decrypted because of:

- Missing historical key.
- GCM authentication failure.
- Malformed envelope.
- Noncanonical/invalid decrypted payload.

Required behavior:

1. Release no plaintext.
2. Do not call begin-send.
3. Do not call a provider.
4. Do not finalize as sender unavailable.
5. Fabricate no adapter outcome or challenge class.
6. Do not automatically repeat cryptographic processing within that lease.
7. Leave LEASED database authority unchanged.
8. Wait for expiry; recovery owns the next transition.

Expired-LEASED recovery:

| Existing attempts                            | Still usable and full window fits | Result                                                           |
| -------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| 0                                            | Yes                               | PENDING                                                          |
| >0, earlier attempts positively non-accepted | Yes                               | RETRY_WAIT, preserving prior eligibility                         |
| 0                                            | No                                | EXPIRED or CANCELLED under item 26                               |
| >0, earlier attempts positively non-accepted | No                                | FAILED_TERMINAL / `retry_deadline_exhausted` or `retry_unusable` |

A new claim may attempt decryption once again; it receives a new generation. The immutable deadline is never extended.

With continuing recovery and DB time progression, permanently missing keys therefore cannot create an infinite claim loop. Eventually no complete provider window fits, and recovery terminalizes and scrubs the job.

No new API, fallback key or failure class.

A malformed claim response rejected after a committed claim has the same conservative expiry/recovery behavior; the repository does not invent a completion command from an invalid receipt.

**21. Challenge recorder contract**

Invoke the unchanged runtime recorder inside the owner terminalization transaction:

```
runtime_record_every8d_settings_challenge_delivery_v1(
  input_request_token_hash,
  input_succeeded,
  input_failure_class
)
```

| Event                                          | Recorder arguments                  |
| ---------------------------------------------- | ----------------------------------- |
| Authoritative acceptance                       | `true, NULL`                        |
| Definitive rejection                           | `false, 'provider_rejected'`        |
| Sender unavailable pre-send                    | `false, 'sender_unavailable'`       |
| Possible emission without authoritative result | `false, 'delivery_outcome_unknown'` |
| Intermediate retry                             | No call                             |
| Retry budget/deadline/unusable exhaustion      | No call                             |
| CANCELLED/EXPIRED never-sent work              | No call                             |
| Crypto failure                                 | No call                             |

Terminal disposition, scrub and recorder boolean receipt commit atomically.

```
true  → recorded
false → not_recorded
no applicable invocation → not_applicable
```

A committed false:

- Does not change truthful outbox disposition.
- Does not reopen state.
- Is never retried.
- Never causes resend.

Recorder exceptions abort the complete transaction. They are not converted to false. Subsequent expired-SENDING recovery closes unknown; its recorder call is a new truthful recovery transaction, not replay of a committed receipt.

Exactly-once recorder effect concerns committed terminalization. An aborted invocation has no durable mutation.

**22. Recovery semantics**

Recovery selects at most `input_batch_size` actionable nonterminal jobs, ordered:

```
coalesce(lease_expires_at, delivery_deadline_at), job_id
```

It acquires applicable parent/challenge/outbox locks and captures fresh decision time afterward.

| Situation                                                                     | Result                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Expired LEASED, attempts=0, usable/window fits                                | PENDING; clear lease; preserve original availability          |
| Expired LEASED, attempts>0, prior positive non-acceptance, usable/window fits | RETRY_WAIT; clear lease; preserve prior retry eligibility     |
| Expired SENDING                                                               | DELIVERY_OUTCOME_UNKNOWN; truthful recorder attempt and scrub |
| Never-attempted deadline/window exhaustion                                    | EXPIRED                                                       |
| Never-attempted non-temporal unusability                                      | CANCELLED, subject to item 26 precedence                      |
| Previously positively non-accepted, unusable/window exhausted                 | FAILED_TERMINAL with applicable retry disposition             |
| Terminal state                                                                | Not selected                                                  |

Expiry is `T >= lease_expires_at`, including equality.

Requeue preserves prior resolution evidence and current generation as inactive metadata. It does not produce a duplicate-compatible old retry generation or an active lease.

Recovery never increments attempts or authorizes a provider call.

Expired SENDING remains unknown even when an acknowledgement-loss scenario suggests no actual send occurred.

**23. Atomic terminal scrub**

Every terminal transition sets these to NULL atomically:

```
encryption_key_version
nonce
ciphertext
authentication_tag
```

It also clears:

```
lease_id
leased_at
lease_expires_at
available_at
```

Retain immutable versions/linkage, fingerprint, attempt/timing metadata and safe resolution receipt until purge.

Request hash is a protected digest, not a raw capability. It remains prohibited in logs.

Compatible duplicate finalization performs no second scrub mutation.

This promises logical row scrubbing, not immediate erasure from WAL, backups or MVCC storage.

**24. Purge, retention and no resurrection**

Capture `T = clock_timestamp()` after relevant locks.

All purge predicates must hold under that same decision time:

```
terminal state
terminal_at <= T - interval '24 hours'
all encrypted fields already NULL
T >= linked challenge.expires_at
```

Purge:

- Batch `1..100`.
- Candidate order `(terminal_at, job_id)`.
- Challenge lock before outbox lock.
- SKIP LOCKED for bounded candidate processing.
- Deletes only outbox rows.
- Returns one count row.
- Never records challenge delivery or first scrubs secrets.

The core sets/restores:

```
wincrm.c3c3_outbox_operation = purge
wincrm.c3c3_outbox_purge = on
wincrm.c3c3_outbox_decision_at = captured T
```

The protection trigger independently verifies:

- Valid finite captured decision time, no later than its fresh `clock_timestamp()`.
- Terminal state and exact retention predicate.
- All encrypted fields NULL.
- Linked challenge exists and is expired at that same T.
- Required purge operation context.

It reads the already locked immutable challenge expiry without acquiring a new parent lock. Missing/malformed context refuses deletion. The GUC alone never authorizes it.

Challenge lifetime is at most ten minutes under existing authority, much shorter than terminal retention. Nevertheless, linked-challenge expiry is an explicit predicate, not an inference from retention.

After purge, enqueue for the same challenge must return zero rows because new enqueue requires, under lock:

```
T < challenge.expires_at
unresolved delivery state
```

Required proof:

```
terminalize → retain → purge → enqueue same challenge
→ zero rows, no new job
```

Maintenance order:

```
outbox recovery
→ retained-terminal purge
→ existing challenge scrub/30-day cleanup
```

The restrictive FK prevents cleanup from silently removing retained/ambiguous child work. A cleanup FK failure must roll back its preceding failure-ledger deletion too.

No cascade or modification of existing cleanup authority.

**25. Complete lock graph and maintenance interactions**

Runtime row-lock order:

```
installation rows, ascending UUID, FOR SHARE
→ enrollment grants, ascending UUID, FOR SHARE
→ administrator witnesses, ascending UUID, FOR SHARE
→ challenges, ascending UUID, FOR UPDATE
→ outbox rows, ascending job UUID, FOR UPDATE
```

Only applicable parent groups are acquired.

For batches, collect the bounded locator set first. Acquire the union of required parent rows before any challenge/outbox row. Do not fully process one job and then acquire another job’s parents.

Use only fully locked parent sets for authority decisions. A skipped/incomplete set yields no authority.

Immutable registration relations are read for current eligibility. No registration mutation is introduced.

Interactions:

- Existing enrollment invalidation: installation→grant→challenge.
- Existing login/consumption: existing alias serialization/parents→challenge.
- No outbox routine acquires alias locks after challenge/outbox locks.
- Recorder reuses the prelocked challenge.
- Outbox routines never mutate or acquire new failure-ledger row locks.
- Existing verification/ledger authority retains its current ordering.
- Cleanup: challenge→failure ledger→challenge deletion/FK checks.
- Purge: challenge→outbox.
- Finalize/recover/begin share challenge→outbox direction.

FK interactions:

- INSERT’s child-side FK existence check occurs after the core already locks the challenge.
- Immutable `challenge_id` prevents runtime FK retargeting.
- Parent-side RESTRICT triggers may inspect/block on child rows during cleanup.
- Purge takes the parent first, preventing a new job→challenge inversion.
- Trigger identity/enabled-state proof includes all internal FK triggers.

Protection performs no new parent row locking.

The installation guard is absent from the runtime graph. Runtime functions never read or lock it.

Maintenance uses quiescent deterministic relation locks in this order:

```
installations
→ app registrations
→ app-version registrations
→ enrollment grants
→ administrators
→ sessions
→ challenges
→ challenge failures
→ outbox
→ installation guard
```

Target relation locks exclude concurrent runtime DML before guard/sequence inspection. Sequence catalog/state checks occur only within this quiescent maintenance boundary. No attempt is made to treat sequence checks as runtime row locks.

No online apply/rollback or deadlock-freedom claim. PG17 independent-session proof is mandatory before implementation approval.

**26. Exact DB-time authority, boundaries and usability**

Use `clock_timestamp()` or a captured timestamp obtained after relevant waits/locks. Never use `now()`, `CURRENT_TIMESTAMP`, transaction-start time, caller timestamps or local wall-clock time for authority. PostgreSQL distinguishes `clock_timestamp()` from transaction-start time. [PG17 time functions](https://www.postgresql.org/docs/17/functions-datetime.html)

Exact boundaries:

| Condition                    | Rule                                                    |
| ---------------------------- | ------------------------------------------------------- |
| Challenge time usable        | `T < expires_at`                                        |
| Challenge expired            | `T >= expires_at`                                       |
| Lease valid                  | `T < lease_expires_at`                                  |
| Lease expired                | `T >= lease_expires_at`                                 |
| Retry due                    | `available_at <= T`                                     |
| Full provider window         | `T + 10 seconds < delivery_deadline_at`                 |
| Begin lease window           | `T + 10 seconds < lease_expires_at`                     |
| Retry schedulable            | `next_available_at + 10 seconds < delivery_deadline_at` |
| Provider invocation deadline | Start only strictly before provider deadline            |
| Retention eligible           | `terminal_at <= T - 24 hours`                           |
| Purge challenge expiry       | `T >= challenge.expires_at`                             |

Relevant waits include parent/challenge/job and uniqueness-conflict waits. A stale pre-wait admission cannot authorize a post-wait action.

Challenge structural usability requires:

```
exact immutable id/hash/purpose
normalized_email IS NOT NULL
email_scrubbed_at IS NULL
delivery_succeeded_at IS NULL
delivery_failed_at IS NULL
locked_at IS NULL
superseded_at IS NULL
verified_at IS NULL
consumed_at IS NULL
delivery_deadline_at = expires_at
```

Time usability additionally requires challenge validity and a full provider window.

Enrollment requires:

- Live unrevoked/unconsumed authoritative grant.
- Method `operator_initial` or `operator_recovery`.
- Pinned identity matching challenge.
- Existing C3a installation/generation/registration eligibility.

Login requires at least one locked active administrator witness for the canonical challenge email with currently eligible installation/generation/registration.

Delivery does not decide login exact-one authority; C3c-2 consumption remains authoritative.

Never-attempted classification:

1. Deadline/window exhausted → EXPIRED / `expired_pre_send`.
2. Otherwise non-temporally unusable → CANCELLED / `cancelled_pre_send`.

Previously positively non-accepted work:

1. Non-temporal unusability → FAILED_TERMINAL / `retry_unusable`.
2. Otherwise deadline/window exhaustion → FAILED_TERMINAL / `retry_deadline_exhausted`.

For provider finalization at count three, budget exhaustion has precedence.

Expiry alone is temporal exhaustion, not a fabricated lifecycle cancellation. SENDING ambiguity is never relabeled cancelled/expired.

**27. Encryption keyring contract**

Exact names:

```
EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION
EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS
```

Keyring is a JSON object mapping versions to encoded keys.

Requirements:

- Version grammar `^[A-Za-z0-9_.-]{1,63}$`.
- Duplicate decoded JSON-member rejection, including escaped equivalent names.
- No arrays, nested/non-string values or trailing content.
- Nonempty; at most 64 entries.
- Raw input at most 16 KiB UTF-8.
- Encoded key exactly `[A-Za-z0-9_-]{43}`.
- Decoded key exactly 32 bytes.
- Canonical re-encoding identical.
- Active version present.
- Partial/malformed supplied group fails even when disabled.
- No trimming, fallback, derivation or startup generation.
- Historical decryption keys retained while required.

Encapsulate buffers with defensive copies.

When the outbox configuration group is supplied, compare all configured historical/active keys across OTP HMAC, pseudonym HMAC and outbox encryption domains; any cross-domain byte equality fails that configuration group. Reject duplicate key bytes across outbox versions.

Absent outbox configuration does not change existing C3b parsing semantics.

OAuth, provider, CSRF and session domains must remain independently provisioned. The parser does not claim to inspect inaccessible external secrets.

Missing historical keys follows item 20’s exact no-send, lease-expiry and eventual closure path.

**28. Exact AES-256-GCM envelope serialization**

Canonical UTF-8 JSON, no BOM or whitespace, exact key order, no extra fields:

```
{"v":1,"alg":"A256GCM","keyVersion":"<version>","payloadVersion":1,"templateVersion":1,"nonce":"<base64url>","ciphertext":"<base64url>","tag":"<base64url>"}
```

Rules:

- `v`, `payloadVersion`, `templateVersion`: integer `1`.
- `alg`: exactly `A256GCM`.
- Nonce: fresh `randomBytes(12)` for each encryption; canonical Base64URL, 16 characters.
- Tag: exactly 16 bytes; canonical Base64URL, 22 characters.
- Ciphertext: 1..512 decoded bytes.
- Serialized envelope: at most 1024 UTF-8 bytes.
- Reject duplicates, unknown fields, alternate encodings and noncanonical serialization.
- DB columns store decoded bytes, not the JSON blob.
- Envelope/column reconstruction must be lossless and canonical.

Decrypt into private temporary buffers. Release plaintext only after successful GCM authentication and strict payload parsing. Successful `decipher.final()` is required before plaintext is trusted. [Node 22 crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html)

All cryptographic failure variants produce the same sanitized payload-unavailable error without protected values, raw causes or partial plaintext.

**29. Exact AAD serialization**

Define:

```
LP(B) = unsigned 32-bit big-endian byte length of B || B
U16(n) = unsigned 16-bit big-endian integer
UUID(x) = canonical 16 RFC UUID bytes
UTF8(x) = exact UTF-8 bytes, without BOM
```

AAD is exactly:

```
LP(UTF8("wincrm/every8d/settings/auth-email-outbox/aad/v1"))
|| U16(envelope_version)
|| LP(UTF8(encryption_key_version))
|| UUID(job_id)
|| UUID(challenge_id)
|| request_token_hash                   -- exactly 32 bytes
|| LP(UTF8(purpose))
|| U16(template_version)
|| U16(payload_version)
```

There is no ambiguous delimiter concatenation.

The SQL helper and TypeScript encoder must produce identical bytes. SQL uses explicitly qualified binary encoding functions; no locale-, JSON-, date- or UUID-text-dependent encoding.

AAD comes from trusted enqueue/claim context, not attacker-selected envelope fields.

Binding includes key version as well as all required immutable linkage. Job, challenge, request hash, purpose, template or payload substitution must fail authentication.

**30. Exact plaintext payload and bounds**

Canonical UTF-8 JSON, exact key order:

```
{"v":1,"recipient":"<canonical recipient>","displayOtp":"<XXXX-XXXX>"}
```

Requirements:

- Exactly these three fields; duplicates and unknown fields rejected.
- `v=1`, matching payload version.
- Recipient must equal the existing C3b canonical normalization result.
- Recipient maximum 254 ASCII bytes.
- Display OTP must equal `formatEvery8dSettingsOtp(parseEvery8dSettingsOtp(value))`: exactly nine characters using the existing alphabet and hyphen position.
- Entire plaintext 1..512 bytes.
- Decrypted serialization must itself be canonical.

Purpose selects the fixed version-1 enrollment or login OTP template. No arbitrary subject, body, HTML, headers, URL, attachment or template name.

No capabilities, enrollment grants, session material, keys, OAuth tokens or provider credentials.

**31. TypeScript modules and preparation boundary**

Proposed modules:

```
src/config/every8dSettingsEmailOutbox.ts
src/services/every8dSettingsEmailOutboxCrypto.ts
src/services/every8dSettingsEmailOutboxRepository.ts
src/services/every8dSettingsEmailOutboxPreparationService.ts
src/types/every8dSettingsEmailOutbox.ts
```

Narrow existing modification:

```
src/config/every8dSettingsAuth.ts
```

Route-free preparation:

```
challenge durable commit
→ validate prepared internal challenge command
→ generate job UUID
→ construct canonical payload/AAD context
→ encrypt once
→ enqueue once
→ discard temporary plaintext references/buffers
```

The raw request capability is excluded from crypto/repository inputs. Only the prepared delivery handle’s hash enters AAD/enqueue.

The stable provider idempotency key is derived from canonical job identity by an internal pure helper. It does not invoke a provider.

No HTTP, worker, adapter, sender selection or network path.

Failure between commits leaves an accepted unsent orphan. No reconstruction, startup scan, combined challenge/outbox transaction or automatic retry.

Existing C3b algorithms/types are preserved.

**32. Repository, crypto-failure and provider-ID contracts**

Exactly six repository methods:

```
enqueue
claim
beginSend
finalize
recover
purge
```

Each invokes only its corresponding RPC once. No generic RPC or direct-table escape hatch.

Result model:

- Single job: `applied` with receipt, `not_applied`, or sanitized failure.
- Batch: `applied` with receipts, including empty array, or failure.
- Purge: `applied` with count, or failure.

Failure categories remain exactly:

```
repository_unavailable
repository_contract_violation
```

Validate exact keys, cardinality, state-dependent NULLs, canonical bytea, versions, timestamps, decimal fences and input/receipt identity consistency.

Independent decryption primitive:

```
decryptClaimedPayload(validatedClaimReceipt, encryptionKeyring)
  → immutable { recipient, displayOtp }
```

It requires a repository-validated claim receipt and creates no send authority.

It has no retry loop. Failure releases no plaintext and causes no follow-up RPC. Future composition must follow item 20.

No C3c-3 composed “ready to send” service. C3c-4 owns composition with sender readiness and confirmed begin receipt.

Provider message ID:

- Exactly 1..255 printable non-whitespace ASCII bytes: byte range `0x21..0x7e`.
- Stored only for authoritative ACCEPTED.
- No response body storage.
- Future adapter must produce a stable collision-safe normalized identifier fitting the contract.
- No truncation.
- No silent trim or alteration of native identity.
- Any normalization scheme must preserve collision-safe identity and be explicit in the later adapter contract.
- A provider that cannot satisfy this boundary requires a contract amendment.

**33. Configuration and operational gates**

Add optional parsed `emailOutboxEncryption` configuration while preserving existing C3b enabled semantics and exact flag grammars.

Absent encryption configuration may remain dormant. Supplied malformed configuration fails regardless of flags. Operations requiring it fail closed when absent.

| Operation                                  | Gate                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Pure parsing/crypto                        | No operational side effect                                                    |
| Route-free preparation/enqueue composition | CHALLENGES_ENABLED AND HTTP_ENABLED; encryption required                      |
| Future claim/begin composition             | CHALLENGES_ENABLED AND HTTP_ENABLED AND EMAIL_DISPATCH_ENABLED                |
| Finalize/recover/purge                     | Explicit trusted completion/maintenance remains available with dispatch false |
| Automatic scheduling/provider send         | Absent                                                                        |

Claim/begin repository admission checks the immutable gate snapshot before input getters or client construction.

SQL does not read deployment flags. ACLs protect database authority; flags are not credentials.

Disabling dispatch must not prevent safe completion, recovery or purge. Enabling it does not create a worker or send path in C3c-3.

**34. Migration, preflight, postflight and exact FK fingerprint delta**

Candidate paths:

```
supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql
supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql
```

The identifier remains available in pinned main and follows C3c-2a. No file was created.

Preflight baseline:

- Exact pinned main.
- Eight C3c-2a prerequisite relation fingerprints.
- Its 59 prior-function fingerprints.
- Its nine session-authority target fingerprints.
- Explicit owner/ACL/schema/language/lifecycle checks.

Pinned relation fingerprints:

| Relation                                    | Fingerprint                        |
| ------------------------------------------- | ---------------------------------- |
| `every8d_settings_administrators`           | `22310a057aae8c919d5f133686b06c12` |
| `every8d_settings_auth_challenge_failures`  | `1c3aa7ad43c10fbeaa3da35919c5f603` |
| `every8d_settings_auth_challenges`          | `ad3214c353186228d0f17e2f115f15fb` |
| `every8d_settings_enrollment_grants`        | `2bc87966915bd44aa80793cc9bb1b3d7` |
| `every8d_settings_sessions`                 | `3ea40301cf1743c7fc3f33e754db1705` |
| `ghl_marketplace_app_registrations`         | `0360ec6e4309027f40c03b1087c17b53` |
| `ghl_marketplace_app_version_registrations` | `5b6cc4f57acd2edd376949b63d579574` |
| `ghl_marketplace_installations`             | `b29aca9663dc2fefce200a5b21518ec9` |

The complete function baselines are the literal manifests in the pinned C3c-2a migration identified in item 2; no inferred or current-production baseline substitutes for them.

Use the hardened C3c-2a fingerprint algorithm:

- Columns/defaults/constraints/indexes.
- Ordinary triggers and enabled state.
- OID-independent internal-trigger identity/state.
- RLS/policies and normalized ACLs.
- Routine signatures/results/defaults, language/execution metadata, stored body and ACL.
- Independent actual-owner validation despite owner normalization.

Preflight refuses:

- Unsupported/incorrect UTF8/environment.
- Missing required roles/digest prerequisite.
- Untrusted common owner or role inheritance into it.
- Schema/language privilege drift.
- Effective protected-relation application privileges.
- Prerequisite ownership/definition/ACL/RLS/policy/trigger drift.
- Any target-name conflict or overload.
- Incompatible later authority.
- Maintenance lock failure.

The new guard must not exist before apply. Its target metadata fingerprint and exact bootstrap-row checks are part of postflight.

Apply is one quiescent maintenance transaction with five-second lock timeout. No retry, CREATE OR REPLACE or repair.

Migration and postflight **must not call nextval**. They perform no runtime behavior test.

Fresh successful apply must leave:

```
outbox empty
sequence last_value = 1
sequence is_called = false
exactly one intact guard row
current pg_postmaster_start_time() = stored migration epoch
```

Exact FK postflight handling:

1. Validate exact child/parent columns, MATCH SIMPLE, RESTRICT/RESTRICT, validated, nondeferrable FK.
2. Resolve internal trigger identities by constraint schema/name, relation identities, function identities, type and enabled state—not raw OIDs or generated names.
3. Require exactly two declared challenge-side additions:
   - AFTER ROW DELETE / `pg_catalog."RI_FKey_restrict_del"()` / type 9 / enabled `O`.
   - AFTER ROW UPDATE / `pg_catalog."RI_FKey_restrict_upd"()` / type 17 / enabled `O`.
4. Validate the child INSERT/UPDATE check triggers and their complete identities too.
5. Remove **only those exactly validated parent additions** from a comparison projection.
6. Require the comparison fingerprint equal `ad3214c353186228d0f17e2f115f15fb`.
7. Independently require the complete, unfiltered postflight challenge projection equal the new frozen postflight manifest.
8. Refuse any unexpected trigger or enabled-state difference.

No broad internal-trigger exclusion.

Authorized implementation must derive and freeze literal new target/postflight fingerprints from the exact reviewed SQL in disposable PG17. This planning task invents no numerical hash for SQL that does not yet exist.

Postflight also proves exact new inventory, owners, ACLs, metadata, guard cardinality/values, untouched prerequisite function bodies and row-count preservation.

No existing row migration or backfill.

**35. Conservative pre-use rollback and server-epoch guard**

Automatic guarded rollback may succeed only when **all** hold:

1. Outbox has zero rows.
2. Sequence `is_called=false` and untouched initial state.
3. Exactly one definitionally intact guard row exists.
4. Current `pg_postmaster_start_time()` exactly equals stored epoch.
5. Sequence definition, owner and ACL are exact.
6. No later dependency or unexpected routine-body reference.
7. All target/prerequisite definitions, owners and ACLs are exact.
8. Quiescent maintenance locks acquired.
9. No other evidence of C3c-3 runtime use or administrative intervention.

Guard protection prevents ordinary runtime/application mutation. Guard data is maintenance metadata, not an audit history.

Epoch mismatch always refuses, including after restart/crash recovery into a new epoch, failover/promotion into a different epoch, or restore into a new server epoch.

Do not infer whether an uncommitted nextval survived.

Sequence `is_called` is only conservative same-uninterrupted-epoch allocation evidence. It is not authoritative history across privileged `setval`, sequence restart, restore or owner/superuser mutation.

Epoch equality is necessary, not proof against privileged tampering or every possible operational discontinuity. Known or suspected crash recovery, promotion/restore or sequence administration requires separate maintenance review even if the timestamp happens to match. This contract does not claim an immutable audit mechanism against the trusted owner.

Under the maintained same-epoch pre-use boundary:

- An aborted allocation still causes conservative rollback refusal.
- Used-and-purged state refuses.
- Sequence exhaustion/property/owner/ACL drift refuses.
- No sequence reset repairs eligibility.

Dependency guard combines `pg_depend` and conservative case-folded literal target-name scans across non-system routine bodies, including non-public schemas and procedures. No claim to infer arbitrary obfuscated dynamic names.

Drop order after **all guards pass**:

```
six runtime wrappers
→ six owner cores
→ four explicit triggers
→ outbox/guard protection functions and AAD helper
→ empty outbox table
→ unused fence sequence
→ singleton installation guard
```

No CASCADE, row deletion as preparation, sequence reset or repair.

The guard row is removed only by dropping its table during a fully eligible pre-use rollback.

Post-rollback prerequisite fingerprints must exactly equal baseline, including removal of the declared FK internal-trigger additions.

A refusal requires a separately reviewed maintenance/recovery decision, not an automatic fallback.

**36. Mandatory PG17 executable proof matrix**

All tests use disposable PG17, synthetic identities and independent real sessions where concurrency is involved.

Fresh maintenance proof must run first in an unused fixture:

```
apply → postflight proves empty/unused/same epoch
→ pre-use rollback succeeds
```

Use another fresh fixture for runtime tests. Never execute behavioral tests against an operational migration database.

| Area                      | Mandatory cases                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enqueue                   | Uniqueness; exact duplicate; concurrent duplicate; conflicts; enqueue vs supersession; enqueue vs cleanup; terminal-scrub duplicate; post-purge duplicate/new enqueue refusal         |
| Orphan                    | Challenge-only commit; no reconstruction/send; explicit supersession under existing limits                                                                                            |
| Claim                     | PENDING; due retry; non-due retry; unusable/deadline refusal; batch bounds/order; SKIP LOCKED; concurrent claims                                                                      |
| Lease/fence               | Fresh UUID/generation; stale UUID/fence; claim vs stale finalization; expired authority; no prior-generation authorization                                                            |
| Begin                     | One increment; duplicate begin; concurrent begin; begin vs lifecycle; begin vs expiry; begin vs recovery; ambiguous acknowledgement; acknowledgement arriving after provider deadline |
| Accepted/rejected/unknown | Exact admission, state, recorder mapping, receipt and atomic scrub                                                                                                                    |
| Retry 1/2                 | Exact 5s/20s arithmetic; due equality; fresh claim/begin; no recorder/scrub/intermediate attempt increment                                                                            |
| Retry 3                   | Budget exhaustion; no fourth send; no fabricated challenge class                                                                                                                      |
| Deadline/unusable         | Correct disposition precedence; strict full-window equality refusal; scrub; no recorder                                                                                               |
| Sender unavailable        | Count unchanged; correct mapping; vs lease expiry; vs new claim; SENDING refusal                                                                                                      |
| Duplicate resolution      | Entire item-17 matrix; retry duplicate before claim; retry duplicate after fresh claim; late conflict; resolved_at unchanged                                                          |
| Recorder                  | True; false; exception; exception rolls back everything; exception followed by expired-SENDING recovery                                                                               |
| Recovery                  | Initial/retry expired LEASED; expired SENDING unknown; never-sent cancellation/expiry; positive non-acceptance exhaustion; terminal non-selection                                     |
| Crypto-loss closure       | Repeated claim/expired-lease recovery with no begin; eventual deadline/unusable terminalization for count=0 and count>0; scrub; no recorder                                           |
| Purge                     | Every terminal state; before/at/after retention; linked challenge not yet expired refusal; exact expiry equality; purge vs duplicate finalize; purge vs cleanup                       |
| Cleanup                   | FK refusal; preceding failure-ledger deletion rolls back; normal recover/purge/cleanup succeeds                                                                                       |
| Direct owner DML          | Every forbidden transition, immutable mutation, attempt jump/decrement, lease/envelope shape, terminal update, forged purge context, premature delete and TRUNCATE                    |
| Scrub                     | Every terminal path from finalize, begin, recovery, retry exhaustion and eventual crypto-failure closure                                                                              |
| Time authority            | All equality boundaries; lock wait crossing expiry/lease/deadline/retention; post-lock re-evaluation rather than transaction-start time                                               |
| Sequence                  | Concurrent allocations; abort gaps; exhausted sequence fail-closed; properties/owner/ACL/state tamper; decimal fences above `2^53−1`                                                  |
| Guard/epoch               | Exact singleton; no application access; mutation refusal; fresh same-epoch rollback; epoch mismatch refusal; post-restart rollback refusal                                            |
| Fingerprints              | Exact FK delta; unrelated internal trigger retained; FK enabled-state tamper; constraint/owner/ACL/body drift; complete postflight fingerprint                                        |
| Rollback                  | Fresh unused success; populated refusal; used-but-purged refusal; aborted allocation refusal; later dependencies/body callers; administrative drift; lock timeout                     |
| Atomic maintenance        | Lock timeout leaves no partial apply/drop/ACL change; fresh migration never advances sequence                                                                                         |
| Regression                | Existing C3a/C3b/C3c-2 SQL authority/proof suites remain valid                                                                                                                        |

Concurrency harness requirements:

- Separate connections/transactions.
- Barriers and both winner orders.
- Observe lock waits without protected payloads.
- Bounded test timeouts.
- No unexpected deadlocks or surviving harness sessions.
- Real DB time or authorized disposable fixtures; no caller-controlled runtime clock.

Administrative/reset tests must not claim that a malicious owner perfectly restoring all observable state is detectable. Known such intervention invalidates automatic rollback eligibility.

No production proof.

**37. Mandatory crypto/application proof matrix**

Crypto:

- Strict version/key grammar.
- Empty/partial configuration, raw-size/entry bounds.
- Duplicate decoded JSON members and escaped duplicates.
- Active-version presence.
- Strict canonical Base64URL and exact 32-byte decoding.
- All configured OTP/pseudonym/outbox cross-domain key comparisons.
- Outbox-version duplicate key material.
- Defensive key/input/output buffer copies.
- Fresh 12-byte nonce and exact 16-byte tag.
- Fixed vectors and round trip.
- Wrong key/version; missing historical key.
- Ciphertext/nonce/tag mutation.
- Cross-job/challenge/request-hash/purpose/template/payload substitution.
- SQL/TypeScript AAD golden vectors.
- Unknown/duplicate envelope fields; malformed/noncanonical/oversized envelope.
- Invalid/noncanonical/oversized plaintext payload.
- No plaintext release before authentication and strict validation.
- Sanitized errors without protected values, nested causes or partial plaintext.

Application/repository:

- Exactly six RPC names and exact parameter keys.
- Every malformed return shape for all six RPCs.
- Zero/one/many cardinality enforcement.
- Canonical bytea and timestamps.
- Fence decimal minimum/maximum, above `2^53−1`, overflow, signs, leading zeros and unsafe-number rejection.
- Full finalize NULL/boolean matrix.
- Full duplicate-resolution matrix.
- One preparation→encryption→enqueue; no retry.
- No enqueue after suppressed/unconfirmed challenge preparation.
- No plaintext/capability/key in RPC inputs.
- Claim-bound decryption only.
- Missing historical key, authentication failure and malformed decrypted payload paths.
- Crypto failure causes no begin, provider invocation, sender-unavailable finalize or other fabricated result.
- No second automatic crypto processing in the same lease.
- Repeated future claims/recovery reach terminal closure by immutable deadline.
- Exact 57-byte provider-idempotency vector.
- Same job/same key; different job/different key.
- Retry preserves key.
- Uppercase/noncanonical UUID rejected.
- No secret-derived idempotency material.
- Disabled-dispatch claim/begin suppression.
- Disabled-dispatch finalize/recover/purge remain available.
- Gates precede getters, randomness and client factories.
- Begin failure/duplicate/late acknowledgement creates no provider authorization.
- Existing config, C3b and session regressions.

Provider-call assertions use test counters/contract fixtures only. No fake provider network implementation becomes runtime code.

**38. Security-negative and ACL matrix**

| Negative                                             | Required behavior           |
| ---------------------------------------------------- | --------------------------- |
| PUBLIC/anon/authenticated wrapper execution          | Denied                      |
| service_role core/helper/protection execution        | Denied                      |
| Application access to outbox/guard columns           | Denied                      |
| Application sequence SELECT/USAGE/UPDATE             | Denied                      |
| Role inheritance into owner                          | Maintenance refusal         |
| Guard mutation/TRUNCATE                              | Denied                      |
| Invalid direct outbox mutation                       | Trigger/CHECK/FK refusal    |
| Immutable linkage/envelope/deadline mutation         | Refused                     |
| Lease tuple in inactive state                        | Refused                     |
| Attempt jump/decrement/fourth attempt                | Refused                     |
| RETRY_WAIT→SENDING                                   | Refused                     |
| Terminal update/reopening                            | Refused                     |
| Acceptance without bounded stable ID                 | Refused                     |
| Fifth provider outcome                               | SQLSTATE 22023              |
| Invalid finalize NULL/boolean combination            | SQLSTATE 22023              |
| Retry without positive evidence                      | Refused                     |
| Sender-unavailable as provider outcome               | Refused                     |
| Crypto failure mapped to delivery failure            | Prohibited                  |
| Retry exhaustion mapped to C3b failure               | Prohibited                  |
| Purge GUC alone                                      | Insufficient                |
| Premature retention/challenge expiry deletion        | Refused                     |
| Post-purge re-enqueue                                | Zero rows                   |
| Missing key/auth failure                             | No plaintext/send authority |
| Raw exception/RPC/provider diagnostics in app output | Sanitized                   |
| Target/prerequisite/FK trigger drift                 | Maintenance refusal         |
| Epoch mismatch/known discontinuity                   | Automatic rollback refusal  |

Both tables have RLS enabled, no policies, and no application table/column privileges. Owner authority remains the trusted boundary.

Only the six wrappers grant EXECUTE to `service_role`. All other functions are owner-only. Sequence and guard have no application privileges. Revoke default PUBLIC execution in the migration transaction and verify effective ACLs, including inherited/default grants.

All SECURITY DEFINER functions have fixed `pg_catalog, public` search path.

Allowed telemetry remains fixed safe categories and aggregate counts. No job/challenge IDs, idempotency keys, request hashes, stored key versions, ciphertext payloads, recipient, OTP, credentials, SQLSTATE/database messages or raw exceptions.

**39. Unresolved decisions and implementation risks**

No material architectural decision remains open in this candidate.

Independent review must accept or reject the complete proposed contract, especially:

- Non-secret lease identity with sequence fencing.
- Initial non-authorizing generation allocation.
- Same-epoch-only conservative rollback plus singleton guard.
- Strict complete provider-window inequalities.
- Bounded-prefix best-effort claim fairness.
- Restrictive FK and cleanup dependency.
- Separate challenge/enqueue commits.
- Crypto failure’s lease-expiry recovery path.
- Exact duplicate-resolution rules.

Required implementation evidence remains unexecuted: literal target fingerprints, PG17 lock/race proofs, crypto vectors, application parsing and regression checks.

Principal risks are incorrect lock ordering, NULL-shape holes, accidental recorder invocation, stale-time use, imprecise fence transport and unsafe interpretation of sequence history.

These are validation obligations, not authorization for production access.

**40. Contradictions and blockers**

| Concern                                     | Frozen resolution                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Six APIs vs sender unavailable              | Explicit finalize pre-send branch                                                |
| Four adapter outcomes vs exhaustion         | Separate internal disposition; no fabricated outcome                             |
| Three C3b failure classes vs retries/crypto | No taxonomy widening                                                             |
| Recorder false                              | Preserve truth; no retry/reopen                                                  |
| Crypto processing permanently unavailable   | Expired-lease recovery plus immutable deadline closure                           |
| Initial fence vs active authority           | Metadata only; lease/state/fence required                                        |
| Sequence vs crash-history claim             | Explicitly limited; singleton epoch guard and conservative maintenance refusal   |
| Purge vs uniqueness/no resurrection         | Explicit challenge-expiry predicate plus locked enqueue revalidation             |
| Scrub vs enqueue idempotency                | Retained canonical encrypted-input fingerprint                                   |
| Duplicate vs fresh retry claim              | Old generation no longer compatible                                              |
| Trigger/core overlap                        | Static/transition/core responsibility separation                                 |
| FK fingerprint drift                        | Exact validated additions, narrow comparison projection and full new fingerprint |
| Separate commits                            | Accepted unsent orphan; no reconstruction                                        |
| Planning vs proof                           | Designs complete; execution deferred                                             |

No material architectural contradiction identified.

No claim is made that epoch equality detects all privileged interventions, that sequence state is an immutable audit log, or that deadlock freedom has been proved.

**41. Proposed implementation slice, names, files and rollback path**

Proposed task:

```
C3c-3 durable settings-auth email outbox authority and envelope boundary
```

Proposed branch:

```
codex/c3c3-settings-auth-email-outbox
```

Proposed worktree:

```
C:\Users\User\source\repos\win-crm.ai-lineconnect-c3c3-email-outbox
```

Neither exists as a result of this task.

Expected affected scope:

- Exact migration/rollback candidates.
- Five proposed TypeScript modules.
- Narrow existing settings-auth config extension.
- Focused application tests.
- Dedicated PG17 SQL/shell/independent-session harness.
- CI wiring.
- Reviewed contract artifact and dedicated run log.

Smallest authorized implementation sequence, **after separate authorization**:

1. Freeze re-review.
2. Isolated implementation task.
3. Database authority, guard and rollback.
4. Fresh pre-use rollback proof before runtime proof.
5. PG17 state/ACL/concurrency proof.
6. Crypto/config/repository/preparation.
7. Focused and existing regressions.
8. `npm run typecheck`, `npm test`, `npm run build`.
9. Independent implementation review.

No new production dependency is expected.

Pre-use rollback is item 35’s guarded rollback plus reverting the focused application change. After runtime use, epoch discontinuity or other refusal, a separately reviewed recovery/maintenance plan is required.

No automatic merge or deployment.

**42. Recommended gate, correction reconciliation and final status**

Recommended gate:

```
INDEPENDENT_C3C_3_CONTRACT_FREEZE_RE_REVIEW
```

This message delivers all 42 sections, exact signatures, return tables, schema, serialization definitions and proof requirements together. No reviewer needs another chat to reconstruct the candidate.

Evidence-delivery findings versus substantive corrections:

| Finding category                                                    | Classification                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Complete schema/constraints/indexes/triggers allegedly missing      | Original candidate contained them; incomplete reviewer input was an evidence-delivery problem |
| Nine states, dispositions and API/core signatures allegedly missing | Original candidate contained them; evidence-delivery problem                                  |
| Return tables, AAD/envelope/payload definitions allegedly missing   | Original candidate contained them; evidence-delivery problem                                  |
| Modules/repository/maintenance/proof sections allegedly missing     | Original candidate contained them; evidence-delivery problem                                  |
| Exact provider idempotency spelling                                 | Substantive freeze addition                                                                   |
| Deterministic crypto-failure eventual closure                       | Substantive clarification/addition                                                            |
| Permanent sequence-history claim                                    | Substantive correction                                                                        |
| Singleton epoch rollback guard                                      | Substantive addition                                                                          |
| Exact purge/time boundaries                                         | Substantive strengthening                                                                     |
| Explicit duplicate/NULL matrices                                    | Substantive precision                                                                         |
| Responsibility split and FK delta handling                          | Substantive precision                                                                         |
| Expanded executable proof cases                                     | Substantive strengthening                                                                     |

Correction reconciliation:

| Correction                    | Status   |
| ----------------------------- | -------- |
| RC1 complete candidate        | RESOLVED |
| RC2 provider idempotency      | RESOLVED |
| RC3 historical-key closure    | RESOLVED |
| RC4 sequence crash/history    | RESOLVED |
| RC5 temporal/purge            | RESOLVED |
| RC6 finalize compatibility    | RESOLVED |
| RC7 responsibility/lock graph | RESOLVED |
| RC8 FK fingerprint/rollback   | RESOLVED |
| RC9 proof matrices            | RESOLVED |

“Resolved” means incorporated into this candidate, pending independent acceptance. It does not mean implementation or executable proof passed.

No typecheck, build, application tests, PG17 execution, crypto execution, production inspection or provider/manual smoke tests ran during this read-only revision.

Production boundaries remain supplied constraints, not newly inspected production facts:

- C3c-2a production migration: NOT APPLIED.
- C3c-2b merged code: not deployed/activated as C3c settings auth.
- HTTP and email-dispatch production activation: not authorized.
- Phase2F: unchanged/false unless separately authorized.
- C3c-4/C3c-5: not started or authorized.

```
C3C_3_CONTRACT_REVISION:
PASS

C3C_3_CONTRACT:
READY_FOR_RE_REVIEW

C3C_3_IMPLEMENTATION:
NOT_AUTHORIZED

C3C_2:
CLOSED_COMPLETE

C3C_2A_PRODUCTION:
NOT_APPLIED

C3C_4:
NOT_STARTED_NOT_AUTHORIZED

PRODUCTION_CHANGES:
NONE

NEXT_GATE:
INDEPENDENT_C3C_3_CONTRACT_FREEZE_RE_REVIEW

STOP
```

12:57 PM