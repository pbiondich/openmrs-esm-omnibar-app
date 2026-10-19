# Brief: hand complex cohort queries to the Cohort Builder

Status: backlog (Paul, 2026-10-19 10:33 AM PT). Next parser step.

## Why
Review of the phrase parser kept finding narrower and narrower combination cases ("women and children", "women on ARVs and under 5", "women, children"). Each fix made the parser more complex. The omnibar should count simple phrases and stop guessing at complex ones.

## What
1. The parser classifies a query as simple or complex. Complex means any of: more than one group joined by and/with/or/comma/semicolon, a negation applied to anything but a single term, more than one program or encounter type, or a phrase it read only partly.
2. Simple queries keep today's count row, unchanged.
3. Complex queries get no count. They show one row instead: "Build this cohort in Cohort Builder", which opens the builder with a ?definition= of the parts it understood for certain, and the original text shown so the user can finish it.
4. If nothing is understood for certain, the row opens a blank builder with the text shown.
5. Never show a number for a complex query.
6. Say why it's complex, in one short plain line under the row, naming the part that triggered it. Examples: "Two groups joined by 'and'", "Has a 'not'", "Two programs", "Didn't understand 'xyz'". If several apply, name the first. Translatable strings.

## Out of scope
- Real and/or/not logic in the omnibar.
- Diagnosis-based counts ("HIV patients"), a separate backlog idea.

## Done when
- The 136-phrase offline set is re-sorted into simple vs complex, and every case that was "no row" for combination reasons now gets the handoff row.
- The handoff link opens the builder with only the certain parts filled in, checked on o3.
- Tests, lint, typecheck, build and translations extract pass. Grok code review approves.
- Each complex case in the offline set shows the right reason line.
- Docs: decisions.md records the simple/complex rule.

## Open questions for Paul
- Should the handoff row take the default Enter highlight, like the count row does?
- Should the builder show the original text as a note, or is the prefill enough?
