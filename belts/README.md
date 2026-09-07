Belt Progression — DJ Battle Platform
====================================

Overview
--------
The belt system is a skills-based progression separate from the popularity-based leaderboard. Belts represent objectively demonstrated technical and creative abilities validated by the Judge system and optional community/battle requirements.

Belt Ranks
----------
White → Yellow → Orange → Green → Blue → Purple → Brown → Black

Black opens Dan levels (1st Dan, 2nd Dan, ...). Each belt has measurable technical criteria (timing, beatmatching, phrasing, transitions, EQ/gain control, creativity) and optional social requirements (battle victories, mentorship contributions) for higher belts.

Promotion Tests
---------------
- Tests are generated from a pool of standardized technical challenges.
- A passing score threshold is required (e.g., 90/100 for certain belts).
- Exams include randomized elements so tests cannot be memorized.
- The Judge returns a detailed breakdown of component scores and failure reasons to guide practice.

Implementation notes
--------------------
- Store belt definitions in `belts/definitions.json`.
- Create SQL migrations to add `belts`, `user_belts`, `belt_tests`, and `belt_attempts` tables.
- Provide API endpoints to request an exam, submit results, and award belts.
- UI: show belt badge on profiles, leaderboards, forum posts, and battle entries.
- Allow battles to restrict by belt ranges and create belt-specific divisions.

Evidence and audit
------------------
Promotion records include detailed Judge telemetry and scoring evidence so awards can be audited and re-scored if scoring models change.
