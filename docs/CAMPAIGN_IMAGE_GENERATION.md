# Campaign image generation

The planned-post review supports one explicit request to create all remaining static
image drafts. Video scripts remain a separate review step. This is not a claim of
complete campaign/media parity or live provider verification.

| Interaction | Contract |
| --- | --- |
| Create images | Submit saved static slot IDs and revisions; disable while topics have unsaved edits. |
| Accept | Save every creative job, slot event and batch record in one transaction, or save none. |
| Duplicate submission | Same account/brand request key and payload return the existing jobs. Changed payload conflicts. |
| Other generation | Existing active/uncertain jobs block a new batch. Only queued jobs created inside the current batch transaction are exempt from the existing Canvas busy guard. |
| Reload/navigation | Jobs continue server-side. Read latest batch status from the server. An uncertain browser response retains the original request in session storage for explicit recheck. |
| Results | Each existing creative worker attaches only its own saved version to its own unchanged slot. Display readiness from job status, not request acceptance. |
| Failure | Show attention state and direct users to individual posts. Never automatically resubmit failed/unknown paid generation. |
| Credits | Existing provider grants, request reservations and account/month caps apply to every worker call. Batch acceptance is not a quote or a guarantee that all jobs have sufficient credits. |

Migration 071 adds the tenant-scoped immutable batch receipt. Runtime access is
SELECT/INSERT only; existing brand permissions and slot-generation isolation apply.
The daily creative-request guard is 90, matching the supported campaign maximum.
Rendering still requires actual configured image providers. No automatic approval
or publication is introduced.
