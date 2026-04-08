sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "mobileappsignport/utils/ContextService",
    "mobileappsignport/utils/AttachmentService",
    "mobileappsignport/utils/SigningService"
], (Controller, JSONModel, MessageBox, ContextService, AttachmentService, SigningService) => {
    "use strict";

    return Controller.extend("mobileappsignport.controller.View1", {

        // ── Init ───────────────────────────────────────────────────────────

        onInit() {
            this.getView().setModel(new JSONModel({
                busy:             true,
                contextLoaded:    false,
                showError:        false,
                context:          {},
                attachments:      [],
                attachmentsBusy:  false,
                attachmentsLoaded: false,
                pdfUrl:           null,
                pdfFileName:      ""
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
                    this._loadAttachments(context.cloudId);
                } else {
                    console.warn("[View1] No cloudId – skipping attachment load");
                }

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
            const sPath       = oCtx.getPath();
            const oAttachment = oCtx.getObject();
            const oContext    = oModel.getProperty("/context");

            console.log("[View1] Sign pressed | file:", oAttachment.fileName);

            SigningService.triggerSigning(oAttachment, oContext)
                .then(result => {
                    console.log("[View1] Signing OK | result:", result);
                    MessageBox.success("Signed!", {
                        title:   "Document Signed",
                        details: JSON.stringify(result, null, 2),
                        onClose: () => {
                            oModel.setProperty(sPath + "/signed", true);
                        }
                    });
                })
                .catch(error => {
                    console.error("[View1] Signing failed:", error.message);
                    MessageBox.error("Signing failed", {
                        title:   "Error",
                        details: error.message
                    });
                });
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