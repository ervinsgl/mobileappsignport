/**
 * routes/signing.js
 *
 * Signing workflow routes.
 * Routing target controlled by SIGNING_TARGET in utils/signing/signing.config.js.
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
 * 3. Returns workflowstepurl for browser navigation to signing portal
 *
 * Body: { attachmentId, fileName, objectId, userName, authToken, returnUrl }
 */
router.post('/trigger', async (req, res) => {
    const { attachmentId, fileName, objectId, userName, authToken, returnUrl } = req.body;

    console.log(`[Signing] POST trigger | target: ${SIGNING_TARGET} | file: ${fileName} | user: ${userName}`);

    try {
        const pdfBuffer     = await FSMService.getAttachmentBuffer(attachmentId);
        const signingParams = { pdfBuffer, fileName, userName, authToken, attachmentId, returnUrl };
        let   result;

        if (SIGNING_TARGET === 'ci') {
            result = await CIService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'secsign') {
            result = await SecSignService.triggerSigning(signingParams);

        } else if (SIGNING_TARGET === 'both') {
            const [ciResult, secSignResult] = await Promise.all([
                CIService.triggerSigning(signingParams),
                SecSignService.triggerSigning(signingParams)
            ]);
            result = { ci: ciResult, secSign: secSignResult };

        } else {
            throw new Error(`Unknown SIGNING_TARGET: '${SIGNING_TARGET}'`);
        }

        let workflowstepurl = result?.workflowstepurl || result?.data?.workflowstepurl;

        // CI mock fallback — inject mock URL if no workflowstepurl returned
        if (!workflowstepurl && SIGNING_TARGET === 'ci') {
            const appBaseUrl   = `${req.protocol}://${req.get('host')}`;
            const appReturnUrl = returnUrl || `${appBaseUrl}/`;
            workflowstepurl    = `${appBaseUrl}/mock-signing.html`
                + `?portfolioId=MOCK-${Date.now()}`
                + `&attachmentId=${encodeURIComponent(attachmentId)}`
                + `&fileName=${encodeURIComponent(fileName)}`
                + `&redirectUrl=${encodeURIComponent(appReturnUrl)}`
                + `&redirectDeclineUrl=${encodeURIComponent(appReturnUrl)}`;
        }

        if (!workflowstepurl) {
            console.error(`[Signing] No workflowstepurl in response:`, JSON.stringify(result));
            return res.status(500).json({ success: false, message: 'No workflowstepurl returned' });
        }

        console.log(`[Signing] Trigger OK | portfolioid: ${result?.portfolioid} | url: ${workflowstepurl}`);

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