# Templates (`localoffice/v1` presets)

Starter documents in the shared envelope format. Open them in the matching tool -
no new tool or code, just data you own.

| File | Type | Open in | What it is |
|---|---|---|---|
| `unit-pack.localoffice.json` | `sheet` | LocalSheets | Unit & physics pack: temperature, length, and mass conversions, simple kinematics, circle geometry, and compound interest. Generic textbook formulas. |
| `net-worth.localoffice.json` | `sheet` | LocalSheets | Net-worth tracker: assets − liabilities, currency-formatted. |
| `pm-plan.localoffice.json` | `plan` | LocalPlan *(step 6)* | A project plan: discovery → design → build → test → launch → retro, with dependencies and dates. Data-only until LocalPlan ships. |

Mortgage, RSU, monthly-budget, rental-cashflow and other finance/robotics presets
already ship (in the legacy `.localsheet.json` format) under
[`../localSheets/templates/`](../localSheets/templates/); LocalSheets reads those
transparently.

## How they're made (and trusted)

The **sheet** presets are authored through the *real* LocalSheets engine, so
every formula is computed and its result asserted before the file is written -
then the recipe (formulas, not cached values) is emitted as a `localoffice/v1`
envelope.

```
node templates/build-templates.js     # author + assert + (re)write the presets
node templates/verify-templates.js     # load each in the SHIPPED localsheets.html
                                        # (sheets compute, zero error cells) +
                                        # validate the plan via the shared core
```

`verify-templates.js` runs as part of `node run-all-tests.js`.
