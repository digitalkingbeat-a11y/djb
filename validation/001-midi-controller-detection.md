# Validation 001: MIDI Controller Detection

Status: DEFERRED - requires physical controller/browser test

## Scope

Validate MIDI controller detection without changing application code. This record is an observation artifact, not a defect report.

## Environment

| Field | Observed value |
| --- | --- |
| Date and time | Pending |
| Tester | Pending |
| Controller manufacturer and model | Pending |
| Connection type and port | Pending |
| Windows version | Pending |
| Browser name and version | Pending |
| App URL or launch method | Pending |

## Procedure

1. Close other browser tabs or applications that may claim the controller's MIDI input.
2. Connect and power on the controller before opening the app.
3. Open the Battle Studio and select `Scan MIDI` in the Hardware panel.
4. Record whether the browser displays a Web MIDI permission prompt and the response selected.
5. Record the values displayed for Controller, Status, MIDI Activity, and Mapping.
6. Operate each listed physical control once and record whether MIDI Activity changes and its displayed value.
7. Capture the Hardware panel after the scan and after the control checks.

## Detection Observation

| Field | Observed value |
| --- | --- |
| Web MIDI permission prompt appeared | Pending |
| Permission response | Pending |
| Controller detected | Pending |
| Controller name shown by app | Pending |
| Status shown by app | Pending |
| Mapping shown by app | Pending |
| Initial MIDI Activity shown by app | Pending |
| App classification | Pending |

Allowed app classifications are:

- `unsupported`: Web MIDI is unavailable in the browser.
- `blocked`: Web MIDI access was denied or failed.
- `disconnected`: Web MIDI access succeeded but no MIDI input was visible.
- `detected-only`: an input is connected but classified as detected but unmapped.
- `partially-mapped`: a recognized input exposes the learn-ready mappings.

## Physical Control Evidence

| Physical control | MIDI Activity changed | Displayed MIDI Activity value | Notes |
| --- | --- | --- | --- |
| Play/Pause | Pending | Pending | |
| Cue | Pending | Pending | |
| Pitch fader | Pending | Pending | |
| Crossfader | Pending | Pending | |
| Hot cue 1 | Pending | Pending | |
| Browse encoder | Pending | Pending | |
| Filter or EQ knob | Pending | Pending | |
| Performance pad | Pending | Pending | |

## Evidence Files

| Evidence | File or location |
| --- | --- |
| Hardware panel after scan | Pending |
| Hardware panel after control checks | Pending |
| Permission prompt screenshot, if shown | Pending |
| Browser console output, if relevant | Pending |

## Result

Result: DEFERRED - requires physical controller/browser test

No defect is established while this scenario is deferred. When the hardware is available, execute this record and enter a separate numbered defect only for a reproducible failure containing the reproduction steps, expected result, actual result, and linked evidence. Do not change or remove MIDI/controller implementation because this record is deferred.