# Live counter board — 0.3.2

The room TV now displays every configured counter with its current active ticket. It includes the most recently called counter, which used to be omitted from the smaller counter list. Each card identifies called/serving, idle or paused state; completion clears that counter's ticket without clearing other counters. No ticket/staff values are synthesized for production.

Ten counters fit in a two-column board without a scrollbar. Larger configurations rotate ten-card pages every eight seconds. Counter names sort naturally (1, 2, …, 10); counter IDs remain the source of assignment. A counter-specific display continues to show only its assigned counter.

The current call's main panel turns white with logo-pink text (`#cd1659`, sampled from the repository's official pink logo). A brief 280 ms transition draws attention to each new call/recall and respects reduced-motion preferences. Other cards stay dark; the matching board card receives a pink outline.

Verification used disposable branch data: ten real configured counters, three issued/called tickets, serving/idle/paused states, completion and fresh snapshots. Layout checks passed at 1920×1080 and 1280×720 with no card clipping. Screenshots in `apps/queue-desktop/test-results/tv-counter-board-1920.png` and `tv-counter-board-1280.png` show test records, not a live branch.
