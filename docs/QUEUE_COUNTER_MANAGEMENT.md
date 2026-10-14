# Branch counter management

The manager's **الكاونترات** tab creates and edits up to six numbered counters, assigns their supported services, shows current tickets and enabled employee-device assignments, pauses/resumes reception, recalls active tickets and opens individual counter analysis.

New counters start paused. Assign a teller device through **الإعدادات** and explicitly enable reception. Counter numbers remain between 1 and 6 so the offline announcement library matches the physical destination.

Deleting a counter retires it from live snapshots and disables its assigned device keys. Ticket records, device records, event history and headquarters evidence remain intact. The server rejects deleting an active counter or the last remaining counter. Revision checks and request receipts protect concurrent edits and retries.

Managers can pause/resume and recall, but cannot impersonate tellers by starting or completing services. Teller attribution continues to use the authenticated device identity. Counter analysis separates recorded service samples, first-service wait samples, utilization, service mix, transfers and no-shows; incomplete coverage and small samples remain visible.

The optional counter archive/number fields require the matching SARAF headquarters receiver and branch runtime before rollout. Older deployed receivers with strict counter schemas need upgrading first. No remote deployment or database cleanup occurs automatically.

Verification: branch lifecycle/retention tests, legacy active-counter renumbering regression, bounded sync payloads, and native Electron manager create/edit/control/analyze/delete flow using disposable test data.
