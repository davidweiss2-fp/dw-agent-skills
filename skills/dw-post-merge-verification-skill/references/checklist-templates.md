# Post-merge observation templates

Placeholders only. Fill `{slots}` from the plan-time metric before running. Every template
names the expected observation - a check with no expected result is not a check.

## Coralogix - error rate (agent, read-only)

DataPrime, scoped to the changed service and the observation window:

```
source logs
| filter $l.subsystemname == '{service}'
| filter $d.severity == 'ERROR'
| filter $m.timestamp > now() - {time_window}
| count
```

Expected: error count for `{service}` drops to `{expected_threshold}` after `{deploy_time}`.

## Coralogix - the specific error is gone (agent, read-only)

```
source logs
| filter $l.subsystemname == '{service}'
| filter $d.message.contains('{error_signature}')
| filter $m.timestamp > now() - {time_window}
| count
```

Expected: `{error_signature}` count is `0` (or near-baseline) in the window after the merge.

## PromQL - request / rate metric (agent, read-only)

```
sum(rate({metric_name}{service="{service}"}[{step}]))
```

Expected: `{metric_name}` moves `{direction}` past `{expected_threshold}` within `{time_window}`.

## Mixpanel - event trend (agent, read-only)

Report on `{event}` segmented by `{property}` over `{time_window}`.

Expected: `{event}` volume moves `{direction}` for the affected segment; unaffected segments flat.

## Dashboard spot-check (dev runs, pasteable)

1. Open `{dashboard_name}` at `{dashboard_url}`, set range to `{time_window}` around `{deploy_time}`.
2. Read the `{panel_name}` panel. Expected: `{expected_observation}`. Paste the value.
3. Compare to the pre-merge value `{baseline}`. Expected delta: `{direction}` by `{magnitude}`.

## Log-silence check (dev runs, pasteable)

1. In `{log_view}`, filter `{service}` + `{error_signature}` for the last `{time_window}`.
2. Expected: no new occurrences after `{deploy_time}`. Paste the count and newest timestamp.
