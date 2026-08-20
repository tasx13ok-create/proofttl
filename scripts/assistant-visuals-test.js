import assert from "node:assert/strict";
import { visualQueryFromMessage, ASSISTANT_VISUALS } from "../src/assistant-visuals.js";

assert.equal(visualQueryFromMessage("show me an alternator"), "alternator");
assert.equal(visualQueryFromMessage("show me a picture of an alternator"), "alternator");
assert.equal(visualQueryFromMessage("what does an alternator look like?"), "alternator");
assert.equal(visualQueryFromMessage("image of Saturn"), "Saturn");
assert.equal(visualQueryFromMessage("why is the sky blue?"), null, "ordinary factual questions must not trigger random imagery");
assert.equal(visualQueryFromMessage("hey"), null, "casual chat must not trigger imagery");
assert.equal(ASSISTANT_VISUALS.provider, "wikimedia-commons");
assert.equal(ASSISTANT_VISUALS.maxResults, 4);

console.log("assistant visual intent checks passed");
