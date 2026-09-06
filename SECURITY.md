# Security Policy

## Supported versions

The core, Vue, React, and Nuxt packages published `0.1.0-rc.1` on August 27, 2026.
This is a prerelease available through `next`; no stable security-supported release line has been
declared. Report vulnerabilities in the release candidate through the private channel below.
Development snapshots should not be treated as security-supported packages.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or pull request. Use the
repository's [private vulnerability report](https://github.com/Kjaal/adaptive-debounce/security/advisories/new).
Include the affected version or commit, reproduction steps, impact, and any known mitigation. Avoid
including real credentials, personal data, or sensitive input content.

No response or remediation deadline is promised before a maintained release and private reporting
channel exist. Confirmed reports will be handled privately until a fix and safe disclosure plan are
ready.

## Data and privacy boundary

The browser observer uses timing and non-content metadata only. It does not read input values or
`InputEvent.data`, and the package performs no telemetry or network requests. Exported and default
`localStorage` state contains only the versioned smoothed timing interval. A debounced callback's
latest arguments remain in application memory until its pending window settles or is cancelled;
applications remain responsible for the sensitivity of those arguments and for their own callback
or storage adapters.
