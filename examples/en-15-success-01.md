---
pattern: 15
type: success
name: Inline-Header Vertical Lists
pack: en-style
language: en
---

# Pattern 15 (en): Inline-Header Vertical Lists — Success Case

## Input Text

> When evaluating a cloud hosting provider, consider these key factors:
>
> - **Speed:** Low-latency servers located near your user base ensure fast page loads and responsive interactions.
> - **Reliability:** A provider with 99.99% uptime guarantees and automated failover keeps your application available during outages.
> - **Security:** End-to-end encryption, DDoS protection, and regular penetration testing safeguard your data and your users' trust.
> - **Scalability:** Auto-scaling groups that spin up new instances during traffic spikes prevent slowdowns without manual intervention.

## Expected Output

> When evaluating a cloud hosting provider, look for low-latency servers near your user base, which keep page loads fast. Reliability matters too: a 99.99% uptime guarantee with automated failover means your application stays available during outages. On the security side, end-to-end encryption, DDoS protection, and regular penetration testing protect both your data and your users' trust. Finally, auto-scaling groups that spin up instances during traffic spikes handle load without manual intervention.

## Applied Pattern

- Pattern 15 (Inline-Header Vertical Lists): Four consecutive bullets using the "**Label:** explanation" format — "Speed:", "Reliability:", "Security:", "Scalability:" — in what should be an article-style paragraph rather than a reference table.

## Judgment

**Success** — The fire condition is met: four bullets with bold-label-colon formatting in a narrative context (an article advising readers on hosting choices). This is not a changelog, API reference, or feature comparison grid. The corrected version weaves the same information into flowing prose, varies sentence structure, and reads as advice rather than a slide deck. Each point retains its substance without the pseudo-heading scaffolding.
