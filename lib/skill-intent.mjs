const CLAIM_SCOPE = Object.freeze({
  role: 'declared_generation_context_not_evaluation',
  does_not_establish: Object.freeze([
    'intent_correctness',
    'intent_fulfillment',
    'scope_coverage',
    'priority_fulfillment',
    'audience_comprehension',
    'human_approval',
  ]),
});

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

function optional(value) {
  return value === undefined ? null : value;
}

export function buildIntentPacket(brief, spec) {
  const included = list(brief?.scope?.included);
  const excluded = list(brief?.scope?.excluded);
  const excludedSet = new Set(excluded);
  const collision = included.find((value) => excludedSet.has(value));
  if (collision !== undefined) {
    throw new Error(`intent scope contradiction: ${collision}`);
  }
  return {
    schema: 'aesthete.intent/v1',
    schema_version: 1,
    goal: optional(brief?.brief),
    scope: { included, excluded },
    content_priority: list(brief?.content_priority),
    artifact: {
      requested_type: brief?.artifact_type,
      effective_type: spec?.artifact_type,
      format: optional(brief?.format),
      canvas: brief?.canvas === undefined
        ? null
        : { w: brief.canvas.w, h: brief.canvas.h },
    },
    audience: {
      description: optional(brief?.audience),
      frequency: optional(brief?.audience_frequency),
    },
    desired_action: optional(brief?.desired_action),
    source: {
      mode: brief?.source_mode ?? 'unspecified',
      must_preserve: list(brief?.must_preserve),
      must_not_assume: list(brief?.must_not_assume),
    },
    claim_scope: {
      role: CLAIM_SCOPE.role,
      does_not_establish: [...CLAIM_SCOPE.does_not_establish],
    },
  };
}

export function renderIntentPromptBullets(intent) {
  const bullets = [];
  if (intent.goal !== null) bullets.push(`Declared goal: ${intent.goal}`);
  for (const value of intent.scope.included) {
    bullets.push(`Included scope: ${value}`);
  }
  for (const value of intent.scope.excluded) {
    bullets.push(`Excluded scope: ${value}`);
  }
  intent.content_priority.forEach((value, index) => {
    bullets.push(`Content priority ${index + 1}: ${value}`);
  });
  if (intent.audience.description !== null) {
    bullets.push(`Audience: ${intent.audience.description}`);
  }
  if (intent.audience.frequency !== null) {
    bullets.push(`Audience frequency: ${intent.audience.frequency}`);
  }
  if (intent.desired_action !== null) {
    bullets.push(`Desired audience action: ${intent.desired_action}`);
  }
  if (intent.source.mode !== 'unspecified') {
    bullets.push(`Source mode: ${intent.source.mode}`);
  }
  for (const value of intent.source.must_preserve) {
    bullets.push(`Preserve: ${value}`);
  }
  for (const value of intent.source.must_not_assume) {
    bullets.push(`Do not assume: ${value}`);
  }
  return bullets;
}
