/**
 * routes/signing.js
 *
 * Signing workflow routes.
 * Routing target is controlled by SIGNING_TARGET in utils/signing.config.js.
 *
 * Routes:
 *   POST /api/signing/trigger  ← called when user presses "Sign PDF"
 */
const express            = require('express');
const FSMService         = require('../utils/fsm/FSMService');
const CIService          = require('../utils/signing/CIService');
const SecSignService     = require('../utils/signing/SecSignService');
const { SIGNING_TARGET } = require('../utils/signing/signing.config');

const router = express.Router();

/**
 * POST /api/signing/trigger
 *
 * 1. Fetches PDF binary from FSM
 * 2. Routes to SAP CI, SecSign, or both based on SIGNING_TARGET
 * 3. Normalises response to always include workflowstepurl
 *    (injects mock URL if target hasn't returned one yet)
 *
 * Body: { attachmentId, fileName, objectId, userName, authToken, returnUrl }
 */
router.post('/trigger', async (req, res) => {
    const { attachmentId, fileName, objectId, userName, authToken, returnUrl } = req.body;

    console.log(`[Signing] POST trigger | target: ${SIGNING_TARGET} | file: ${fileName} | user: ${userName}`);

    try {
        // Step 1: fetch PDF binary from FSM
        console.log(`[Signing] Fetching PDF buffer | attachmentId: ${attachmentId}`);
        const pdfBuffer = await FSMService.getAttachmentBuffer(attachmentId);
        console.log(`[Signing] PDF buffer ready | size: ${pdfBuffer.length} bytes`);

        const signingParams = { pdfBuffer, fileName, userName, authToken, attachmentId, returnUrl };
        let result;

        // Step 2: route to configured target
        if (SIGNING_TARGET === 'ci') {
            console.log('[Signing] Routing → SAP CI');
            result = await CIService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'secsign') {
            console.log('[Signing] Routing → SecSign');
            result = await SecSignService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'both') {
            console.log('[Signing] Routing → SAP CI + SecSign (parallel)');
            const [ciResult, secSignResult] = await Promise.all([
                CIService.triggerSigning(signingParams),
                SecSignService.triggerSigning(signingParams)
            ]);
            result = { ci: ciResult, secSign: secSignResult };

        } else {
            throw new Error(`Unknown SIGNING_TARGET: '${SIGNING_TARGET}'. Must be 'ci', 'secsign', or 'both'.`);
        }

        console.log(`[Signing] Trigger successful | target: ${SIGNING_TARGET}`);

        // Step 3: resolve workflowstepurl
        // SecSign returns it directly in the response.
        // CI mock doesn't return one yet – inject mock URL only for 'ci' target.
        let workflowstepurl = result?.workflowstepurl || result?.data?.workflowstepurl;

        if (!workflowstepurl && SIGNING_TARGET === 'ci') {
            const appBaseUrl   = `${req.protocol}://${req.get('host')}`;
            const appReturnUrl = returnUrl || `${appBaseUrl}/`;

            workflowstepurl = `${appBaseUrl}/mock-signing.html`
                + `?portfolioId=MOCK-${Date.now()}`
                + `&attachmentId=${encodeURIComponent(attachmentId)}`
                + `&fileName=${encodeURIComponent(fileName)}`
                + `&redirectUrl=${encodeURIComponent(appReturnUrl)}`
                + `&redirectDeclineUrl=${encodeURIComponent(appReturnUrl)}`;

            console.log(`[Signing] No workflowstepurl from CI – injecting mock: ${workflowstepurl}`);
        }

        if (!workflowstepurl) {
            console.error(`[Signing] ERROR: no workflowstepurl in response | target: ${SIGNING_TARGET}`);
            console.error(`[Signing] Full result: ${JSON.stringify(result, null, 2)}`);
            return res.status(500).json({ success: false, message: 'No workflowstepurl returned from signing service' });
        }

        console.log(`[Signing] workflowstepurl resolved: ${workflowstepurl}`);
        console.log(`[Signing] portfolioid: ${result?.portfolioid}`);

        return res.json({
            success:         true,
            target:          SIGNING_TARGET,
            workflowstepurl: workflowstepurl,
            portfolioid:     result?.portfolioid || result?.data?.portfolioid || null,
            data:            result
        });

    } catch (error) {
        console.error(`[Signing] Trigger failed:`, error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;