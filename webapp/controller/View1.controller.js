sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "mobileappsignport/utils/services/ContextService",
    "mobileappsignport/utils/services/AttachmentService",
    "mobileappsignport/utils/services/SigningService"
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
                selectedCount:     0,
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

                    if (result?.workflowstepurl) {
                        console.log("[View1] Navigating to signing portal:", result.workflowstepurl);
                        window.location.href = result.workflowstepurl;
                    } else {
                        console.warn("[View1] No workflowstepurl – marking signed locally");
                        MessageBox.success("Signed!", {
                            title:   "Document Signed",
                            details: JSON.stringify(result, null, 2),
                            onClose: () => oModel.setProperty(oCtx.getPath() + "/signed", true)
                        });
                    }
                })
                .catch(error => {
                    console.error("[View1] Signing failed:", error.message);
                    MessageBox.error("Signing failed", { title: "Error", details: error.message });
                });
        },

        // ── Return from signing portal ─────────────────────────────────────

        _checkSigningReturn() {
            const params = new URLSearchParams(window.location.search);

            // Log full URL and ALL params on every load so nothing from SecSign redirect is missed
            console.log("[View1] _checkSigningReturn | full URL:", window.location.href);
            console.log("[View1] _checkSigningReturn | search string:", window.location.search || "(empty)");

            const allParams = {};
            params.forEach((value, key) => { allParams[key] = value; });
            console.log("[View1] _checkSigningReturn | all params:", JSON.stringify(allParams, null, 2));

            const signed       = params.get("signed");
            const portfolioId  = params.get("portfolioId");
            const attachmentId = params.get("attachmentId");

            console.log("[View1] _checkSigningReturn | signed:", signed, "| portfolioId:", portfolioId, "| attachmentId:", attachmentId);

            if (signed !== "true") {
                console.log("[View1] _checkSigningReturn | no signed=true param – normal load");
                return;
            }

            console.log("[View1] Returned from signing portal | portfolioId:", portfolioId, "| attachmentId:", attachmentId);

            if (attachmentId) {
                const oModel      = this.getView().getModel("view");
                const attachments = oModel.getProperty("/attachments") || [];
                const idx         = attachments.findIndex(a => a.id === attachmentId);

                if (idx !== -1) {
                    oModel.setProperty(`/attachments/${idx}/signed`, true);
                    console.log("[View1] Row marked signed | index:", idx);
                } else {
                    console.warn("[View1] Attachment not found for id:", attachmentId);
                }
            }

            MessageToast.show(
                `Document signed successfully${portfolioId ? " (Portfolio: " + portfolioId + ")" : ""}`,
                { duration: 4000 }
            );

            const sessionKey = params.get("session");
            const cleanUrl   = window.location.pathname
                + (sessionKey ? `?session=${encodeURIComponent(sessionKey)}` : "")
                + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        },

        // ── Merge ──────────────────────────────────────────────────────────

        onSelectionChange() {
            const count = this.byId("attachmentsTable").getSelectedItems().length;
            this.getView().getModel("view").setProperty("/selectedCount", count);
            console.log("[View1] Selection changed | selected:", count);
        },

        onMergePress() {
            const oTable   = this.byId("attachmentsTable");
            const oModel   = this.getView().getModel("view");
            const selected = oTable.getSelectedItems();

            const attachmentIds = selected.map(i => i.getBindingContext("view").getProperty("id"));
            const fileNames     = selected.map(i => i.getBindingContext("view").getProperty("fileName"));

            console.log("[View1] Merge pressed | ids:", attachmentIds, "| files:", fileNames);

            oModel.setProperty("/pdfUrl", null);
            oModel.setProperty("/pdfFileName", "Merging...");
            oModel.setProperty("/attachmentsBusy", true);

            AttachmentService.mergePdfs(attachmentIds)
                .then(url => {
                    oModel.setProperty("/pdfUrl", url);
                    oModel.setProperty("/pdfFileName", `Merged (${fileNames.join(" + ")})`);
                    oModel.setProperty("/attachmentsBusy", false);
                    console.log("[View1] Merge complete | url:", url);
                    this.byId("pdfPanel").getDomRef()?.scrollIntoView({ behavior: "smooth" });
                })
                .catch(error => {
                    console.error("[View1] Merge failed:", error.message);
                    oModel.setProperty("/attachmentsBusy", false);
                    oModel.setProperty("/pdfFileName", "");
                    MessageBox.error("Merge failed: " + error.message);
                });
        },

        // ── PDF Viewer ─────────────────────────────────────────────────────

        onFileNamePress(oEvent) {
            const oAttachment = oEvent.getSource().getBindingContext("view").getObject();
            const oModel      = this.getView().getModel("view");

            oModel.setProperty("/pdfUrl",      AttachmentService.getPdfUrl(oAttachment.id));
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