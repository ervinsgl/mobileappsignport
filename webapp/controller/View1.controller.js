sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "mobileappsignport/utils/ContextService",
    "mobileappsignport/utils/AttachmentService",
    "mobileappsignport/utils/SigningService"
], (Controller, JSONModel, MessageBox, MessageToast, ContextService, AttachmentService, SigningService) => {
    "use strict";

    return Controller.extend("mobileappsignport.controller.View1", {

        // ── Init ───────────────────────────────────────────────────────────

        onInit() {
            this.getView().setModel(new JSONModel({
                busy:              true,
                contextLoaded:     false,
                showError:         false,
                context:           {},
                attachments:       [],
                attachmentsBusy:   false,
                attachmentsLoaded: false,
                pdfUrl:            null,
                pdfFileName:       ""
            }), "view");

            this._loadContext();
        },

        // ── Context ────────────────────────────────────────────────────────

        async _loadContext() {
            const oModel = this.getView().getModel("view");

            try {
                const context = await ContextService.getContext();

                oModel.setProperty("/context", context);
                oModel.setProperty("/contextLoaded", true);
                oModel.setProperty("/busy", false);

                console.log("[View1] Context loaded:", {
                    source: context.source, user: context.userName,
                    objectType: context.objectType, cloudId: context.cloudId
                });

                if (context.cloudId && context.cloudId !== "N/A") {
                    await this._loadAttachments(context.cloudId);
                } else {
                    console.warn("[View1] No cloudId – skipping attachment load");
                }

                // Check if we just returned from the signing portal
                this._checkSigningReturn();

            } catch (error) {
                console.warn("[View1] Context unavailable:", error.message);
                oModel.setProperty("/showError", true);
                oModel.setProperty("/busy", false);
            }
        },

        // ── Attachments ────────────────────────────────────────────────────

        async _loadAttachments(objectId) {
            const oModel = this.getView().getModel("view");
            oModel.setProperty("/attachmentsBusy", true);

            try {
                const attachments = await AttachmentService.loadAttachments(objectId);
                oModel.setProperty("/attachments", attachments);
                oModel.setProperty("/attachmentsLoaded", true);

            } catch (error) {
                console.error("[View1] Attachment load failed:", error.message);
                oModel.setProperty("/attachmentsLoaded", true);

            } finally {
                oModel.setProperty("/attachmentsBusy", false);
            }
        },

        // ── Sign ───────────────────────────────────────────────────────────

        onSignPress(oEvent) {
            const oCtx        = oEvent.getSource().getBindingContext("view");
            const oModel      = oCtx.getModel();
            const oAttachment = oCtx.getObject();
            const oContext    = oModel.getProperty("/context");

            console.log("[View1] Sign pressed | file:", oAttachment.fileName);

            SigningService.triggerSigning(oAttachment, oContext)
                .then(result => {
                    console.log("[View1] Signing trigger OK | result:", result);

                    const workflowstepurl = result?.workflowstepurl;

                    if (workflowstepurl) {
                        console.log("[View1] Navigating to signing portal:", workflowstepurl);
                        // Navigate the WebView to the signing portal.
                        // SecSign (or mock) will redirect back to the app
                        // with ?signed=true&attachmentId=... when complete.
                        window.location.href = workflowstepurl;
                    } else {
                        // Fallback – no URL returned, mark signed in place
                        console.warn("[View1] No workflowstepurl in response – marking signed locally");
                        MessageBox.success("Signed!", {
                            title:   "Document Signed",
                            details: JSON.stringify(result, null, 2),
                            onClose: () => {
                                oModel.setProperty(oCtx.getPath() + "/signed", true);
                            }
                        });
                    }
                })
                .catch(error => {
                    console.error("[View1] Signing failed:", error.message);
                    MessageBox.error("Signing failed", {
                        title:   "Error",
                        details: error.message
                    });
                });
        },

        // ── Return from signing portal ─────────────────────────────────────

        /**
         * Called after context + attachments are loaded.
         * Reads URL params injected by the signing portal redirect:
         *   ?signed=true&portfolioId=4100&attachmentId=abc123
         * If present: marks the correct row as signed and cleans the URL.
         */
        _checkSigningReturn() {
            const params       = new URLSearchParams(window.location.search);
            const signed       = params.get("signed");
            const portfolioId  = params.get("portfolioId");
            const attachmentId = params.get("attachmentId");

            if (signed !== "true") return;

            console.log("[View1] Returned from signing portal | portfolioId:", portfolioId, "| attachmentId:", attachmentId);

            // Mark the matching attachment row as signed
            if (attachmentId) {
                const oModel      = this.getView().getModel("view");
                const attachments = oModel.getProperty("/attachments") || [];
                const idx         = attachments.findIndex(a => a.id === attachmentId);

                if (idx !== -1) {
                    oModel.setProperty(`/attachments/${idx}/signed`, true);
                    console.log("[View1] Row marked signed | index:", idx);
                } else {
                    console.warn("[View1] Attachment not found in model for id:", attachmentId);
                }
            }

            // Show success toast
            MessageToast.show(
                `Document signed successfully${portfolioId ? " (Portfolio: " + portfolioId + ")" : ""}`,
                { duration: 4000 }
            );

            // Clean signing params from URL but keep ?session= intact
            const sessionKey = params.get("session");
            const cleanUrl   = window.location.pathname
                + (sessionKey ? `?session=${encodeURIComponent(sessionKey)}` : "")
                + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        },

        // ── PDF Viewer ─────────────────────────────────────────────────────

        onFileNamePress(oEvent) {
            const oAttachment = oEvent.getSource().getBindingContext("view").getObject();
            const oModel      = this.getView().getModel("view");

            const pdfUrl = `/api/attachment-pdf/${encodeURIComponent(oAttachment.id)}`;
            oModel.setProperty("/pdfUrl", pdfUrl);
            oModel.setProperty("/pdfFileName", oAttachment.fileName);

            console.log("[View1] PDF opened:", oAttachment.fileName);
            this.byId("pdfPanel").getDomRef()?.scrollIntoView({ behavior: "smooth" });
        },

        onClosePdf() {
            const oModel = this.getView().getModel("view");
            oModel.setProperty("/pdfUrl", null);
            oModel.setProperty("/pdfFileName", "");
        }

    });
});