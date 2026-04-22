/**
 * signing.config.js
 *
 * Single place to control which signing backend(s) receive the request.
 *
 * SIGNING_TARGET options:
 *   'ci'      – send to SAP CI only (current default)
 *   'secsign' – send to SecSign directly only
 *   'both'    – send to both CI and SecSign in parallel
 *
 * To switch: change SIGNING_TARGET below and redeploy.
 * No other files need to change.
 */

const SIGNING_TARGET = 'ci'; // ← change this when ready

module.exports = { SIGNING_TARGET };