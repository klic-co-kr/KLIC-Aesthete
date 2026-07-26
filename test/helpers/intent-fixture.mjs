export function makeIntent(goal = 'declared goal') {
  return {
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal,
    scope: { included: [], excluded: [] },
    content_priority: [],
    artifact: {
      requested_type: 'dashboard',
      effective_type: 'dashboard',
      format: null,
      canvas: null,
    },
    audience: { description: null, frequency: null },
    desired_action: null,
    source: {
      mode: 'unspecified',
      must_preserve: [],
      must_not_assume: [],
    },
    claim_scope: {
      role: 'declared_generation_context_not_evaluation',
      does_not_establish: [
        'intent_correctness',
        'intent_fulfillment',
        'scope_coverage',
        'priority_fulfillment',
        'audience_comprehension',
        'human_approval',
      ],
    },
  };
}
