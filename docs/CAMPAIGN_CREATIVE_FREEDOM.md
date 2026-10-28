# Campaign creative freedom

The campaign wizard now follows Campaign → Content mix → Style → Font → Creativity → Review. Customers choose Normal, Creative or Super creative. These are creative-direction choices, not provider/model names or promises of exact image preservation.

| Interaction | Contract |
| --- | --- |
| Open Creativity | Creative is selected by default. Each choice has a plain-language description. |
| Select / Back / Continue | The selected value remains in the current wizard state and is shown in Review. No generation starts. |
| Create campaign plan | The mode is sent in campaign.design.creativity, validated and saved with the campaign. |
| Uncertain response / reload | The saved pending request includes the mode; retry uses the same request key and payload. |
| Generate a planned image | The saved mode is translated to creative direction alongside style and font in the image request. |
| Existing campaign without a mode | Creative is used; existing saved data is compatible. |

Normal requests restrained improvements close to the approved brand and reference composition. Creative requests fresh compositions with recognizable subjects. Super creative requests imaginative concepts while retaining brand facts and recognizable products. These instructions guide generation; finished creatives still require review. Strict unmodified-asset composition is not implemented by this setting.

No migration or new provider configuration is required. The wizard was deployed on 2026-10-25; live paid-generation fidelity is tracked separately from the deployed UI checks.

## Saved typography and exports

Campaign-generated images now save the chosen font in their generation request. New Classic designs use DM Serif Display headlines and DM Sans body/CTA; Modern and Expressive use DM Sans. Image revisions preserve the saved editable layer fonts. Existing designs remain compatible, including Arial/Georgia/Verdana. Canvas exposes the two bundled font families and waits for them to load before laying out text.

The isolated export image includes the same OFL font files and license notices as the browser. Its manifest records their hashes; server-side export uses those actual fonts, not a system-font substitution. `work/verify-campaign-font-render.mjs` verifies distinct rendered pixels and records `docs/evidence/campaign-font-render.json`. This verifies typography, not live provider generation or full design-style fidelity.
