# Third-party notices

Website extraction and rendered evidence use [Crawl4AI](https://github.com/unclecode/crawl4ai), version 0.9.5, licensed under Apache License 2.0. Copyright and license text remain in the installed distribution and are copied under vendor/licenses/crawl4ai-LICENSE. This attribution also fulfils the distribution's requested text attribution.

Robots rules use [robots-parser](https://github.com/samclarke/robots-parser), version 3.0.1, MIT. Its license is retained under vendor/licenses/robots-parser-LICENSE.

This supplements docs/THIRD_PARTY_LOCK.md and existing vendor/marketing-skills/LICENSE. It is not a claim that Postiz licensing, every browser/native dependency or the production distribution's complete notice bundle is cleared.

Local design review uses [Agentation](https://github.com/benjitaylor/agentation), version 3.1.2, Copyright (c) 2026 Benji Taylor, under PolyForm Shield 1.0.0. The license is retained in vendor/licenses/agentation-LICENSE. It is opt-in in development, with remote annotation syncing disabled.

Onboarding research can use [Agent Reach](https://github.com/Panniantong/Agent-Reach) at commit c70ae6da5d39bc90e09ad2ae0575ccc89f31e284 (version 1.6.1), MIT. It runs only inside the research sandbox image (apps/agent-reach), with its login, cookie and browser channels removed; its license is retained under vendor/licenses/agent-reach-LICENSE and in the image. Its dependencies (yt-dlp, requests, loguru, PyYAML and their hash-pinned wheels in apps/agent-reach/requirements.lock) keep their own licenses in the installed distributions.
