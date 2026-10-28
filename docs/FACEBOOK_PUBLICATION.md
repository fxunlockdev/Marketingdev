# Facebook Page feed publication

Migration 073 extends content slots, image/video requests, carousel versions and publication requests to Facebook. The campaign builder, Canvas media controls, content preferences and calendar can select Facebook. The skill runtime accepts the channel and the campaign retains it independently of the business defaults.

Final image publication requires the immutable approved PNG export. The existing exact-version, approval-revision, brand/account scope, scheduled-time and staging-grant checks still apply. The destination list includes only available accounts with current operator authorization. A Facebook slot cannot use a LinkedIn or Instagram destination.

The publication worker uploads approved media and submits Facebook feed settings through the typed adapter. Acceptance is separate from published status. The existing durable unknown-outcome handling prevents automatic resubmission. No OAuth token or private storage key is sent to the browser.

Operator setup now recognizes LinkedIn, Instagram and Facebook publication grants. Held, unavailable or mismatched accounts cannot receive a new enabled grant. This does not create a grant automatically.

Known limits: Facebook Stories and targeted Facebook reconnect are not included. AI brand recommendations still suggest Instagram/LinkedIn; Facebook can be selected in preferences or the campaign. Video and multi-image transports are implemented, but the new full-path verification currently targets single-image publishing. Live Meta verification and deployment remain outstanding.

Local verification includes 47 content/transport contracts, 19 publication foundation tests, 21 planning foundation tests, and 14 operator configuration tests. These use real local database/storage/job services with mock provider transport. The publishing browser regression now opens the collapsed Activity and results section through its summary before asserting metrics and learning results; the current Home heading is asserted. No assertions of publishing outcomes, media hashes, approval or tenant boundaries were removed.
