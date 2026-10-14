// Opt-in real-monitor check. Speech is locked off; only the approved alert sound plays.
process.env.QUEUE_TEST_PHYSICAL_HDMI = '1';
require('./hdmi-flow.cjs');
