# TV display and manager controls

The room TV contains the Alnatheer logo, Saudi date/time, a fixed narrow column of up to six counters, and the main call panel. No footer, buttons or audio settings appear on the customer screen. A connection-loss warning still identifies stale data.

In the manager application, open **تلفزيون HDMI** to select the second monitor, refresh detected screens, start or stop the TV, and configure its announcements:

- Automatic mode prefers the installed free Arabic voice library. Explicit natural-library and local Windows Arabic modes are also available.
- Enable/mute announcements, select a local Arabic voice, adjust volume, and test the alert and announcement on the TV.
- Volume controls both the alert and speech. Changes take effect on subsequent playback without interrupting an ongoing announcement.
- Voice readiness, missing Arabic voices, playback errors and a required branch-host restart are reported in the manager window.

Settings persist on the manager/display computer in `announcement-settings.json`. HDMI clients cannot change settings or trigger test audio. Use Windows sound settings to select HDMI as the output; physical cabling and speaker routing still require a branch hardware test.

For a standalone room or counter display, press **Ctrl+Shift+S**, authenticate with the branch manager key, then use the audio settings. Return to the customer screen when finished. The shortcut does not bypass manager authentication.

The normal sequence remains alert → Arabic announcement → five-second highlight hold → return to black. A temporary audio failure does not disable subsequent calls. Tests use disposable branch data and verify 1080p/720p layout, manager controls, persistence, restricted TV IPC, real generated audio, volume changes during playback and failure recovery.
