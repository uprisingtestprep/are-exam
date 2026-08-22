/* ARE 5.0 division registry, read by app.js to build the division picker and
   to size each practice sitting (question count, timer, disclosed pass
   threshold) to THAT division's real exam, not one fixed exam-wide value.

   Update this file by hand each time a division's content ships -- there
   are only ever 6, so a small static list is simpler and safer than a
   generator script that has to stay in sync with config.json across 6
   separate content-writing passes. Flip "available" to true only once that
   division's questions are actually present in questions.js; a division
   with no content selectable in the UI would let a candidate "start" a
   sitting with zero questions.

   pool_size on each division is that division's share of the SIMULATOR's
   own pool (zero overlap with the printed book -- see
   sim_excludes_book_questions in config.json), not the timed-sitting length
   (real_item_count). A candidate only ever sits real_item_count questions at
   once in Real Exam Sittings mode, matched to the real NCARB time limit, but
   that sitting is a random draw from pool_size, and retaking the division
   draws again. Full Pool Drill mode (a separate mode, see app.js) instead
   serves every one of a division's pool_size questions in one sitting.

   window.BOOK_TOTAL is the printed book's own question count (2 practice
   tests, matches content_rules / the trim in trim_book_tests.py) -- the one
   number here the browser can't derive itself, since the book isn't loaded
   client-side. The simulator's own total is NOT duplicated as a constant;
   it's read live from window.EXAM_QUESTIONS.length (questions.js) so it can
   never drift out of sync with what actually shipped. See feedback memory on
   the ARE page-trim: showing only real_item_count on the picker made a
   candidate undercount the book (65+75+75+100+100+75=490) against the real
   total, and the fix is to always show the true totals, book and simulator,
   with zero overlap between them, not a bigger single misleading number. */
window.BOOK_TOTAL = 788;
window.DIVISIONS = [
  {
    key: "pcm", label: "Practice Management",
    real_item_count: 65, pool_size: 216, timer_seconds: 9600, pass_pct: 65,
    domains: ["business_operations", "finances_risk_and_development_of_practice",
              "practice_wide_delivery_of_services", "practice_methodologies"],
    available: true,
  },
  {
    key: "pjm", label: "Project Management",
    real_item_count: 75, pool_size: 217, timer_seconds: 12600, pass_pct: 65,
    domains: ["resource_management", "project_work_planning", "contracts",
              "project_execution", "project_quality_control"],
    available: true,
  },
  {
    key: "pa", label: "Programming and Analysis",
    real_item_count: 75, pool_size: 217, timer_seconds: 12600, pass_pct: 68,
    domains: ["environmental_and_contextual_conditions", "codes_and_regulations",
              "site_analysis_and_programming", "building_analysis_and_programming"],
    available: true,
  },
  {
    key: "ppd", label: "Project Planning and Design",
    real_item_count: 100, pool_size: 217, timer_seconds: 14700, pass_pct: 68,
    domains: ["ppd_environmental_conditions_and_context", "ppd_codes_and_regulations",
              "ppd_building_systems_materials_and_assemblies",
              "ppd_project_integration_of_program_and_systems",
              "ppd_project_costs_and_budgeting"],
    available: true,
  },
  {
    key: "pdd", label: "Project Development and Documentation",
    real_item_count: 100, pool_size: 217, timer_seconds: 14700, pass_pct: 62,
    domains: ["pdd_integration_of_building_materials_and_systems", "pdd_construction_documentation",
              "pdd_project_manual_and_specifications", "pdd_codes_and_regulations",
              "pdd_construction_cost_estimates"],
    available: true,
  },
  {
    key: "ce", label: "Construction and Evaluation",
    real_item_count: 75, pool_size: 216, timer_seconds: 10800, pass_pct: 62,
    domains: ["ce_preconstruction_activities", "ce_construction_observation",
              "ce_administrative_procedures_and_protocols",
              "ce_project_closeout_and_evaluation"],
    available: true,
  },
];
