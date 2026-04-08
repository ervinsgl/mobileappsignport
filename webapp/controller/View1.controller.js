sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "mobileappsignport/utils/ContextService",
    "mobileappsignport/utils/SigningService"
], (Controller, JSONModel, MessageBox, ContextService, SigningService) => {
    "use strict";

    return Controller.extend("mobileappsignport.controller.View1", {

        onInit() {
            this.getView().setModel(new JSONModel({
                busy: true,
                contextLoaded: false,
                showError: false,
                context: {},
                attachments: [],
                attachmentsBusy: false,
                attachmentsLoaded: false,
                pdfUrl: null,       // set → PDF panel appears; null → hidden
                pdfFileName: ""
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

                console.log("FSM context loaded:", {
                    source: context.source,
                    user: context.userName,
                    objectType: context.objectType,
                    cloudId: context.cloudId
                });

                if (context.cloudId && context.cloudId !== "N/A") {
                    this._loadAttachments(context.cloudId);
                } else {
                    console.warn("No cloudId in context – skipping attachment load");
                }

            } catch (error) {
                console.warn("FSM context not available:", error.message);
                oModel.setProperty("/showError", true);
                oModel.setProperty("/busy", false);
            }
        },

        // ── Attachments ────────────────────────────────────────────────────

        async _loadAttachments(objectId) {
            const oModel = this.getView().getModel("view");
            oModel.setProperty("/attachmentsBusy", true);
            console.log("Loading attachments for objectId:", objectId);

            try {
                const response = await fetch(`/api/attachments/${encodeURIComponent(objectId)}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const attachments = await response.json();
                console.log("Attachments received:", attachments.length, attachments);

                const enriched = await Promise.all(
                    attachments.map(att => this._fetchAttachmentContent(att))
                );

                oModel.setProperty("/attachments", enriched);
                oModel.setProperty("/attachmentsLoaded", true);
                oModel.setProperty("/attachmentsBusy", false);

            } catch (error) {
                console.error("Failed to load attachments:", error.message);
                oModel.setProperty("/attachmentsBusy", false);
                oModel.setProperty("/attachmentsLoaded", true);
            }
        },

        async _fetchAttachmentContent(attachment) {
            try {
                const response = await fetch(`/api/attachment-content/${encodeURIComponent(attachment.id)}`);

                if (!response.ok) {
                    console.warn(`Content fetch failed for ${attachment.id}: HTTP ${response.status}`);
                    return { ...attachment, content: "N/A", contentType: "application/pdf" };
                }

                const result = await response.json();
                console.log(`Content fetched for ${attachment.id} | size: ${result.base64?.length} chars`);

                const preview = result.base64 ? result.base64.substring(0, 60) + "..." : "N/A";

                return {
                    ...attachment,
                    content:     preview,
                    contentFull: result.base64,
                    contentType: result.contentType || "application/pdf",
                    signed:      false
                };

            } catch (error) {
                console.error(`Content fetch error for ${attachment.id}:`, error.message);
                return { ...attachment, content: "Error", contentType: "application/pdf" };
            }
        },

        // ── Sign ───────────────────────────────────────────────────────────

        onSignPress(oEvent) {
            const oCtx        = oEvent.getSource().getBindingContext("view");
            const oModel      = oCtx.getModel();
            const sPath       = oCtx.getPath();
            const oAttachment = oCtx.getObject();
            const oContext    = oModel.getProperty("/context");

            console.log("[View1] Sign pressed | file:", oAttachment.fileName, "| id:", oAttachment.id);

            SigningService.triggerSigning(oAttachment, oContext)
                .then(result => {
                    console.log("[View1] Signing trigger OK | result:", result);

                    MessageBox.success("Signed!", {
                        title:   "Document Signed",
                        details: JSON.stringify(result, null, 2),
                        onClose: () => {
                            oModel.setProperty(sPath + "/signed", true);
                            console.log("[View1] Row marked signed:", oAttachment.fileName);
                        }
                    });
                })
                .catch(error => {
                    console.error("[View1] Signing trigger failed:", error.message);

                    MessageBox.error("Signing failed", {
                        title:   "Error",
                        details: error.message
                    });
                });
        },

        // ── PDF Viewer ─────────────────────────────────────────────────────

        onFileNamePress(oEvent) {
            const oCtx        = oEvent.getSource().getBindingContext("view");
            const oAttachment = oCtx.getObject();
            const oModel      = this.getView().getModel("view");

            // Point PDFViewer directly at the backend route that pipes the binary.
            // Avoids Blob URL iframe security issues inside SAP UI5 PDFViewer.
            const pdfUrl = `/api/attachment-pdf/${encodeURIComponent(oAttachment.id)}`;

            oModel.setProperty("/pdfUrl", pdfUrl);
            oModel.setProperty("/pdfFileName", oAttachment.fileName);

            console.log("PDF viewer opened for:", oAttachment.fileName, "| url:", pdfUrl);

            this.byId("pdfPanel").getDomRef()?.scrollIntoView({ behavior: "smooth" });
        },

        onClosePdf() {
            const oModel = this.getView().getModel("view");
            oModel.setProperty("/pdfUrl", null);
            oModel.setProperty("/pdfFileName", "");
        }

    });
});