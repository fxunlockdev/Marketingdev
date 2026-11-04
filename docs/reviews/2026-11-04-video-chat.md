# Conversational video setup

The video action previously opened the full reference-management and video-request forms in the canvas. Sending a message also cleared the current conversation and performed a route replacement, creating a reload-like flash.

The conversation now owns image choice, duration selection, script review, optional script editing, and approval. The canvas holds the video preview and its status. Upload/approval management is available only through an explicit picker dialog. Initial creative details continue to come from the AI-interpreted request; users do not re-enter the brief or channel.

Selecting an image saves the existing brief, duration, reference and format together through the existing durable video workflow. A stable per-turn request key prevents duplicate jobs. Uncertain sends retain the exact envelope for retry; definitive validation failures unlock image selection. Modal error/retry controls stay reachable. Saved scripts and approved references are recovered from the server after reload. Paid video generation still requires explicit prompt approval.

The chat now preserves its mounted state after sending, and changes the conversation URL without another route navigation. Internal history selection and creation shortcuts also retain framework history state.

## Scope and limitations

- Dev environment only; no new migrations or environment variables.
- Runway provider routing and media models are unchanged.
- Script fields remain available under **Edit script & caption**. This change does not add unrestricted natural-language editing of an already prepared script.
- The starting image must be approved for reuse. Uploaded-reference rights approval remains explicit.
- The independent source review identified modal recovery and definitive-rejection lockouts; both were corrected and covered by browser cases.

## Validation

Acceptance evidence is recorded in `docs/evidence/video-chat-validation.json` and `docs/evidence/video-chat-hosted.json`. Local generated media uses mock providers; hosted script preparation and playback checks distinguish actual provider calls from fixture coverage.

The final checks passed: 356 contract tests, two chat recovery browser tests, and the combined carousel/reel/video browser journey. Hosted dev checks passed with real GPT request interpretation and script preparation, saved Runway video playback, refresh recovery, and desktop/mobile layout checks. The hosted test script was canceled after validation; no new paid video generation or social publishing was performed. The dev web deployment is `13c21491-a177-4a50-94f7-d2258d175778`.
