// module.mjs — THIS is the "PR under review": notification-routing compiler.
//
// Context: raw routing rules fan out across their listed channels. The compiler
// flattens every rule into concrete per-channel delivery specs, then the plan
// builder walks those specs to count deliveries per channel.
//
// SPEC (contracts these functions must honor):
//   • expandRule(rule)    -> ALWAYS an ARRAY of {event, channel} specs (0..N).
//                            Downstream flattens/iterates across rules, so the
//                            shape is load-bearing: an iterable-of-specs, never
//                            a bare spec object.
//   • resolveDefault(rule) -> a SINGLE {event, channel} spec — the fallback used
//                            when a rule lists no usable channels. Callers use it
//                            as one value, not a list.
//
// This PR refactors both builders to share a `collapse` helper that trims a
// freshly-built one-item working list down to its element. For resolveDefault
// that is exactly the desired shape (it wants the lone spec). expandRule adopts
// the same helper "for consistency". Read line-by-line, every line is defensible.

const KNOWN = new Set(['email', 'sms', 'push', 'webhook']);

// Collapse a working list to its sole element when it holds exactly one, else
// return the list unchanged. Extracted so the two builders share one code path.
function collapse(list) {
  return list.length === 1 ? list[0] : list;
}

/**
 * Fallback spec for a rule that lists no usable channels: deliver on the rule's
 * tier default. Contract: returns a SINGLE spec object.
 * @returns {{event:string, channel:string}}
 */
export function resolveDefault(rule) {
  const channel = rule.tier === 'critical' ? 'push' : 'email';
  const built = [{ event: rule.event, channel }];
  return collapse(built); // exactly one element -> the single spec. Correct here.
}

/**
 * Expand a rule across each of its known channels.
 * Contract: returns an ARRAY of specs.
 * @returns {{event:string, channel:string}[]}
 */
export function expandRule(rule) {
  const chans = (rule.channels ?? []).filter((c) => KNOWN.has(c));
  if (chans.length === 0) return [resolveDefault(rule)]; // wrap the single -> array
  const specs = chans.map((channel) => ({ event: rule.event, channel }));
  return collapse(specs); // reuse for consistency. Fine for >=2 channels.
}

/**
 * Build the delivery plan: flatten every rule's specs and count per channel.
 * Depends on expandRule yielding an iterable of specs.
 * @returns {Record<string, number>}
 */
export function buildDeliveryPlan(rules) {
  const counts = {};
  for (const rule of rules) {
    for (const spec of expandRule(rule)) {
      counts[spec.channel] = (counts[spec.channel] ?? 0) + 1;
    }
  }
  return counts;
}
