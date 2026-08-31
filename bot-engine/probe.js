/**
 * probe.js - Run this on Railway to test party key resolution.
 * node probe.js SJPCXC
 */
const { resolveParty } = require("./resolver");
const KEY = process.argv[2] || "SJPCXC";
console.log("Probing key:", KEY);
resolveParty(KEY).then(r => {
  console.log("SUCCESS:", JSON.stringify(r));
  process.exit(0);
}).catch(e => {
  console.log("FAILED:", e.message);
  process.exit(1);
});
